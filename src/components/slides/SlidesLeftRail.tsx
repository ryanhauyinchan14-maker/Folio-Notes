import React, { useState } from 'react';
import {
  ImagePlus,
  LayoutTemplate,
  PaintBucket,
  PenTool,
  Shapes,
  Type,
} from 'lucide-react';
import {
  SLIDE_BACKGROUND_GRADIENTS,
  SLIDE_BACKGROUND_SOLIDS,
  SLIDE_LAYOUT_OPTIONS,
  SLIDE_SHAPE_CATALOG,
  type SlideLayoutId,
} from '../../slides/slideLayouts';
import type { SlideBackground, SlideShapeKind } from '../../types/notes';

export type SlidesRailTab = 'layouts' | 'elements' | 'text' | 'uploads' | 'backgrounds' | 'draw';

interface SlidesLeftRailProps {
  activeTab: SlidesRailTab;
  onChangeTab: (tab: SlidesRailTab) => void;
  drawMode: boolean;
  drawColor: string;
  drawSize: number;
  onToggleDrawMode: (enabled: boolean) => void;
  onChangeDrawColor: (color: string) => void;
  onChangeDrawSize: (size: number) => void;
  onClearInk: () => void;
  onApplyLayout: (layoutId: SlideLayoutId) => void;
  onAddShape: (shape: SlideShapeKind) => void;
  onAddText: (variant: 'heading' | 'subheading' | 'body' | 'badge') => void;
  onTriggerUploadImage: () => void;
  onChangeBackground: (bg: SlideBackground, applyAll?: boolean) => void;
  onTriggerBackgroundImage: () => void;
}

const RAIL_TABS: Array<{ id: SlidesRailTab; label: string; icon: React.ReactNode }> = [
  { id: 'layouts', label: 'Layouts', icon: <LayoutTemplate className="h-4 w-4" /> },
  { id: 'elements', label: 'Elements', icon: <Shapes className="h-4 w-4" /> },
  { id: 'text', label: 'Text', icon: <Type className="h-4 w-4" /> },
  { id: 'uploads', label: 'Uploads', icon: <ImagePlus className="h-4 w-4" /> },
  { id: 'backgrounds', label: 'Bg', icon: <PaintBucket className="h-4 w-4" /> },
  { id: 'draw', label: 'Draw', icon: <PenTool className="h-4 w-4" /> },
];

