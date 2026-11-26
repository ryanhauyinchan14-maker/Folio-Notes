# Folio Studio (Folio Notes)

A local-first **Drawing Board**, **Notes**, and **Slides** studio for **Windows, macOS, Linux, iOS/iPadOS, Android, and modern web browsers**, built with Electron, React, TypeScript, PWA offline caching, TipTap, and Canvas 2D.

Folio Studio stores illustrations, rich-text documents, slide decks, imported PDFs, templates, and custom fonts locally on your machine in IndexedDB with optional AES-GCM encrypted Vault locks and bring-your-own-key (BYOK) AI assistance.

---

## Features

- **Unified 3-Mode Workspace & Home Shelf**
  - Switch cleanly between **All Workspaces**, **Drawing Board Mode**, **Notes Mode**, and **Slides Mode** from the floating left navigation rail, with one-click creation cards and mode badges across covers.
- **Drawing Board Mode (Procreate-Inspired Illustration Studio)**
  - Pure text-box-free drawing workspace (no Text dock button or accidental keystroke textbox spawning) for both paged sheets (`Letter`, `A4`, `Legal`, `Tabloid`, `Custom`, PDF annotations) and unbounded **Infinite Boards**.
  - **Brush Studio:** 8 expressive brushes (`Technical Pen`, `Fountain Nib`, `Graphite Pencil`, `Soft Airbrush`, `Watercolor Wash`, `Studio Marker`, `Monoline`, `Highlighter`) with Size, Opacity, Streamline stabilization, and collapsible left-edge Procreate-style Size/Opacity quick sliders.
  - **Layers Stack:** Per-page multi-layer compositing with Visibility, Opacity, Blend Modes (`Normal`, `Multiply`, `Screen`, `Overlay`, `Darken`, `Lighten`), Lock, Alpha Lock, Duplicate, Reorder, Merge Down, Clear, and Vault encryption.
  - **Color Studio, Symmetry & Vector Canvas Tools:** Interactive HSB square + Hue slider + Hex picker + Harmonies + Saved Palettes, pixel **Eyedropper (`I`)**, scanline **ColorDrop Fill (`G`)**, **Symmetry Guides** (`Vertical`, `Horizontal`, `Quadrant`, 8-fold `Radial`), **90° Rotate / Flip** for selected strokes, **Hold-to-Snap** geometry, **Precision & Whole-Stroke Erasers**, and **Split Screen** dual-board editing.
- **Notes Mode (Google Docs-Inspired Document Studio)**
  - Modular rich-text editor powered by TipTap v3 (`H1–H3`, Font family/size/color/highlight, alignment, bulleted/numbered/checklist items, inline images, interactive 3×3+ tables with header/row/column controls, Callout blocks, and live **KaTeX math blocks**).
  - Type `/` anywhere for the **Slash Command** block menu, browse the live **Document Outline** sidebar, track live word/character/reading-time stats, switch between **Paginated** and **Pageless** views, ask the Document AI Study assistant, and export to **PDF**, **Markdown (`.md`)**, **Standalone HTML**, or **Word (`.doc`)**.
- **Slides Mode (Canva-Inspired Presentation Studio)**
  - Opens in widescreen **`16:9` (`1920 × 1080`)** by default, with a one-click **Custom Size** modal (`16:9`, `4:3`, `1:1`, `9:16`, `A4 Landscape`, or custom `W × H` with aspect ratio lock and proportional element scaling).
  - **6-Tab Studio Rail:** `Layouts` (7 starter templates), `Elements` (10 customizable SVG shapes), `Text` (headings, subheadings, body, callout badges), `Uploads` (images), `Backgrounds` (solids, gradients, custom image/color), and `Draw` (freehand slide ink).
  - **Direct-Manipulation Stage & Filmstrip:** Drag with magnetic center snap guides, 8-handle resize, rotation handle with 15° Shift snap, thumbnail slide filmstrip (add, duplicate, reorder, delete), and **Speaker Notes** drawer.
  - **Present Mode & Export:** Full-screen presentation viewer with transitions, elapsed timer, Speaker Notes overlay (`N`), interactive **Laser Pointer (`L`)**, and high-DPI export to **PDF** or **PNG Slide Pack (`.zip`)**.
- **BYOK AI Study Suite & Handwriting Conversion**
  - Connect **Google Gemini**, **OpenAI**, **xAI Grok**, **Anthropic Claude**, or any **OpenAI-compatible / Ollama** endpoint via zero-CORS Electron IPC fetch.
  - Built-in **Ask Notes**, **Math Tutor**, **Quizzes & Flashcards**, **Study Visuals**, and **Auto AI Handwriting Correction** with superscript (`x²`), subscript (`H₂O`), and single-step Undo.
