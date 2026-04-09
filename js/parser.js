// Cisco MAC address table parser
// Implements: parseMacTable(), detectFormat(), normalizePort(), splitCommands(),
//             parseInterfaceDescription(), parseCdpNeighbors(), parseVlan(),
//             parseTerminalOutput()

const IOS_RE = /^\s*(\d+)\s+([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})\s+(\w+)\s+(\S+)\s*$/;
const NXOS_RE = /^\*?\s*(\d+)\s+([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})\s+(\w+)\s+\S+\s+\S+\s+\S+\s+(\S+)\s*$/;

/**
 * Returns true if a line should be silently skipped (header, separator, footer, legend).
 */
function isSkippable(line) {
  const trimmed = line.trim();
  if (trimmed === '') return true;

  // Separator lines: only dashes, spaces, and plus signs
  if (/^[-\s+]+$/.test(trimmed)) return true;

  // Header lines containing column names
  if (/vlan/i.test(trimmed) && /mac/i.test(trimmed)) return true;

  // Common title lines
  if (/^mac address table/i.test(trimmed)) return true;

  // Footer lines
  if (/^total mac addresses/i.test(trimmed)) return true;

  // VLAN "All" entries (system/CPU MACs) — not relevant for migration audits
  if (/^\s*All\s+/i.test(trimmed)) return true;

  // Legend and section labels
  if (/^legend:/i.test(trimmed)) return true;
  if (/multicast entries/i.test(trimmed)) return true;
  if (/unicast entries/i.test(trimmed)) return true;

  return false;
}

/**
 * Detect whether raw text is IOS or NX-OS format.
 * Returns "ios", "nxos", or "unknown".
 */
export function detectFormat(rawText) {
  if (!rawText) return 'unknown';
  const lines = rawText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // NX-OS indicators: leading *, or header with "age" and "NTFY"
    if (/^\*/.test(trimmed) && NXOS_RE.test(trimmed)) return 'nxos';
    if (/age/i.test(trimmed) && /ntfy/i.test(trimmed)) return 'nxos';
  }

  for (const line of lines) {
    if (IOS_RE.test(line.trim())) return 'ios';
  }

  return 'unknown';
}

/**
 * Parse a Cisco MAC address table (IOS/IOS-XE or NX-OS).
 * Returns { entries: MacEntry[], format: string, errors: string[] }
 */
export function parseMacTable(rawText) {
  const entries = [];
  const errors = [];

  if (!rawText) {
    return { entries, format: 'unknown', errors };
  }

  const lines = rawText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (isSkippable(trimmed)) continue;

    // Try IOS first
    let m = IOS_RE.exec(trimmed);
    if (m) {
      entries.push({
        vlan: parseInt(m[1], 10),
        mac: m[2].toLowerCase(),
        type: m[3],
        port: normalizePort(m[4]),
      });
      continue;
    }

    // Try NX-OS
    m = NXOS_RE.exec(trimmed);
    if (m) {
      entries.push({
        vlan: parseInt(m[1], 10),
        mac: m[2].toLowerCase(),
        type: m[3],
        port: normalizePort(m[4]),
      });
      continue;
    }

    // Unparseable data line
    errors.push(`Line ${i + 1}: ${trimmed}`);
  }

  const format = detectFormat(rawText);
  return { entries, format, errors };
}

// --- Shared patterns ---

/**
 * Port-like pattern fragment for matching Cisco interface names with optional spaces.
 * e.g. "Gig 1/0/1", "Fas 0/1", "Ten 1/0/1", "Eth1/1", "GigabitEthernet0/0"
 */
const PORT_PATTERN = /(?:Gig(?:abitEthernet)?|Fas(?:tEthernet)?|Ten(?:GigabitEthernet)?|Eth(?:ernet)?|Twe(?:ntyFiveGigE)?|Po(?:rt-channel)?|Gi|Te|Fa)\s*[\d/]+/i;

// --- Port normalization ---

/**
 * Port-name normalization rules: [regex, shortPrefix].
 * Order matters — longer prefixes first to avoid partial matches.
 * Each regex is case-insensitive and anchored to start-of-string.
 */
