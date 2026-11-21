import React, { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, Check, SlidersHorizontal, X } from 'lucide-react';
import { renderPaperBackground } from '../../canvas/paperRenderer';
import {
  DEFAULT_PAPER_CONFIG,
  PAGE_SIZE_DEFINITIONS,
  PAPER_COLOR_PRESETS,
  resolvePageDimensions,
} from '../../constants/papers';
import { useAppStore } from '../../store/useAppStore';
import type {
  PageOrientation,
  PageSizePresetId,
  PaperConfig,
  PaperPattern,
} from '../../types/notes';

interface CustomizePaperModalProps {
  open: boolean;
  pageId: string | null;
  initialPaper: PaperConfig;
  onClose: () => void;
}

const PATTERNS: { id: PaperPattern; label: string }[] = [
  { id: 'blank', label: 'Blank' },
  { id: 'ruled', label: 'Ruled' },
  { id: 'grid', label: 'Grid' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'cornell', label: 'Cornell' },
];

const SPACING_PRESETS = [
  { label: 'Narrow', value: 24 },
  { label: 'Standard', value: 32 },
  { label: 'Wide', value: 42 },
];

export const CustomizePaperModal: React.FC<CustomizePaperModalProps> = ({
  open,
  pageId,
  initialPaper,
  onClose,
}) => {
  const applyPaperToPage = useAppStore((s) => s.applyPaperToPage);
  const savePresetTemplate = useAppStore((s) => s.savePresetTemplate);

  const [draft, setDraft] = useState<PaperConfig>(initialPaper);
  const [presetName, setPresetName] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraft({ ...DEFAULT_PAPER_CONFIG, ...initialPaper });
      setPresetName('');
      setSavedNotice(null);
    }
  }, [open, initialPaper]);

  // Render live HiDPI preview of the paper configuration
  useEffect(() => {
    if (!open) return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const maxPreviewW = 240;
    const maxPreviewH = 310;
    const aspect = draft.width / Math.max(1, draft.height);
    let cssW = maxPreviewW;
    let cssH = Math.round(cssW / aspect);
    if (cssH > maxPreviewH) {
      cssH = maxPreviewH;
      cssW = Math.round(cssH * aspect);
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const scale = (cssW / Math.max(1, draft.width)) * dpr;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, draft.width, draft.height);
    renderPaperBackground(ctx, draft);
  }, [open, draft]);

  if (!open) return null;

  const handleSizePresetChange = (sizePreset: PageSizePresetId) => {
    const dims = resolvePageDimensions(
      sizePreset,
      draft.orientation,
      draft.width,
      draft.height,
    );
    setDraft((prev) => ({
      ...prev,
      sizePreset,
      width: dims.width,
      height: dims.height,
    }));
  };

  const handleOrientationChange = (orientation: PageOrientation) => {
    const dims = resolvePageDimensions(
      draft.sizePreset,
      orientation,
      draft.width,
      draft.height,
    );
    setDraft((prev) => ({
      ...prev,
      orientation,
      width: dims.width,
      height: dims.height,
    }));
  };

  const handleCustomDimension = (axis: 'width' | 'height', value: number) => {
    const clamped = Math.max(320, Math.min(2400, Math.round(value || 320)));
    setDraft((prev) => ({
      ...prev,
      sizePreset: 'custom',
      [axis]: clamped,
    }));
  };

  const handleSavePreset = async () => {
    const name = presetName.trim() || `${draft.pattern[0].toUpperCase()}${draft.pattern.slice(1)} Preset`;
    await savePresetTemplate(name, draft);
    setSavedNotice(`Saved "${name}" to My Templates`);
    setPresetName('');
  };

  const handleApply = async () => {
    if (pageId) {
      await applyPaperToPage(pageId, draft);
    }
    onClose();
  };

  return (
    <div
      className="folio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customize-paper-title"
        className="folio-modal-card flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl text-[#072D59]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#DBF2FC] text-[#072D59]">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
              <h2 id="customize-paper-title" className="text-base font-bold text-[#072D59]">
                Customize Paper
              </h2>
              <p className="text-xs text-[#072D59]/65">
                Configure paper template, page size, spacing &amp; color
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Customize Paper"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#072D59]/55 transition duration-150 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="grid flex-1 gap-6 overflow-y-auto p-5 md:grid-cols-[270px_1fr]">
          {/* Live Preview Pane */}
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[#072D59]/10 bg-[#DBF2FC]/30 p-4">
            <canvas
              ref={previewCanvasRef}
              data-testid="customize-paper-preview"
              className="rounded-sm shadow-md ring-1 ring-[#072D59]/12"
            />
            <span className="mt-3 text-xs font-semibold text-[#072D59]/65">
              {draft.width} × {draft.height} px · {draft.orientation}
            </span>
          </div>

          {/* Controls Pane */}
          <div className="space-y-5">
            {/* Pattern */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65">
                Pattern
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {PATTERNS.map((pat) => (
                  <button
                    key={pat.id}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, pattern: pat.id }))}
                    className={`rounded-xl border px-2 py-2 text-xs font-semibold transition duration-150 ${
                      draft.pattern === pat.id
                        ? 'border-[#072D59] bg-[#072D59] text-white shadow-xs'
                        : 'border-[#072D59]/12 bg-white text-[#072D59] hover:bg-[#DBF2FC]/45'
                    }`}
                  >
                    {pat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Page Size & Orientation */}
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label
                  htmlFor="paper-size-select"
                  className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65"
                >
                  Page Size
                </label>
                <select
                  id="paper-size-select"
                  value={draft.sizePreset}
                  onChange={(e) => handleSizePresetChange(e.target.value as PageSizePresetId)}
                  className="folio-input w-full rounded-xl px-3 py-2 text-sm"
                >
                  {PAGE_SIZE_DEFINITIONS.map((sz) => (
                    <option key={sz.id} value={sz.id}>
                      {sz.label} — {sz.subtitle}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65">
                  Orientation
                </label>
                <div className="flex rounded-xl border border-[#072D59]/12 bg-[#DBF2FC]/30 p-0.5">
                  {(['portrait', 'landscape'] as PageOrientation[]).map((ori) => (
                    <button
                      key={ori}
                      type="button"
                      onClick={() => handleOrientationChange(ori)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition duration-150 ${
                        draft.orientation === ori
                          ? 'bg-[#072D59] text-white shadow-xs'
                          : 'text-[#072D59]/75 hover:text-[#072D59]'
                      }`}
                    >
                      {ori}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {draft.sizePreset === 'custom' && (
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[#072D59]/10 bg-[#DBF2FC]/25 p-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#072D59]/75">
                    Width (px)
                  </label>
                  <input
                    type="number"
                    min={320}
                    max={2400}
                    value={draft.width}
                    onChange={(e) => handleCustomDimension('width', Number(e.target.value))}
                    className="folio-input w-full rounded-lg px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#072D59]/75">
                    Height (px)
                  </label>
                  <input
                    type="number"
                    min={320}
                    max={2400}
                    value={draft.height}
                    onChange={(e) => handleCustomDimension('height', Number(e.target.value))}
                    className="folio-input w-full rounded-lg px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>
            )}

            {/* Line Spacing */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wide text-[#072D59]/65">
                  Line / Grid Spacing
                </label>
                <span className="text-xs font-bold text-[#072D59]">{draft.spacing} px</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {SPACING_PRESETS.map((sp) => (
                  <button
                    key={sp.value}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, spacing: sp.value }))}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition duration-150 ${
                      draft.spacing === sp.value
                        ? 'border-[#072D59] bg-[#072D59] text-white'
                        : 'border-[#072D59]/12 text-[#072D59]/75 hover:bg-[#DBF2FC]/45'
                    }`}
                  >
                    {sp.label} ({sp.value})
                  </button>
                ))}
                <input
                  type="range"
                  min={16}
                  max={64}
                  step={2}
                  aria-label="Line spacing slider"
                  value={draft.spacing}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, spacing: Number(e.target.value) }))
                  }
                  className="ml-auto flex-1 min-w-[110px] accent-[#FD6E88]"
                />
              </div>
            </div>

            {/* Margin Line */}
            <div className="flex items-center justify-between rounded-xl border border-[#072D59]/10 px-3.5 py-2.5">
              <div>
                <div className="text-sm font-bold text-[#072D59]">Margin Line</div>
                <div className="text-xs text-[#072D59]/60">
                  Vertical left margin guide ({draft.marginOffset ?? 96}px)
                </div>
              </div>
              <div className="flex items-center gap-3">
                {draft.marginLine && (
                  <input
                    type="color"
                    aria-label="Margin line color"
                    value={draft.marginColor ?? '#F43F5E'}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, marginColor: e.target.value }))
                    }
                    className="h-7 w-7 cursor-pointer rounded border border-[#072D59]/15 bg-transparent p-0"
                  />
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.marginLine}
                  aria-label="Toggle margin line"
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, marginLine: !prev.marginLine }))
                  }
                  className={`relative h-6 w-11 rounded-full transition-colors duration-150 ${
                    draft.marginLine ? 'bg-[#FD6E88]' : 'bg-[#072D59]/20'
                  }`}
                >
                  <span
                    className={`block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform duration-150 ${
                      draft.marginLine ? 'translate-x-5.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Paper Color */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65">
                Paper Color
              </label>
              <div className="flex flex-wrap items-center gap-2.5">
                {PAPER_COLOR_PRESETS.map((preset) => {
                  const selected =
                    draft.paperColor.toLowerCase() === preset.color.toLowerCase();
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.label}
                      aria-label={`Paper color ${preset.label}`}
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, paperColor: preset.color }))
                      }
                      className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition duration-150 ${
                        selected
                          ? 'border-[#FD6E88] bg-[#FD6E88]/8 ring-2 ring-[#FD6E88]/25'
                          : 'border-[#072D59]/12 hover:border-[#072D59]/30'
                      }`}
                    >
                      <span
                        className="h-4 w-4 rounded-full border border-[#072D59]/20"
                        style={{ backgroundColor: preset.color }}
                      />
                      <span>{preset.label}</span>
                    </button>
                  );
                })}
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#072D59]/12 px-2.5 py-1.5 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/45">
                  <input
                    type="color"
                    aria-label="Custom paper color"
                    value={draft.paperColor}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, paperColor: e.target.value }))
                    }
                    className="h-4 w-4 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  Custom
                </label>
              </div>
            </div>

            {/* Save as Named Preset */}
            <div className="rounded-xl border border-[#072D59]/10 bg-[#DBF2FC]/25 p-3.5">
              <label
                htmlFor="preset-name-input"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#072D59]/70"
              >
                Save Paper Configuration as Preset
              </label>
              <div className="flex gap-2">
                <input
                  id="preset-name-input"
                  type="text"
                  value={presetName}
                  onChange={(e) => {
                    setPresetName(e.target.value);
                    setSavedNotice(null);
                  }}
                  placeholder="e.g., Cornell Cream Narrow"
                  className="folio-input flex-1 rounded-xl px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={handleSavePreset}
                  className="folio-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold"
                >
                  <BookmarkPlus className="h-4 w-4 text-[#FD6E88]" />
                  Save Preset
                </button>
              </div>
              {savedNotice && (
                <p
                  data-testid="preset-saved-notice"
                  className="mt-2 flex items-center gap-1 text-xs font-semibold text-emerald-700"
                >
                  <Check className="h-3.5 w-3.5" />
                  {savedNotice}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="folio-modal-footer flex items-center justify-end gap-2 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="folio-btn-secondary rounded-xl px-4 py-2 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="folio-btn-crimson rounded-xl px-4 py-2 text-sm font-semibold shadow-xs"
          >
            Apply to Current Page
          </button>
        </div>
      </div>
    </div>
  );
};
