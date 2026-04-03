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
 * Prompt line pattern: hostname#show ... or hostname>show ...
 * Captures: (1) hostname, (2) everything after "show "
 */
const PROMPT_RE = /^(\S+)[#>]show\s+(.+)$/;

/**
 * Commands we recognize (matched against the text after "show ").
 * Each entry is a substring that must appear at the start of the command portion.
 */
const RECOGNIZED_COMMANDS = [
  'mac address-table',
  'interfaces description',
  'cdp neighbors',
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

    // Check if this matches a recognized command
    const matched = RECOGNIZED_COMMANDS.find(cmd =>
      showArgs.toLowerCase().startsWith(cmd)
    );
    if (!matched) continue;

    if (!hostname) hostname = promptHost;
    boundaries.push({ index: i, command: showArgs });
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

  // Port-like pattern fragment for matching interface names with optional spaces
  // e.g. "Gig 1/0/1", "Fas 0/1", "Ten 1/0/1", "Eth1/1", "GigabitEthernet0/0"
  const PORT_PATTERN = /(?:Gig(?:abitEthernet)?|Fas(?:tEthernet)?|Ten(?:GigabitEthernet)?|Eth(?:ernet)?|Twe(?:ntyFiveGigE)?|Po(?:rt-channel)?)\s*[\d/]+/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    // Skip header/legend lines
    if (/^Capability Codes/i.test(trimmed)) continue;
    if (/^\s/.test(line) && !/\S+\s+/.test(trimmed.replace(/^\s+/, ''))) continue; // indented continuation of legend
    if (/Device ID/i.test(trimmed) && /Local/i.test(trimmed)) continue;
    if (/^[-\s]+$/.test(trimmed)) continue;
    if (/^Total cdp entries/i.test(trimmed)) continue;

    // Skip indented capability code continuation lines (start with whitespace, contain only short tokens like letters/commas)
    if (/^\s/.test(line) && /^[A-Z\s,\-=]+$/i.test(trimmed) && trimmed.length < 80) continue;

    // Try to parse a CDP neighbor line.
    // Strategy: Device ID is first token, then find a port pattern for local interface,
    // then a holdtime number, capability letters, platform, and remote port.
    const cdpMatch = trimmed.match(
      new RegExp(
        '^(\\S+)\\s+(' + PORT_PATTERN.source + ')\\s+(\\d+)\\s+([A-Za-z](?:\\s+[A-Za-z])*)\\s+(\\S+)\\s+(' + PORT_PATTERN.source + ')\\s*$',
        'i'
      )
    );

    if (!cdpMatch) continue;

    const deviceId = cdpMatch[1];
    const localPort = normalizePort(cdpMatch[2]);
    // cdpMatch[3] = holdtime (unused)
    // cdpMatch[4] = capabilities (unused)
    const platform = cdpMatch[5];
    const remotePort = normalizePort(cdpMatch[6]);

    result.set(localPort, { deviceId, platform, remotePort });
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
 */
const STANDARD_COMMANDS = [
  'mac address-table',
  'interfaces description',
  'cdp neighbors',
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
    cdpNeighbors: null,
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
      } else if (cmd.includes('cdp neighbors')) {
        result.cdpNeighbors = parseCdpNeighbors(block.text);
      } else if (cmd.startsWith('vlan')) {
        result.vlanData = parseVlan(block.text);
      }
    } catch (_e) {
      // Parser threw — leave its result as null and continue
      if (cmd.includes('mac address-table')) macFound = true; // still counts as found
    }
  }

  // If MAC table block not found among blocks, try entire text as fallback
  if (!macFound) {
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

  // Build commandsFound / commandsMissing
  const foundSet = new Set();
  if (macFound) foundSet.add('mac address-table');
  if (result.interfaceDesc !== null) foundSet.add('interfaces description');
  if (result.cdpNeighbors !== null) foundSet.add('cdp neighbors');
  if (result.vlanData !== null) foundSet.add('vlan');

  result.commandsFound = STANDARD_COMMANDS.filter(c => foundSet.has(c));
  result.commandsMissing = STANDARD_COMMANDS.filter(c => !foundSet.has(c));

  return result;
}