const PORT_RULES = [
  [/^TwentyFiveGigE\s*/i, 'Twe'],
  [/^TenGigabitEthernet\s*/i, 'Te'],
  [/^Ten\s+/i, 'Te'],
  [/^GigabitEthernet\s*/i, 'Gi'],
  [/^Gig\s+/i, 'Gi'],
  [/^FastEthernet\s*/i, 'Fa'],
  [/^Fas\s+/i, 'Fa'],
  [/^Ethernet\s*/i, 'Eth'],
  [/^Port-channel\s*/i, 'Po'],
  [/^Vlan\s*/i, 'Vl'],
];

/**
 * Normalize a Cisco port name to its canonical short form.
 * Already-short names pass through unchanged.
 *
 * @param {string} portName - e.g. "GigabitEthernet1/0/1", "Gig 1/0/1", "Gi1/0/1"
 * @returns {string} - e.g. "Gi1/0/1"
 */
export function normalizePort(portName) {
  if (!portName) return portName;
  const trimmed = portName.trim();

  for (const [re, prefix] of PORT_RULES) {
    if (re.test(trimmed)) {
      return prefix + trimmed.replace(re, '');
    }
  }

  return trimmed;
}

// --- Multi-command splitter ---

/**
 * Prompt line pattern: hostname#show/sh ... or hostname>show/sh ...
 * Captures: (1) hostname, (2) everything after "show " or "sh "
 */
const PROMPT_RE = /^(\S+)[#>]sh(?:ow)?\s+(.+)$/;

/**
 * Abbreviation map: maps common abbreviated command forms to their canonical form.
 * Falls back to RECOGNIZED_COMMANDS for exact matches not listed here.
 * Order: most specific first.
 */
const COMMAND_ALIASES = [
  // MAC address table
  ['mac ad',               'mac address-table'],
  ['mac address-table',    'mac address-table'],
  // Interfaces
  ['int stat',             'interfaces status'],
  ['inter stat',           'interfaces status'],
  ['interfaces stat',      'interfaces status'],
  ['interfaces status',    'interfaces status'],
  ['int desc',             'interfaces description'],
  ['inter desc',           'interfaces description'],
  ['interfaces desc',      'interfaces description'],
  ['interfaces description', 'interfaces description'],
  // CDP
  ['cdp nei',              'cdp neighbors'],
  ['cdp neighbors',        'cdp neighbors'],
  // LLDP
  ['lldp nei',             'lldp neighbors'],
  ['lldp neighbors',       'lldp neighbors'],
  // VLAN
  ['vlan br',              'vlan brief'],
  ['vlan brief',           'vlan brief'],
  ['vlan',                 'vlan'],
];

/**
 * Resolve a raw show-command argument to its canonical recognized form.
 * Returns the canonical command string, or null if unrecognized.
 */
function resolveCommand(showArgs) {
  const lower = showArgs.toLowerCase();
  for (const [abbrev, canonical] of COMMAND_ALIASES) {
    if (lower.startsWith(abbrev)) return canonical;
  }
  // Fallback: check if it exactly matches a recognized command not in COMMAND_ALIASES
  for (const cmd of RECOGNIZED_COMMANDS) {
    if (lower.startsWith(cmd)) return cmd;
  }
  return null;
}

/**
 * Commands we recognize (used for commandsFound/commandsMissing reporting).
 */
const RECOGNIZED_COMMANDS = [
  'mac address-table',
  'interfaces description',
  'interfaces status',
  'cdp neighbors',
  'lldp neighbors',
  'vlan brief',
  'vlan',
];

/**
 * Split raw terminal output containing multiple "show" commands into blocks.
 *
 * @param {string} rawText - Pasted terminal output, possibly with multiple show commands
 * @returns {{ hostname: string|null, blocks: Array<{ command: string, text: string }> }}
 */
export function splitCommands(rawText) {
  if (!rawText) return { hostname: null, blocks: [] };

  const lines = rawText.split('\n');
  let hostname = null;
  const boundaries = []; // { index, command }

  for (let i = 0; i < lines.length; i++) {
    const m = PROMPT_RE.exec(lines[i].trim());
    if (!m) continue;

    const promptHost = m[1];
    const showArgs = m[2].trim();

    // Resolve abbreviated command to canonical form
    const canonical = resolveCommand(showArgs);
    if (!canonical) continue;

    if (!hostname) hostname = promptHost;
    boundaries.push({ index: i, command: canonical });
  }

  if (boundaries.length === 0) {
    return { hostname: null, blocks: [] };
  }

  const blocks = [];
  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b].index + 1; // line after the prompt
    const end = b + 1 < boundaries.length ? boundaries[b + 1].index : lines.length;
    blocks.push({
      command: boundaries[b].command,
      text: lines.slice(start, end).join('\n'),
    });
  }

  return { hostname, blocks };
}

