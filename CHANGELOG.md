# Changelog

All notable changes to **Folio Notes / Folio Studio** are documented in this file.

## [2.1.0] - 2026-11-26

### Added
- **3-Mode Studio Template Gallery (`TemplatePickerModal.tsx`):**
  - Expanded Templates from Drawing-Board-only into a full 3-mode gallery with **Docs (4)** (`Meeting Notes`, `Lecture & Study Doc`, `Project Brief`, `Weekly Planner`) and **Slides (4)** (`Pitch Deck 16:9`, `Study Guide Deck 16:9`, `Creative Showcase 16:9`, `Square Carousel 1:1`) alongside Whiteboards, Built-in Papers, and My Templates.
  - Added Doc and Slide templates directly into Home Shelf search and the `Ctrl+K` Command Palette.
- **Studio Mode Defaults in Preferences (`SettingsModal.tsx`, `settings.ts`):**
  - Added dedicated **General & Studio** mode defaults for Drawing Board default brush, Docs default page layout (`Paginated` / `Pageless`), and Slides default aspect ratio (`16:9`, `4:3`, `1:1`, `9:16`, `A4`), plus quick UI scale preset pills (`100%`–`200%`).
- **Framed Inset Notebook Outline for Imported PDFs (`CoverPreview.tsx`, `NotebookModal.tsx`):**
  - Imported PDFs (including already-imported worksheets) now display their page preview smaller and centered inside a crisp white mini-sheet frame within a navy bound notebook outline (left spine ridge, right paper-stack edge, clear top title header with zero text overlap, and `PDF` pill), with a `Framed Inset / Full Bleed` toggle in Cover Settings.

### Changed
- **200% Ctrl+Scroll & UI Scale Ceiling (`uiZoom.ts`, `electron/preload.ts`, `NotesEditor.tsx`, `SlideStageCanvas.tsx`):**
  - Raised whole-app `Ctrl + Scroll` / UI Scale ceiling from `150%` to **`200%`** across Web, Electron (`webFrame.setZoomFactor`), and Settings, and added smooth `Ctrl + Scroll` zooming up to `200%` in both Notes Mode and Slides Mode.
- **Modernized `"Your Notes, Ready."` Home Shelf & Command Studio (`HomeShelf.tsx`, `CommandPaletteModal.tsx`, `NotebookModal.tsx`, `shortcuts.ts`):**
  - Redesigned the hero creation strip around 3 vibrant pink pill buttons (**New Canvas**, **New Doc**, **New Slides**) beside frosted secondary pills (`Infinite Board`, `Import PDF`, `Import .folio`), added inline mode filter pills (`All`, `Canvases`, `Docs`, `Slides`), and modernized copy and shortcuts across all studio modals.
- **Performance & Lag Elimination:**
  - Cached built-in Template Gallery thumbnails at module level (eliminating synchronous canvas generation stutter on modal open), switched the left nav capsule shader from a 2nd continuous 60fps WebGL loop to `static-accent`, batched `repository.getShelfItems` first-page queries via `bulkGet`, skipped redundant root IndexedDB library scans, memoized Settings font filtering during UI scale dragging, shared one `prefers-reduced-motion` listener across all `BookTiltCard` items with stable memoized callbacks, and updated Trash optimistically on delete.

## [2.0.0] - 2026-11-25

### Added
- **3-Mode Studio Architecture & Home Shelf Workspace Rail:**
  - Reorganized the library with a left workspace switcher (`All`, `Drawing Board`, `Notes`, `Slides`), one-click mode creation cards, and distinct mode badges across all notebook covers.
- **Google Docs-Inspired Notes Mode:**
  - Full TipTap rich-text document studio with headings (`H1–H3`), formatting toolbar (font family, size, color, highlight, alignment, line spacing), checklists, tables, inline images, collapsible Callout blocks, KaTeX math blocks, `/` slash command menu, document Outline sidebar, live word/reading-time count, document AI assistant panel, and PDF/Markdown/HTML/Word export.
- **Canva-Inspired Slides Mode (16:9 Default + Custom Size):**
  - Widescreen `16:9` (`1920×1080`) default slide deck with Canva-style **Custom Size** modal (`16:9`, `4:3`, `1:1`, `9:16`, `A4`, custom `W × H`, aspect lock, proportional element scaling), 6-tab left rail (`Layouts`, `Elements`, `Text`, `Uploads`, `Backgrounds`, `Draw`), direct-manipulation canvas stage (drag, snap guides, 8 resize handles, rotation + 15° snap), bottom filmstrip + speaker notes, full-screen Present Mode with laser pointer, PDF export, and PNG ZIP export.
