import React, { useEffect, useState } from 'react';
import { Lock, Maximize2, Unlock, X } from 'lucide-react';
import { SLIDE_SIZE_PRESETS } from '../../slides/slidePresets';
import type { SlideSizePresetId } from '../../types/notes';

interface SlideSizeModalProps {
  open: boolean;
  currentPreset: SlideSizePresetId;
  currentWidth: number;
  currentHeight: number;
  onApply: (params: {
    preset: SlideSizePresetId;
    width: number;
    height: number;
    scaleElements: boolean;
  }) => void;
  onClose: () => void;
}

export const SlideSizeModal: React.FC<SlideSizeModalProps> = ({
  open,
  currentPreset,
  currentWidth,
  currentHeight,
  onApply,
  onClose,
}) => {
  const [preset, setPreset] = useState<SlideSizePresetId>(currentPreset);
  const [width, setWidth] = useState(currentWidth);
  const [height, setHeight] = useState(currentHeight);
  const [lockRatio, setLockRatio] = useState(false);
  const [scaleElements, setScaleElements] = useState(true);

  useEffect(() => {
    if (!open) return;
    setPreset(currentPreset);
    setWidth(currentWidth);
    setHeight(currentHeight);
    setScaleElements(true);
  }, [open, currentPreset, currentWidth, currentHeight]);

  if (!open) return null;

  const aspect = Math.max(0.1, currentWidth / Math.max(1, currentHeight));

  const handleWidthChange = (val: number) => {
    const nextW = Math.max(320, Math.min(4096, Math.round(val || 320)));
    setPreset('custom');
    setWidth(nextW);
    if (lockRatio) {
      setHeight(Math.max(320, Math.min(4096, Math.round(nextW / aspect))));
    }
  };

  const handleHeightChange = (val: number) => {
    const nextH = Math.max(320, Math.min(4096, Math.round(val || 320)));
    setPreset('custom');
    setHeight(nextH);
    if (lockRatio) {
      setWidth(Math.max(320, Math.min(4096, Math.round(nextH * aspect))));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onApply({ preset, width, height, scaleElements });
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
        data-testid="slide-size-modal"
        className="folio-modal-card flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl text-[var(--navy-900)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-seal)]">
              <Maximize2 className="h-4 w-4 text-[var(--crimson-500)]" />
            </span>
            <div>
              <h2 className="text-base font-bold">Slide Size &amp; Custom Dimensions</h2>
              <p className="text-xs text-[var(--navy-600)]">
                16:9 Widescreen (1920×1080) is the default; choose any preset or custom pixel size.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close slide size modal"
            onClick={onClose}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-600)] hover:bg-[var(--surface-seal)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SLIDE_SIZE_PRESETS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid={`modal-slide-preset-${opt.id}`}
                onClick={() => {
                  setPreset(opt.id);
                  setWidth(opt.width);
                  setHeight(opt.height);
                }}
                className={`folio-press rounded-xl border p-2.5 text-left ${
                  preset === opt.id
                    ? 'folio-glass-active'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-tint)]'
                }`}
              >
                <div className="text-xs font-bold">{opt.label}</div>
                <div className="mt-0.5 text-[10px] opacity-80">{opt.subtitle}</div>
              </button>
            ))}
            <button
              type="button"
              data-testid="modal-slide-preset-custom"
              onClick={() => setPreset('custom')}
              className={`folio-press rounded-xl border p-2.5 text-left ${
                preset === 'custom'
                  ? 'folio-glass-active'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-tint)]'
              }`}
            >
              <div className="text-xs font-bold">Custom Size</div>
              <div className="mt-0.5 text-[10px] opacity-80">Enter W × H px</div>
            </button>
          </div>

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="folio-section-label">Custom Pixel Dimensions</span>
              <button
                type="button"
                onClick={() => setLockRatio((l) => !l)}
                className="folio-press inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-[var(--navy-600)] hover:bg-[var(--surface-tint)]"
              >
                {lockRatio ? <Lock className="h-3 w-3 text-[var(--crimson-500)]" /> : <Unlock className="h-3 w-3" />}
                <span>{lockRatio ? 'Ratio Locked' : 'Free Ratio'}</span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-[var(--navy-600)]">
                Width (px)
                <input
                  type="number"
                  min={320}
                  max={4096}
                  data-testid="modal-custom-width"
                  value={width}
                  onChange={(e) => handleWidthChange(Number(e.target.value))}
                  className="folio-input mt-1 w-full rounded-xl px-3 py-1.5 text-sm font-bold"
                />
              </label>
              <label className="text-xs font-semibold text-[var(--navy-600)]">
                Height (px)
                <input
                  type="number"
                  min={320}
                  max={4096}
                  data-testid="modal-custom-height"
                  value={height}
                  onChange={(e) => handleHeightChange(Number(e.target.value))}
                  className="folio-input mt-1 w-full rounded-xl px-3 py-1.5 text-sm font-bold"
                />
              </label>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-semibold text-[var(--navy-900)]">
            <input
              type="checkbox"
              checked={scaleElements}
              onChange={(e) => setScaleElements(e.target.checked)}
              className="h-4 w-4 accent-[var(--crimson-500)]"
            />
            <span>Scale &amp; reposition existing elements proportionally</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="folio-btn-secondary folio-press rounded-xl px-4 py-2 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="modal-slide-size-apply"
              className="folio-btn-crimson folio-press rounded-xl px-4 py-2 text-xs font-bold"
            >
              Resize Slides
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
