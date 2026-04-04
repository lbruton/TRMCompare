---
name: deploy
description: Deploy TechRefreshMacCompare to the dufs static file server. Uploads all project files (index.html, css/, js/, libs/) to the dufs container via WebDAV/curl. Use when the user says "deploy", "upload", "publish", "push to dufs", or "update dufs".
---

# Deploy to dufs

Uploads the TechRefreshMacCompare tool to the dufs static file server on Portainer.

## Target

| Property | Value |
|----------|-------|
| dufs URL | `http://192.168.1.81:8060` |
| Remote path | `/tools/TechRefreshMacCompare/` |
| Public URL | `https://dufs.lbruton.cc/tools/TechRefreshMacCompare/` |
| Source | `/Volumes/DATA/GitHub/TechRefreshMacCompare/` |

## Files to deploy

Only deploy web-serving files — skip git/Codex config:

- `index.html`
- `css/` (all files recursively)
- `js/` (all files recursively)
- `libs/` (all files recursively)

**Exclude:** `AGENTS.md`, `README.md`, `.Codex/`, `.git/`, `.DS_Store`

## Procedure

### 1. Upload using curl WebDAV

```bash
DEST="http://192.168.1.81:8060/tools/TechRefreshMacCompare"
SRC="/Volumes/DATA/GitHub/TechRefreshMacCompare"

# Ensure remote directory exists
curl -s -X MKCOL "$DEST/" 2>/dev/null || true

# Upload index.html
curl -s -X PUT "$DEST/index.html" --data-binary "@$SRC/index.html"

# Upload directories (create dirs first, then files)
for dir in css js libs; do
  if [ -d "$SRC/$dir" ]; then
    # Create remote subdirs
    find "$SRC/$dir" -type d | while read d; do
      rel="${d#$SRC/}"
      curl -s -X MKCOL "$DEST/$rel/" 2>/dev/null || true
    done
    # Upload files
    find "$SRC/$dir" -type f ! -name '.DS_Store' | while read f; do
      rel="${f#$SRC/}"
      curl -s -X PUT "$DEST/$rel" --data-binary "@$f"
    done
  fi
done
```

### 2. Verify

```bash
# Check the deployed page returns 200
curl -s -o /dev/null -w "%{http_code}" https://dufs.lbruton.cc/tools/TechRefreshMacCompare/index.html
```

### 3. Report

Show a summary:
- Number of files uploaded
- Public URL: `https://dufs.lbruton.cc/tools/TechRefreshMacCompare/`
- Timestamp of deploy
