import React from 'react';
import { Paintbrush, X } from 'lucide-react';
import { BRUSH_PRESETS, getBrushPreset } from '../../canvas/brushEngine';
import { useAppStore } from '../../store/useAppStore';
import { DraggableRangeSlider } from '../common/DraggableRangeSlider';

interface BrushStudioPopoverProps {
  onClose: () => void;
}

export const BrushStudioPopover: React.FC<BrushStudioPopoverProps> = ({ onClose }) => {
  const activeBrushId = useAppStore((s) => s.activeBrushId);
  const activeTool = useAppStore((s) => s.activeTool);
  const penSize = useAppStore((s) => s.penSize);
  const highlighterSize = useAppStore((s) => s.highlighterSize);
  const brushOpacity = useAppStore((s) => s.brushOpacity);
  const brushStreamline = useAppStore((s) => s.brushStreamline);
  const inkColor = useAppStore((s) => s.inkColor);

  const setActiveBrushId = useAppStore((s) => s.setActiveBrushId);
  const setActiveSize = useAppStore((s) => s.setActiveSize);
  const setBrushOpacity = useAppStore((s) => s.setBrushOpacity);
  const setBrushStreamline = useAppStore((s) => s.setBrushStreamline);

  const isHighlighter = activeTool === 'highlighter' || activeBrushId === 'highlighter';
  const currentSize = isHighlighter ? highlighterSize : penSize;
  const activeSpec = getBrushPreset(activeBrushId);

  return (
    <div
      data-testid="brush-studio-popover"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="folio-popover w-80 rounded-2xl p-3.5 text-[var(--navy-900)]"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Paintbrush className="h-4 w-4 text-[var(--crimson-500)]" />
          <h3 className="text-xs font-extrabold tracking-tight text-[var(--navy-900)]">
            Brush Studio
          </h3>
          <span className="folio-glass-badge rounded-full px-2 py-0.5 text-[10px] font-bold">
            {activeSpec.category}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close Brush Studio"
          onClick={onClose}
          className="folio-press rounded-lg p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="custom-scrollbar mb-3 grid max-h-60 grid-cols-1 gap-1.5 overflow-y-auto pr-0.5">
        {BRUSH_PRESETS.map((preset) => {
          const selected = activeBrushId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              data-testid={`brush-preset-${preset.id}`}
              aria-pressed={selected}
              onClick={() => setActiveBrushId(preset.id)}
              className={`folio-press flex items-center justify-between gap-2.5 rounded-xl border px-2.5 py-2 text-left transition ${
                selected
                  ? 'folio-glass-active border-transparent'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-bold">{preset.name}</span>
                  <span
                    className={`rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                      selected
                        ? 'bg-white/20 text-white'
                        : 'bg-[var(--surface-tint)] text-[var(--navy-600)]'
                    }`}
                  >
                    {preset.category}
                  </span>
                </div>
                <p
                  className={`truncate text-[10px] ${
                    selected ? 'text-white/80' : 'text-[var(--navy-600)]'
                  }`}
                >
                  {preset.description}
                </p>
              </div>
              <svg
                viewBox="0 0 152 38"
                className="h-7 w-20 shrink-0 rounded-lg bg-white/75 p-0.5 ring-1 ring-black/5"
                aria-hidden="true"
              >
                <path
                  d={preset.previewPath}
                  fill="none"
                  stroke={inkColor}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={Math.max(2, Math.min(7, preset.defaultSize * 0.85))}
                  strokeOpacity={preset.id === 'highlighter' ? 0.45 : preset.opacityMultiplier}
                  strokeDasharray={preset.grainAlpha > 0 ? '2 1.8' : undefined}
                />
              </svg>
            </button>
          );
        })}
      </div>

      <div className="space-y-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-2.5">
        <label className="block space-y-1">
          <div className="flex items-center justify-between text-[11px] font-semibold">
            <span>Size</span>
            <span className="folio-mono tabular-nums">{currentSize}px</span>
          </div>
          <DraggableRangeSlider
            testId="brush-studio-size-slider"
            ariaLabel="Brush size"
            min={isHighlighter ? 6 : 1}
            max={isHighlighter ? 48 : 36}
            step={isHighlighter ? 1 : 0.5}
            value={Math.max(isHighlighter ? 6 : 1, Math.min(isHighlighter ? 48 : 36, currentSize))}
            onChange={(val) => setActiveSize(val)}
            className="w-full"
          />
        </label>

        <label className="block space-y-1">
          <div className="flex items-center justify-between text-[11px] font-semibold">
            <span>Opacity</span>
            <span className="folio-mono tabular-nums">{Math.round(brushOpacity * 100)}%</span>
          </div>
          <DraggableRangeSlider
            testId="brush-studio-opacity-slider"
            ariaLabel="Brush opacity"
            min={10}
            max={100}
            step={5}
            value={Math.round(brushOpacity * 100)}
            onChange={(val) => setBrushOpacity(val / 100)}
            className="w-full"
          />
        </label>

        <label className="block space-y-1">
          <div className="flex items-center justify-between text-[11px] font-semibold">
            <span>Streamline Stabilization</span>
            <span className="folio-mono tabular-nums">{Math.round(brushStreamline * 100)}%</span>
          </div>
          <DraggableRangeSlider
            testId="brush-studio-streamline-slider"
            ariaLabel="Brush streamline stabilization"
            min={0}
            max={100}
            step={5}
            value={Math.round(brushStreamline * 100)}
            onChange={(val) => setBrushStreamline(val / 100)}
            className="w-full"
          />
        </label>
      </div>
    </div>
  );
};
