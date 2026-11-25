# Folio Notes — Desktop Editorial Studio Design System (`v1.3.0`)

Folio Notes adapts the **`Light Gray Serif Product Marketing`** design language (`agent-design.com/design/light-gray-serif-product-marketing` — calm native desktop software craft, oversized display serif headings, swiss neo-grotesque UI copy, `11px` uppercase pill badges, inverted focal bento tiles, `20px–26px` rounded studio surfaces, and frosted glass panels) re-mapped strictly onto our locked **60 / 30 / 10 Seal & Crimson** token system.

---

## 1. Strict Token Governance Rule

- **Zero arbitrary colors in UI chrome.** Never introduce default Tailwind blues (`blue-500`), generic grays (`slate-*`, `gray-*`, `zinc-*`, `neutral-*`, `stone-*`), purple-blue AI gradients, or un-tokenized rainbow pills (`emerald-*`, `amber-*`, `pink-*`, `red-*`) into app chrome components.
- Every UI surface, border, heading, badge, button, and shadow MUST consume the CSS custom properties defined in `src/index.css` (directly or via semantic `.folio-*` utility classes).
- **Canvas Neutrality Guardrail:** Notebook paper templates, imported PDF pages, whiteboard desk presets (including Cool Studio Gray `#E2E8F0`), and pen/highlighter ink swatches are strictly excluded from chrome theming so user notes, drawings, and ink remain 100% accurate.

---

## 2. Locked Color System (60 / 30 / 10 Rule)

### 60% Atmospheric Surfaces (Base Mist & Frosted Glass)
| Token | Value | Role |
|---|---|---|
| `--surface-canvas` | `#F2F7FB` | Primary Home Shelf backdrop (never raw `#FFFFFF`) |
| `--surface-elevated` | `#FFFFFF` | Book cards, modals, command palette, inputs, active menus |
| `--surface-glass` | `rgba(255, 255, 255, 0.78)` | Floating Bento tiles, command trigger, floating glass islands (`blur(18px) saturate(165%)`) |
| `--surface-tint` | `#E5F2FA` | Subtle hover fills, inset panels, segmented tracks, inactive chips |
| `--surface-seal` | `#DBF2FC` | Seal Blue modal header wash & pill badge backgrounds |

### 30% Structural Anchor (Deep Navy & Navy-Tinted Depth)
| Token | Value | Role |
|---|---|---|
| `--navy-950` | `#052142` | Floating nav capsule gradient floor |
| `--navy-900` | `#072D59` | Primary headings, active tool/tab pills, inverted focal bento card, primary icons |
| `--navy-800` | `#0B3E78` | Hover state for navy buttons and inverted studio tiles |
| `--navy-600` | `#4A6685` | Secondary metadata, timestamps, muted labels, uppercase eyebrow tags |
| `--border-subtle` | `rgba(7, 45, 89, 0.10)` | Hairline borders across islands, cards, bento tiles, and dividers |
| `--border-strong` | `rgba(7, 45, 89, 0.18)` | Inputs, secondary buttons, elevated popovers |

### 10% Primary CTA Accent (Crimson Pink — Strict Role)
| Token | Value | Role |
|---|---|---|
| `--crimson-500` | `#FD6E88` | **Primary CTAs only** (`+ New`, `Create`, `Save`, `Export`, `Restart to Update`), focus rings, active indicators |
| `--crimson-600` | `#F25775` | Hover state for primary Crimson CTAs |
| `--crimson-glow` | `rgba(253, 110, 136, 0.24)` | Focus rings (`0 0 0 3px`) and halo ring wrappers around hero primary actions |
| `--crimson-soft` | `rgba(253, 110, 136, 0.12)` | Subtle highlight hover wash on AI & accent controls |

### Atmospheric Paper Shader Stops
- **Palette:** `['#DBF2FC', '#9AD7F7', '#072D59', '#FD6E88']` (Seal Blue, Mid Seal, Deep Navy, Crimson Pink).
- **Home Shelf Studio Hero (`MeshGradient`):** `distortion={0.62}`, `swirl={0.14}`, `grainMixer={0.14}`, `grainOverlay={0.12}`, `scale={1.15}`, `speed={0.18}` when focused (`0` when blurred, hidden, reduced motion, or Editor active). Overlaid on the left by `.folio-hero-scrim` so `#072D59` editorial text stays crisp regardless of shader swirl position.
- **Modal & Command Palette Accent (`StaticMeshGradient`):** Zero-CPU static mesh (`positions={2}`, `waveX={0.85}`, `waveY={0.75}`, `mixing={0.9}`, `grainMixer={0.12}`, `grainOverlay={0.1}`).

### Harmonized Semantic States
| Token | Value | Role |
|---|---|---|
| `--state-success` | `#0D9488` | Saved status, verified AI providers, strong passwords, update ready |
| `--state-warning` | `#D97706` | Vault notice, medium password strength, smart dark paper indicator |
| `--state-danger` | `#DC2626` | **Destructive actions only** (`Delete Notebook`, `Delete Folder`, `Delete Page`, `Clear Page`, validation errors) |