- **Procreate-Inspired Drawing Board Mode Upgrades:**
  - Added **Brush Studio** (`Technical Pen`, `Fountain Nib`, `Graphite Pencil`, `Soft Airbrush`, `Watercolor Wash`, `Studio Marker`, `Monoline`, `Highlighter`) with Size, Opacity, and Streamline stabilization plus collapsible left-edge quick sliders.
  - Added **Layers Panel** with per-layer visibility, opacity, blend modes (`Normal`, `Multiply`, `Screen`, `Overlay`, `Darken`, `Lighten`), Lock, Alpha Lock, duplicate, reorder, merge down, clear, and AES-GCM Vault encryption persistence.
  - Added **Color Studio** interactive HSB square + hue bar + harmonies + saved palettes + pixel **Eyedropper** (`I`), **ColorDrop Fill** (`G`), **Symmetry Guides** (`Vertical`, `Horizontal`, `Quadrant`, `Radial`), and **90° Rotate / Flip** transforms on selected strokes.

### Changed
- Removed Drawing Board Mode's `Text` dock tool, `T` shortcut, and accidental/printable-key textbox spawning so Drawing Board Mode behaves as a pure distraction-free illustration studio while keeping rich text in **Notes Mode** and **Slides Mode**.

## [1.5.1] - 2026-11-25

### Changed
- **Hardware, Memory & GPU Optimization (Zero Behavioral Change):**
  - **GPU / WebGL:** Immediately release the `canUseWebGL()` probe context via `WEBGL_lose_context`, pause offscreen hero WebGL shaders automatically via `IntersectionObserver`, and tuned shader `maxPixelCount` budgets (`800×450` hero, `240×480` nav capsule, `640×320` accent) while keeping identical visuals and `webgl` mode.
  - **Canvas VRAM Virtualization:** Extended offscreen viewport culling (`IntersectionObserver`, `1000px` overscan) to all standard notebook pages so far-offscreen pages release their `staticCanvas` / `activeCanvas` backing stores until scrolled near, lazily allocate `activeCanvas` only while actively drawing/hovering/transforming, cap canvas backing DPR at `2`, and release canvas buffers on unmount.
  - **CPU & RAM Hygiene:** Added bounded 48-entry LRU eviction + notebook-close cleanup to the decoded image element cache, eliminated per-frame `StrokePoint[]` array copies in `getFreehandStrokeOutline`, skipped unnecessary `Set`/`Array.sort` allocations on empty render passes, stabilized `onRecordCursorPoint`, and memoized `PageCanvas`, `PaperShaderBackdrop`, and `BookTiltCard`.
  - **Faster Startup & Smaller Parse Footprint:** Switched `pdfjs-dist` to lazy on-demand dynamic loading and added Vite vendor chunk splitting (`vendor-pdfjs`, `vendor-pdflib`, `vendor-katex`, `vendor-genai`, `vendor-shaders`, `vendor-storage`, `vendor-react`).

## [1.5.0] - 2026-11-25

### Added
- **Universal Cross-Platform Support (Windows, macOS, Linux, iOS, iPadOS, Android & Web):**
  - Added full PWA support (`manifest.webmanifest`, offline Service Worker `sw.js`, iOS `apple-touch-icon` & safe-area viewport handling, and an in-app `Install App` prompt when installable on Chrome/Edge/Android).
  - Added cross-platform desktop packaging targets in `package.json` and `.github/workflows/release.yml` for **macOS** (`.dmg` + `.zip` on Apple Silicon `arm64` & Intel `x64`), **Linux** (`.AppImage` + `.deb`), and **Windows** (`.exe` NSIS + Portable), plus GitHub Pages deployment (`.github/workflows/pages.yml`) and 3-OS CI verification (`windows-latest`, `macos-latest`, `ubuntu-latest`).
  - Added macOS (`⌘`) application menu support and cross-platform OS font discovery (`fc-list` + font directory scanning on Linux and `/System/Library/Fonts` + `Library/Fonts` on macOS).
  - Added mobile multi-touch gestures: two-finger pinch-to-zoom and pan on both Notebooks and Infinite Whiteboards, a two-finger touch palm/pinch guard to prevent stray strokes on tablets/phones, and responsive `< 400px` top bar layout.

## [1.4.21] - 2026-11-25

### Fixed
- **Thinking-Model & Thin-Pen Live Handwriting Reliability:** Raised live OCR `maxTokens` (`2048`) and used `max_completion_tokens` for GPT-5/o-series models so reasoning models never return empty strings on short math chunks (`y = 5`, `50`), boosted thin-pen contrast on OCR snapshots without altering ink style, stripped accidental wrapper quotes/backticks, and tightened `EMPTY` criteria.
- **Adjacent-Stroke Sweep, Serial Queue & Auto-Retry:** Added `expandClusterWithAdjacentUntidiedStrokes` to pull stranded same-line strokes (`y = 5` next to `00x²`) into the active flush, serialized live OCR requests with automatic single-retry backoff on transient failures, and prevented Hold-to-Snap from converting small pen glyphs mid-word.

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
