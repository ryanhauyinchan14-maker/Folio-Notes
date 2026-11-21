import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AlignmentGuide,
  computeDragAlignment,
  getTextboxBoundsList,
} from '../../canvas/alignment';
import {
  boundsOverlap,
  computeBoundsFromPoints,
  doesEraserHitStroke,
  doesStrokeIntersectRect,
  getStrokesInLasso,
  hitTestStroke,
  sampleShapePoints,
  scaleStroke,
} from '../../canvas/geometry';
import {
  findHandwritingCluster,
  tidyHandwritingCluster,
} from '../../canvas/handwritingCorrection';
import { drawCommittedImage, getImageBounds } from '../../canvas/imageRenderer';
import {
  isSmartDarkApplicable,
  renderPaperBackground,
  resolveEffectivePaperConfig,
} from '../../canvas/paperRenderer';
import {
  expandSelectionWithGroups,
  getSelectionSummary,
  getTextboxBounds,
  type PageElementSelection,
} from '../../canvas/selection';
import { recognizeShape } from '../../canvas/shapeRecognition';
import {
  drawActiveFreehandStroke,
  drawCommittedStroke,
  drawShapeGeometry,
} from '../../canvas/strokeRenderer';
import {
  drawCommittedTextbox,
  hitTestTextbox,
  measureTextboxLayout,
} from '../../canvas/textLayout';
import { useAppStore } from '../../store/useAppStore';
import type {
  BoundingBox,
  Page,
  PageImage,
  ShapeGeometry,
  Stroke,
  StrokePoint,
  Textbox,
} from '../../types/notes';
import { createId } from '../../utils/id';
import {
  buildPlacedPageImage,
  isSupportedImageFile,
  processUploadedImage,
} from '../../utils/imageImport';
import {
  getPdfDocumentForAsset,
  renderPdfPageToCanvas,
} from '../../utils/pdfEngine';
import type { CanvasContextMenuState } from './CanvasContextMenu';
import { ImageOverlay } from './ImageOverlay';
import { TextboxOverlay } from './TextboxOverlay';
import { UnifiedSelectionOverlay } from './UnifiedSelectionOverlay';

interface PageCanvasProps {
  page: Page;
  pageNumber: number;
  totalPages: number;
  zoom: number;
  spacePressed: boolean;
  onFocusPage: (pageId: string) => void;
  onRecordCursorPoint: (pageId: string, x: number, y: number) => void;
  onContextMenuRequest: (menu: CanvasContextMenuState) => void;
}

const HOLD_SNAP_DELAY_MS = 480;
const HOLD_MOVE_TOLERANCE = 5.5;
const HANDWRITING_CORRECTION_DELAY_MS = 650;
const MAX_BACKING_DIMENSION = 4096;

