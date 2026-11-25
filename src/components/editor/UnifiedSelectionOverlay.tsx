import React, { useMemo, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { hitTestStroke } from '../../canvas/geometry';
import {
  getSelectionSummary,
  type PageElementSelection,
} from '../../canvas/selection';
import { hitTestTextbox } from '../../canvas/textLayout';
import { useAppStore } from '../../store/useAppStore';
import type { BoundingBox, Page } from '../../types/notes';
import type { CanvasContextMenuState } from './CanvasContextMenu';

interface UnifiedSelectionOverlayProps {
  page: Page;
  zoom: number;
  spacePressed?: boolean;
  isWhiteboard?: boolean;
  clientToWorld?: (clientX: number, clientY: number) => { x: number; y: number };
  liveDragOffset?: { dx: number; dy: number } | null;
  liveScaleBounds?: BoundingBox | null;
  isOffPageDrag?: boolean;
  onStrokeScalePreview?: (
    preview: {
      strokeIds: string[];
      originBounds: BoundingBox;
      targetBounds: BoundingBox;
    } | null,
  ) => void;
  onStartMultiDrag: (
    e: React.PointerEvent<HTMLElement>,
    sel: PageElementSelection,
  ) => void;
  onContextMenuRequest?: (menu: CanvasContextMenuState) => void;
}

type CornerKey = 'tl' | 'tr' | 'bl' | 'br';

export const UnifiedSelectionOverlay: React.FC<UnifiedSelectionOverlayProps> = ({
  page,
  zoom,
  spacePressed = false,
  isWhiteboard = false,
  clientToWorld,
  liveDragOffset = null,
  liveScaleBounds = null,
  isOffPageDrag = false,
  onStrokeScalePreview,
  onStartMultiDrag,
  onContextMenuRequest,
}) => {
  const lassoSelection = useAppStore((s) => s.lassoSelection);
  const selectedTextboxIds = useAppStore((s) => s.selectedTextboxIds);
  const selectedImageIds = useAppStore((s) => s.selectedImageIds);
  const activeTextboxId = useAppStore((s) => s.activeTextboxId);
  const croppingImageId = useAppStore((s) => s.croppingImageId);
  const beginEditTextbox = useAppStore((s) => s.beginEditTextbox);
  const setCroppingImageId = useAppStore((s) => s.setCroppingImageId);
  const toggleElementInSelection = useAppStore((s) => s.toggleElementInSelection);
  const commitStrokeScale = useAppStore((s) => s.commitStrokeScale);

  const [scalePill, setScalePill] = useState<string | null>(null);
  const scaleRef = useRef<{
    pointerId: number;
    corner: CornerKey;
    originBounds: BoundingBox;
    targetBounds: BoundingBox;
    strokeIds: string[];
    startClientX: number;
    startClientY: number;
  } | null>(null);

  const selection: PageElementSelection = useMemo(
    () => ({
      strokeIds:
        lassoSelection?.pageId === page.id ? lassoSelection.strokeIds : [],
      textboxIds: selectedTextboxIds,
      imageIds: selectedImageIds,
    }),
    [lassoSelection, page.id, selectedTextboxIds, selectedImageIds],
  );

  const summary = useMemo(
    () => getSelectionSummary(page, selection),
    [page, selection],
  );

  // Single ungrouped Textbox or single ungrouped Image is handled directly by its own overlay
  const handledBySingleElementOverlay =
    summary.totalCount === 1 &&
    (summary.textboxCount === 1 || summary.imageCount === 1);

  if (
    activeTextboxId ||
    croppingImageId ||
    summary.totalCount === 0 ||
    !summary.combinedBounds ||
    handledBySingleElementOverlay
  ) {
    return null;
  }

  const isStrokesOnly =
    summary.strokeCount > 0 &&
    summary.textboxCount === 0 &&
    summary.imageCount === 0;
  const activeBounds = liveScaleBounds ?? summary.combinedBounds;
  const pad = isStrokesOnly ? 8 : summary.textboxCount > 0 ? 10 : 6;
  const dxCur = liveDragOffset?.dx ?? 0;
  const dyCur = liveDragOffset?.dy ?? 0;

  const left = (activeBounds.minX - pad + dxCur) * zoom;
  const top = (activeBounds.minY - pad + dyCur) * zoom;
  const width = Math.max(
    24,
    (activeBounds.maxX - activeBounds.minX + pad * 2) * zoom,
  );
  const height = Math.max(
    24,
    (activeBounds.maxY - activeBounds.minY + pad * 2) * zoom,
  );

  const toPagePoint = (
    el: HTMLElement,
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null => {
    if (isWhiteboard && clientToWorld) {
      return clientToWorld(clientX, clientY);
    }
    const surface = el.closest<HTMLElement>('[data-page-id]');
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * page.paper.width,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * page.paper.height,
    };
  };

  const handleBoxPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (spacePressed) return;
    if (e.button === 2) {
      e.stopPropagation();
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.shiftKey) {
      const pt = toPagePoint(e.currentTarget, e.clientX, e.clientY);
      if (!pt) return;
      const tbSet = new Set(selection.textboxIds);
      const imgSet = new Set(selection.imageIds);
      const strokeSet = new Set(selection.strokeIds);

      const hitTb = hitTestTextbox(
        pt.x,
        pt.y,
        (page.textboxes ?? []).filter((t) => tbSet.has(t.id)),
      );
      if (hitTb) {
        toggleElementInSelection(page.id, { kind: 'textbox', id: hitTb.id });
        return;
      }

      const hitImg = [...(page.images ?? [])]
        .filter((im) => imgSet.has(im.id))
        .sort((a, b) => b.zIndex - a.zIndex)
        .find(
          (im) =>
            pt.x >= im.x - 4 &&
            pt.x <= im.x + im.width + 4 &&
            pt.y >= im.y - 4 &&
            pt.y <= im.y + im.height + 4,
        );
      if (hitImg) {
        toggleElementInSelection(page.id, { kind: 'image', id: hitImg.id });
        return;
      }

      const hitSt = hitTestStroke(
        pt.x,
        pt.y,
        page.strokes.filter((s) => strokeSet.has(s.id)),
        10,
      );
      if (hitSt) {
        toggleElementInSelection(page.id, { kind: 'stroke', id: hitSt.id });
      }
      return;
    }

    if (summary.anyLocked) return;
    onStartMultiDrag(e, selection);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (spacePressed) return;
    const pt = toPagePoint(e.currentTarget, e.clientX, e.clientY);
    if (!pt) return;

    const tbSet = new Set(selection.textboxIds);
    const imgSet = new Set(selection.imageIds);
    const hitTb = hitTestTextbox(
      pt.x,
      pt.y,
      (page.textboxes ?? []).filter((t) => tbSet.has(t.id)),
    );
    if (hitTb && !hitTb.locked) {
      e.stopPropagation();
      beginEditTextbox(page.id, hitTb.id);
      return;
    }

    const hitImg = [...(page.images ?? [])]
      .filter((im) => imgSet.has(im.id))
      .sort((a, b) => b.zIndex - a.zIndex)
      .find(
        (im) =>
          pt.x >= im.x - 4 &&
          pt.x <= im.x + im.width + 4 &&
          pt.y >= im.y - 4 &&
          pt.y <= im.y + im.height + 4,
      );
    if (hitImg && !hitImg.locked) {
      e.stopPropagation();
      setCroppingImageId(hitImg.id);
    }
  };

  const startStrokeScale = (
    e: React.PointerEvent<HTMLButtonElement>,
    corner: CornerKey,
  ) => {
    if (e.button !== 0 || summary.anyLocked || !isStrokesOnly) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    const ob = summary.combinedBounds!;
    scaleRef.current = {
      pointerId: e.pointerId,
      corner,
      originBounds: ob,
      targetBounds: ob,
      strokeIds: selection.strokeIds,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };
    const w = Math.round(ob.maxX - ob.minX);
    const h = Math.round(ob.maxY - ob.minY);
    setScalePill(`${w} × ${h} px`);
  };

  const moveStrokeScale = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = scaleRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    e.stopPropagation();

    const rawDx = (e.clientX - st.startClientX) / zoom;
    const rawDy = (e.clientY - st.startClientY) / zoom;
    const ob = st.originBounds;
    const origW = Math.max(4, ob.maxX - ob.minX);
    const origH = Math.max(4, ob.maxY - ob.minY);
    const minSize = 14;

    let nextMinX = ob.minX;
    let nextMaxX = ob.maxX;
    let nextMinY = ob.minY;
    let nextMaxY = ob.maxY;

    if (st.corner === 'br' || st.corner === 'tr') {
      nextMaxX = Math.max(ob.minX + minSize, ob.maxX + rawDx);
    } else {
      nextMinX = Math.min(ob.maxX - minSize, ob.minX + rawDx);
    }

    if (st.corner === 'br' || st.corner === 'bl') {
      nextMaxY = Math.max(ob.minY + minSize, ob.maxY + rawDy);
    } else {
      nextMinY = Math.min(ob.maxY - minSize, ob.minY + rawDy);
    }

    if (e.shiftKey) {
      const sX = (nextMaxX - nextMinX) / origW;
      const sY = (nextMaxY - nextMinY) / origH;
      const uni = Math.max(minSize / Math.min(origW, origH), Math.abs(sX - 1) >= Math.abs(sY - 1) ? sX : sY);
      const uW = origW * uni;
      const uH = origH * uni;
      if (st.corner === 'br' || st.corner === 'tr') nextMaxX = ob.minX + uW;
      else nextMinX = ob.maxX - uW;
      if (st.corner === 'br' || st.corner === 'bl') nextMaxY = ob.minY + uH;
      else nextMinY = ob.maxY - uH;
    }

    const nextTarget: BoundingBox = {
      minX: nextMinX,
      minY: nextMinY,
      maxX: nextMaxX,
      maxY: nextMaxY,
    };
    st.targetBounds = nextTarget;
    setScalePill(
      `${Math.round(nextTarget.maxX - nextTarget.minX)} × ${Math.round(
        nextTarget.maxY - nextTarget.minY,
      )} px`,
    );
    onStrokeScalePreview?.({
      strokeIds: st.strokeIds,
      originBounds: ob,
      targetBounds: nextTarget,
    });
  };

  const endStrokeScale = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = scaleRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    e.stopPropagation();
    scaleRef.current = null;
    setScalePill(null);
    onStrokeScalePreview?.(null);

    const ob = st.originBounds;
    const tb = st.targetBounds;
    const dw = Math.abs((tb.maxX - tb.minX) - (ob.maxX - ob.minX));
    const dh = Math.abs((tb.maxY - tb.minY) - (ob.maxY - ob.minY));
    if (dw >= 1 || dh >= 1) {
      commitStrokeScale(page.id, st.strokeIds, ob, tb);
    }
  };

  const corners: Array<{
    key: CornerKey;
    posClass: string;
    cursorClass: string;
    label: string;
  }> = [
    { key: 'tl', posClass: '-left-3 -top-3', cursorClass: 'cursor-nwse-resize', label: 'Scale stroke top-left' },
    { key: 'tr', posClass: '-right-3 -top-3', cursorClass: 'cursor-nesw-resize', label: 'Scale stroke top-right' },
    { key: 'bl', posClass: '-left-3 -bottom-3', cursorClass: 'cursor-nesw-resize', label: 'Scale stroke bottom-left' },
    { key: 'br', posClass: '-right-3 -bottom-3', cursorClass: 'cursor-nwse-resize', label: 'Scale stroke bottom-right' },
  ];

  const coordPill =
    liveDragOffset
      ? `X: ${Math.round(activeBounds.minX + dxCur)}, Y: ${Math.round(activeBounds.minY + dyCur)}`
      : scalePill;

  return (
    <div
      data-testid={isStrokesOnly ? 'lasso-selection-box' : 'multi-selection-box'}
      data-group-selected={summary.isSingleGroup ? 'true' : 'false'}
      data-locked={summary.anyLocked ? 'true' : 'false'}
      data-off-page-drag={isOffPageDrag ? 'true' : 'false'}
      onPointerDown={handleBoxPointerDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => {
        if (spacePressed) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenuRequest?.({
          pageId: page.id,
          clientX: e.clientX,
          clientY: e.clientY,
          targetType: isStrokesOnly ? 'lasso' : 'selection',
        });
      }}
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      }}
      className={`absolute z-20 rounded-md transition-colors ${
        spacePressed
          ? 'pointer-events-none'
          : summary.anyLocked
            ? 'pointer-events-auto cursor-default'
            : 'pointer-events-auto cursor-move'
      } ${
        isOffPageDrag
          ? 'opacity-45 border-[1.5px] border-dashed border-[#FD6E88] bg-[#FD6E88]/12'
          : summary.anyLocked
            ? 'border-2 border-dashed border-[#072D59]/60 bg-[#DBF2FC]/15'
            : summary.isSingleGroup
              ? 'border-2 border-[#072D59] bg-[#DBF2FC]/12 shadow-xs'
              : 'border-[1.5px] border-dashed border-[#072D59] bg-[#DBF2FC]/15 shadow-xs'
      }`}
    >
      {/* Stroke scale corner handles OR subtle corner indicators */}
      {isStrokesOnly && !summary.anyLocked ? (
        corners.map((c) => (
          <button
            key={c.key}
            type="button"
            data-testid={`stroke-handle-${c.key}`}
            title="Drag corner to scale strokes (Shift keeps aspect)"
            aria-label={c.label}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => startStrokeScale(e, c.key)}
            onPointerMove={moveStrokeScale}
            onPointerUp={endStrokeScale}
            onPointerCancel={endStrokeScale}
            className={`group absolute ${c.posClass} z-20 flex h-6 w-6 items-center justify-center bg-transparent ${c.cursorClass}`}
          >
            <span className="block h-2.5 w-2.5 rounded-full border-[1.5px] border-[#072D59] bg-white shadow-xs transition-transform group-hover:scale-110" />
          </button>
        ))
      ) : (
        <>
          <span className="pointer-events-none absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full border-2 border-[#072D59] bg-white" />
          <span className="pointer-events-none absolute -right-1.5 -top-1.5 h-3 w-3 rounded-full border-2 border-[#072D59] bg-white" />
          <span className="pointer-events-none absolute -bottom-1.5 -left-1.5 h-3 w-3 rounded-full border-2 border-[#072D59] bg-white" />
          <span className="pointer-events-none absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-full border-2 border-[#072D59] bg-white" />
        </>
      )}

      {summary.isSingleGroup && !summary.anyLocked && (
        <span
          data-testid="group-badge"
          className="folio-glass-badge pointer-events-none absolute -top-5 left-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
        >
          Group · {summary.totalCount}
        </span>
      )}

      {summary.anyLocked && (
        <span
          data-testid="element-lock-badge"
          title="Locked element — unlock from top bar or right-click menu"
          className="pointer-events-none absolute -top-3 right-1 inline-flex items-center gap-1 rounded-full border border-[#072D59]/20 bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#072D59] shadow-sm"
        >
          <Lock className="h-2.5 w-2.5 text-[#FD6E88]" />
          <span>Locked</span>
        </span>
      )}

      {coordPill && !isOffPageDrag && (
        <div
          data-testid="live-drag-pill"
          className="folio-mono folio-glass-badge pointer-events-none absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
        >
          {coordPill}
        </div>
      )}
    </div>
  );
};