- **Privacy, Vault Security & Cross-Platform Craft**
  - 100% local IndexedDB storage (Dexie v5) with `.folio.json` backup/restore, **Vault AES-GCM** notebook encryption (protecting strokes, layers, Notes documents, Slides decks, and PDFs), **7-day Trash** with `Ctrl+Z` Delete Undo, Editorial Glass UI (`DESIGN.md`) with animated WebGL paper-shader hero, Command Palette (`Ctrl+K`), OS + Google Fonts + custom `.ttf/.otf/.woff/.woff2` imports, and native Print Preview.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Desktop Shell** | Electron 45, Node.js main/preload IPC, `electron-builder` (Windows NSIS/Portable, macOS DMG/ZIP, Linux AppImage/deb), `electron-updater` |
| **UI & Styling** | React 19, TypeScript, Vite 8, Tailwind CSS v4, `@paper-design/shaders-react`, `lucide-react`, KaTeX |
| **Canvas, Docs & Slides** | HTML5 Canvas 2D, `perfect-freehand`, TipTap v3.35, `pdfjs-dist`, `pdf-lib`, `jszip` |
| **State & Storage** | Zustand, Dexie v5 (IndexedDB), Web Crypto API (AES-GCM Vault encryption) |
| **Testing** | Vitest, `jsdom`, `fake-indexeddb`, `@napi-rs/canvas` |

---

## Getting Started

### Prerequisites

- **Node.js 24+** and **npm**
- Runs natively on **Windows**, **macOS** (`arm64` & `x64`), **Linux** (`AppImage` & `.deb`), and as an installable offline **PWA** on **iOS**, **iPadOS**, **Android**, and desktop browsers.

### Installation & Development

```bash
# Install dependencies
npm install

# Start Vite dev server (browser / mobile PWA testing)
npm run dev

# Start full Electron desktop app in dev mode
npm run electron:dev
```

### Verification & Builds

```bash
# Run TypeScript checks (renderer + Electron main/preload)
npm run typecheck

# Run full Vitest suite
npm run test -- --maxWorkers=4

# Build web/PWA bundle (dist/)
npm run build

# Package desktop installers into release/
npm run electron:build         # Windows (NSIS + Portable)
npm run electron:build:mac     # macOS (DMG + ZIP, arm64 & x64)
npm run electron:build:linux   # Linux (AppImage + deb)
```

---

## Project Structure

```text
├── electron/                 # Electron main process, preload bridge, print, system fonts & updater
├── scripts/                  # Icon generation & local update manifest scripts
├── public/                   # PWA manifest, Service Worker & multi-platform app icons
├── src/
│   ├── ai/                   # Multi-provider BYOK AI client, snapshots, handwriting OCR & study suite
│   ├── canvas/               # Brush engine, color math, symmetry, ColorDrop fill, vector font & geometry
│   ├── notes/                # TipTap extensions (Callout, KaTeX Math) & PDF/MD/HTML/Word exporters
│   ├── slides/               # Slide presets (16:9 default), 10 shapes, 7 layouts, PDF & PNG-ZIP export
│   ├── components/
│   │   ├── common/           # Frosted glass controls, shaders, sliders, update toast
│   │   ├── editor/           # Drawing Board workspace, Brush/Layers/Color popovers, AI sidebar
│   │   ├── notes/            # Notes Mode toolbar, slash menu, outline sidebar & AI assistant
│   │   ├── slides/           # Slides Mode stage, left rail, Custom Size modal, filmstrip & Present Mode
│   │   ├── modals/           # Settings, Print Preview, Export, Command Palette, Vault & Folder modals
│   │   └── shelf/            # Home Shelf workspace switcher, shader hero & 3D tilt book cards
│   ├── constants/            # Built-in cover presets & paper configurations
│   ├── db/                   # Dexie v5 schema & encrypted/local notebook repository
│   ├── store/                # Zustand application & updater stores
│   ├── types/                # Shared domain TypeScript interfaces
│   └── utils/                # Export pipeline, PDF import, shortcuts, fonts, sounds & Vault crypto
├── .github/workflows/        # GitHub Actions CI, GitHub Pages PWA & multi-OS tagged release builds
├── DESIGN.md                 # Editorial Studio design system & token specification
└── CHANGELOG.md              # Release history
```

---

## Releases & CI

- Every push and pull request to `main` runs typechecking, Vitest tests, Vite build, and Electron compilation across **Windows, macOS, and Linux** via [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
- Pushing to `main` also publishes the installable web **PWA** via [`.github/workflows/pages.yml`](.github/workflows/pages.yml) for **iPhone, iPad, Android, and Chrome/Safari/Edge**.
- Pushing a version tag matching `v*` (for example `v2.0.0`) triggers [`.github/workflows/release.yml`](.github/workflows/release.yml) to build and publish **Windows**, **macOS**, and **Linux** installers to GitHub Releases.
