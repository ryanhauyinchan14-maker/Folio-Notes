import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  Layers,
  Lock,
  Merge,
  Plus,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { ensurePageLayers, useAppStore } from '../../store/useAppStore';
import type { LayerBlendMode, Page } from '../../types/notes';
import { DraggableRangeSlider } from '../common/DraggableRangeSlider';

interface LayersPopoverProps {
  activePage: Page;
  onClose: () => void;
}

const BLEND_MODES: Array<{ value: LayerBlendMode; label: string }> = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
];

export const LayersPopover: React.FC<LayersPopoverProps> = ({ activePage, onClose }) => {
  const activeLayerIdByPage = useAppStore((s) => s.activeLayerIdByPage);
  const setActiveLayerForPage = useAppStore((s) => s.setActiveLayerForPage);
  const addDrawingLayer = useAppStore((s) => s.addDrawingLayer);
  const updateDrawingLayer = useAppStore((s) => s.updateDrawingLayer);
  const duplicateDrawingLayer = useAppStore((s) => s.duplicateDrawingLayer);
  const reorderDrawingLayer = useAppStore((s) => s.reorderDrawingLayer);
  const mergeDrawingLayerDown = useAppStore((s) => s.mergeDrawingLayerDown);
  const clearDrawingLayer = useAppStore((s) => s.clearDrawingLayer);
  const deleteDrawingLayer = useAppStore((s) => s.deleteDrawingLayer);

  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');

  const layers = ensurePageLayers(activePage);
  const activeLayerId = activeLayerIdByPage[activePage.id] ?? layers[layers.length - 1]?.id;
  const selectedLayer = layers.find((l) => l.id === activeLayerId) ?? layers[0];
  const selectedIndex = layers.findIndex((l) => l.id === selectedLayer?.id);
  const fallbackLayerId = layers[0]?.id;

  const commitRename = (layerId: string) => {
    setEditingLayerId(null);
    const trimmed = nameDraft.trim();
    if (trimmed) {
      updateDrawingLayer(activePage.id, layerId, { name: trimmed.slice(0, 32) });
    }
  };

  return (
    <div
      data-testid="layers-popover"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="folio-popover w-80 rounded-2xl p-3.5 text-[var(--navy-900)]"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-[var(--crimson-500)]" />
          <h3 className="text-xs font-extrabold tracking-tight text-[var(--navy-900)]">
            Layers
          </h3>
          <span className="folio-glass-badge rounded-full px-1.5 py-0.5 text-[10px] font-bold">
            {layers.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="add-layer-btn"
            title="Add New Layer"
            aria-label="Add Layer"
            onClick={() => addDrawingLayer(activePage.id)}
            className="folio-btn-crimson inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-bold"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add</span>
          </button>
          <button
            type="button"
            aria-label="Close Layers"
            onClick={onClose}
            className="folio-press rounded-lg p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Render top layer first, matching Procreate stacking */}
      <div className="custom-scrollbar mb-3 max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
        {[...layers].reverse().map((layer) => {
          const isSelected = layer.id === selectedLayer?.id;
          const strokeCount = activePage.strokes.filter(
            (s) => (s.layerId ?? fallbackLayerId) === layer.id,
          ).length;

          return (
            <div
              key={layer.id}
              data-testid={`layer-row-${layer.id}`}
              onClick={() => setActiveLayerForPage(activePage.id, layer.id)}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-2.5 py-2 transition ${
                isSelected
                  ? 'folio-glass-active border-transparent'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
              }`}
            >
              <div className="min-w-0 flex-1">
                {editingLayerId === layer.id ? (
                  <input
                    type="text"
                    autoFocus
                    value={nameDraft}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={() => commitRename(layer.id)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') commitRename(layer.id);
                      if (e.key === 'Escape') setEditingLayerId(null);
                    }}
                    className="folio-input h-6 w-full rounded px-1.5 text-xs font-bold text-[var(--navy-900)]"
                  />
                ) : (
                  <div
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setNameDraft(layer.name);
                      setEditingLayerId(layer.id);
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <span className="truncate text-xs font-bold">{layer.name}</span>
                    <span
                      className={`rounded px-1 text-[10px] font-semibold tabular-nums ${
                        isSelected
                          ? 'bg-white/20 text-white'
                          : 'bg-[var(--surface-tint)] text-[var(--navy-600)]'
                      }`}
                    >
                      {strokeCount}
                    </span>
                    {layer.alphaLock && (
                      <span
                        title="Alpha Lock active"
                        className={`rounded px-1 text-[9px] font-bold uppercase ${
                          isSelected ? 'bg-white/20 text-white' : 'bg-[var(--crimson-soft)] text-[var(--crimson-600)]'
                        }`}
                      >
                        Alpha
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  title={layer.locked ? 'Unlock Layer' : 'Lock Layer'}
                  aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateDrawingLayer(activePage.id, layer.id, { locked: !layer.locked });
                  }}
                  className={`rounded-md p-1 transition ${
                    isSelected
                      ? 'hover:bg-white/20 text-white/90'
                      : 'text-[var(--navy-600)] hover:bg-[var(--surface-tint)]'
                  }`}
                >
                  {layer.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 opacity-60" />}
                </button>
                <button
                  type="button"
                  data-testid={`layer-vis-${layer.id}`}
                  title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                  aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                  aria-pressed={layer.visible}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateDrawingLayer(activePage.id, layer.id, { visible: !layer.visible });
                  }}
                  className={`rounded-md p-1 transition ${
                    isSelected
                      ? 'hover:bg-white/20 text-white'
                      : 'text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
                  }`}
                >
                  {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 opacity-45" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {selectedLayer && (
        <div className="space-y-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-2.5">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold">
              <span>Blend</span>
              <select
                data-testid="layer-blend-select"
                aria-label="Layer blend mode"
                value={selectedLayer.blendMode}
                onChange={(e) =>
                  updateDrawingLayer(activePage.id, selectedLayer.id, {
                    blendMode: e.target.value as LayerBlendMode,
                  })
                }
                className="folio-input h-7 rounded-lg px-1.5 text-[11px] font-semibold"
              >
                {BLEND_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              data-testid="layer-alpha-lock-btn"
              aria-pressed={selectedLayer.alphaLock}
              onClick={() =>
                updateDrawingLayer(activePage.id, selectedLayer.id, {
                  alphaLock: !selectedLayer.alphaLock,
                })
              }
              className={`folio-press inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold ${
                selectedLayer.alphaLock
                  ? 'folio-glass-active border-transparent'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-700)] hover:bg-[var(--surface-tint)]'
              }`}
            >
              <CheckSquare className="h-3 w-3" />
              <span>Alpha</span>
            </button>
          </div>

          <label className="block space-y-1">
            <div className="flex items-center justify-between text-[11px] font-semibold">
              <span>Layer Opacity</span>
              <span className="folio-mono tabular-nums">
                {Math.round(selectedLayer.opacity * 100)}%
              </span>
            </div>
            <DraggableRangeSlider
              testId="layer-opacity-slider"
              ariaLabel="Layer opacity"
              min={0}
              max={100}
              step={5}
              value={Math.round(selectedLayer.opacity * 100)}
              onChange={(val) =>
                updateDrawingLayer(activePage.id, selectedLayer.id, {
                  opacity: val / 100,
                })
              }
              className="w-full"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-1 pt-0.5">
            <button
              type="button"
              title="Move Layer Up"
              aria-label="Move Layer Up"
              disabled={selectedIndex >= layers.length - 1}
              onClick={() => reorderDrawingLayer(activePage.id, selectedLayer.id, 'up')}
              className="folio-press rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1.5 text-[var(--navy-800)] hover:bg-[var(--surface-tint)] disabled:opacity-35"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Move Layer Down"
              aria-label="Move Layer Down"
              disabled={selectedIndex <= 0}
              onClick={() => reorderDrawingLayer(activePage.id, selectedLayer.id, 'down')}
              className="folio-press rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1.5 text-[var(--navy-800)] hover:bg-[var(--surface-tint)] disabled:opacity-35"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid="layer-duplicate-btn"
              title="Duplicate Layer"
              aria-label="Duplicate Layer"
              onClick={() => duplicateDrawingLayer(activePage.id, selectedLayer.id)}
              className="folio-press rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1.5 text-[var(--navy-800)] hover:bg-[var(--surface-tint)]"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid="layer-merge-down-btn"
              title="Merge Down"
              aria-label="Merge Layer Down"
              disabled={selectedIndex <= 0}
              onClick={() => mergeDrawingLayerDown(activePage.id, selectedLayer.id)}
              className="folio-press rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1.5 text-[var(--navy-800)] hover:bg-[var(--surface-tint)] disabled:opacity-35"
            >
              <Merge className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid="layer-clear-btn"
              title="Clear Layer Strokes"
              aria-label="Clear Layer"
              onClick={() => clearDrawingLayer(activePage.id, selectedLayer.id)}
              className="folio-press rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1.5 text-[var(--navy-800)] hover:bg-[var(--surface-tint)]"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid="layer-delete-btn"
              title="Delete Layer"
              aria-label="Delete Layer"
              disabled={layers.length <= 1}
              onClick={() => deleteDrawingLayer(activePage.id, selectedLayer.id)}
              className="folio-press rounded-lg border border-[var(--state-danger-border)] bg-[var(--surface-elevated)] p-1.5 text-[var(--state-danger-text)] hover:bg-[var(--state-danger-bg)] disabled:opacity-35"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
