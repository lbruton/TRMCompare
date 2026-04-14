/**
 * Cisco IOS syntax highlighter — vanilla JS ES module.
 * Adapted from Forge TypeScript/React reference.
 */

// ------------------------------------------------------------------
// Regex constants
// ------------------------------------------------------------------

const HOSTNAME_RE = /^(\s*[A-Za-z0-9_-]+(?:\([^)]*\))?[>#]\s*)(.*)$/;
const SECTION_BANNER_RE = /^!#{3,}\s*.*\s*-\s*(START|END)\s*#{3,}$/i;
const IPV4_RE = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;
const NUMBER_RE = /\b(\d+)\b/;

// MAC addresses: Cisco format xxxx.xxxx.xxxx or xxxx.xxxx.xxxx.xxxx.
// Explicit boundary checks avoid the finicky behaviour of \b with dot-separated hex.
const MAC_ADDRESS_RE = /(?<![0-9a-zA-Z])([0-9a-fA-F]{4}(?:\.[0-9a-fA-F]{4}){2,3})(?![0-9a-zA-Z])/;

// Expanded interface names.
const INTERFACE_NAME_RE = /\b((?:Port-channel|Loopback|Gi|Te|Fa|Eth|Tunnel|Serial|Vlan|Lo|Po)\S*)\b/;

const CLI_KEYWORDS = [
  'hostname', 'interface', 'ip', 'address', 'switchport', 'vlan',
  'access-list', 'permit', 'deny', 'shutdown', 'no', 'service',
  'aaa', 'radius', 'tacacs', 'dot1x', 'snmp-server', 'logging',
  'ntp', 'banner', 'line', 'crypto', 'spanning-tree', 'description',
  'clock', 'username', 'enable', 'secret', 'key', 'timeout',
  'transport', 'authentication', 'authorization', 'accounting',
  'device-tracking', 'mac', 'lldp', 'cdp', 'epm'
];

const KEYWORD_RE = new RegExp(
  '\\b(' + CLI_KEYWORDS.map(k => k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|') + ')\\b'
);

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ------------------------------------------------------------------
// Tokenizer
// ------------------------------------------------------------------

function tokenizeCli(remaining) {
  const tokens = [];

  while (remaining.length > 0) {
    let best = null;

    function tryMatch(re, className) {
      const m = re.exec(remaining);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, length: m[0].length, className, text: m[0] };
      }
    }

    tryMatch(MAC_ADDRESS_RE, 'mac-address');
    tryMatch(IPV4_RE, 'ip-address');
    tryMatch(INTERFACE_NAME_RE, 'interface');
    tryMatch(KEYWORD_RE, 'keyword');
    tryMatch(NUMBER_RE, 'number');

    if (best === null) {
      tokens.push({ text: remaining, className: 'text' });
      break;
    }

    if (best.index > 0) {
      tokens.push({ text: remaining.slice(0, best.index), className: 'text' });
    }
    tokens.push({ text: best.text, className: best.className });
    remaining = remaining.slice(best.index + best.length);
  }

  return tokens;
}

export function tokenizeLine(line) {
  if (line.length === 0) {
    return [{ text: '', className: 'text' }];
  }

  // Section banner lines (START/END markers)
  if (SECTION_BANNER_RE.test(line)) {
    return [{ text: line, className: 'section-banner' }];
  }

  // Comment line
  if (line.trimStart().startsWith('!')) {
    return [{ text: line, className: 'comment' }];
  }

  // Hostname prompt line
  const hostMatch = HOSTNAME_RE.exec(line);
  if (hostMatch) {
    const tokens = [{ text: hostMatch[1], className: 'hostname' }];
    const rest = hostMatch[2];
    if (rest.length > 0) {
      tokens.push(...tokenizeCli(rest));
    }
    return tokens;
  }

  return tokenizeCli(line);
}

// ------------------------------------------------------------------
// Highlight
// ------------------------------------------------------------------

export function highlight(text) {
  return text
    .split('\n')
    .map(line => {
      const tokens = tokenizeLine(line);
      return tokens
        .map(t => `<span class="token-${t.className}">${escapeHtml(t.text)}</span>`)
        .join('');
    })
    .join('\n');
}

// ------------------------------------------------------------------
// OverlayManager
// ------------------------------------------------------------------

export class OverlayManager {
  constructor(textareaId, overlayId) {
    this.textarea = document.getElementById(textareaId);
    this.overlay = document.getElementById(overlayId);
    if (!this.textarea || !this.overlay) {
      throw new Error('OverlayManager: textarea or overlay element not found');
    }
    this._ensurePositioning();
    this._observeResize();
  }

  _ensurePositioning() {
    const parent = this.textarea.parentElement;
    if (parent && window.getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    this.overlay.style.position = 'absolute';
    this.overlay.style.top = '0';
    this.overlay.style.left = '0';
  }

  _observeResize() {
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        this.syncStyles();
      });
      this._resizeObserver.observe(this.textarea);
    }
  }

  show() {
    this.syncStyles();
    this.overlay.style.visibility = 'visible';
    this.overlay.style.zIndex = '10';
    this.textarea.style.zIndex = '1';
    this.textarea.style.color = 'transparent';
  }

  hide() {
    this.overlay.style.visibility = 'hidden';
    this.textarea.style.color = '';
  }

  update(content) {
    this.overlay.innerHTML = content;
  }

  syncStyles() {
    const styles = window.getComputedStyle(this.textarea);
    const overlay = this.overlay;

    overlay.style.top = `${this.textarea.offsetTop}px`;
    overlay.style.left = `${this.textarea.offsetLeft}px`;
    overlay.style.fontFamily = styles.fontFamily;
    overlay.style.fontSize = styles.fontSize;
    overlay.style.lineHeight = styles.lineHeight;
    overlay.style.paddingTop = styles.paddingTop;
    overlay.style.paddingRight = styles.paddingRight;
    overlay.style.paddingBottom = styles.paddingBottom;
    overlay.style.paddingLeft = styles.paddingLeft;
    overlay.style.borderTopWidth = styles.borderTopWidth;
    overlay.style.borderRightWidth = styles.borderRightWidth;
    overlay.style.borderBottomWidth = styles.borderBottomWidth;
    overlay.style.borderLeftWidth = styles.borderLeftWidth;
    overlay.style.borderRadius = styles.borderRadius;
    overlay.style.width = styles.width;
    overlay.style.height = styles.height;
    overlay.style.boxSizing = styles.boxSizing;
  }

  syncScroll() {
    this.overlay.scrollTop = this.textarea.scrollTop;
    this.overlay.scrollLeft = this.textarea.scrollLeft;
  }
}