// --- show interfaces description parser ---

/**
 * Parse Cisco "show interfaces description" output.
 *
 * @param {string} text - Raw command output
 * @returns {Map<string, { status: string, protocol: string, description: string }>}
 *          Keyed by normalized port name
 */
export function parseInterfaceDescription(text) {
  const result = new Map();
  if (!text) return result;

  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    // Skip header line
    if (/Interface/i.test(trimmed) && /Status/i.test(trimmed) && /Protocol/i.test(trimmed)) continue;

    // Skip separator lines
    if (/^[-\s]+$/.test(trimmed)) continue;

    // Match data lines. Status can be multi-word ("admin down", "administratively down").
    // Pattern: interface  status  protocol  [description]
    // We use a regex that captures the known status+protocol combinations.
    const m = trimmed.match(
      /^(\S+)\s+(up|down|admin down|administratively down)\s+(up|down)\s*(.*)$/i
    );
    if (!m) continue;

    const port = normalizePort(m[1]);
    const status = m[2].toLowerCase();
    const protocol = m[3].toLowerCase();
    const description = m[4] ? m[4].trim() : '';

    result.set(port, { status, protocol, description });
  }

  return result;
}

// --- show interfaces status parser ---

/**
 * Parse Cisco "show interfaces status" output.
 * Columns: Port, Name, Status, Vlan, Duplex, Speed, Type
 *
 * Returns the same Map shape as parseInterfaceDescription() for compatibility,
 * plus access VLAN info that can enrich port classification.
 *
 * @param {string} text - Raw command output
 * @returns {{ descriptions: Map<string, { status: string, protocol: string, description: string }>,
 *             portVlans: Map<string, number|'trunk'|'routed'> }}
 */
export function parseInterfaceStatus(text) {
  const descriptions = new Map();
  const portVlans = new Map();
  if (!text) return { descriptions, portVlans };

  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    // Skip header line
    if (/^Port\s+/i.test(trimmed) && /Status/i.test(trimmed)) continue;

    // Skip separator lines
    if (/^[-\s]+$/.test(trimmed)) continue;

    // Match data lines:
    // Port         Name               Status       Vlan       Duplex  Speed Type
    // Gi1/0/1      Video Camera       connected    35         a-full  a-100 10/100/1000BaseTX
    // Te1/1/3      hostnnswan01-f1/0  connected    trunk      full    1000  1000BaseSX SFP
    // Gi1/0/2                         notconnect   40         auto    auto  10/100/1000BaseTX
    //
    // Strategy: Port is first token. Then we scan right-to-left for the fixed-width fields
    // (Type, Speed, Duplex, Vlan, Status) and what remains is Name.
    const m = trimmed.match(
      /^(\S+)\s+(.*?)\s+(connected|notconnect|disabled|err-disabled|inactive|monitoring)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/i
    );
    if (!m) continue;

    const port = normalizePort(m[1]);
    const name = m[2] ? m[2].trim() : '';
    const status = m[3].toLowerCase();
    const vlanField = m[4];
    // m[5] = duplex, m[6] = speed, m[7] = type (unused for now)

    // Map status to protocol-style values for compatibility with interfaceDesc consumers
    const isUp = (status === 'connected');
    const mappedStatus = isUp ? 'up' : (status === 'disabled' ? 'admin down' : 'down');
    const mappedProtocol = isUp ? 'up' : 'down';

    descriptions.set(port, {
      status: mappedStatus,
      protocol: mappedProtocol,
      description: name,
    });

    // Extract VLAN info
    if (vlanField.toLowerCase() === 'trunk') {
      portVlans.set(port, 'trunk');
    } else if (vlanField.toLowerCase() === 'routed') {
      portVlans.set(port, 'routed');
    } else {
      const vlanNum = parseInt(vlanField, 10);
      if (!isNaN(vlanNum)) {
        portVlans.set(port, vlanNum);
      }
    }
  }

  return { descriptions, portVlans };
}