export const PageCanvas: React.FC<PageCanvasProps> = ({
  page,
  pageNumber,
  totalPages,
  zoom,
  spacePressed,
  onFocusPage,
  onRecordCursorPoint,
  onContextMenuRequest,
}) => {
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);

  const unlockedMasterKey = useAppStore((s) => s.unlockedMasterKey);
  const activeTool = useAppStore((s) => s.activeTool);
  const penColor = useAppStore((s) => s.penColor);
  const penSize = useAppStore((s) => s.penSize);
  const highlighterColor = useAppStore((s) => s.highlighterColor);
  const highlighterSize = useAppStore((s) => s.highlighterSize);
  const eraserSize = useAppStore((s) => s.eraserSize);
  const holdToSnapEnabled = useAppStore((s) => s.holdToSnapEnabled);
  const handwritingCorrectionEnabled = useAppStore((s) => s.handwritingCorrectionEnabled);
  const darkPaperView = useAppStore((s) => s.darkPaperView);
  const lassoSelection = useAppStore((s) => s.lassoSelection);
  const activeTextboxId = useAppStore((s) => s.activeTextboxId);
  const selectedTextboxIds = useAppStore((s) => s.selectedTextboxIds);
  const selectedImageIds = useAppStore((s) => s.selectedImageIds);

  const commitNewStroke = useAppStore((s) => s.commitNewStroke);
  const commitEraseStrokes = useAppStore((s) => s.commitEraseStrokes);
  const commitHandwritingCorrection = useAppStore((s) => s.commitHandwritingCorrection);
  const setUnifiedSelection = useAppStore((s) => s.setUnifiedSelection);
  const toggleElementInSelection = useAppStore((s) => s.toggleElementInSelection);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const commitMultiElementMove = useAppStore((s) => s.commitMultiElementMove);
  const altCloneMultiSelection = useAppStore((s) => s.altCloneMultiSelection);
  const commitAltMultiMove = useAppStore((s) => s.commitAltMultiMove);
  const spawnTextbox = useAppStore((s) => s.spawnTextbox);
  const beginEditTextbox = useAppStore((s) => s.beginEditTextbox);
  const selectTextbox = useAppStore((s) => s.selectTextbox);
  const addPageImages = useAppStore((s) => s.addPageImages);

  const [dpr, setDpr] = useState<number>(() =>
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  );
  const [snapToast, setSnapToast] = useState<string | null>(null);
  const [liveErasedIds, setLiveErasedIds] = useState<string[]>([]);
  const [draggingTextboxId, setDraggingTextboxId] = useState<string | null>(null);
  const [activeOverlayImageId, setActiveOverlayImageId] = useState<string | null>(null);
  const [imageDecodeTick, setImageDecodeTick] = useState(0);
  const [hoveredTextboxId, setHoveredTextboxId] = useState<string | null>(null);
  const [hoveredStrokeId, setHoveredStrokeId] = useState<string | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<BoundingBox | null>(null);
  const [liveMultiDrag, setLiveMultiDrag] = useState<{
    selection: PageElementSelection;
    dx: number;
    dy: number;
  } | null>(null);
  const [liveStrokeScale, setLiveStrokeScale] = useState<{
    strokeIds: string[];
    originBounds: BoundingBox;
    targetBounds: BoundingBox;
  } | null>(null);
  const [activeGuides, setActiveGuides] = useState<AlignmentGuide[]>([]);
  const [isDragOverFile, setIsDragOverFile] = useState(false);

  const handleImageDecoded = useCallback(() => {
    setImageDecodeTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const updateDpr = () => setDpr(window.devicePixelRatio || 1);
    window.addEventListener('resize', updateDpr);
    return () => window.removeEventListener('resize', updateDpr);
  }, []);

  const renderScale = useMemo(() => {
    const rawScale = dpr * zoom;
    const maxAllowed = Math.min(
      MAX_BACKING_DIMENSION / Math.max(1, page.paper.width),
      MAX_BACKING_DIMENSION / Math.max(1, page.paper.height),
    );
    return Math.min(rawScale, maxAllowed);
  }, [dpr, zoom, page.paper.width, page.paper.height]);

  const cssWidth = Math.round(page.paper.width * zoom);
  const cssHeight = Math.round(page.paper.height * zoom);
  const backingWidth = Math.max(1, Math.round(page.paper.width * renderScale));
  const backingHeight = Math.max(1, Math.round(page.paper.height * renderScale));

  const pdfBitmapRef = useRef<HTMLCanvasElement | null>(null);
  const renderedPdfScaleRef = useRef<number>(0);
  const [pdfRenderTick, setPdfRenderTick] = useState(0);
  const [isNearViewport, setIsNearViewport] = useState(true);
  const [debouncedPdfScale, setDebouncedPdfScale] = useState<number>(renderScale);

  useEffect(() => {
    if (!page.pdfBackground) return;
    const el = pageSurfaceRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.length > 0) {
          setIsNearViewport(entries.some((e) => e.isIntersecting));
        }
      },
      { rootMargin: '800px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [page.pdfBackground]);

  useEffect(() => {
    if (!page.pdfBackground) return;
    if (!pdfBitmapRef.current) {
      setDebouncedPdfScale(renderScale);
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedPdfScale(renderScale);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [renderScale, page.pdfBackground]);

  useEffect(() => {
    const bg = page.pdfBackground;
    if (!bg || !isNearViewport) {
      if (pdfBitmapRef.current) {
        pdfBitmapRef.current.width = 0;
        pdfBitmapRef.current.height = 0;
        pdfBitmapRef.current = null;
        renderedPdfScaleRef.current = 0;
        setPdfRenderTick((t) => t + 1);
      }
      return;
    }

    const controller = new AbortController();
    const targetW = Math.max(1, Math.round(page.paper.width * debouncedPdfScale));
    const targetH = Math.max(1, Math.round(page.paper.height * debouncedPdfScale));

    void (async () => {
      try {
        const doc = await getPdfDocumentForAsset(bg.assetId, unlockedMasterKey);
        if (!doc || controller.signal.aborted) return;

        const offscreen = document.createElement('canvas');
        const ok = await renderPdfPageToCanvas({
          doc,
          pageNumber: bg.pageNumber,
          canvas: offscreen,
          targetWidthPx: targetW,
          targetHeightPx: targetH,
          signal: controller.signal,
        });
        if (!ok || controller.signal.aborted) {
          offscreen.width = 0;
          offscreen.height = 0;
          return;
        }

        if (pdfBitmapRef.current && pdfBitmapRef.current !== offscreen) {
          pdfBitmapRef.current.width = 0;
          pdfBitmapRef.current.height = 0;
        }
        pdfBitmapRef.current = offscreen;
        renderedPdfScaleRef.current = debouncedPdfScale;
        setPdfRenderTick((t) => t + 1);
      } catch {
        // Ignore aborted or transient PDF render errors
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    page.pdfBackground?.assetId,
    page.pdfBackground?.pageNumber,
    page.paper.width,
    page.paper.height,
    debouncedPdfScale,
    isNearViewport,
    unlockedMasterKey,
  ]);

  const isPointerActiveRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const activePointsRef = useRef<StrokePoint[]>([]);
  const activeSimulatePressureRef = useRef<boolean>(true);
  const snappedShapeRef = useRef<ShapeGeometry | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const erasedSetRef = useRef<Set<string>>(new Set());
  const lastEraserPointRef = useRef<{ x: number; y: number } | null>(null);
  const lassoPointsRef = useRef<{ x: number; y: number }[]>([]);
  const rafPendingRef = useRef<number | null>(null);
  const snapToastTimerRef = useRef<number | null>(null);
  const handwritingTimerRef = useRef<number | null>(null);
  const multiDragCleanupRef = useRef<(() => void) | null>(null);
  const marqueeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (activeTool !== 'pan' || spacePressed) {
      setHoveredTextboxId(null);
      setHoveredStrokeId(null);
    }
  }, [activeTool, spacePressed, page.id]);

  const clearHandwritingTimer = useCallback(() => {
    if (handwritingTimerRef.current !== null) {
      window.clearTimeout(handwritingTimerRef.current);
      handwritingTimerRef.current = null;
    }
  }, []);

  const showSnapBadge = useCallback((label: string) => {
    setSnapToast(label);
    if (snapToastTimerRef.current !== null) {
      window.clearTimeout(snapToastTimerRef.current);
    }
    snapToastTimerRef.current = window.setTimeout(() => {
      setSnapToast(null);
    }, 1500);
  }, []);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const syncCanvasSizes = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;
    },
    [backingWidth, backingHeight],
  );

  const smartDarkActive = isSmartDarkApplicable(page.paper.paperColor, darkPaperView);
  const effectivePaper = useMemo(
    () => resolveEffectivePaperConfig(page.paper, darkPaperView),
    [page.paper, darkPaperView],
  );

  const hiddenDragTextboxIds = useMemo(() => {
    const s = new Set<string>();
    if (liveMultiDrag) {
      for (const id of liveMultiDrag.selection.textboxIds) s.add(id);
    }
    return s;
  }, [liveMultiDrag]);

  const hiddenDragImageIds = useMemo(() => {
    const s = new Set<string>();
    if (liveMultiDrag) {
      for (const id of liveMultiDrag.selection.imageIds) s.add(id);
    }
    return s;
  }, [liveMultiDrag]);

  // Redraw bottom static canvas ONLY when committed strokes/textboxes, paper, scale, dark view, or drag preview change
  useEffect(() => {
    const canvas = staticCanvasRef.current;
    if (!canvas) return;
    syncCanvasSizes(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    ctx.clearRect(0, 0, effectivePaper.width, effectivePaper.height);

    if (page.pdfBackground) {
      ctx.fillStyle = smartDarkActive ? '#131B2E' : '#FFFFFF';
      ctx.fillRect(0, 0, effectivePaper.width, effectivePaper.height);
      if (pdfBitmapRef.current && pdfBitmapRef.current.width > 0) {
        if (smartDarkActive) {
          ctx.save();
          ctx.filter = 'invert(0.88) hue-rotate(180deg) contrast(0.95) brightness(0.95)';
          ctx.drawImage(
            pdfBitmapRef.current,
            0,
            0,
            effectivePaper.width,
            effectivePaper.height,
          );
          ctx.restore();
        } else {
          ctx.drawImage(
            pdfBitmapRef.current,
            0,
            0,
            effectivePaper.width,
            effectivePaper.height,
          );
        }
      }
    } else {
      renderPaperBackground(ctx, effectivePaper);
    }

    const sortedImages = [...(page.images ?? [])].sort(
      (a, b) => a.zIndex - b.zIndex,
    );
    for (const img of sortedImages) {
      if (img.id === activeOverlayImageId || hiddenDragImageIds.has(img.id)) continue;
      drawCommittedImage(ctx, img, handleImageDecoded);
    }

    const hiddenStrokeIds = new Set<string>(liveErasedIds);
    if (liveMultiDrag) {
      for (const id of liveMultiDrag.selection.strokeIds) hiddenStrokeIds.add(id);
    }
    if (liveStrokeScale) {
      for (const id of liveStrokeScale.strokeIds) hiddenStrokeIds.add(id);
    }

    for (const stroke of page.strokes) {
      if (hiddenStrokeIds.has(stroke.id)) continue;
      drawCommittedStroke(ctx, stroke, true, smartDarkActive);
    }

    for (const tb of page.textboxes ?? []) {
      if (
        tb.id === activeTextboxId ||
        tb.id === draggingTextboxId ||
        hiddenDragTextboxIds.has(tb.id)
      ) {
        continue;
      }
      drawCommittedTextbox(ctx, tb, smartDarkActive);
    }
  }, [
    page.id,
    page.paper,
    page.pdfBackground,
    pdfRenderTick,
    effectivePaper,
    smartDarkActive,
    page.images,
    page.strokes,
    page.textboxes,
    renderScale,
    backingWidth,
    backingHeight,
    liveErasedIds,
    liveMultiDrag,
    liveStrokeScale,
    hiddenDragTextboxIds,
    hiddenDragImageIds,
    activeTextboxId,
    draggingTextboxId,
    activeOverlayImageId,
    imageDecodeTick,
    handleImageDecoded,
    syncCanvasSizes,
  ]);

  useEffect(() => {
    syncCanvasSizes(activeCanvasRef.current);
  }, [syncCanvasSizes]);

  const clearActiveCanvas = useCallback(() => {
    const canvas = activeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const renderTransformFrame = useCallback(
    (
      multiDrag: { selection: PageElementSelection; dx: number; dy: number } | null,
      strokeScale: {
        strokeIds: string[];
        originBounds: BoundingBox;
        targetBounds: BoundingBox;
      } | null,
    ) => {
      const canvas = activeCanvasRef.current;
      if (!canvas) return;
      syncCanvasSizes(canvas);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
      ctx.clearRect(0, 0, page.paper.width, page.paper.height);

      const currentPage =
        useAppStore.getState().pages.find((p) => p.id === page.id) ?? page;

      if (strokeScale) {
        const sSet = new Set(strokeScale.strokeIds);
        for (const stroke of currentPage.strokes) {
          if (!sSet.has(stroke.id)) continue;
          const scaled = scaleStroke(
            stroke,
            strokeScale.originBounds,
            strokeScale.targetBounds,
          );
          drawCommittedStroke(ctx, scaled, false, smartDarkActive);
        }
        return;
      }

      if (!multiDrag) return;
      const strokeSet = new Set(multiDrag.selection.strokeIds);
      const tbSet = new Set(multiDrag.selection.textboxIds);
      const imgSet = new Set(multiDrag.selection.imageIds);

      ctx.save();
      ctx.translate(multiDrag.dx, multiDrag.dy);

      const sortedImgs = [...(currentPage.images ?? [])]
        .filter((im) => imgSet.has(im.id))
        .sort((a, b) => a.zIndex - b.zIndex);
      for (const img of sortedImgs) {
        drawCommittedImage(ctx, img, handleImageDecoded);
      }

      for (const stroke of currentPage.strokes) {
        if (strokeSet.has(stroke.id)) {
          drawCommittedStroke(ctx, stroke, false, smartDarkActive);
        }
      }

      for (const tb of currentPage.textboxes ?? []) {
        if (tbSet.has(tb.id)) {
          drawCommittedTextbox(ctx, tb, smartDarkActive);
        }
      }

      ctx.restore();
    },
    [
      handleImageDecoded,
      page,
      renderScale,
      smartDarkActive,
      syncCanvasSizes,
    ],
  );

  const handleStrokeScalePreview = useCallback(
    (
      preview: {
        strokeIds: string[];
        originBounds: BoundingBox;
        targetBounds: BoundingBox;
      } | null,
    ) => {
      setLiveStrokeScale(preview);
      renderTransformFrame(null, preview);
    },
    [renderTransformFrame],
  );

  const renderActiveFrame = useCallback(() => {
    rafPendingRef.current = null;
    const canvas = activeCanvasRef.current;
    if (!canvas) return;
    syncCanvasSizes(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    ctx.clearRect(0, 0, page.paper.width, page.paper.height);

    if (!isPointerActiveRef.current) return;

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      const isHighlighter = activeTool === 'highlighter';
      const color = isHighlighter ? highlighterColor : penColor;
      const size = isHighlighter ? highlighterSize : penSize;
      const opacity = isHighlighter ? 0.45 : 1;

      if (snappedShapeRef.current) {
        drawShapeGeometry(
          ctx,
          snappedShapeRef.current,
          color,
          size,
          opacity,
          false,
          smartDarkActive,
          isHighlighter,
        );
      } else {
        drawActiveFreehandStroke(
          ctx,
          activePointsRef.current,
          activeTool,
          color,
          size,
          opacity,
          activeSimulatePressureRef.current,
          smartDarkActive,
        );
      }
    } else if (activeTool === 'eraser' && lastEraserPointRef.current) {
      const pt = lastEraserPointRef.current;
      ctx.save();
      ctx.strokeStyle = 'rgba(253, 110, 136, 0.85)';
      ctx.fillStyle = 'rgba(253, 110, 136, 0.14)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, eraserSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (activeTool === 'lasso' && lassoPointsRef.current.length > 1) {
      const pts = lassoPointsRef.current;
      ctx.save();
      ctx.strokeStyle = '#072D59';
      ctx.fillStyle = 'rgba(219, 242, 252, 0.28)';
      ctx.lineWidth = 1.75;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
  }, [
    activeTool,
    eraserSize,
    highlighterColor,
    highlighterSize,
    page.paper.height,
    page.paper.width,
    penColor,
    penSize,
    renderScale,
    smartDarkActive,
    syncCanvasSizes,
  ]);

  const scheduleActiveRender = useCallback(() => {
    if (rafPendingRef.current !== null) return;
    rafPendingRef.current = window.requestAnimationFrame(renderActiveFrame);
  }, [renderActiveFrame]);

  const toPagePoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = activeCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * page.paper.width;
    const y = ((clientY - rect.top) / Math.max(1, rect.height)) * page.paper.height;
    return { x, y };
  };

  const triggerHoldToSnap = useCallback(() => {
    if (!isPointerActiveRef.current || snappedShapeRef.current) return;
    const recognized = recognizeShape(activePointsRef.current);
    if (!recognized) return;

    snappedShapeRef.current = recognized;
    const labelMap: Record<ShapeGeometry['kind'], string> = {
      line: 'Snapped to Line',
      rect: 'Snapped to Rectangle',
      circle: 'Snapped to Circle',
    };
    showSnapBadge(labelMap[recognized.kind]);
    renderActiveFrame();
  }, [renderActiveFrame, showSnapBadge]);

  const resetHoldTimer = useCallback(
    (x: number, y: number) => {
      if (!holdToSnapEnabled || snappedShapeRef.current) return;
      const anchor = holdAnchorRef.current;
      if (!anchor || Math.hypot(x - anchor.x, y - anchor.y) > HOLD_MOVE_TOLERANCE) {
        holdAnchorRef.current = { x, y };
        clearHoldTimer();
        holdTimerRef.current = window.setTimeout(triggerHoldToSnap, HOLD_SNAP_DELAY_MS);
      }
    },
    [clearHoldTimer, holdToSnapEnabled, triggerHoldToSnap],
  );

  const sweepEraserSegment = (x1: number, y1: number, x2: number, y2: number) => {
    let added = false;
    for (const stroke of page.strokes) {
      if (stroke.locked || erasedSetRef.current.has(stroke.id)) continue;
      if (doesEraserHitStroke(x1, y1, x2, y2, eraserSize, stroke)) {
        erasedSetRef.current.add(stroke.id);
        added = true;
      }
    }
    if (added) {
      setLiveErasedIds(Array.from(erasedSetRef.current));
    }
  };

  const startMultiDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, targetSelection: PageElementSelection) => {
      multiDragCleanupRef.current?.();
      const latestPage =
        useAppStore.getState().pages.find((p) => p.id === page.id) ?? page;
      const summary = getSelectionSummary(latestPage, targetSelection);
      if (summary.totalCount === 0 || !summary.combinedBounds || summary.anyLocked) {
        return;
      }

      let workingSel = targetSelection;
      let prevSnapshot: {
        strokes: Stroke[];
        textboxes: Textbox[];
        images: PageImage[];
      } | null = null;

      if (e.altKey) {
        prevSnapshot = {
          strokes: [...latestPage.strokes],
          textboxes: [...(latestPage.textboxes ?? [])],
          images: [...(latestPage.images ?? [])],
        };
        const cloned = altCloneMultiSelection(page.id, targetSelection);
        if (cloned) {
          workingSel = cloned;
        } else {
          prevSnapshot = null;
        }
      }

      const freshPage =
        useAppStore.getState().pages.find((p) => p.id === page.id) ?? latestPage;
      const originBounds =
        getSelectionSummary(freshPage, workingSel).combinedBounds ??
        summary.combinedBounds;

      const excludedIds = new Set<string>([
        ...workingSel.strokeIds,
        ...workingSel.textboxIds,
        ...workingSel.imageIds,
      ]);

      const pointerId = e.pointerId;
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      let hasMoved = false;
      let lastDx = 0;
      let lastDy = 0;

      if (prevSnapshot) {
        const preview = { selection: workingSel, dx: 0, dy: 0 };
        setLiveMultiDrag(preview);
        renderTransformFrame(preview, null);
      }

      const onWindowMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const distPx = Math.hypot(
          ev.clientX - startClientX,
          ev.clientY - startClientY,
        );
        if (!hasMoved && distPx < 2 && !prevSnapshot) return;
        hasMoved = true;

        const rawDx = (ev.clientX - startClientX) / zoom;
        const rawDy = (ev.clientY - startClientY) / zoom;

        const otherBounds = getTextboxBoundsList(
          freshPage.textboxes ?? [],
          excludedIds,
          freshPage.images ?? [],
          freshPage.strokes,
        );
        const { dx, dy, guides } = computeDragAlignment({
          originBounds,
          rawDx,
          rawDy,
          paper: freshPage.paper,
          otherTextboxBounds: otherBounds,
          axisLock: ev.shiftKey,
          bypassSnap: ev.ctrlKey || ev.metaKey,
          snapThreshold: 5,
        });

        lastDx = dx;
        lastDy = dy;
        setActiveGuides(guides);
        const nextPreview = { selection: workingSel, dx, dy };
        setLiveMultiDrag(nextPreview);
        renderTransformFrame(nextPreview, null);
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onWindowMove);
        window.removeEventListener('pointerup', onWindowUp);
        window.removeEventListener('pointercancel', onWindowUp);
        multiDragCleanupRef.current = null;
      };

      const onWindowUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanup();
        setLiveMultiDrag(null);
        setActiveGuides([]);
        clearActiveCanvas();

        if (prevSnapshot) {
          commitAltMultiMove(page.id, prevSnapshot, workingSel, lastDx, lastDy);
        } else if (hasMoved && (Math.abs(lastDx) >= 0.25 || Math.abs(lastDy) >= 0.25)) {
          commitMultiElementMove(page.id, workingSel, lastDx, lastDy);
        }
      };

      multiDragCleanupRef.current = cleanup;
      window.addEventListener('pointermove', onWindowMove);
      window.addEventListener('pointerup', onWindowUp);
      window.addEventListener('pointercancel', onWindowUp);
    },
    [
      altCloneMultiSelection,
      clearActiveCanvas,
      commitAltMultiMove,
      commitMultiElementMove,
      page,
      renderTransformFrame,
      zoom,
    ],
  );

  const startMarqueeSelection = useCallback(
    (
      e: React.PointerEvent<HTMLCanvasElement>,
      startPt: { x: number; y: number },
      priorSelection: PageElementSelection,
      preservePrior: boolean,
    ) => {
      marqueeCleanupRef.current?.();
      const pointerId = e.pointerId;
      const clampX = (val: number) => Math.max(0, Math.min(page.paper.width, val));
      const clampY = (val: number) => Math.max(0, Math.min(page.paper.height, val));
      let currentRect: BoundingBox = {
        minX: clampX(startPt.x),
        minY: clampY(startPt.y),
        maxX: clampX(startPt.x),
        maxY: clampY(startPt.y),
      };

      const onWindowMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const pt = toPagePoint(ev.clientX, ev.clientY);
        const cx = clampX(pt.x);
        const cy = clampY(pt.y);
        currentRect = {
          minX: Math.min(startPt.x, cx),
          minY: Math.min(startPt.y, cy),
          maxX: Math.max(startPt.x, cx),
          maxY: Math.max(startPt.y, cy),
        };
        setMarqueeRect(currentRect);
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onWindowMove);
        window.removeEventListener('pointerup', onWindowUp);
        window.removeEventListener('pointercancel', onWindowUp);
        marqueeCleanupRef.current = null;
      };

      const onWindowUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanup();
        setMarqueeRect(null);

        const rect = currentRect;
        if (rect.maxX - rect.minX < 3 && rect.maxY - rect.minY < 3) {
          return;
        }

        const freshPage =
          useAppStore.getState().pages.find((p) => p.id === page.id) ?? page;
        const hitStrokeIds = freshPage.strokes
          .filter((s) => doesStrokeIntersectRect(s, rect))
          .map((s) => s.id);
        const hitTbIds = (freshPage.textboxes ?? [])
          .filter((tb) => boundsOverlap(getTextboxBounds(tb), rect))
          .map((tb) => tb.id);
        const hitImgIds = (freshPage.images ?? [])
          .filter((im) => boundsOverlap(getImageBounds(im), rect))
          .map((im) => im.id);

        const mergedStrokeIds = preservePrior
          ? Array.from(new Set([...priorSelection.strokeIds, ...hitStrokeIds]))
          : hitStrokeIds;
        const mergedTbIds = preservePrior
          ? Array.from(new Set([...priorSelection.textboxIds, ...hitTbIds]))
          : hitTbIds;
        const mergedImgIds = preservePrior
          ? Array.from(new Set([...priorSelection.imageIds, ...hitImgIds]))
          : hitImgIds;

        if (
          mergedStrokeIds.length > 0 ||
          mergedTbIds.length > 0 ||
          mergedImgIds.length > 0
        ) {
          setUnifiedSelection(
            page.id,
            {
              strokeIds: mergedStrokeIds,
              textboxIds: mergedTbIds,
              imageIds: mergedImgIds,
            },
            { expandGroups: true },
          );
        }
      };

      marqueeCleanupRef.current = cleanup;
      window.addEventListener('pointermove', onWindowMove);
      window.addEventListener('pointerup', onWindowUp);
      window.addEventListener('pointercancel', onWindowUp);
    },
    [page, setUnifiedSelection],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    onFocusPage(page.id);
    clearHandwritingTimer();

    const { x, y } = toPagePoint(e.clientX, e.clientY);
    onRecordCursorPoint(page.id, x, y);

    if (activeTool === 'text' && e.button === 0 && !spacePressed) {
      e.preventDefault();
      e.stopPropagation();
      const hit = hitTestTextbox(x, y, page.textboxes ?? []);
      if (hit) {
        beginEditTextbox(page.id, hit.id);
      } else {
        spawnTextbox({ pageId: page.id, x, y });
      }
      return;
    }

    // Universal Select (`V`) -> direct scribble selection/drag, Shift+Click toggle, or empty-paper Marquee drag-box
    if (activeTool === 'pan' && e.button === 0 && !spacePressed) {
      const hitTb = hitTestTextbox(x, y, page.textboxes ?? []);
      if (hitTb) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          toggleElementInSelection(page.id, { kind: 'textbox', id: hitTb.id });
        } else {
          selectTextbox(hitTb.id);
        }
        return;
      }

      const hitStroke = hitTestStroke(x, y, page.strokes, 8);
      if (hitStroke) {
        e.preventDefault();
        e.stopPropagation();
        setHoveredStrokeId(null);
        if (e.shiftKey) {
          toggleElementInSelection(page.id, { kind: 'stroke', id: hitStroke.id });
          return;
        }
        const expanded = expandSelectionWithGroups(page, {
          strokeIds: [hitStroke.id],
          textboxIds: [],
          imageIds: [],
        });
        setUnifiedSelection(page.id, expanded, { expandGroups: false });
        const summary = getSelectionSummary(page, expanded);
        if (!summary.anyLocked) {
          startMultiDrag(e, expanded);
        }
        return;
      }

      // Empty paper drag -> start Marquee selection rectangle
      e.preventDefault();
      e.stopPropagation();
      const prior: PageElementSelection = e.shiftKey
        ? {
            strokeIds:
              lassoSelection?.pageId === page.id ? lassoSelection.strokeIds : [],
            textboxIds: selectedTextboxIds,
            imageIds: selectedImageIds,
          }
        : { strokeIds: [], textboxIds: [], imageIds: [] };
      if (!e.shiftKey) {
        clearSelection();
      }
      startMarqueeSelection(e, { x, y }, prior, e.shiftKey);
      return;
    }

    // In Lasso, clicking an existing textbox selects it cleanly
    if (activeTool === 'lasso' && e.button === 0 && !spacePressed) {
      const hit = hitTestTextbox(x, y, page.textboxes ?? []);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        selectTextbox(hit.id);
        return;
      }
    }

    clearSelection();

    if (spacePressed || e.button !== 0) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    isPointerActiveRef.current = true;
    activePointerIdRef.current = e.pointerId;
    snappedShapeRef.current = null;
    clearHoldTimer();

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      const isStylus = e.pointerType === 'pen';
      activeSimulatePressureRef.current = !isStylus;
      const pressure = isStylus ? Math.max(0.05, Math.min(1, e.pressure || 0.5)) : 0.5;

      activePointsRef.current = [{ x, y, pressure, t: e.timeStamp }];
      holdAnchorRef.current = { x, y };
      if (holdToSnapEnabled) {
        holdTimerRef.current = window.setTimeout(triggerHoldToSnap, HOLD_SNAP_DELAY_MS);
      }
      renderActiveFrame();
    } else if (activeTool === 'eraser') {
      erasedSetRef.current = new Set();
      lastEraserPointRef.current = { x, y };
      sweepEraserSegment(x, y, x, y);
      renderActiveFrame();
    } else if (activeTool === 'lasso') {
      clearSelection();
      lassoPointsRef.current = [{ x, y }];
      renderActiveFrame();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const hoverPt = toPagePoint(e.clientX, e.clientY);
    onRecordCursorPoint(page.id, hoverPt.x, hoverPt.y);

    if (!isPointerActiveRef.current) {
      const hitTb = hitTestTextbox(hoverPt.x, hoverPt.y, page.textboxes ?? []);
      const nextTbHover = hitTb ? hitTb.id : null;
      if (nextTbHover !== hoveredTextboxId) {
        setHoveredTextboxId(nextTbHover);
      }
      if (activeTool === 'pan' && !spacePressed && !nextTbHover) {
        const hitSt = hitTestStroke(hoverPt.x, hoverPt.y, page.strokes, 8);
        const nextStHover = hitSt ? hitSt.id : null;
        if (nextStHover !== hoveredStrokeId) {
          setHoveredStrokeId(nextStHover);
        }
      } else if (hoveredStrokeId !== null) {
        setHoveredStrokeId(null);
      }
      return;
    }

    if (activePointerIdRef.current !== e.pointerId) return;

    e.preventDefault();
    const nativeEvt = e.nativeEvent;
    const coalesced =
      typeof nativeEvt.getCoalescedEvents === 'function'
        ? nativeEvt.getCoalescedEvents()
        : [nativeEvt];
    const events = coalesced.length > 0 ? coalesced : [nativeEvt];

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      const isStylus = e.pointerType === 'pen';
      for (const sample of events) {
        const { x, y } = toPagePoint(sample.clientX, sample.clientY);

        if (snappedShapeRef.current?.kind === 'line') {
          const line = snappedShapeRef.current;
          let x2 = x;
          let y2 = y;
          const angleDeg =
            (Math.atan2(Math.abs(y2 - line.y1), Math.abs(x2 - line.x1)) * 180) / Math.PI;
          if (angleDeg < 4) y2 = line.y1;
          else if (angleDeg > 86) x2 = line.x1;
          snappedShapeRef.current = { ...line, x2, y2 };
          continue;
        }

        if (snappedShapeRef.current) continue;

        const pressure = isStylus
          ? Math.max(0.05, Math.min(1, sample.pressure || 0.5))
          : 0.5;
        activePointsRef.current.push({ x, y, pressure, t: sample.timeStamp });
        resetHoldTimer(x, y);
      }
      scheduleActiveRender();
    } else if (activeTool === 'eraser') {
      for (const sample of events) {
        const { x, y } = toPagePoint(sample.clientX, sample.clientY);
        const prev = lastEraserPointRef.current ?? { x, y };
        sweepEraserSegment(prev.x, prev.y, x, y);
        lastEraserPointRef.current = { x, y };
      }
      scheduleActiveRender();
    } else if (activeTool === 'lasso') {
      for (const sample of events) {
        const { x, y } = toPagePoint(sample.clientX, sample.clientY);
        const pts = lassoPointsRef.current;
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(x - last.x, y - last.y) >= 3) {
          pts.push({ x, y });
        }
      }
      scheduleActiveRender();
    }
  };

  const finishPointerInteraction = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerActiveRef.current || activePointerIdRef.current !== e.pointerId) {
      return;
    }

    clearHoldTimer();
    if (rafPendingRef.current !== null) {
      window.cancelAnimationFrame(rafPendingRef.current);
      rafPendingRef.current = null;
    }

    isPointerActiveRef.current = false;
    activePointerIdRef.current = null;

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      const isHighlighter = activeTool === 'highlighter';
      const color = isHighlighter ? highlighterColor : penColor;
      const size = isHighlighter ? highlighterSize : penSize;
      const opacity = isHighlighter ? 0.45 : 1;
      const snapped = snappedShapeRef.current;

      if (snapped) {
        const pts = sampleShapePoints(snapped, 0.5);
        const stroke: Stroke = {
          id: createId(),
          tool: activeTool,
          color,
          size,
          opacity,
          simulatePressure: false,
          points: pts,
          shape: snapped,
          bounds: computeBoundsFromPoints(pts, size * 0.6, snapped),
          createdAt: Date.now(),
        };
        commitNewStroke(page.id, stroke);
      } else if (activePointsRef.current.length > 0) {
        const rawPoints = [...activePointsRef.current];
        if (rawPoints.length === 1) {
          const p0 = rawPoints[0];
          rawPoints.push({ ...p0, x: p0.x + 0.25, y: p0.y + 0.25 });
        }
        const stroke: Stroke = {
          id: createId(),
          tool: activeTool,
          color,
          size,
          opacity,
          simulatePressure: activeSimulatePressureRef.current,
          points: rawPoints,
          bounds: computeBoundsFromPoints(rawPoints, size * 0.6),
          createdAt: Date.now(),
        };
        commitNewStroke(page.id, stroke);

        if (activeTool === 'pen' && handwritingCorrectionEnabled) {
          clearHandwritingTimer();
          const committedStrokeId = stroke.id;
          handwritingTimerRef.current = window.setTimeout(() => {
            handwritingTimerRef.current = null;
            const latestPage = useAppStore
              .getState()
              .pages.find((p) => p.id === page.id);
            if (!latestPage) return;
            const cluster = findHandwritingCluster(latestPage.strokes, committedStrokeId);
            if (cluster.length === 0) return;
            const tidied = tidyHandwritingCluster(cluster);
            if (tidied.length > 0) {
              commitHandwritingCorrection(
                page.id,
                cluster.map((s) => s.id),
                tidied,
              );
            }
          }, HANDWRITING_CORRECTION_DELAY_MS);
        }
      }

      activePointsRef.current = [];
      snappedShapeRef.current = null;
    } else if (activeTool === 'eraser') {
      const toDelete = Array.from(erasedSetRef.current);
      erasedSetRef.current = new Set();
      lastEraserPointRef.current = null;
      setLiveErasedIds([]);
      if (toDelete.length > 0) {
        commitEraseStrokes(page.id, toDelete);
      }
    } else if (activeTool === 'lasso') {
      const polygon = lassoPointsRef.current;
      lassoPointsRef.current = [];
      if (polygon.length >= 3) {
        const selectedIds = getStrokesInLasso(polygon, page.strokes);
        if (selectedIds.length > 0) {
          setUnifiedSelection(
            page.id,
            { strokeIds: selectedIds, textboxIds: [], imageIds: [] },
            { expandGroups: true },
          );
        } else {
          clearSelection();
        }
      }
    }

    clearActiveCanvas();
  };

  useEffect(() => {
    return () => {
      clearHoldTimer();
      clearHandwritingTimer();
      multiDragCleanupRef.current?.();
      marqueeCleanupRef.current?.();
      if (snapToastTimerRef.current !== null) {
        window.clearTimeout(snapToastTimerRef.current);
      }
      if (rafPendingRef.current !== null) {
        window.cancelAnimationFrame(rafPendingRef.current);
      }
    };
  }, [clearHoldTimer, clearHandwritingTimer]);

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool !== 'pan' && activeTool !== 'lasso' && activeTool !== 'text') return;
    const { x, y } = toPagePoint(e.clientX, e.clientY);
    onRecordCursorPoint(page.id, x, y);
    const hit = hitTestTextbox(x, y, page.textboxes ?? []);
    if (hit) {
      if (!hit.locked) beginEditTextbox(page.id, hit.id);
    } else {
      spawnTextbox({ pageId: page.id, x, y });
    }
  };

  const handleCanvasContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toPagePoint(e.clientX, e.clientY);
    const hit = hitTestTextbox(x, y, page.textboxes ?? []);
    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      selectTextbox(hit.id);
      onContextMenuRequest({
        pageId: page.id,
        clientX: e.clientX,
        clientY: e.clientY,
        targetType: 'textbox',
        textboxId: hit.id,
      });
      return;
    }
    const hitStroke = hitTestStroke(x, y, page.strokes, 8);
    if (hitStroke) {
      e.preventDefault();
      e.stopPropagation();
      setUnifiedSelection(
        page.id,
        { strokeIds: [hitStroke.id], textboxIds: [], imageIds: [] },
        { expandGroups: true },
      );
      onContextMenuRequest({
        pageId: page.id,
        clientX: e.clientX,
        clientY: e.clientY,
        targetType: 'lasso',
      });
    }
  };

  const hoveredTextboxLayout = useMemo(() => {
    if (!hoveredTextboxId) return null;
    if (hoveredTextboxId === activeTextboxId || selectedTextboxIds.includes(hoveredTextboxId)) {
      return null;
    }
    const tb = (page.textboxes ?? []).find((t) => t.id === hoveredTextboxId);
    if (!tb) return null;
    const layout = measureTextboxLayout(tb);
    return { tb, layout };
  }, [hoveredTextboxId, activeTextboxId, selectedTextboxIds, page.textboxes]);

  const hoveredStrokeBounds = useMemo(() => {
    if (!hoveredStrokeId || activeTool !== 'pan' || spacePressed) return null;
    if (lassoSelection?.pageId === page.id && lassoSelection.strokeIds.includes(hoveredStrokeId)) {
      return null;
    }
    const st = page.strokes.find((s) => s.id === hoveredStrokeId);
    if (!st) return null;
    if (st.groupId) {
      const expanded = expandSelectionWithGroups(page, {
        strokeIds: [st.id],
        textboxIds: [],
        imageIds: [],
      });
      const summary = getSelectionSummary(page, expanded);
      return summary.combinedBounds;
    }
    return st.bounds;
  }, [hoveredStrokeId, activeTool, spacePressed, lassoSelection, page]);

  const cursorClass =
    spacePressed
      ? 'cursor-grab active:cursor-grabbing'
      : activeTool === 'pan'
        ? hoveredStrokeBounds || hoveredTextboxLayout
          ? 'cursor-move'
          : 'cursor-default'
        : activeTool === 'text'
          ? 'cursor-text'
          : activeTool === 'eraser'
            ? 'cursor-cell'
            : 'cursor-crosshair';

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOverFile) setIsDragOverFile(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragOverFile(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    setIsDragOverFile(false);
    const files = Array.from(e.dataTransfer?.files ?? []).filter(
      isSupportedImageFile,
    );
    if (files.length === 0) return;

    e.preventDefault();
    e.stopPropagation();
    onFocusPage(page.id);

    const dropPt = toPagePoint(e.clientX, e.clientY);
    onRecordCursorPoint(page.id, dropPt.x, dropPt.y);

    const baseMaxZ = (page.images ?? []).reduce(
      (m, im) => Math.max(m, im.zIndex),
      0,
    );
    const placed: PageImage[] = [];

    for (let i = 0; i < files.length; i++) {
      try {
        const processed = await processUploadedImage(files[i]);
        placed.push(
          buildPlacedPageImage({
            dataUrl: processed.dataUrl,
            naturalWidth: processed.naturalWidth,
            naturalHeight: processed.naturalHeight,
            paper: page.paper,
            centerX: dropPt.x + i * 24,
            centerY: dropPt.y + i * 24,
            zIndex: baseMaxZ + i + 1,
          }),
        );
      } catch {
        // Ignore corrupt/unreadable image drops
      }
    }

    if (placed.length > 0) {
      addPageImages(page.id, placed);
    }
  };

  return (
    <div
      ref={pageSurfaceRef}
      data-page-id={page.id}
      data-testid={`page-surface-${pageNumber}`}
      data-dark-paper={smartDarkActive ? 'true' : 'false'}
      data-pdf-page={page.pdfBackground ? 'true' : 'false'}
      data-pdf-rendered={page.pdfBackground && pdfBitmapRef.current ? 'true' : 'false'}
      data-pdf-render-scale={
        renderedPdfScaleRef.current ? renderedPdfScaleRef.current.toFixed(2) : '0'
      }
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => {
        void handleDrop(e);
      }}
      className={`relative mx-auto shrink-0 rounded-sm shadow-[0_6px_28px_rgba(7,45,89,0.12)] transition-shadow ${
        isDragOverFile
          ? 'ring-2 ring-[#FD6E88] ring-offset-2'
          : 'ring-1 ring-[#072D59]/10'
      }`}
      style={{
        width: `${cssWidth}px`,
        height: `${cssHeight}px`,
        backgroundColor: effectivePaper.paperColor,
      }}
    >
      {/* Layer 1: Static bottom canvas */}
      <canvas
        ref={staticCanvasRef}
        data-testid={`static-canvas-${pageNumber}`}
        className="pointer-events-none absolute inset-0 block rounded-sm"
        style={{
          width: `${cssWidth}px`,
          height: `${cssHeight}px`,
        }}
      />

      {/* Layer 2: Active top canvas */}
      <canvas
        ref={activeCanvasRef}
        data-testid={`active-canvas-${pageNumber}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={finishPointerInteraction}
        onPointerLeave={() => {
          setHoveredTextboxId(null);
          setHoveredStrokeId(null);
        }}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleCanvasContextMenu}
        className={`canvas-drawing-surface absolute inset-0 block rounded-sm ${cursorClass}`}
        style={{
          width: `${cssWidth}px`,
          height: `${cssHeight}px`,
          mixBlendMode:
            activeTool === 'highlighter'
              ? smartDarkActive
                ? 'screen'
                : 'multiply'
              : 'normal',
        }}
      />

      {/* Subtle 1px accent outline when hovering over an unselected Textbox or Scribble */}
      {hoveredTextboxLayout && (
        <div
          data-testid="textbox-hover-outline"
          style={{
            left: `${hoveredTextboxLayout.tb.x * zoom}px`,
            top: `${hoveredTextboxLayout.tb.y * zoom}px`,
            width: `${hoveredTextboxLayout.layout.width * zoom}px`,
            height: `${hoveredTextboxLayout.layout.height * zoom}px`,
            outline: '1px solid rgba(7, 45, 89, 0.5)',
          }}
          className="pointer-events-none absolute z-10"
        />
      )}

      {hoveredStrokeBounds && (
        <div
          data-testid="stroke-hover-outline"
          style={{
            left: `${(hoveredStrokeBounds.minX - 4) * zoom}px`,
            top: `${(hoveredStrokeBounds.minY - 4) * zoom}px`,
            width: `${Math.max(12, (hoveredStrokeBounds.maxX - hoveredStrokeBounds.minX + 8) * zoom)}px`,
            height: `${Math.max(12, (hoveredStrokeBounds.maxY - hoveredStrokeBounds.minY + 8) * zoom)}px`,
            outline: '1px solid rgba(7, 45, 89, 0.45)',
          }}
          className="pointer-events-none absolute z-10 rounded-xs"
        />
      )}

      {/* Canva Marquee Selection Box */}
      {marqueeRect && (
        <div
          data-testid="marquee-selection-rect"
          style={{
            left: `${marqueeRect.minX * zoom}px`,
            top: `${marqueeRect.minY * zoom}px`,
            width: `${(marqueeRect.maxX - marqueeRect.minX) * zoom}px`,
            height: `${(marqueeRect.maxY - marqueeRect.minY) * zoom}px`,
            border: '1.5px solid #072D59',
            backgroundColor: 'rgba(219, 242, 252, 0.35)',
          }}
          className="pointer-events-none absolute z-30 rounded-[2px]"
        />
      )}

      {/* Magnetic Magenta Alignment Guides & Shift Axis Lock Guides */}
      {activeGuides.map((guide, idx) =>
        guide.orientation === 'vertical' ? (
          <div
            key={`v-${idx}-${guide.pos}`}
            data-testid={guide.kind === 'snap' ? 'alignment-guide' : 'axis-lock-guide'}
            style={{
              left: `${guide.pos * zoom}px`,
              top: `${guide.start * zoom}px`,
              height: `${Math.max(1, (guide.end - guide.start) * zoom)}px`,
              width: '1px',
              backgroundColor: guide.kind === 'snap' ? '#EC4899' : 'rgba(7, 45, 89, 0.45)',
            }}
            className="pointer-events-none absolute z-30"
          />
        ) : (
          <div
            key={`h-${idx}-${guide.pos}`}
            data-testid={guide.kind === 'snap' ? 'alignment-guide' : 'axis-lock-guide'}
            style={{
              top: `${guide.pos * zoom}px`,
              left: `${guide.start * zoom}px`,
              width: `${Math.max(1, (guide.end - guide.start) * zoom)}px`,
              height: '1px',
              backgroundColor: guide.kind === 'snap' ? '#EC4899' : 'rgba(7, 45, 89, 0.45)',
            }}
            className="pointer-events-none absolute z-30"
          />
        ),
      )}

      {/* Interactive Image Layer (selection, crop, one-motion drag) */}
      <ImageOverlay
        page={page}
        zoom={zoom}
        spacePressed={spacePressed}
        hiddenImageIds={hiddenDragImageIds}
        onActiveOverlayImageChange={setActiveOverlayImageId}
        onGuidesChange={setActiveGuides}
        onStartMultiDrag={startMultiDrag}
        onContextMenuRequest={onContextMenuRequest}
      />

      {/* Airtight Textbox Editor & Selection Overlay */}
      <TextboxOverlay
        page={page}
        zoom={zoom}
        spacePressed={spacePressed}
        hiddenTextboxIds={hiddenDragTextboxIds}
        onDraggingTextboxChange={setDraggingTextboxId}
        onGuidesChange={setActiveGuides}
        onStartMultiDrag={startMultiDrag}
        onContextMenuRequest={onContextMenuRequest}
      />

      {/* Unified Stroke & Multi-Element Selection Overlay */}
      <UnifiedSelectionOverlay
        page={page}
        zoom={zoom}
        spacePressed={spacePressed}
        liveDragOffset={
          liveMultiDrag ? { dx: liveMultiDrag.dx, dy: liveMultiDrag.dy } : null
        }
        liveScaleBounds={liveStrokeScale ? liveStrokeScale.targetBounds : null}
        onStrokeScalePreview={handleStrokeScalePreview}
        onStartMultiDrag={startMultiDrag}
        onContextMenuRequest={onContextMenuRequest}
      />

      {/* Hold-to-Snap feedback pill */}
      {snapToast && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full bg-[#072D59]/90 px-3 py-1 text-xs font-medium text-white shadow-md backdrop-blur">
          {snapToast}
        </div>
      )}

      {/* Subtle page badge */}
      <div className="folio-mono pointer-events-none absolute bottom-2 right-3 rounded-full bg-[#072D59]/65 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-xs">
        {pageNumber} / {totalPages}
      </div>
    </div>
  );
};
