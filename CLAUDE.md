# TRMCompare

Client-side Cisco switch migration audit tool. Compares MAC address tables side-by-side with VLAN, description, CDP, and port type mismatch detection.

## Quick Reference

- **Prefix:** TRMC
- **Issues:** `DocVault/Projects/TechRefreshMacCompare/Issues/`
- **DocVault:** Start at `/Volumes/DATA/GitHub/DocVault/Projects/TechRefreshMacCompare/_Index.md` and follow the index
- **Deploy targets:** GitHub Pages (public), Portainer (internal dev/test), Docker (corp/self-host)
- **Versioning:** git tags (semver), changelog in `CHANGELOG.md`

## Architecture

Zero-dependency vanilla HTML/CSS/JS. Runs from any static file server, GitHub Pages, or Docker container.

| Module | Purpose |
|--------|---------|
| `js/parser.js` | Cisco MAC table parser (IOS, IOS-XE, NX-OS) + multi-command splitter |
| `js/diff.js` | MAC-keyed comparison engine with layered port classification |
| `js/export.js` | Excel (SheetJS) + PDF (jsPDF/AutoTable) export |
| `js/app.js` | UI orchestrator — DOM events, audit table rendering, sort/filter |

**Bundled libs (in `libs/`):** SheetJS, jsPDF, AutoTable

## Conventions

- ES modules for app code (`type="module"`), classic scripts for bundled libs
- Use inline bundled libs only — source all code and dependencies from the repository
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
| `Dockerfile` | nginx:alpine, non-root (UID 1001), port 8080, OpenShift-compatible |
| `nginx.conf` | Custom nginx config for rootless operation |
| `docker-compose.yml` | Portainer GitOps deploy (host port 8088) |

## Deploy / Test

Three deployment paths — use whichever fits the situation:

| Method | URL | When to use |
|--------|-----|-------------|
| **Portainer** | `http://192.168.1.81:8088` | Dev/test — auto-deploys from `main` via GitOps (5 min poll). Test here before waiting on GitHub Pages. Works offline on the LAN. |
| **GitHub Pages** | `https://lbruton.github.io/TRMCompare/` | Public production. Auto-deploys on push to `main`. |
| **Docker local** | `docker build -t trmc . && docker run -p 8080:8080 trmc` | Quick local testing or corp deployment. |

**Portainer stack:** ID 30, container `trmcompare`, GitOps tracking `refs/heads/main`.

**Workflow:** Push to `main` → Portainer picks it up in ~5 min → verify on `:8088` → GitHub Pages deploys shortly after.

## Data Shapes

`buildAuditEntries()` returns the canonical entry shape used by all rendering and export code:

```js
{ mac, old: { port, vlan, type, desc, cdp }, new: { port, vlan, type, desc, cdp }, issues: [] }
```

- `issues` contains: `'vlan'`, `'type'`, `'desc'`, `'cdp'`, `'new'`, `'missing'`
- All export and rendering code MUST consume this canonical shape exclusively — retire all references to the old flat `compareMacTables` format

## Gotchas

- **Port type display:** `access` type renders as em-dash in both UI and exports — only `trunk`/`voice` get labels
- **Export parity:** Excel and PDF exports must match the audit table columns — reviewers flag mismatches
- **Module loading:** `libs/` scripts load as classic `<script>` tags (not modules) — they set `window.*` globals
- **AI tooling gitignored:** CLAUDE.md, AGENTS.md, GEMINI.md, .agents/, .specflow/, .codacy.yml are gitignored (preserved locally via `/backup-claude`). They won't sync to corp GitLab mirror.

## Development

```bash
# Local dev server
python3 -m http.server 8080
# Open http://localhost:8080

# Docker
docker build -t trmc . && docker run -p 8080:8080 trmc
```
