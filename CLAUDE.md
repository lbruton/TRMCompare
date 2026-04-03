# TRMCompare

Client-side Cisco switch migration audit tool. Compares MAC address tables side-by-side with VLAN, description, CDP, and port type mismatch detection.

## Quick Reference

- **Prefix:** TRMC
- **Issues:** `DocVault/Projects/TechRefreshMacCompare/Issues/`
- **DocVault:** `DocVault/Projects/TechRefreshMacCompare/Overview.md`
- **Deploy target:** dufs at `/tools/TechRefreshMacCompare/` and GitHub Pages

## Architecture

Zero-dependency vanilla HTML/CSS/JS. Runs from any static file server or GitHub Pages.

| Module | Purpose |
|--------|---------|
| `js/parser.js` | Cisco MAC table parser (IOS, IOS-XE, NX-OS) + multi-command splitter |
| `js/diff.js` | MAC-keyed comparison engine with layered port classification |
| `js/export.js` | Excel (SheetJS) + PDF (jsPDF/AutoTable) export |
| `js/app.js` | UI orchestrator — DOM events, audit table rendering, sort/filter |

**Bundled libs (in `libs/`):** SheetJS, jsPDF, AutoTable

## Conventions

- ES modules for app code (`type="module"`), classic scripts for bundled libs
- No CDN, no npm, no build step
- Dark professional theme via CSS custom properties
- All user input HTML-escaped via `textContent`

## Development

```bash
python3 -m http.server 8080
# Open http://localhost:8080
```