---

## 3. Structural Rules, Spacing & Radii (`Light Gray Serif Product Marketing`)

Pure-black drop shadows are prohibited; all ambient depth uses Navy tints (`rgba(7, 45, 89, ...)`).

### Radius Scale
| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | `8px` | Compact island icon buttons, shortcut keycaps, mini badges |
| `--radius-md` | `12px` | Segmented controls, dropdown menu items, modal form inputs |
| `--radius-lg` | `16px` | Book cover surfaces, modal panels, floating editor islands |
| `--radius-card` | `20px` | Glassmorphic Bento tiles, magnetic tool dock, inverted studio tiles |
| `--radius-cta` | `24px` | Primary pill CTAs and floating navigation capsule |
| `--radius-card-lg` | `26px` | Asymmetric Bento Studio Hero Showcase |
| `--radius-glow-wrap` | `28px` | Crimson/Seal outer halo ring wrapping primary hero CTA buttons |
| `--radius-pill` | `9999px` | Search trigger, quick paper chips, status pills |

### Layout Rhythm
1. **Home Shelf Studio:**
   - **Floating Nav Capsule (`.folio-nav-capsule`):** Detached frosted navy capsule (`w-[64px]`, centered vertically on desktop `left-4`, centered horizontally on `< md` bottom) with icon hover tooltips (`Skiper98`-style).
   - **Asymmetric Bento Studio Hero:** Left column holds live workspace telemetry (`JetBrains Mono`), editable **Zodiak** display title, **Command-Palette trigger (`Ctrl+K`)**, and quick paper chips over the directional readability scrim; right column floats a **2×2 Bento Quick-Create Studio** (`.folio-bento-inverted` `#072D59` focal **New Notebook** tile + glass **Whiteboard**, **Import PDF**, and **Templates / Import** tiles) over the live **`MeshGradient`**.
   - **3D Tilt Book Cards (`BookTiltCard`):** Pointer-tracked `±7deg` 3D tilt + radial specular sheen, sculpted `12px` spine crease, `2.5px` cream `#F8F6F0` stacked paper edge, staggered entrance, and slide-up bottom glass bar (`Open/Unlock`, `Export`, `Lock/Unlock`, `•••`). Tilting pauses automatically when `•••` menu opens, and the menu elevates at `z-40` outside `overflow-hidden`.
2. **Editor Workspace (Detached Floating Glass Islands):**
   - Zero stacked full-width edge-to-edge header rectangles. A `pointer-events-none` top frame positions 3 detached `.folio-glass-island` clusters:
     - **Top-Left Island:** Back to Shelf, inline-editable Notebook Title, `Page ▾`, and Pages Drawer toggle.
     - **Top-Center Dynamic Contextual Island:** Morphing glass bar showing ONLY the active tool/selection controls, keeping empty canvas gaps `pointer-events-none`.
     - **Top-Right Island:** Undo/Redo, Saved pill, Lock Now (if vaulted), Smart Dark Paper toggle, AI Study toggle, Shortcuts `?`, and Crimson **Export** button.
   - **Magnetic Floating Tool Dock (`BottomDocks`):** Pointer-proximity icon magnification (`1.0 → 1.24`, applied solely to inner icon wrappers so the sliding `<MorphingPill>` remains pixel-locked) alongside a detached Zoom & View pill.

---

## 4. Fontshare Typography Hierarchy
- **Display Serif (`--font-display`):** **Zodiak** (`400, 700, 800`), tight tracking (`-0.03em`), for Home Shelf display greeting & folder titles. Fallback: `Georgia, Cambria, "Times New Roman", serif`.
- **UI Sans (`--font-sans`):** **Switzer** (`400, 500, 600, 700`), Swiss neo-grotesque for controls, cards, docks, and modals. Fallback: `-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`.
- **Technical Mono (`--font-mono`):** **JetBrains Mono** with `tabular-nums` for `Ctrl+K` keycaps, page counters, zoom readouts, stats pills, and pixel dimensions.
- **Section Micro-Labels (`.folio-section-label`):** `11px`, weight `600`, uppercase, `letter-spacing: 0.08em`, color `var(--navy-600)`.

---

## 5. Motion & Micro-Sound Craft
- **Snap Hover (`--motion-fast`):** `150ms cubic-bezier(0.2, 0.8, 0.2, 1)`.
- **Spring Pill & Island Morph (`--motion-spring`):** `180ms cubic-bezier(0.22, 1, 0.36, 1)` measured via `offsetLeft` / `offsetTop` / `offsetWidth` / `offsetHeight` relative to the track container.
- **Shelf Entrance (`folioCardEnter`):** Staggered `220ms` reveal (`28ms` step, max `220ms`).
- **Reduced Motion:** All entrances, tilts, magnetic scales, and transitions respect `@media (prefers-reduced-motion: reduce)` and `speed={0}`.
- **Subtle UI Micro-Sounds (`src/utils/uiSound.ts`):** Strictly off by default; toggled in **Settings → Appearance → Subtle UI Sounds**.
