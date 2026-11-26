import React, { useEffect, useRef, useState } from 'react';
import { Palette, Pipette, Plus, X } from 'lucide-react';
import {
  getColorHarmonies,
  hexToHsv,
  hsvToHex,
  normalizeHex,
} from '../../canvas/colorMath';
import { useAppStore } from '../../store/useAppStore';

interface ColorStudioPopoverProps {
  onClose: () => void;
}

export const ColorStudioPopover: React.FC<ColorStudioPopoverProps> = ({ onClose }) => {
  const inkColor = useAppStore((s) => s.inkColor);
  const activeTool = useAppStore((s) => s.activeTool);
  const savedColorPalettes = useAppStore((s) => s.savedColorPalettes);

  const setActiveColor = useAppStore((s) => s.setActiveColor);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const addColorToPalette = useAppStore((s) => s.addColorToPalette);

  const initialHsv = hexToHsv(inkColor);
  const [hsv, setHsv] = useState(initialHsv);
  const [hexDraft, setHexDraft] = useState(normalizeHex(inkColor));
  const [selectedPaletteId, setSelectedPaletteId] = useState(
    savedColorPalettes[0]?.id ?? 'folio-studio',
  );
  const svBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const norm = normalizeHex(inkColor);
    setHexDraft(norm);
    setHsv((prev) => {
      const parsed = hexToHsv(norm);
      return {
        h: parsed.s === 0 ? prev.h : parsed.h,
        s: parsed.s,
        v: parsed.v,
      };
    });
  }, [inkColor]);

  const applyHsv = (nextH: number, nextS: number, nextV: number) => {
    setHsv({ h: nextH, s: nextS, v: nextV });
    const hex = hsvToHex(nextH, nextS, nextV);
    setHexDraft(hex);
    setActiveColor(hex);
  };

  const updateSvFromPointer = (clientX: number, clientY: number) => {
    const el = svBoxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const s = Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100);
    const v = Math.round((1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))) * 100);
    applyHsv(hsv.h, s, v);
  };

  const handleSvPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    updateSvFromPointer(e.clientX, e.clientY);
    const pid = e.pointerId;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId === pid) updateSvFromPointer(ev.clientX, ev.clientY);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const harmonies = getColorHarmonies(inkColor);
  const harmonySwatches = Array.from(
    new Set([...harmonies.complementary, ...harmonies.analogous, ...harmonies.triadic]),
  );
  const activePalette =
    savedColorPalettes.find((p) => p.id === selectedPaletteId) ?? savedColorPalettes[0];

  return (
    <div
      data-testid="color-studio-popover"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="folio-popover w-72 rounded-2xl p-3.5 text-[var(--navy-900)]"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-[var(--crimson-500)]" />
          <h3 className="text-xs font-extrabold tracking-tight text-[var(--navy-900)]">
            Color Studio
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="color-studio-eyedropper-btn"
            title="Sample color from canvas (I)"
            aria-label="Activate Eyedropper"
            aria-pressed={activeTool === 'eyedropper'}
            onClick={() => {
              setActiveTool('eyedropper');
              onClose();
            }}
            className={`folio-press inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-bold ${
              activeTool === 'eyedropper'
                ? 'folio-glass-active border-transparent'
                : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-800)] hover:bg-[var(--surface-tint)]'
            }`}
          >
            <Pipette className="h-3.5 w-3.5" />
            <span>Sample</span>
          </button>
          <button
            type="button"
            aria-label="Close Color Studio"
            onClick={onClose}
            className="folio-press rounded-lg p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* HSB Saturation / Brightness Square */}
      <div
        ref={svBoxRef}
        data-testid="color-studio-sv-box"
        onPointerDown={handleSvPointerDown}
        className="relative mb-2.5 h-36 w-full cursor-crosshair overflow-hidden rounded-xl border border-[var(--border-subtle)]"
        style={{ backgroundColor: hsvToHex(hsv.h, 100, 100) }}
      >
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to right, #FFFFFF, rgba(255,255,255,0))' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, #000000, rgba(0,0,0,0))' }}
        />
        <span
          className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-1 ring-black/40"
          style={{
            left: `${hsv.s}%`,
            top: `${100 - hsv.v}%`,
            backgroundColor: inkColor,
          }}
        />
      </div>

      {/* Hue Bar */}
      <label className="mb-2.5 block space-y-1">
        <div className="flex items-center justify-between text-[10px] font-semibold text-[var(--navy-600)]">
          <span>Hue</span>
          <span className="folio-mono tabular-nums">{hsv.h}°</span>
        </div>
        <input
          type="range"
          data-testid="color-studio-hue-slider"
          aria-label="Color hue"
          min={0}
          max={359}
          value={hsv.h}
          onChange={(e) => applyHsv(Number(e.target.value), hsv.s, hsv.v)}
          className="h-3 w-full cursor-pointer appearance-none rounded-full"
          style={{
            background:
              'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)',
          }}
        />
      </label>

      {/* Active Swatch + Editable Hex */}
      <div className="mb-3 flex items-center gap-2">
        <span
          className="h-8 w-10 shrink-0 rounded-lg border border-[var(--border-subtle)] shadow-inner"
          style={{ backgroundColor: inkColor }}
        />
        <input
          type="text"
          data-testid="color-studio-hex-input"
          aria-label="Hex color code"
          value={hexDraft}
          onChange={(e) => {
            const val = e.target.value;
            setHexDraft(val);
            if (/^#?[0-9a-fA-F]{6}$/.test(val.trim())) {
              setActiveColor(normalizeHex(val));
            }
          }}
          onBlur={() => setHexDraft(normalizeHex(inkColor))}
          className="folio-input folio-mono h-8 flex-1 rounded-lg px-2.5 text-xs font-bold uppercase"
        />
      </div>

      {/* Color Harmonies */}
      <div className="mb-3 space-y-1">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--navy-600)]">
          Harmonies
        </span>
        <div className="flex flex-wrap gap-1.5">
          {harmonySwatches.map((hex) => (
            <button
              key={hex}
              type="button"
              title={`Harmony ${hex}`}
              aria-label={`Select harmony color ${hex}`}
              onClick={() => setActiveColor(hex)}
              className="h-5 w-5 rounded-full border border-black/15 transition hover:scale-110"
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      </div>

      {/* Palettes */}
      {activePalette && (
        <div className="space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-2">
          <div className="flex items-center justify-between gap-2">
            <select
              aria-label="Select color palette"
              value={activePalette.id}
              onChange={(e) => setSelectedPaletteId(e.target.value)}
              className="folio-input h-6 flex-1 rounded-md px-1.5 text-[11px] font-bold"
            >
              {savedColorPalettes.map((pal) => (
                <option key={pal.id} value={pal.id}>
                  {pal.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="color-palette-save-btn"
              title="Save current ink color to palette"
              aria-label="Save current ink color to palette"
              onClick={() => addColorToPalette(activePalette.id, inkColor)}
              className="folio-press inline-flex h-6 items-center gap-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-1.5 text-[10px] font-bold text-[var(--navy-800)] hover:bg-[var(--surface-tint)]"
            >
              <Plus className="h-3 w-3" />
              <span>Save</span>
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {activePalette.colors.map((hex) => (
              <button
                key={hex}
                type="button"
                title={hex}
                aria-label={`Palette color ${hex}`}
                onClick={() => setActiveColor(hex)}
                className={`h-5 w-5 rounded-md border border-black/15 transition hover:scale-110 ${
                  inkColor.toUpperCase() === hex.toUpperCase()
                    ? 'ring-2 ring-[var(--crimson-500)] ring-offset-1'
                    : ''
                }`}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
