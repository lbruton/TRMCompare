# Changelog

All notable changes to TRMCompare are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/). Versioned with git tags.

## [1.2.1] - 2026-04-13

### Added

- Cisco IOS syntax highlighting for Before/After textareas — hostname prompts, MAC addresses, IPs, interfaces, keywords, comments, and section banners (TRMC-8)

## [1.2.0] - 2026-04-10

### Changed
- Heuristic port classifier returns `multi` (amber) instead of `trunk` (blue) when no `show vlan` evidence exists — reduces false trunk labels on hypervisor, Docker, and AP ports
- `trunk` label now only applied with definitive `show vlan` data

### Added
- Amber "Multi" port tag and filter pill — distinct from blue "Trunk"
- Updated disclaimer explaining multi vs trunk distinction

## [1.1.0] - 2026-04-04

### Fixed
- Export buttons (Excel + PDF) crash due to stale `compareMacTables` entry shape — rewritten for `buildAuditEntries` output

### Added
- `.gitattributes` — GitHub ZIP downloads now exclude dev files
- `CHANGELOG.md` — release history tracking
- `.gitignore` — ignore `.claude/`, `.spec-workflow/`, `.DS_Store`

## [1.0.0] - 2026-04-03

### Added
- Light/dark theme toggle with cool blue-gray stone palette
- F5 Heavy Industrial SVG logo and branding across all pages
- About page with screenshot walkthrough
- Self-host install guide at `/install/`
- Optional command indicators (amber) in capture card

## [0.9.0] - 2026-04-02

### Added
- Multi-command paste: `show mac address-table`, `show interfaces description`, `show cdp neighbors`, `show vlan`
- MAC-keyed audit view replacing the old diff view — one row per MAC, old/new side-by-side
- Layered port classification: MAC heuristic -> show vlan -> CDP confirmation
- Mismatch detection: VLAN, description, CDP, port type changes flagged with color badges
- Colored filter pills for port type (trunk/voice/access) and issue state (new/missing)
- Sortable audit table columns
- Excel (SheetJS) + PDF (jsPDF/AutoTable) export
- 100% client-side — data never leaves the browser
