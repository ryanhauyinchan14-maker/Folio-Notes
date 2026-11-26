import React, { useState } from 'react';
import { ChevronLeft, Sliders } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export const ProcreateSideSliders: React.FC = () => {
  const activeTool = useAppStore((s) => s.activeTool);
  const penSize = useAppStore((s) => s.penSize);
  const highlighterSize = useAppStore((s) => s.highlighterSize);
  const brushOpacity = useAppStore((s) => s.brushOpacity);
  const setActiveSize = useAppStore((s) => s.setActiveSize);
  const setBrushOpacity = useAppStore((s) => s.setBrushOpacity);

  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 900 : false,
  );

  if (activeTool !== 'pen' && activeTool !== 'highlighter') {
    return null;
  }

  const isHighlighter = activeTool === 'highlighter';
  const currentSize = isHighlighter ? highlighterSize : penSize;
  const maxSize = isHighlighter ? 48 : 36;
  const minSize = isHighlighter ? 6 : 1;

  if (collapsed) {
    return (
      <button
        type="button"
        data-testid="procreate-side-sliders-toggle"
        title="Expand Brush Size & Opacity Side Sliders"
        aria-label="Expand brush sliders"
        onClick={() => setCollapsed(false)}
        className="folio-glass-island folio-press pointer-events-auto flex h-10 w-8 items-center justify-center rounded-r-xl text-[var(--navy-800)] hover:bg-[var(--surface-tint)]"
      >
        <Sliders className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div
      data-testid="procreate-side-sliders"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="folio-glass-island pointer-events-auto flex flex-col items-center gap-2.5 rounded-2xl px-2 py-2.5 text-[var(--navy-900)]"
    >
      <button
        type="button"
        title="Collapse Side Sliders"
        aria-label="Collapse brush sliders"
        onClick={() => setCollapsed(true)}
        className="folio-press rounded-lg p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>

      <div className="flex flex-col items-center gap-1">
        <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--navy-600)]">
          Size
        </span>
        <div className="flex h-24 w-6 items-center justify-center">
          <input
            type="range"
            aria-label="Quick brush size slider"
            min={minSize}
            max={maxSize}
            step={isHighlighter ? 1 : 0.5}
            value={Math.max(minSize, Math.min(maxSize, currentSize))}
            onChange={(e) => setActiveSize(Number(e.target.value))}
            className="h-1.5 w-20 -rotate-90 cursor-pointer accent-[var(--crimson-500)]"
          />
        </div>
        <span className="folio-mono text-[10px] font-bold tabular-nums">{currentSize}</span>
      </div>

      <div className="h-px w-5 bg-[var(--border-subtle)]" />

      <div className="flex flex-col items-center gap-1">
        <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--navy-600)]">
          Alpha
        </span>
        <div className="flex h-24 w-6 items-center justify-center">
          <input
            type="range"
            aria-label="Quick brush opacity slider"
            min={10}
            max={100}
            step={5}
            value={Math.round(brushOpacity * 100)}
            onChange={(e) => setBrushOpacity(Number(e.target.value) / 100)}
            className="h-1.5 w-20 -rotate-90 cursor-pointer accent-[var(--navy-800)]"
          />
        </div>
        <span className="folio-mono text-[10px] font-bold tabular-nums">
          {Math.round(brushOpacity * 100)}%
        </span>
      </div>
    </div>
  );
};
