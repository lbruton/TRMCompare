// MAC table comparison engine
// Implements: compareMacTables(), buildLookupMap(), classifyPorts()
// TRMC-3: enrichment support (descriptions, CDP, VLAN names) and definitive port classification

/**
 * Build a lookup map keyed by "vlan:mac" from an array of MacEntry objects.
 * @param {Array<{vlan: number, mac: string, type: string, port: string}>} entries
 * @returns {Map<string, {vlan: number, mac: string, type: string, port: string}>}
 */
export function buildLookupMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    const key = `${entry.vlan}:${entry.mac}`;
    map.set(key, entry);
  }
  return map;
}

/**
 * Classify ports using all available data layers.
 * Returns a Map<port, 'trunk'|'voice'|null>.
 *
 * Layered classification (most confident wins):
 *
 * Layer 1 — MAC table heuristic (always available):
 *   - 3+ VLANs on one port → trunk
 *   - 2 VLANs, exactly 1 MAC per VLAN → voice (classic phone+PC pattern)
 *   - 2 VLANs, any VLAN has 2+ MACs → trunk
 *   - 1 VLAN, 2+ MACs → trunk (multiple devices behind an uplink)
 *   - 1 MAC, 1 VLAN → null (access port)
 *
 * Layer 2 — show vlan (definitive access/trunk split):
 *   Ports listed in "show vlan" are access ports; absent ports are trunks.
 *   Voice detection: port appears in 2+ VLANs in show vlan output.
 *
 * Layer 3 — CDP neighbors (confirms voice):
 *   Device IDs starting with "SEP" or platforms starting with "CP-" or
 *   "IP Phone" confirm a port is voice, even if VLAN data is ambiguous.
 *
 * @param {Array} entries - MacEntry array
 * @param {Object} [layers] - Optional additional data layers:
 *   @param {Map<string, number>} [layers.vlanPorts] - Map of normalizedPort → vlanId from "show vlan"
 *   @param {Map<string, number>} [layers.portVlanCount] - Map of normalizedPort → number of VLANs it appears in (from show vlan)
 *   @param {Map<string, {deviceId: string, platform: string, remotePort: string}>} [layers.cdp] - CDP neighbor data
 */
export function classifyPorts(entries, layers) {
  const vlanPorts = layers?.vlanPorts ?? null;
  const cdp = layers?.cdp ?? null;

  // Backward compat: if layers is a Map (old call signature), treat as vlanPorts
  const isLegacyMap = layers instanceof Map;
  const effectiveVlanPorts = isLegacyMap ? layers : vlanPorts;

  let result;

  if (effectiveVlanPorts && effectiveVlanPorts.size > 0) {
    result = _classifyPortsDefinitive(entries, effectiveVlanPorts, cdp);
  } else {
    result = _classifyPortsHeuristic(entries);
  }

  // Layer 3: CDP refinement (when no show vlan data, or to catch edge cases)
  if (cdp && cdp.size > 0) {
    for (const [port, neighbor] of cdp) {
      if (!result.has(port)) continue;
      const current = result.get(port);
      if (_isCdpPhone(neighbor) && current !== 'trunk') {
        // CDP confirms phone → voice
        result.set(port, 'voice');
      } else if (!_isCdpPhone(neighbor) && current === 'voice') {
        // CDP shows non-phone on a multi-VLAN port → not voice, just access
        result.set(port, null);
      }
    }
  }

  return result;
}

/** Check if a CDP neighbor looks like a phone */
function _isCdpPhone(neighbor) {
  if (!neighbor) return false;
  const id = (neighbor.deviceId || '').toUpperCase();
  const platform = (neighbor.platform || '').toUpperCase();
  return id.startsWith('SEP') || platform.startsWith('CP-') || platform.includes('PHONE');
}

/**
 * Definitive classification using show vlan data.
 * Ports in show vlan = access, absent = trunk.
 * Voice detection: port assigned to 2+ VLANs in show vlan (e.g. data + voice VLAN).
 *
 * @param {Array} entries - MacEntry array
 * @param {Map<string, Set<number>>} vlanPorts - port → Set of VLAN IDs from show vlan parser
 */
