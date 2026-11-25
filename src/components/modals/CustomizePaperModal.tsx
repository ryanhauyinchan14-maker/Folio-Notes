import React, { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, Check, SlidersHorizontal, X } from 'lucide-react';
import { renderPaperBackground } from '../../canvas/paperRenderer';
import {
  DEFAULT_PAPER_CONFIG,
  formatPaperPatternLabel,
  MAX_CUSTOM_PAGE_DIMENSION,
  MIN_CUSTOM_PAGE_DIMENSION,
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
import { DraggableRangeSlider } from '../common/DraggableRangeSlider';
import { MorphingPill, useMorphingIndicator } from '../common/MorphingIndicator';

interface CustomizePaperModalProps {
  open: boolean;
  pageId: string | null;
  initialPaper: PaperConfig;
  isWhiteboard?: boolean;
  onClose: () => void;
}

const PATTERNS: { id: PaperPattern; label: string }[] = [
  { id: 'blank', label: 'Blank' },
  { id: 'ruled', label: 'Lined' },
  { id: 'grid', label: 'Graph' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'cornell', label: 'Study Notes' },
];

const WHITEBOARD_PATTERNS: PaperPattern[] = ['blank', 'grid', 'dotted'];

const SPACING_PRESETS = [
  { label: 'Narrow', value: 24 },
  { label: 'Standard', value: 32 },
  { label: 'Wide', value: 42 },
];

export const CustomizePaperModal: React.FC<CustomizePaperModalProps> = ({
  open,
  pageId,
  initialPaper,
  isWhiteboard = false,
  onClose,
}) => {
  const applyPaperToPage = useAppStore((s) => s.applyPaperToPage);
  const savePresetTemplate = useAppStore((s) => s.savePresetTemplate);

  const [draft, setDraft] = useState<PaperConfig>(initialPaper);
  const [widthText, setWidthText] = useState(String(initialPaper.width));
  const [heightText, setHeightText] = useState(String(initialPaper.height));
  const [presetName, setPresetName] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const orientationTrackRef = useRef<HTMLDivElement | null>(null);
  const orientationIndicator = useMorphingIndicator(
    orientationTrackRef,
    open && !isWhiteboard ? draft.orientation : null,
    [open, isWhiteboard],
  );

  useEffect(() => {
    if (open) {
      const next = { ...DEFAULT_PAPER_CONFIG, ...initialPaper };
      setDraft(next);
      setWidthText(String(next.width));
      setHeightText(String(next.height));
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
    cssW = Math.max(12, cssW);
    cssH = Math.max(12, cssH);

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

  const clampDimension = (raw: number, fallback: number): number => {
    const val = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : fallback;
    return Math.max(MIN_CUSTOM_PAGE_DIMENSION, Math.min(MAX_CUSTOM_PAGE_DIMENSION, val));
  };

  const resolveNormalizedDraft = (): PaperConfig => {
    if (draft.sizePreset !== 'custom') return draft;
    const w = clampDimension(Number(widthText), draft.width);
    const h = clampDimension(Number(heightText), draft.height);
    return w === draft.width && h === draft.height ? draft : { ...draft, width: w, height: h };
  };

  const handleSizePresetChange = (sizePreset: PageSizePresetId) => {
    const dims = resolvePageDimensions(
      sizePreset,
      draft.orientation,
      draft.width,
      draft.height,
    );
    setWidthText(String(dims.width));
    setHeightText(String(dims.height));
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
    setWidthText(String(dims.width));
    setHeightText(String(dims.height));
    setDraft((prev) => ({
      ...prev,
      orientation,
      width: dims.width,
      height: dims.height,
    }));
  };

  const handleCustomDimensionInput = (axis: 'width' | 'height', rawText: string) => {
    if (axis === 'width') setWidthText(rawText);
    else setHeightText(rawText);

    const parsed = Math.round(Number(rawText));
    if (
      rawText.trim() !== '' &&
      Number.isFinite(parsed) &&
      parsed >= MIN_CUSTOM_PAGE_DIMENSION &&
      parsed <= MAX_CUSTOM_PAGE_DIMENSION
    ) {
      setDraft((prev) => ({
        ...prev,
        sizePreset: 'custom',
        [axis]: parsed,
      }));
    }
  };

  const commitCustomDimensionBlur = (axis: 'width' | 'height') => {
    const raw = axis === 'width' ? widthText : heightText;
    const fallback = axis === 'width' ? draft.width : draft.height;
    const clamped = clampDimension(Number(raw), fallback);
    if (axis === 'width') setWidthText(String(clamped));
    else setHeightText(String(clamped));
    setDraft((prev) => ({
      ...prev,
      sizePreset: 'custom',
      [axis]: clamped,
    }));
  };

  const handleSavePreset = async () => {
    const normalized = resolveNormalizedDraft();
    setDraft(normalized);
    setWidthText(String(normalized.width));
    setHeightText(String(normalized.height));
    const name =
      presetName.trim() ||
      `${formatPaperPatternLabel(normalized.pattern)} Paper`;
    await savePresetTemplate(name, normalized);
    setSavedNotice(`Saved "${name}" to My Templates`);
    setPresetName('');
  };

  const handleApply = async () => {
    const normalized = resolveNormalizedDraft();
    if (pageId) {
      await applyPaperToPage(pageId, normalized);
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
        className="folio-modal-card flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl text-[var(--navy-900)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-seal)] text-[var(--navy-900)]">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
              <h2 id="customize-paper-title" className="text-base font-bold text-[var(--navy-900)]">
                {isWhiteboard ? 'Customize Board' : 'Customize Paper'}
              </h2>
              <p className="text-xs text-[var(--navy-600)]">
                {isWhiteboard
                  ? 'Configure whiteboard grid pattern, spacing & background color'
                  : 'Configure paper template, page size, spacing & color'}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Customize Paper"
            onClick={onClose}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-600)] hover:bg-[var(--surface-seal)] hover:text-[var(--navy-900)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="grid flex-1 gap-6 overflow-y-auto p-5 md:grid-cols-[270px_1fr]">
          {/* Live Preview Pane */}
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-tint)] p-4">
            <canvas
              ref={previewCanvasRef}
              data-testid="customize-paper-preview"
              className="rounded-sm shadow-[var(--shadow-card)] ring-1 ring-[var(--border-subtle)]"
            />
            <span className="mt-3 text-xs font-semibold text-[var(--navy-600)] tabular-nums">
              {isWhiteboard
                ? 'Whiteboard Background'
                : `${draft.width} × ${draft.height} px · ${draft.orientation}`}
            </span>
          </div>

          {/* Controls Pane */}
          <div className="space-y-5">
            {/* Pattern */}
            <div>
              <label className="folio-section-label mb-2 block">
                Pattern
              </label>
              <div className={`grid gap-1.5 ${isWhiteboard ? 'grid-cols-3' : 'grid-cols-5'}`}>
                {(isWhiteboard
                  ? PATTERNS.filter((pat) => WHITEBOARD_PATTERNS.includes(pat.id))
                  : PATTERNS
                ).map((pat) => (
                  <button
                    key={pat.id}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, pattern: pat.id }))}
                    className={`folio-press rounded-xl border px-2 py-2 text-xs font-semibold ${
                      draft.pattern === pat.id
                        ? 'folio-glass-active'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
                    }`}
                  >
                    {pat.label}
                  </button>
                ))}
              </div>
            </div>

            {!isWhiteboard && (
              <>
                {/* Page Size & Orientation */}
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label
                  htmlFor="paper-size-select"
                  className="folio-section-label mb-1.5 block"
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
                <label className="folio-section-label mb-1.5 block">
                  Orientation
                </label>
                <div
                  ref={orientationTrackRef}
                  className="folio-segmented-track flex rounded-xl p-0.5"
                >
                  <MorphingPill indicator={orientationIndicator} className="rounded-lg" />
                  {(['portrait', 'landscape'] as PageOrientation[]).map((ori) => (
                    <button
                      key={ori}
                      type="button"
                      data-morph-key={ori}
                      onClick={() => handleOrientationChange(ori)}
                      className={`folio-press relative z-10 rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${
                        draft.orientation === ori
                          ? orientationIndicator.ready
                            ? 'text-white'
                            : 'folio-glass-active'
                          : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                      }`}
                    >
                      {ori}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {draft.sizePreset === 'custom' && (
              <div className="space-y-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-tint)] p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[var(--navy-600)]">
                      Width (px)
                    </label>
                    <input
                      type="number"
                      data-testid="custom-paper-width-input"
                      min={MIN_CUSTOM_PAGE_DIMENSION}
                      max={MAX_CUSTOM_PAGE_DIMENSION}
                      value={widthText}
                      onChange={(e) => handleCustomDimensionInput('width', e.target.value)}
                      onBlur={() => commitCustomDimensionBlur('width')}
                      className="folio-input w-full rounded-lg px-2.5 py-1.5 text-sm tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[var(--navy-600)]">
                      Height (px)
                    </label>
                    <input
                      type="number"
                      data-testid="custom-paper-height-input"
                      min={MIN_CUSTOM_PAGE_DIMENSION}
                      max={MAX_CUSTOM_PAGE_DIMENSION}
                      value={heightText}
                      onChange={(e) => handleCustomDimensionInput('height', e.target.value)}
                      onBlur={() => commitCustomDimensionBlur('height')}
                      className="folio-input w-full rounded-lg px-2.5 py-1.5 text-sm tabular-nums"
                    />
                  </div>
                </div>
                {(draft.width > 4096 || draft.height > 4096) && (
                  <p
                    data-testid="large-page-note"
                    className="text-[11px] leading-snug text-[var(--navy-600)]"
                  >
                    Large page (&gt; 4096 px): Live rendering stays sharp via viewport windowing.
                    PNG/JPG/PDF exports auto-scale within browser bitmap &amp; PDF viewer limits
                    (SVG stays full vector).
                  </p>
                )}
              </div>
            )}
              </>
            )}

            {/* Line Spacing */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="folio-section-label">
                  Line / Grid Spacing
                </label>
                <span className="folio-mono text-xs font-bold text-[var(--navy-900)]">{draft.spacing} px</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {SPACING_PRESETS.map((sp) => (
                  <button
                    key={sp.value}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, spacing: sp.value }))}
                    className={`folio-press rounded-lg border px-2.5 py-1 text-xs font-semibold tabular-nums ${
                      draft.spacing === sp.value
                        ? 'folio-glass-active'
                        : 'border-[var(--border-subtle)] text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]'
                    }`}
                  >
                    {sp.label} ({sp.value})
                  </button>
                ))}
                <DraggableRangeSlider
                  min={16}
                  max={64}
                  step={2}
                  ariaLabel="Line spacing slider"
                  value={draft.spacing}
                  onChange={(spacing) =>
                    setDraft((prev) => ({ ...prev, spacing }))
                  }
                  className="ml-auto flex-1 min-w-[110px]"
                />
              </div>
            </div>

            {/* Margin Line */}
            {!isWhiteboard && (
              <div className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] px-3.5 py-2.5">
                <div>
                  <div className="text-sm font-bold text-[var(--navy-900)]">Margin Line</div>
                  <div className="text-xs text-[var(--navy-600)] tabular-nums">
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
                    className="h-7 w-7 cursor-pointer rounded border border-[var(--border-strong)] bg-transparent p-0"
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
                  className={`folio-press inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150 ${
                    draft.marginLine ? 'bg-[var(--crimson-500)]' : 'bg-[var(--border-strong)]'
                  }`}
                >
                  <span
                    className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow transition-transform duration-150 ${
                      draft.marginLine ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
            )}

            {/* Paper Color */}
            <div>
              <label className="folio-section-label mb-2 block">
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
                      className={`folio-press flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold ${
                        selected
                          ? 'border-[var(--crimson-500)] bg-[var(--surface-seal)]/55 ring-2 ring-[var(--crimson-glow)]'
                          : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <span
                        className="h-4 w-4 rounded-full border border-[var(--border-strong)]"
                        style={{ backgroundColor: preset.color }}
                      />
                      <span>{preset.label}</span>
                    </button>
                  );
                })}
                <label className="folio-press inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]">
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
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-tint)] p-3.5">
              <label
                htmlFor="preset-name-input"
                className="folio-section-label mb-1.5 block"
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
                  className="folio-btn-secondary folio-press inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold"
                >
                  <BookmarkPlus className="h-4 w-4 text-[var(--crimson-500)]" />
                  Save Preset
                </button>
              </div>
              {savedNotice && (
                <p
                  data-testid="preset-saved-notice"
                  className="mt-2 flex items-center gap-1 text-xs font-semibold text-[var(--state-success-text)]"
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
            className="folio-btn-secondary folio-press rounded-xl px-4 py-2 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="folio-btn-crimson folio-press rounded-xl px-4 py-2 text-sm font-semibold"
          >
            Apply to Current Page
          </button>
        </div>
      </div>
    </div>
  );
};
