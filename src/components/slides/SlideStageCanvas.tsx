import React, { useEffect, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { getFreehandStrokeOutline, outlineToSvgPath } from '../../canvas/strokeRenderer';
import { useAppStore } from '../../store/useAppStore';
import type { SlideBackground, SlideData, SlideElement, Stroke, StrokePoint } from '../../types/notes';
import { createId } from '../../utils/id';
import { getCssFallbackZoomFactor } from '../../utils/uiZoom';
import { SlideElementNode } from './SlideElementNode';

interface SlideStageCanvasProps {
  slideWidth: number;
  slideHeight: number;
  slideData: SlideData;
  selectedIds: string[];
  editingTextId: string | null;
  drawMode: boolean;
  drawColor: string;
  drawSize: number;
  onSelectIds: (ids: string[]) => void;
  onStartEditText: (id: string | null) => void;
  onChangeSlideData: (next: SlideData, commitHistory?: boolean) => void;
}

export function resolveSlideBgStyle(bg: SlideBackground): React.CSSProperties {
  if (bg.kind === 'image' && bg.imageDataUrl) {
    return {
      backgroundImage: `url(${bg.imageDataUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  if (bg.kind === 'gradient' && bg.gradient) {
    return { background: bg.gradient };
  }
  return { backgroundColor: bg.color || '#FFFFFF' };
}

export const SlideStageCanvas: React.FC<SlideStageCanvasProps> = ({
  slideWidth,
  slideHeight,
  slideData,
  selectedIds,
  editingTextId,
  drawMode,
  drawColor,
  drawSize,
  onSelectIds,
  onStartEditText,
  onChangeSlideData,
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [stageScale, setStageScale] = useState(0.5);
  const [userZoom, setUserZoom] = useState(1);
  const [snapGuides, setSnapGuides] = useState<{ x?: number; y?: number }>({});
  const [liveAngle, setLiveAngle] = useState<number | null>(null);
  const [activePoints, setActivePoints] = useState<StrokePoint[] | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const effectiveScale = stageScale * userZoom;

  useEffect(() => () => dragCleanupRef.current?.(), []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (useAppStore.getState().ctrlScrollBehavior === 'gui-scale') return;
      e.preventDefault();
      if (e.deltaY === 0) return;
      const step = e.deltaY < 0 ? 0.1 : -0.1;
      setUserZoom((prev) => Math.max(0.5, Math.min(2.0, Math.round((prev + step) * 100) / 100)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const recompute = () => {
      const localW = el.clientWidth || el.getBoundingClientRect().width / getCssFallbackZoomFactor();
      const localH = el.clientHeight || el.getBoundingClientRect().height / getCssFallbackZoomFactor();
      const availW = Math.max(200, (localW || 720) - 48);
      const availH = Math.max(150, (localH || 420) - 48);
      const nextScale = Math.min(availW / slideWidth, availH / slideHeight, 1);
      setStageScale(Math.max(0.1, nextScale));
    };
    recompute();
    window.addEventListener('resize', recompute);
    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', recompute);
    }
    const obs = new ResizeObserver(recompute);
    obs.observe(el);
    return () => {
      window.removeEventListener('resize', recompute);
      obs.disconnect();
    };
  }, [slideWidth, slideHeight]);

  const sortedElements = [...slideData.elements].sort((a, b) => a.zIndex - b.zIndex);
  const singleSelected =
    selectedIds.length === 1
      ? sortedElements.find((el) => el.id === selectedIds[0]) ?? null
      : null;

  const startMoveElements = (e: React.PointerEvent, anchorEl: SlideElement) => {
    if (drawMode || anchorEl.locked) return;
    e.stopPropagation();
    const isAlreadySelected = selectedIds.includes(anchorEl.id);
    const activeSelection = e.shiftKey
      ? isAlreadySelected
        ? selectedIds.filter((id) => id !== anchorEl.id)
        : [...selectedIds, anchorEl.id]
      : isAlreadySelected
        ? selectedIds
        : [anchorEl.id];
    onSelectIds(activeSelection);
    if (editingTextId && editingTextId !== anchorEl.id) {
      onStartEditText(null);
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const zoomFactor = getCssFallbackZoomFactor();
    const scale = Math.max(0.1, effectiveScale);
    const initialMap = new Map(
      slideData.elements
        .filter((el) => activeSelection.includes(el.id) && !el.locked)
        .map((el) => [el.id, { x: el.x, y: el.y }]),
    );
    let latestData = slideData;

    dragCleanupRef.current?.();
    const onMove = (ev: PointerEvent) => {
      const rawDx = (ev.clientX - startX) / (zoomFactor * scale);
      const rawDy = (ev.clientY - startY) / (zoomFactor * scale);

      let snapDx = rawDx;
      let snapDy = rawDy;
      const guides: { x?: number; y?: number } = {};
      const origin = initialMap.get(anchorEl.id);
      if (origin && !ev.altKey) {
        const cx = origin.x + rawDx + anchorEl.width / 2;
        const cy = origin.y + rawDy + anchorEl.height / 2;
        if (Math.abs(cx - slideWidth / 2) < 12) {
          snapDx += slideWidth / 2 - cx;
          guides.x = slideWidth / 2;
        }
        if (Math.abs(cy - slideHeight / 2) < 12) {
          snapDy += slideHeight / 2 - cy;
          guides.y = slideHeight / 2;
        }
      }
      setSnapGuides(guides);

      latestData = {
        ...slideData,
        elements: slideData.elements.map((el) => {
          const orig = initialMap.get(el.id);
          if (!orig) return el;
          return {
            ...el,
            x: Math.round(orig.x + snapDx),
            y: Math.round(orig.y + snapDy),
          };
        }),
      };
      onChangeSlideData(latestData, false);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setSnapGuides({});
      onChangeSlideData(latestData, true);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = onUp;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startResizeElement = (
    e: React.PointerEvent,
    el: SlideElement,
    handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w',
  ) => {
    if (el.locked) return;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const zoomFactor = getCssFallbackZoomFactor();
    const scale = Math.max(0.1, effectiveScale);
    const orig = { x: el.x, y: el.y, w: el.width, h: el.height };
    let latestData = slideData;

    dragCleanupRef.current?.();
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / (zoomFactor * scale);
      const dy = (ev.clientY - startY) / (zoomFactor * scale);
      let nextX = orig.x;
      let nextY = orig.y;
      let nextW = orig.w;
      let nextH = orig.h;

      if (handle.includes('e')) nextW = Math.max(24, orig.w + dx);
      if (handle.includes('s')) nextH = Math.max(12, orig.h + dy);
      if (handle.includes('w')) {
        const wDelta = Math.min(dx, orig.w - 24);
        nextX = orig.x + wDelta;
        nextW = orig.w - wDelta;
      }
      if (handle.includes('n')) {
        const hDelta = Math.min(dy, orig.h - 12);
        nextY = orig.y + hDelta;
        nextH = orig.h - hDelta;
      }

      latestData = {
        ...slideData,
        elements: slideData.elements.map((item) =>
          item.id === el.id
            ? {
                ...item,
                x: Math.round(nextX),
                y: Math.round(nextY),
                width: Math.round(nextW),
                height: Math.round(nextH),
              }
            : item,
        ),
      };
      onChangeSlideData(latestData, false);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onChangeSlideData(latestData, true);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = onUp;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startRotateElement = (e: React.PointerEvent, el: SlideElement) => {
    if (el.locked) return;
    e.stopPropagation();
    e.preventDefault();
    const stageEl = viewportRef.current?.querySelector<HTMLElement>('[data-testid="slide-stage-surface"]');
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const cx = rect.left + (el.x + el.width / 2) * effectiveScale;
    const cy = rect.top + (el.y + el.height / 2) * effectiveScale;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
    const origRot = el.rotation || 0;
    let latestData = slideData;

    dragCleanupRef.current?.();
    const onMove = (ev: PointerEvent) => {
      const curAngle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      let deg = origRot + ((curAngle - startAngle) * 180) / Math.PI;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      else deg = Math.round(deg);
      setLiveAngle(deg);
      latestData = {
        ...slideData,
        elements: slideData.elements.map((item) =>
          item.id === el.id ? { ...item, rotation: deg } : item,
        ),
      };
      onChangeSlideData(latestData, false);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLiveAngle(null);
      onChangeSlideData(latestData, true);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = onUp;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleInkPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawMode) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const pt: StrokePoint = {
      x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * slideWidth,
      y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * slideHeight,
      pressure: e.pressure > 0 ? e.pressure : 0.5,
    };
    let pts = [pt];
    setActivePoints(pts);

    const onMove = (ev: PointerEvent) => {
      const nextPt: StrokePoint = {
        x: ((ev.clientX - rect.left) / Math.max(1, rect.width)) * slideWidth,
        y: ((ev.clientY - rect.top) / Math.max(1, rect.height)) * slideHeight,
        pressure: ev.pressure > 0 ? ev.pressure : 0.5,
      };
      pts = [...pts, nextPt];
      setActivePoints(pts);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setActivePoints(null);
      if (pts.length >= 2) {
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const newStroke: Stroke = {
          id: createId(),
          tool: 'pen',
          color: drawColor,
          size: drawSize,
          opacity: 1,
          simulatePressure: true,
          points: pts,
          bounds: {
            minX: Math.min(...xs),
            minY: Math.min(...ys),
            maxX: Math.max(...xs),
            maxY: Math.max(...ys),
          },
          createdAt: Date.now(),
        };
        onChangeSlideData(
          {
            ...slideData,
            inkStrokes: [...(slideData.inkStrokes ?? []), newStroke],
          },
          true,
        );
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const renderHandles = (el: SlideElement) => {
    const handles: Array<{
      id: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
      style: React.CSSProperties;
    }> = [
      { id: 'nw', style: { left: -6, top: -6, cursor: 'nwse-resize' } },
      { id: 'n', style: { left: '50%', top: -6, transform: 'translateX(-50%)', cursor: 'ns-resize' } },
      { id: 'ne', style: { right: -6, top: -6, cursor: 'nesw-resize' } },
      { id: 'e', style: { right: -6, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' } },
      { id: 'se', style: { right: -6, bottom: -6, cursor: 'nwse-resize' } },
      { id: 's', style: { left: '50%', bottom: -6, transform: 'translateX(-50%)', cursor: 'ns-resize' } },
      { id: 'sw', style: { left: -6, bottom: -6, cursor: 'nesw-resize' } },
      { id: 'w', style: { left: -6, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' } },
    ];
    return (
      <>
        {handles.map((h) => (
          <div
            key={h.id}
            data-testid={`slide-resize-${h.id}`}
            onPointerDown={(ev) => startResizeElement(ev, el, h.id)}
            style={h.style}
            className="absolute z-30 h-3 w-3 rounded-full border-2 border-[var(--crimson-500)] bg-white shadow-xs"
          />
        ))}
        <button
          type="button"
          aria-label="Rotate element"
          data-testid="slide-rotate-handle"
          onPointerDown={(ev) => startRotateElement(ev, el)}
          style={{ left: '50%', bottom: -34, transform: 'translateX(-50%)' }}
          className="absolute z-30 flex h-6 w-6 cursor-grab items-center justify-center rounded-full border border-[var(--crimson-500)] bg-white text-[var(--navy-900)] shadow"
        >
          <RotateCw className="h-3 w-3" />
        </button>
        {liveAngle !== null && (
          <div
            style={{ left: '50%', bottom: -60, transform: 'translateX(-50%)' }}
            className="folio-btn-navy absolute z-40 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
          >
            {liveAngle}°
          </div>
        )}
      </>
    );
  };

  return (
    <div
      ref={viewportRef}
      data-testid="slide-stage-viewport"
      onClick={() => {
        onSelectIds([]);
        onStartEditText(null);
      }}
      className={`relative flex min-h-0 flex-1 items-center justify-center p-5 ${
        userZoom > 1 ? 'overflow-auto' : 'overflow-hidden'
      }`}
    >
      <div
        style={{
          width: `${Math.round(slideWidth * effectiveScale)}px`,
          height: `${Math.round(slideHeight * effectiveScale)}px`,
        }}
        className="relative shrink-0 shadow-[0_18px_48px_rgba(7,45,89,0.18)]"
      >
        <div
          data-testid="slide-stage-surface"
          style={{
            width: `${slideWidth}px`,
            height: `${slideHeight}px`,
            transform: `scale(${effectiveScale})`,
            transformOrigin: 'top left',
            ...resolveSlideBgStyle(slideData.background),
          }}
          className="relative overflow-hidden rounded-sm ring-1 ring-[var(--border-strong)]"
        >
          {/* Magnetic Center Snap Guides */}
          {snapGuides.x !== undefined && (
            <div
              style={{ left: `${snapGuides.x}px` }}
              className="pointer-events-none absolute inset-y-0 z-40 w-[2px] bg-[#EC4899]"
            />
          )}
          {snapGuides.y !== undefined && (
            <div
              style={{ top: `${snapGuides.y}px` }}
              className="pointer-events-none absolute inset-x-0 z-40 h-[2px] bg-[#EC4899]"
            />
          )}

          {sortedElements.map((el) => {
            const isSelected = selectedIds.includes(el.id);
            const isEditing = editingTextId === el.id;
            return (
              <div
                key={el.id}
                data-testid={`slide-element-${el.id}`}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => startMoveElements(e, el)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (el.kind === 'text' && !el.locked) {
                    onSelectIds([el.id]);
                    onStartEditText(el.id);
                  }
                }}
                style={{
                  left: `${el.x}px`,
                  top: `${el.y}px`,
                  width: `${el.width}px`,
                  height: `${el.height}px`,
                  transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                  opacity: el.opacity,
                  zIndex: el.zIndex,
                }}
                className={`absolute select-none ${
                  drawMode ? 'pointer-events-none' : 'cursor-move'
                } ${isSelected ? 'ring-2 ring-[var(--crimson-500)]' : 'hover:ring-1 hover:ring-[#072D59]/30'}`}
              >
                <SlideElementNode
                  element={el}
                  editing={isEditing}
                  onChangeText={(txt) =>
                    onChangeSlideData(
                      {
                        ...slideData,
                        elements: slideData.elements.map((item) =>
                          item.id === el.id && item.kind === 'text'
                            ? { ...item, text: txt }
                            : item,
                        ),
                      },
                      false,
                    )
                  }
                  onFinishEdit={() => {
                    onStartEditText(null);
                    onChangeSlideData(slideData, true);
                  }}
                />
                {isSelected && singleSelected?.id === el.id && !isEditing && renderHandles(el)}
              </div>
            );
          })}

          {/* Slide Freehand Ink SVG Layer */}
          <svg
            viewBox={`0 0 ${slideWidth} ${slideHeight}`}
            onPointerDown={handleInkPointerDown}
            className={`absolute inset-0 z-30 h-full w-full ${
              drawMode ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'
            }`}
          >
            {(slideData.inkStrokes ?? []).map((stroke) => {
              const d = outlineToSvgPath(
                getFreehandStrokeOutline(
                  stroke.points,
                  stroke.tool,
                  stroke.size * 2,
                  stroke.simulatePressure,
                ),
              );
              return (
                <path
                  key={stroke.id}
                  d={d}
                  fill={stroke.color}
                  opacity={stroke.opacity}
                />
              );
            })}
            {activePoints && activePoints.length > 1 && (
              <path
                d={outlineToSvgPath(
                  getFreehandStrokeOutline(activePoints, 'pen', drawSize * 2, true, false),
                )}
                fill={drawColor}
              />
            )}
          </svg>
        </div>
      </div>

      {userZoom !== 1 && (
        <div
          data-testid="slide-stage-zoom-pill"
          onClick={(e) => e.stopPropagation()}
          className="folio-glass-island absolute bottom-3 right-3 z-30 flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold text-[var(--navy-900)]"
        >
          <span className="folio-mono tabular-nums">{Math.round(userZoom * 100)}%</span>
          <button
            type="button"
            data-testid="slide-stage-zoom-reset"
            onClick={() => setUserZoom(1)}
            className="folio-btn-navy folio-press rounded-full px-2 py-0.5 text-[10px] font-bold"
          >
            Fit
          </button>
        </div>
      )}
    </div>
  );
};
