# Folio Notes

A local-first digital notebook and infinite whiteboard desktop application built with Electron, React, TypeScript, and Canvas 2D.

Folio Notes stores notebooks, pages, ink strokes, imported PDFs, templates, and custom fonts locally on your machine with IndexedDB, optional AES-GCM encrypted Vault notebooks, multi-provider bring-your-own-key (BYOK) AI study tools, and crisp vector handwriting correction.

---

## Features

- **Notebooks & Infinite Whiteboards**
  - Create structured multi-page notebooks (blank, ruled, grid, dotted, Cornell, or custom paper templates) or unbounded pan-and-zoom whiteboards.
  - Import multi-page PDF documents offline and annotate directly over rendered pages.
  - Open two notebooks side by side with **Split Screen** editing and shared tool controls.
- **Natural Ink & Precision Canvas Tools**
  - Pressure-aware **Pen** and **Highlighter** powered by `perfect-freehand`, with 3 quick thickness presets plus an expandable `1px–15px` (Pen) / `6px–48px` (Highlighter) precision slider.
  - **Hold-to-Snap** straight lines, rectangles, and circles; **Stroke** and **Precision** erasers; and **Hold Right-Click** temporary Lasso selection while in Pen or Select mode.
  - **Universal Select** marquee with drag-and-drop alignment guides, group/ungroup, lock/unlock, and rich textboxes.
- **BYOK AI Study Suite & Vector Handwriting Correction**
  - Connect **Google Gemini**, **OpenAI**, **xAI Grok**, **Anthropic Claude**, or any **OpenAI-compatible / Ollama** endpoint via a zero-CORS Electron IPC fetch bridge.
  - Built-in **Ask Notes**, **Math Tutor**, **Quizzes & Flashcards**, **Study Visuals**, and **Handwriting Transcription** with KaTeX math rendering.
  - **Auto AI Handwriting Correction** converts raw handwritten words and equations into clean, editable, erasable vector pen strokes—supporting raised superscripts/exponents (`x²`, `x^2`, `x^{n+1}`), subscripts (`H₂O`, `H_2O`), single-step Undo, and live word-by-word streaming.
- **Privacy, Vault Security & Recovery**
  - 100% local IndexedDB storage via Dexie with `.folio` notebook and workspace backup export/import.
  - Optional **Vault Lock** encrypts notebook contents and automatically blocks external AI requests for locked notebooks.
  - **7-day Trash** on the Home Shelf with **5-second `Ctrl+Z` Delete Undo**.
- **Editorial Glass UI, Typography & Export**
  - Seal & Crimson glassmorphism (`DESIGN.md`) with an animated WebGL paper-shader hero, Command Palette (`Ctrl+K`), Smart Context-Aware `Ctrl+Scroll`, customizable keyboard shortcuts, and optional subtle UI sounds.
  - Customize the interface font in **Settings → Appearance** with 22 curated typefaces, OS font discovery, arbitrary Google Fonts, or offline `.ttf` / `.otf` / `.woff` / `.woff2` imports.
  - Native **Print Preview** and high-DPI export to **PDF**, **PNG**, **JPG**, **SVG**, and **`.folio`** archives, plus built-in GitHub / local update support.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Desktop Shell** | Electron 45, Node.js main/preload IPC, `electron-builder` (NSIS & Portable Windows targets), `electron-updater` |
| **UI & Styling** | React 19, TypeScript, Vite 8, Tailwind CSS v4, `@paper-design/shaders-react`, `lucide-react`, KaTeX |
| **State & Storage** | Zustand, Dexie (IndexedDB), Web Crypto API (AES-GCM Vault encryption) |
| **Canvas & Documents** | HTML5 Canvas 2D, `perfect-freehand`, `pdfjs-dist`, `pdf-lib`, `jszip` |
| **Testing** | Vitest, `jsdom`, `fake-indexeddb` |

---

## Getting Started

### Prerequisites

- **Node.js 24+** and **npm**
- Windows 10/11 recommended for Electron desktop packaging (browser dev server works cross-platform)

### Installation & Development

```bash
# Install dependencies
npm install

# Start Vite dev server (browser)
npm run dev

# Start full Electron desktop app in dev mode
npm run electron:dev
```

### Verification & Desktop Build

```bash
# Run TypeScript checks (renderer + Electron main/preload)
npm run typecheck

# Run full Vitest suite
npm run test -- --maxWorkers=4

# Build web bundle, compile Electron, and package Windows NSIS + Portable installers into release/
npm run electron:build
```

---

## Project Structure

```text
├── electron/                 # Electron main process, preload bridge, print, system fonts & updater
├── scripts/                  # Icon generation & local update manifest scripts
├── src/
│   ├── ai/                   # Multi-provider BYOK AI client, snapshots, handwriting OCR & study suite
│   ├── canvas/               # Ink renderer, vector handwriting font, paper/whiteboard, geometry, eraser
│   ├── components/
│   │   ├── common/           # Frosted glass controls, shaders, sliders, update toast
│   │   ├── editor/           # Canvas workspace, floating islands, contextual sub-bar, AI sidebar
│   │   ├── modals/           # Settings, Print Preview, Export, Command Palette, Vault & Folder modals
│   │   └── shelf/            # Home Shelf studio hero, 3D tilt book cards & Trash section
│   ├── constants/            # Built-in cover presets & paper configurations
│   ├── db/                   # Dexie v4 schema & encrypted/local notebook repository
│   ├── store/                # Zustand application & updater stores
│   ├── types/                # Shared domain TypeScript interfaces
│   └── utils/                # Export pipeline, PDF import, shortcuts, fonts, sounds & Vault crypto
├── .github/workflows/        # GitHub Actions CI checks & tagged Windows release builds
├── DESIGN.md                 # Editorial Studio design system & token specification
└── CHANGELOG.md              # Release history
```

---

## Releases & CI

- Every push and pull request to `main` runs typechecking, Vitest tests, Vite build, and Electron compilation via [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
- Pushing a version tag matching `v*` (for example `v1.4.20`) triggers [`.github/workflows/release.yml`](.github/workflows/release.yml) to build and publish the Windows installers to GitHub Releases.
