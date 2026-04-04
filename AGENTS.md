# TRMCompare

Client-side Cisco switch migration audit tool. Compares MAC address tables side-by-side with VLAN, description, CDP, and port type mismatch detection.

## Quick Reference

- **Prefix:** TRMC
- **Issues:** `DocVault/Projects/TechRefreshMacCompare/Issues/`
- **DocVault:** `DocVault/Projects/TechRefreshMacCompare/Overview.md`
- **Deploy target:** GitHub Pages on `main` ([lbruton.github.io/TRMCompare](https://lbruton.github.io/TRMCompare/))
- **Versioning:** git tags (semver), changelog in `CHANGELOG.md`

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

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Main app entry point |
| `css/style.css` | All styles, CSS custom properties for theming |
| `about/index.html` | About page with screenshot walkthrough |
| `install/index.html` | Self-host install guide |
| `samples/` | Sample Cisco terminal output for testing |

## Data Shapes

`buildAuditEntries()` returns the canonical entry shape used by all rendering and export code:

```js
{ mac, old: { port, vlan, type, desc, cdp }, new: { port, vlan, type, desc, cdp }, issues: [] }
```

- `issues` contains: `'vlan'`, `'type'`, `'desc'`, `'cdp'`, `'new'`, `'missing'`
- All export and rendering code MUST consume this shape — never the old flat `compareMacTables` format

## Gotchas

- **Port type display:** `access` type renders as em-dash in both UI and exports — only `trunk`/`voice` get labels
- **Export parity:** Excel and PDF exports must match the audit table columns — reviewers flag mismatches
- **Module loading:** `libs/` scripts load as classic `<script>` tags (not modules) — they set `window.*` globals

## Development

```bash
python3 -m http.server 8080
# Open http://localhost:8080
```
