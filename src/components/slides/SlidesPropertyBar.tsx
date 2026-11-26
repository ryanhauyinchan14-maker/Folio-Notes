import React from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  Copy,
  FlipHorizontal2,
  FlipVertical2,
  Italic,
  Lock,
  Trash2,
  Underline,
  Unlock,
} from 'lucide-react';
import type { SlideElement, SlideTransition } from '../../types/notes';

interface SlidesPropertyBarProps {
  selectedElement: SlideElement | null;
  selectedCount: number;
  transition: SlideTransition;
  onChangeTransition: (t: SlideTransition) => void;
  onOpenResize: () => void;
  onUpdateElement: (patch: Partial<SlideElement>) => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onDuplicateSelected: () => void;
  onToggleLock: () => void;
  onDeleteSelected: () => void;
}

const SLIDE_FONTS = [
  'Plus Jakarta Sans, sans-serif',
  'Inter, system-ui, sans-serif',
  'Georgia, serif',
  'JetBrains Mono, monospace',
];

export const SlidesPropertyBar: React.FC<SlidesPropertyBarProps> = ({
  selectedElement,
  selectedCount,
  transition,
  onChangeTransition,
  onOpenResize,
  onUpdateElement,
  onBringForward,
  onSendBackward,
  onDuplicateSelected,
  onToggleLock,
  onDeleteSelected,
}) => {
  return (
    <div
      data-testid="slides-property-bar"
      className="flex min-h-[44px] flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-glass)] px-3 py-1.5 text-xs backdrop-blur-md"
    >
      {!selectedElement ? (
        <>
          <span className="font-semibold text-[var(--navy-600)]">
            {selectedCount > 1
              ? `${selectedCount} elements selected`
              : 'Click an element to edit properties, or choose slide options:'}
          </span>
          <label className="inline-flex items-center gap-1.5 font-semibold text-[var(--navy-900)]">
            <span>Transition</span>
            <select
              aria-label="Slide transition"
              value={transition}
              onChange={(e) => onChangeTransition(e.target.value as SlideTransition)}
              className="folio-input h-7 rounded-lg px-2 text-xs font-semibold"
            >
              <option value="none">None</option>
              <option value="fade">Fade</option>
              <option value="slide">Slide</option>
              <option value="zoom">Zoom</option>
            </select>
          </label>
          <button
            type="button"
            onClick={onOpenResize}
            className="folio-btn-secondary folio-press rounded-lg px-2.5 py-1 text-xs font-semibold"
          >
            Custom Size…
          </button>
        </>
      ) : (
        <>
          {selectedElement.kind === 'text' && (
            <>
              <select
                aria-label="Text font family"
                value={selectedElement.fontFamily}
                onChange={(e) => onUpdateElement({ fontFamily: e.target.value })}
                className="folio-input h-7 max-w-[140px] rounded-lg px-2 text-xs font-semibold"
              >
                {SLIDE_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f.split(',')[0]}
                  </option>
                ))}
              </select>
              <input
                type="number"
                aria-label="Font size"
                min={10}
                max={200}
                value={selectedElement.fontSize}
                onChange={(e) =>
                  onUpdateElement({ fontSize: Math.max(10, Number(e.target.value) || 24) })
                }
                className="folio-input h-7 w-14 rounded-lg px-1.5 text-xs font-bold"
              />
              <button
                type="button"
                aria-label="Bold"
                onClick={() => onUpdateElement({ bold: !selectedElement.bold })}
                className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                  selectedElement.bold ? 'folio-glass-active' : 'hover:bg-[var(--surface-tint)]'
                }`}
              >
                <Bold className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Italic"
                onClick={() => onUpdateElement({ italic: !selectedElement.italic })}
                className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                  selectedElement.italic ? 'folio-glass-active' : 'hover:bg-[var(--surface-tint)]'
                }`}
              >
                <Italic className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Underline"
                onClick={() => onUpdateElement({ underline: !selectedElement.underline })}
                className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                  selectedElement.underline ? 'folio-glass-active' : 'hover:bg-[var(--surface-tint)]'
                }`}
              >
                <Underline className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Align Left"
                onClick={() => onUpdateElement({ align: 'left' })}
                className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                  selectedElement.align === 'left'
                    ? 'folio-glass-active'
                    : 'hover:bg-[var(--surface-tint)]'
                }`}
              >
                <AlignLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Align Center"
                onClick={() => onUpdateElement({ align: 'center' })}
                className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                  selectedElement.align === 'center'
                    ? 'folio-glass-active'
                    : 'hover:bg-[var(--surface-tint)]'
                }`}
              >
                <AlignCenter className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Align Right"
                onClick={() => onUpdateElement({ align: 'right' })}
                className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                  selectedElement.align === 'right'
                    ? 'folio-glass-active'
                    : 'hover:bg-[var(--surface-tint)]'
                }`}
              >
                <AlignRight className="h-3.5 w-3.5" />
              </button>
              <label className="inline-flex items-center gap-1 font-semibold">
                <span>Text</span>
                <input
                  type="color"
                  aria-label="Text color"
                  value={selectedElement.color}
                  onChange={(e) => onUpdateElement({ color: e.target.value })}
                  className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent"
                />
              </label>
            </>
          )}

          {selectedElement.kind === 'shape' && (
            <>
              <label className="inline-flex items-center gap-1 font-semibold">
                <span>Fill</span>
                <input
                  type="color"
                  aria-label="Shape fill color"
                  value={
                    selectedElement.fillColor === 'transparent'
                      ? '#DBF2FC'
                      : selectedElement.fillColor
                  }
                  onChange={(e) => onUpdateElement({ fillColor: e.target.value })}
                  className="h-6 w-7 cursor-pointer rounded"
                />
              </label>
              <label className="inline-flex items-center gap-1 font-semibold">
                <span>Border</span>
                <input
                  type="color"
                  aria-label="Shape stroke color"
                  value={
                    selectedElement.strokeColor === 'transparent'
                      ? '#072D59'
                      : selectedElement.strokeColor
                  }
                  onChange={(e) => onUpdateElement({ strokeColor: e.target.value })}
                  className="h-6 w-7 cursor-pointer rounded"
                />
              </label>
              <label className="inline-flex items-center gap-1 font-semibold">
                <span>Radius</span>
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={selectedElement.cornerRadius}
                  onChange={(e) =>
                    onUpdateElement({ cornerRadius: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="folio-input h-7 w-14 rounded-lg px-1.5 text-xs font-bold"
                />
              </label>
            </>
          )}

          {selectedElement.kind === 'image' && (
            <>
              <button
                type="button"
                aria-label="Flip Horizontal"
                onClick={() => onUpdateElement({ flipX: !selectedElement.flipX })}
                className="folio-press inline-flex h-7 items-center gap-1 rounded-lg px-2 hover:bg-[var(--surface-tint)]"
              >
                <FlipHorizontal2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Flip Vertical"
                onClick={() => onUpdateElement({ flipY: !selectedElement.flipY })}
                className="folio-press inline-flex h-7 items-center gap-1 rounded-lg px-2 hover:bg-[var(--surface-tint)]"
              >
                <FlipVertical2 className="h-3.5 w-3.5" />
              </button>
              <label className="inline-flex items-center gap-1 font-semibold">
                <span>Radius</span>
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={selectedElement.borderRadius}
                  onChange={(e) =>
                    onUpdateElement({ borderRadius: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="folio-input h-7 w-14 rounded-lg px-1.5 text-xs font-bold"
                />
              </label>
            </>
          )}

          <div className="mx-0.5 h-4 w-px bg-[var(--border-subtle)]" />

          <label className="inline-flex items-center gap-1 font-semibold">
            <span>Rot</span>
            <input
              type="number"
              aria-label="Rotation degrees"
              value={Math.round(selectedElement.rotation)}
              onChange={(e) => onUpdateElement({ rotation: Number(e.target.value) || 0 })}
              className="folio-input h-7 w-14 rounded-lg px-1.5 text-xs font-bold"
            />
          </label>
          <label className="inline-flex items-center gap-1 font-semibold">
            <span>Opacity</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={selectedElement.opacity}
              onChange={(e) => onUpdateElement({ opacity: Number(e.target.value) })}
              className="w-16 accent-[var(--crimson-500)]"
            />
          </label>
        </>
      )}

      {selectedCount > 0 && (
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title="Bring Forward"
            aria-label="Bring Forward"
            onClick={onBringForward}
            className="folio-press h-7 w-7 rounded-lg flex items-center justify-center hover:bg-[var(--surface-tint)]"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Send Backward"
            aria-label="Send Backward"
            onClick={onSendBackward}
            className="folio-press h-7 w-7 rounded-lg flex items-center justify-center hover:bg-[var(--surface-tint)]"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Duplicate (Ctrl+D)"
            aria-label="Duplicate Element"
            onClick={onDuplicateSelected}
            className="folio-press h-7 w-7 rounded-lg flex items-center justify-center hover:bg-[var(--surface-tint)]"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {selectedElement && (
            <button
              type="button"
              title={selectedElement.locked ? 'Unlock' : 'Lock'}
              aria-label={selectedElement.locked ? 'Unlock Element' : 'Lock Element'}
              onClick={onToggleLock}
              className="folio-press h-7 w-7 rounded-lg flex items-center justify-center hover:bg-[var(--surface-tint)]"
            >
              {selectedElement.locked ? (
                <Lock className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
              ) : (
                <Unlock className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <button
            type="button"
            title="Delete (Del)"
            aria-label="Delete Selected"
            data-testid="slides-delete-selected-btn"
            onClick={onDeleteSelected}
            className="folio-press h-7 w-7 rounded-lg flex items-center justify-center text-[var(--state-danger-text)] hover:bg-[var(--state-danger-bg)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