// --- show cdp neighbors parser ---

/**
 * Parse Cisco "show cdp neighbors" compact (non-detail) output.
 *
 * @param {string} text - Raw command output
 * @returns {Map<string, { deviceId: string, platform: string, remotePort: string }>}
 *          Keyed by normalized local port
 */
export function parseCdpNeighbors(text) {
  const result = new Map();
  if (!text) return result;

  const lines = text.split('\n');

  let pendingDeviceId = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') { pendingDeviceId = null; continue; }

    // Skip header/legend lines
    if (/^Capability Codes/i.test(trimmed)) continue;
    if (/Device ID/i.test(trimmed) && /Local/i.test(trimmed)) continue;
    if (/^[-\s]+$/.test(trimmed)) continue;
    if (/^Total cdp entries/i.test(trimmed)) continue;

    // Skip indented capability code continuation lines
    if (/^\s/.test(line) && /^[A-Z\s,\-=]+$/i.test(trimmed) && trimmed.length < 80) continue;

    // Try single-line match: DeviceID  LocalIntf  Holdtime  Capability  Platform  RemotePort
    const cdpMatch = trimmed.match(
      new RegExp(
        '^(\\S+)\\s+(' + PORT_PATTERN.source + ')\\s+(\\d+)\\s+([A-Za-z](?:\\s+[A-Za-z])*)\\s+(\\S+)\\s+(' + PORT_PATTERN.source + ')\\s*$',
        'i'
      )
    );

    if (cdpMatch) {
      const deviceId = cdpMatch[1];
      const localPort = normalizePort(cdpMatch[2]);
      const platform = cdpMatch[5];
      const remotePort = normalizePort(cdpMatch[6]);
      result.set(localPort, { deviceId, platform, remotePort });
      pendingDeviceId = null;
      continue;
    }

    // Multi-line: device ID alone on first line (long hostname wraps)
    // Check if this is a standalone device ID (single non-whitespace token, no port pattern)
    if (!PORT_PATTERN.test(trimmed) && /^\S+$/.test(trimmed) && !/^Total/i.test(trimmed)) {
      pendingDeviceId = trimmed;
      continue;
    }

    // Multi-line continuation: indented line with port data, preceded by a device ID line
    if (pendingDeviceId && /^\s/.test(line)) {
      const contMatch = trimmed.match(
        new RegExp(
          '^(' + PORT_PATTERN.source + ')\\s+(\\d+)\\s+([A-Za-z](?:\\s+[A-Za-z])*)\\s+(\\S+)\\s+(' + PORT_PATTERN.source + ')\\s*$',
          'i'
        )
      );
      if (contMatch) {
        const localPort = normalizePort(contMatch[1]);
        const platform = contMatch[4];
        const remotePort = normalizePort(contMatch[5]);
        result.set(localPort, { deviceId: pendingDeviceId, platform, remotePort });
        pendingDeviceId = null;
        continue;
      }
    }

    pendingDeviceId = null;
  }

  return result;
}

// --- show lldp neighbors parser ---

/**
 * Parse Cisco "show lldp neighbors" compact output.
 * Returns same shape as parseCdpNeighbors() for interchangeability.
 *
 * LLDP format:
 *   Device ID           Local Intf     Hold-time  Capability      Port ID
 *   west-gate-pns.53    Gi1/0/12       20                         port-001
 *
 * Note: Device ID can run into Local Intf without whitespace on long hostnames.
 *
 * @param {string} text - Raw command output
 * @returns {Map<string, { deviceId: string, platform: string, remotePort: string }>}
 *          Keyed by normalized local port
 */