const ShapePreviewIcon: React.FC<{ shape: SlideShapeKind }> = ({ shape }) => (
  <svg viewBox="0 0 28 28" className="mb-1.5 h-6 w-6 text-[var(--navy-900)]" aria-hidden="true">
    {shape === 'rect' && (
      <rect x="3" y="5" width="22" height="18" fill="var(--surface-seal)" stroke="currentColor" strokeWidth="2" />
    )}
    {shape === 'rounded-rect' && (
      <rect x="3" y="5" width="22" height="18" rx="5" fill="var(--surface-seal)" stroke="currentColor" strokeWidth="2" />
    )}
    {shape === 'circle' && (
      <circle cx="14" cy="14" r="10" fill="var(--surface-seal)" stroke="currentColor" strokeWidth="2" />
    )}
    {shape === 'triangle' && (
      <polygon points="14,4 25,24 3,24" fill="var(--surface-seal)" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    )}
    {shape === 'arrow' && (
      <polygon points="3,10 17,10 17,5 26,14 17,23 17,18 3,18" fill="var(--surface-seal)" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    )}
    {shape === 'line' && (
      <line x1="3" y1="21" x2="25" y2="7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    )}
    {shape === 'star' && (
      <polygon points="14,3 17,10 25,10 19,15 21,23 14,18 7,23 9,15 3,10 11,10" fill="var(--surface-seal)" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    )}
    {shape === 'pill' && (
      <rect x="3" y="8" width="22" height="12" rx="6" fill="var(--crimson-500)" stroke="currentColor" strokeWidth="1.8" />
    )}
    {shape === 'speech-bubble' && (
      <path d="M5 5 H23 Q25 5 25 7 V18 Q25 20 23 20 H11 L6 25 L7 20 H5 Q3 20 3 18 V7 Q3 5 5 5 Z" fill="var(--surface-seal)" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    )}
    {shape === 'divider' && (
      <line x1="3" y1="14" x2="25" y2="14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    )}
  </svg>
);

export const SlidesLeftRail: React.FC<SlidesLeftRailProps> = ({
  activeTab,
  onChangeTab,
  drawMode,
  drawColor,
  drawSize,
  onToggleDrawMode,
  onChangeDrawColor,
  onChangeDrawSize,
  onClearInk,
  onApplyLayout,
  onAddShape,
  onAddText,
  onTriggerUploadImage,
  onChangeBackground,
  onTriggerBackgroundImage,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [customBgHex, setCustomBgHex] = useState('#FFFFFF');

  const handleSelectTab = (tab: SlidesRailTab) => {
    if (activeTab === tab && drawerOpen) {
      setDrawerOpen(false);
    } else {
      onChangeTab(tab);
      setDrawerOpen(true);
    }
    if (tab === 'draw') {
      onToggleDrawMode(true);
    } else if (drawMode) {
      onToggleDrawMode(false);
    }
  };

  return (
    <div
      data-testid="slides-left-rail"
      className="z-20 flex h-full shrink-0 border-r border-[var(--border-subtle)] bg-[var(--surface-glass)] backdrop-blur-md"
    >
      {/* Vertical Icon Rail */}
      <nav aria-label="Slide Studio Tools" className="flex w-16 flex-col items-center gap-1.5 border-r border-[var(--border-subtle)] py-3">
        {RAIL_TABS.map((tab) => {
          const active = activeTab === tab.id && drawerOpen;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`slides-rail-tab-${tab.id}`}
              aria-pressed={active}
              onClick={() => handleSelectTab(tab.id)}
              className={`folio-press flex w-13 flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-bold ${
                active
                  ? 'folio-glass-active'
                  : 'text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Expandable Tool Drawer */}
      {drawerOpen && (
        <div className="custom-scrollbar w-60 overflow-y-auto p-3">
          {activeTab === 'layouts' && (
            <div className="space-y-2">
              <div className="folio-section-label">Slide Layouts</div>
              {SLIDE_LAYOUT_OPTIONS.map((layout) => (
                <button
                  key={layout.id}
                  type="button"
                  data-testid={`slides-layout-${layout.id}`}
                  onClick={() => onApplyLayout(layout.id)}
                  className="folio-press block w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-2.5 text-left hover:border-[var(--crimson-500)]"
                >
                  <div className="text-xs font-bold text-[var(--navy-900)]">{layout.name}</div>
                  <div className="mt-0.5 text-[10px] text-[var(--navy-600)]">{layout.description}</div>
                </button>
              ))}
            </div>
          )}

          {activeTab === 'elements' && (
            <div className="space-y-2.5">
              <div className="folio-section-label">Shapes &amp; Elements</div>
              <div className="grid grid-cols-2 gap-2">
                {SLIDE_SHAPE_CATALOG.map((item) => (
                  <button
                    key={item.shape}
                    type="button"
                    data-testid={`slides-add-shape-${item.shape}`}
                    onClick={() => onAddShape(item.shape)}
                    className="folio-press flex flex-col items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 py-3 text-[11px] font-semibold text-[var(--navy-900)] hover:border-[var(--crimson-500)]"
                  >
                    <ShapePreviewIcon shape={item.shape} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'text' && (
            <div className="space-y-2.5">
              <div className="folio-section-label">Click to Add Textbox</div>
              <button
                type="button"
                data-testid="slides-add-text-heading"
                onClick={() => onAddText('heading')}
                className="folio-press block w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 text-left text-lg font-extrabold hover:border-[var(--crimson-500)]"
              >
                Add a Heading
              </button>
              <button
                type="button"
                data-testid="slides-add-text-subheading"
                onClick={() => onAddText('subheading')}
                className="folio-press block w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 text-left text-sm font-bold text-[var(--navy-800)] hover:border-[var(--crimson-500)]"
              >
                Add a Subheading
              </button>
              <button
                type="button"
                data-testid="slides-add-text-body"
                onClick={() => onAddText('body')}
                className="folio-press block w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 text-left text-xs font-medium text-[var(--navy-600)] hover:border-[var(--crimson-500)]"
              >
                Add body text paragraph
              </button>
              <button
                type="button"
                data-testid="slides-add-text-badge"
                onClick={() => onAddText('badge')}
                className="folio-press block w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 text-left hover:border-[var(--crimson-500)]"
              >
                <span className="inline-block rounded-full bg-[var(--crimson-500)] px-3 py-1 text-[11px] font-bold text-white">
                  CALLOUT BADGE
                </span>
              </button>
            </div>
          )}

          {activeTab === 'uploads' && (
            <div className="space-y-3">
              <div className="folio-section-label">Media Uploads</div>
              <button
                type="button"
                data-testid="slides-upload-image-btn"
                onClick={onTriggerUploadImage}
                className="folio-btn-crimson flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold"
              >
                <ImagePlus className="h-4 w-4" />
                Upload Image to Slide
              </button>
              <p className="text-[11px] leading-relaxed text-[var(--navy-600)]">
                Tip: You can also paste images from your clipboard (`Ctrl+V`) or drag files straight onto any slide.
              </p>
            </div>
          )}

          {activeTab === 'backgrounds' && (
            <div className="space-y-3">
              <div className="folio-section-label">Solid Colors</div>
              <div className="grid grid-cols-4 gap-2">
                {SLIDE_BACKGROUND_SOLIDS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Background color ${hex}`}
                    data-testid={`slides-bg-solid-${hex}`}
                    onClick={() => {
                      setCustomBgHex(hex);
                      onChangeBackground({ kind: 'solid', color: hex });
                    }}
                    style={{ backgroundColor: hex }}
                    className="h-9 rounded-xl border border-[var(--border-strong)] shadow-2xs"
                  />
                ))}
              </div>

              <label className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 py-2 text-xs font-semibold">
                <span>Custom Color</span>
                <input
                  type="color"
                  value={customBgHex}
                  onChange={(e) => {
                    setCustomBgHex(e.target.value);
                    onChangeBackground({ kind: 'solid', color: e.target.value });
                  }}
                  className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent"
                />
              </label>

              <div className="folio-section-label pt-1">Gradients</div>
              <div className="grid grid-cols-2 gap-2">
                {SLIDE_BACKGROUND_GRADIENTS.map((g) => (
                  <button
                    key={g.label}
                    type="button"
                    onClick={() => onChangeBackground({ kind: 'gradient', gradient: g.gradient })}
                    style={{ background: g.gradient }}
                    className="h-12 rounded-xl border border-[var(--border-subtle)] p-1.5 text-left text-[10px] font-bold text-white drop-shadow"
                  >
                    {g.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={onTriggerBackgroundImage}
                className="folio-btn-secondary w-full rounded-xl px-3 py-2 text-xs font-semibold"
              >
                Upload Background Image
              </button>
            </div>
          )}

          {activeTab === 'draw' && (
            <div className="space-y-3">
              <div className="folio-section-label">Slide Ink Overlay</div>
              <label className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-xs font-bold">
                <span>Draw Mode Active</span>
                <input
                  type="checkbox"
                  checked={drawMode}
                  onChange={(e) => onToggleDrawMode(e.target.checked)}
                  className="h-4 w-4 accent-[var(--crimson-500)]"
                />
              </label>
              <label className="flex items-center justify-between text-xs font-semibold">
                <span>Ink Color</span>
                <input
                  type="color"
                  value={drawColor}
                  onChange={(e) => onChangeDrawColor(e.target.value)}
                  className="h-7 w-10 rounded"
                />
              </label>
              <label className="block text-xs font-semibold">
                Stroke Width ({drawSize}px)
                <input
                  type="range"
                  min={2}
                  max={20}
                  value={drawSize}
                  onChange={(e) => onChangeDrawSize(Number(e.target.value))}
                  className="folio-range mt-1 w-full"
                />
              </label>
              <button
                type="button"
                onClick={onClearInk}
                className="folio-btn-secondary w-full rounded-xl px-3 py-2 text-xs font-semibold text-[var(--state-danger-text)]"
              >
                Clear Slide Ink
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
