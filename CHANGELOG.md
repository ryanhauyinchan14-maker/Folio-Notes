# Changelog

All notable changes to **Folio Notes** are documented in this file.

## [1.4.20] - 2026-11-24

### Fixed
- **Superscripts & Subscripts in AI Handwriting Correction:** Render handwritten exponents (`x²`, `x^2`, `x^{n+1}`, `e^-x`, `(x+1)^2`) and subscripts (`H₂O`, `H_2O`, `a_{n-1}`) as genuinely raised/lowered scaled vector ink strokes instead of literal `^` carets or fallback dashes, while updating Vision OCR prompts to transcribe math expressions verbatim.
- **Smooth Continuous Vector Ink:** Chained multi-segment curves across letters and digits and rendered `isTidied` strokes without zero-width start/end tapers, eliminating pinched bowtie creases on characters such as `e`, `d`, `0`, `2`, and `5`.
- **Auto AI Handwriting Reliability:** Expanded stroke/cluster height limits (`220px` stroke / `260px` cluster), accepted fast 2-point strokes (`1`, `-`, `=`), preserved large handwriting scale up to `160px`, scaled accessory and word-gap detection proportionally, increased trailing pause to `900ms`, prevented accessories from flushing their own word prematurely, supported Split Screen pages, tightened neighbor baseline alignment, and dynamically padded Vision OCR PNG crops for thick pens.

## [1.4.19] - 2026-11-24

### Changed
- Added a subtle frosted paper-shader backdrop and translucent scrim to the **Update Ready** toast card for cohesive floating glass styling.

## [1.4.18] - 2026-11-24

### Added
- **Precision Thickness Slider:** Retained the 3 quick thickness presets in the floating sub-bar while adding a compact dropdown toggle with an interactive range slider (`1px–15px` for Pen, `6px–48px` for Highlighter).

## [1.4.17] - 2026-11-24

### Added
- **Customizable Interface Typography:** Added an Interface Font picker in **Settings → Appearance** featuring 22 curated fonts, Electron Windows system font discovery, custom Google/OS font lookup, and offline `.ttf` / `.otf` / `.woff` / `.woff2` font imports persisted in Dexie `v4`.

## [1.4.16] - 2026-11-24

### Added
- **Hold Right-Click Lasso:** Holding the right mouse button in **Pen** or **Select** mode temporarily activates Lasso selection on release/drag, while right-clicking an already-selected element preserves its context menu.

## [1.4.15] - 2026-11-24

### Changed
- Refined active smoked-glass button edges and contrast, removed unnecessary decorative icons and hyphenated UI microcopy, and simplified redundant Settings toggles.

## [1.3.0 - 1.4.14] - 2026-11-24

### Added
- **Editorial Seal & Crimson Glass UI (`DESIGN.md`):** Frosted floating editor islands, magnetic bottom tool dock, animated WebGL MeshGradient shelf hero, and 3D tilt notebook cover cards.
- **Split Screen Editing:** Side-by-side dual-notebook view from the Pages drawer with independent pages/zoom and shared top controls.
- **Print Preview & Command Palette:** Dedicated Print Preview dialog with live sheet preview, native system print / Save as PDF, and global `Ctrl+K` Command Palette.
- **7-Day Trash & Vault Delete Protection:** Recently Deleted shelf section, 5-second `Ctrl+Z` notebook deletion undo, and password-verified deletion for Vault-locked items.
- **Updater & Micro-Sounds:** Built-in GitHub / local update checker with toast notifications and opt-in subtle UI audio feedback.

## [1.1.0 - 1.2.1] - 2026-11-23

### Added
- **Infinite Whiteboard & Smart Zoom:** Unbounded pan-and-zoom canvases, Fit Content / Reset View, Kleki-style middle-click panning, and context-aware `Ctrl+Scroll`.
- **Multi-Provider BYOK AI & Handwriting Cleanup:** Support for Gemini, OpenAI, xAI Grok, Anthropic Claude, and custom endpoints via Electron zero-CORS proxy, Markdown + KaTeX rendering, Stroke & Precision erasers, and live vector AI handwriting replacement.

## [1.0.0] - 2026-11-22

### Added
- Initial **Folio Notes** desktop release with local Dexie notebooks, folders, built-in and custom paper templates, offline PDF import/annotation, Universal Select alignment/grouping/locking, AES-GCM Vault encryption, export to PDF/PNG/JPG/SVG/Folio, and Windows NSIS installer.