export function parseLldpNeighbors(text) {
  const result = new Map();
  if (!text) return result;

  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    // Skip header/legend lines
    if (/^Capability codes/i.test(trimmed)) continue;
    if (/^\s*\(/.test(trimmed)) continue; // capability legend continuation
    if (/Device ID/i.test(trimmed) && /Local/i.test(trimmed)) continue;
    if (/^[-\s]+$/.test(trimmed)) continue;
    if (/^Total entries/i.test(trimmed)) continue;

    // Find the local interface port pattern in the line
    const portMatch = trimmed.match(PORT_PATTERN);
    if (!portMatch) continue;

    const portStart = trimmed.indexOf(portMatch[0]);
    const deviceId = trimmed.substring(0, portStart).trim();
    if (!deviceId) continue;

    const localPort = normalizePort(portMatch[0]);

    // After local port, find: holdtime, capability (optional), port ID
    const remainder = trimmed.substring(portStart + portMatch[0].length).trim();
    const parts = remainder.split(/\s+/);

    // Last token is remote port ID — normalize for interchangeability with CDP output
    const remotePort = parts.length > 0 ? normalizePort(parts[parts.length - 1]) : '';

    result.set(localPort, { deviceId, platform: 'LLDP', remotePort });
  }

  return result;
}

// --- show vlan parser ---

/**
 * Parse Cisco "show vlan" or "show vlan brief" output.
 *
 * @param {string} text - Raw command output
 * @returns {{ names: Map<number, string>, portVlans: Map<string, Set<number>> }}
 *          names: VLAN ID → name, portVlans: normalized port → Set of VLAN IDs
 */
export function parseVlan(text) {
  const names = new Map();
  const portVlans = new Map();
  if (!text) return { names, portVlans };

  const lines = text.split('\n');
  let currentVlan = null;
  let pastHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Stop at second table section (e.g. "VLAN Type  SAID")
    if (pastHeader && /^VLAN\s+Type/i.test(trimmed)) break;

    // Skip header
    if (/VLAN/i.test(trimmed) && /Name/i.test(trimmed) && /Status/i.test(trimmed)) {
      pastHeader = true;
      continue;
    }

    // Skip separator lines
    if (/^[-\s]+$/.test(trimmed)) continue;

    if (trimmed === '') {
      // Blank line might signal end of first table section
      // Check if next non-blank line is a different table header
      continue;
    }

    // Try to match a VLAN data line
    const vlanMatch = trimmed.match(
      /^(\d+)\s+(\S+)\s+(active|suspend|act\/unsup|inactive)\s*(.*)?$/i
    );

    if (vlanMatch) {
      const vlanId = parseInt(vlanMatch[1], 10);
      const name = vlanMatch[2];
      const portsStr = vlanMatch[4] ? vlanMatch[4].trim() : '';

      // Skip system default VLANs
      if (vlanId >= 1002 && vlanId <= 1005) {
        currentVlan = null;
        continue;
      }

      names.set(vlanId, name);
      currentVlan = vlanId;

      // Parse ports from this line
      if (portsStr) {
        parsePorts(portsStr, vlanId, portVlans);
      }
      continue;
    }

    // Continuation line: starts with spaces and contains port-like names
    if (/^\s/.test(line) && currentVlan !== null && trimmed !== '') {
      parsePorts(trimmed, currentVlan, portVlans);
    }
  }

  return { names, portVlans };
}

/**
 * Parse a comma-separated port list and add to portVlans map.
 * Each port maps to a Set of VLAN IDs (a port can be in multiple VLANs, e.g. voice+data).
 * Handles trailing commas gracefully.
 */
function parsePorts(portsStr, vlanId, portVlans) {
  const parts = portsStr.split(',');
  for (const part of parts) {
    const p = part.trim();
    if (p === '') continue;
    const port = normalizePort(p);
    if (!portVlans.has(port)) {
      portVlans.set(port, new Set());
    }
    portVlans.get(port).add(vlanId);
  }
}

// --- Top-level orchestrator ---

/**
 * Standard command set for tracking found/missing.
 * "interfaces description" and "interfaces status" are alternatives — either satisfies enrichment.
 */
const STANDARD_COMMANDS = [
  'mac address-table',
  'interfaces description',
  'interfaces status',
  'cdp neighbors',
  'lldp neighbors',
  'vlan',
];