function _classifyPortsDefinitive(entries, vlanPorts) {
  const result = new Map();

  const seenPorts = new Set();
  for (const entry of entries) {
    seenPorts.add(entry.port);
  }

  for (const port of seenPorts) {
    if (!vlanPorts.has(port)) {
      // Not in show vlan = trunk
      result.set(port, 'trunk');
    } else {
      // In show vlan = access. Check for voice: port in 2+ VLANs
      const assignedVlans = vlanPorts.get(port);
      if (assignedVlans.size >= 2) {
        result.set(port, 'voice');
      } else {
        result.set(port, null);
      }
    }
  }

  return result;
}

/** Original heuristic classification — internal helper */
function _classifyPortsHeuristic(entries) {
  // Group by port: { macs: Set, vlans: Set, macsPerVlan: Map<vlan, count> }
  const portStats = new Map();
  for (const entry of entries) {
    let stats = portStats.get(entry.port);
    if (!stats) {
      stats = { macs: new Set(), vlans: new Set(), macsPerVlan: new Map() };
      portStats.set(entry.port, stats);
    }
    stats.macs.add(entry.mac);
    stats.vlans.add(entry.vlan);
    stats.macsPerVlan.set(entry.vlan, (stats.macsPerVlan.get(entry.vlan) || 0) + 1);
  }

  const result = new Map();
  for (const [port, stats] of portStats) {
    const vlanCount = stats.vlans.size;
    const macCount = stats.macs.size;

    if (vlanCount >= 3) {
      result.set(port, 'trunk');
    } else if (vlanCount === 2) {
      // Classic voice: exactly 1 MAC per VLAN (phone + PC)
      const allSingle = [...stats.macsPerVlan.values()].every(c => c === 1);
      result.set(port, allSingle ? 'voice' : 'trunk');
    } else if (macCount >= 2) {
      // Single VLAN but multiple MACs → uplink/trunk
      result.set(port, 'trunk');
    } else {
      result.set(port, null);
    }
  }
  return result;
}

/** Status sort priority — lower number sorts first */
const STATUS_ORDER = { moved: 0, removed: 1, new: 2, unchanged: 3 };

/**
 * Compare two MAC table snapshots and produce a diff with summary.
 * @param {Array} before - MacEntry array from the "before" snapshot
 * @param {Array} after  - MacEntry array from the "after" snapshot
 * @param {Object} [portProfiles] - Optional { before: Map, after: Map } from classifyPorts()
 * @param {Object} [enrichment] - Optional enrichment data from multi-command parsing:
 *   { before: { descriptions, cdp, vlanNames }, after: { descriptions, cdp, vlanNames } }
 *   - descriptions: Map<normalizedPort, { status, protocol, description }>
 *   - cdp: Map<normalizedPort, { deviceId, platform, remotePort }>
 *   - vlanNames: Map<number, string>
 * @returns {{ entries: Array, summary: { moved: number, new: number, removed: number, unchanged: number, total: number } }}
 */