/**
 * Top-level orchestrator that parses raw terminal output containing one or more
 * Cisco show commands. Replaces direct parseMacTable() calls from app.js.
 *
 * Backward compatible: MAC-only pastes (no prompts) still work identically.
 *
 * @param {string} rawText - Raw pasted terminal output
 * @returns {{
 *   macEntries: Array,
 *   macFormat: string,
 *   macErrors: string[],
 *   interfaceDesc: Map|null,
 *   cdpNeighbors: Map|null,
 *   vlanData: { names: Map, portVlans: Map }|null,
 *   hostname: string|null,
 *   commandsFound: string[],
 *   commandsMissing: string[],
 * }}
 */
export function parseTerminalOutput(rawText) {
  const result = {
    macEntries: [],
    macFormat: 'unknown',
    macErrors: [],
    interfaceDesc: null,
    interfaceStatus: null,
    cdpNeighbors: null,
    lldpNeighbors: null,
    vlanData: null,
    hostname: null,
    commandsFound: [],
    commandsMissing: [],
  };

  if (!rawText) return result;

  const { hostname, blocks } = splitCommands(rawText);

  // No prompts found — Phase 1 backward compatibility
  if (blocks.length === 0) {
    const mac = parseMacTable(rawText);
    result.macEntries = mac.entries;
    result.macFormat = mac.format;
    result.macErrors = mac.errors;
    result.commandsFound = mac.entries.length > 0 ? ['mac address-table'] : [];
    result.commandsMissing = [];
    return result;
  }

  // Multi-command mode
  result.hostname = hostname;
  let macFound = false;

  for (const block of blocks) {
    const cmd = block.command.toLowerCase();

    try {
      if (cmd.includes('mac address-table')) {
        const mac = parseMacTable(block.text);
        result.macEntries = mac.entries;
        result.macFormat = mac.format;
        result.macErrors = mac.errors;
        macFound = true;
      } else if (cmd.includes('interfaces description')) {
        result.interfaceDesc = parseInterfaceDescription(block.text);
      } else if (cmd.includes('interfaces status')) {
        result.interfaceStatus = parseInterfaceStatus(block.text);
        // Also populate interfaceDesc from status data for backward compatibility
        if (!result.interfaceDesc) {
          result.interfaceDesc = result.interfaceStatus.descriptions;
        }
      } else if (cmd.includes('cdp neighbors')) {
        result.cdpNeighbors = parseCdpNeighbors(block.text);
      } else if (cmd.includes('lldp neighbors')) {
        result.lldpNeighbors = parseLldpNeighbors(block.text);
        // Also populate cdpNeighbors from LLDP for backward compatibility
        if (!result.cdpNeighbors) {
          result.cdpNeighbors = result.lldpNeighbors;
        }
      } else if (cmd.startsWith('vlan')) {
        result.vlanData = parseVlan(block.text);
      }
    } catch (_e) {
      // Parser threw — leave its result as null and continue
      if (cmd.includes('mac address-table')) macFound = true; // still counts as found
    }
  }

  // If MAC table block not found among recognized blocks, try entire text as fallback.
  // Only do this if we found very few blocks (likely a MAC-only paste with stray prompts).
  // In multi-command mode with several blocks, a missing MAC table is intentional — don't
  // pollute macErrors by parsing the whole dump (running config, version, etc.).
  if (!macFound && blocks.length <= 1) {
    try {
      const mac = parseMacTable(rawText);
      result.macEntries = mac.entries;
      result.macFormat = mac.format;
      result.macErrors = mac.errors;
      if (mac.entries.length > 0) macFound = true;
    } catch (_e) {
      // leave defaults
    }
  }

  // Build commandsFound / commandsMissing from actually-parsed blocks only
  // (not from synthesized compat aliases like interfaceDesc from interfaceStatus)
  const foundSet = new Set();
  if (macFound) foundSet.add('mac address-table');
  if (result.vlanData !== null) foundSet.add('vlan');
  for (const block of blocks) {
    const cmd = block.command.toLowerCase();
    if (cmd.includes('interfaces description')) foundSet.add('interfaces description');
    if (cmd.includes('interfaces status')) foundSet.add('interfaces status');
    if (cmd.includes('cdp neighbors')) foundSet.add('cdp neighbors');
    if (cmd.includes('lldp neighbors')) foundSet.add('lldp neighbors');
  }

  result.commandsFound = STANDARD_COMMANDS.filter(c => foundSet.has(c));
  result.commandsMissing = STANDARD_COMMANDS.filter(c => !foundSet.has(c));

  return result;
}