export function compareMacTables(before, after, portProfiles, enrichment) {
  const beforeMap = buildLookupMap(before);
  const afterMap = buildLookupMap(after);
  const beforeTags = portProfiles ? portProfiles.before : new Map();
  const afterTags = portProfiles ? portProfiles.after : new Map();

  // Enrichment maps (all optional)
  const bDesc = enrichment?.before?.descriptions ?? null;
  const aDesc = enrichment?.after?.descriptions ?? null;
  const bCdp = enrichment?.before?.cdp ?? null;
  const aCdp = enrichment?.after?.cdp ?? null;
  const bVlanNames = enrichment?.before?.vlanNames ?? null;
  const aVlanNames = enrichment?.after?.vlanNames ?? null;

  /** Format CDP neighbor as "deviceId via remotePort", or null */
  function fmtCdp(cdpMap, port) {
    if (!cdpMap || !port) return null;
    const c = cdpMap.get(port);
    return c ? `${c.deviceId} via ${c.remotePort}` : null;
  }

  /** Look up VLAN name from before or after enrichment */
  function lookupVlanName(vlan) {
    return bVlanNames?.get(vlan) ?? aVlanNames?.get(vlan) ?? null;
  }

  /** Build enrichment fields for a diff entry */
  function enrich(beforePort, afterPort, vlan) {
    return {
      beforeDescription: bDesc?.get(beforePort)?.description ?? null,
      afterDescription: aDesc?.get(afterPort)?.description ?? null,
      beforeCdpNeighbor: fmtCdp(bCdp, beforePort),
      afterCdpNeighbor: fmtCdp(aCdp, afterPort),
      vlanName: lookupVlanName(vlan),
    };
  }

  const entries = [];

  // Walk the "after" map — detects unchanged, moved, and new
  for (const [key, afterEntry] of afterMap) {
    const beforeEntry = beforeMap.get(key);
    if (beforeEntry) {
      const status = beforeEntry.port === afterEntry.port ? 'unchanged' : 'moved';
      entries.push({
        status,
        vlan: afterEntry.vlan,
        mac: afterEntry.mac,
        beforePort: beforeEntry.port,
        afterPort: afterEntry.port,
        beforePortTag: beforeTags.get(beforeEntry.port) || null,
        afterPortTag: afterTags.get(afterEntry.port) || null,
        type: afterEntry.type,
        ...enrich(beforeEntry.port, afterEntry.port, afterEntry.vlan),
      });
    } else {
      entries.push({
        status: 'new',
        vlan: afterEntry.vlan,
        mac: afterEntry.mac,
        beforePort: null,
        afterPort: afterEntry.port,
        beforePortTag: null,
        afterPortTag: afterTags.get(afterEntry.port) || null,
        type: afterEntry.type,
        ...enrich(null, afterEntry.port, afterEntry.vlan),
      });
    }
  }

  // Walk the "before" map — detects removed
  for (const [key, beforeEntry] of beforeMap) {
    if (!afterMap.has(key)) {
      entries.push({
        status: 'removed',
        vlan: beforeEntry.vlan,
        mac: beforeEntry.mac,
        beforePort: beforeEntry.port,
        afterPort: null,
        beforePortTag: beforeTags.get(beforeEntry.port) || null,
        afterPortTag: null,
        type: beforeEntry.type,
        ...enrich(beforeEntry.port, null, beforeEntry.vlan),
      });
    }
  }

  // Sort: moved → removed → new → unchanged, then by VLAN asc, then MAC asc
  entries.sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDiff !== 0) return statusDiff;
    const vlanDiff = a.vlan - b.vlan;
    if (vlanDiff !== 0) return vlanDiff;
    return a.mac < b.mac ? -1 : a.mac > b.mac ? 1 : 0;
  });

  // Compute summary
  const summary = { moved: 0, new: 0, removed: 0, unchanged: 0, total: 0 };
  for (const entry of entries) {
    summary[entry.status]++;
  }
  summary.total = entries.length;

  return { entries, summary };
}

/**
 * Build a MAC-keyed map: mac → { port, vlans: Set<number> }
 * Groups all VLAN appearances per MAC into one entry, picking the port from the first seen.
 * A MAC on a trunk will have multiple VLANs; on an access port, just one.
 */
function buildMacMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (!map.has(entry.mac)) {
      map.set(entry.mac, { mac: entry.mac, port: entry.port, vlans: new Set() });
    }
    map.get(entry.mac).vlans.add(entry.vlan);
  }
  return map;
}

/**
 * Build audit entries for the side-by-side migration audit view.
 * Each entry represents one unique MAC address with old and new switch data side by side,
 * plus mismatch flags for VLAN, port type, description, and CDP.
 *
 * Keyed by MAC (not vlan:mac) so a MAC that moves between VLANs shows as one row
 * with a VLAN mismatch, not as separate removed+new entries.
 *
 * @param {Array} before - MacEntry array
 * @param {Array} after - MacEntry array
 * @param {Object} portProfiles - { before: Map, after: Map } from classifyPorts()
 * @param {Object} enrichment - { before: { descriptions, cdp, vlanNames }, after: { ... } }
 * @returns {Array<AuditEntry>}
 */
export function buildAuditEntries(before, after, portProfiles, enrichment) {
  const beforeMacs = buildMacMap(before);
  const afterMacs = buildMacMap(after);
  const beforeTags = portProfiles?.before ?? new Map();
  const afterTags = portProfiles?.after ?? new Map();

  const bDesc = enrichment?.before?.descriptions ?? null;
  const aDesc = enrichment?.after?.descriptions ?? null;
  const bCdp = enrichment?.before?.cdp ?? null;
  const aCdp = enrichment?.after?.cdp ?? null;

  function getDesc(descMap, port) {
    return descMap?.get(port)?.description ?? null;
  }
  function getCdp(cdpMap, port) {
    if (!cdpMap || !port) return null;
    const c = cdpMap.get(port);
    return c ? `${c.deviceId} via ${c.remotePort}` : null;
  }
  function formatVlans(vlans) {
    if (!vlans || vlans.size === 0) return null;
    if (vlans.size === 1) return [...vlans][0];
    return [...vlans].sort((a, b) => a - b).join(', ');
  }
  function vlansEqual(a, b) {
    if (!a || !b) return a === b;
    if (a.size !== b.size) return false;
    for (const v of a) { if (!b.has(v)) return false; }
    return true;
  }

  const entries = [];
  const allMacs = new Set([...beforeMacs.keys(), ...afterMacs.keys()]);

  for (const mac of allMacs) {
    const b = beforeMacs.get(mac) ?? null;
    const a = afterMacs.get(mac) ?? null;

    const oldPort = b?.port ?? null;
    const newPort = a?.port ?? null;
    const oldVlans = b?.vlans ?? null;
    const newVlans = a?.vlans ?? null;
    const oldType = oldPort ? (beforeTags.get(oldPort) || 'access') : null;
    const newType = newPort ? (afterTags.get(newPort) || 'access') : null;
    const oldDesc = getDesc(bDesc, oldPort);
    const newDesc = getDesc(aDesc, newPort);
    const oldCdp = getCdp(bCdp, oldPort);
    const newCdp = getCdp(aCdp, newPort);

    const issues = [];
    if (b && a) {
      if (!vlansEqual(oldVlans, newVlans)) issues.push('vlan');
      if (oldType !== newType) issues.push('type');
      if (oldDesc && newDesc && oldDesc !== newDesc) issues.push('desc');
      if (oldCdp && newCdp && oldCdp !== newCdp) issues.push('cdp');
    } else if (!b) {
      issues.push('new');
    } else {
      issues.push('missing');
    }

    entries.push({
      mac,
      old: { port: oldPort, vlan: formatVlans(oldVlans), type: oldType, desc: oldDesc, cdp: oldCdp },
      new: { port: newPort, vlan: formatVlans(newVlans), type: newType, desc: newDesc, cdp: newCdp },
      issues,
    });
  }

  // Sort: entries with issues first, then by old port, then MAC
  entries.sort((a, b) => {
    const aHasIssue = a.issues.length > 0 && a.issues[0] !== 'new' ? 0 : a.issues[0] === 'new' ? 1 : 2;
    const bHasIssue = b.issues.length > 0 && b.issues[0] !== 'new' ? 0 : b.issues[0] === 'new' ? 1 : 2;
    if (aHasIssue !== bHasIssue) return aHasIssue - bHasIssue;
    const portA = a.old.port || a.new.port || '';
    const portB = b.old.port || b.new.port || '';
    if (portA !== portB) return portA.localeCompare(portB);
    return a.mac.localeCompare(b.mac);
  });

  return entries;
}
