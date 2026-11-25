import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { cleanHandwritingStrokesWithAi } from '../../ai/handwritingAi';
import {
  type AlignmentGuide,
  computeDragAlignment,
  getTextboxBoundsList,
} from '../../canvas/alignment';
import { eraseStrokesPrecisionSegment } from '../../canvas/eraser';
import {
  boundsOverlap,
  computeBoundsFromPoints,
  doesEraserHitStroke,
  doesStrokeIntersectRect,
  getStrokesInLasso,
  hitTestStroke,
  sampleShapePoints,
  scaleStroke,
  snapLineEndToCardinalAxis,
} from '../../canvas/geometry';
import {
  expandBoundingBox,
  isHandwritingAccessoryStroke,
  isHandwritingCandidateStroke,
  isHandwritingClusterReady,
  isNewHandwritingWordStart,
} from '../../canvas/handwritingCorrection';
import { drawCommittedImage, getImageBounds } from '../../canvas/imageRenderer';
import {
  isDarkColor,
  isSmartDarkApplicable,
  renderPaperBackground,
  renderWhiteboardBackground,
  resolveEffectivePaperConfig,
} from '../../canvas/paperRenderer';
import {
  expandSelectionWithGroups,
  getSelectionSummary,
  getTextboxBounds,
  isBoundsOffPage,
  type PageElementSelection,
} from '../../canvas/selection';
import { screenToWorld, type WhiteboardCamera } from '../../canvas/whiteboard';
import { resolveActiveAiConfig } from '../../utils/settings';
import { getCssFallbackZoomFactor } from '../../utils/uiZoom';
import { recognizeShape } from '../../canvas/shapeRecognition';
import {
  drawActiveFreehandStroke,
  drawCommittedStroke,
  drawShapeGeometry,
} from '../../canvas/strokeRenderer';
import {
  drawCommittedTextbox,
  hitTestTextbox,
  isPointOnTextboxText,
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
  isPanning?: boolean;
  whiteboardCamera?: WhiteboardCamera | null;
  viewportSize?: { width: number; height: number };
  masterKeyOverride?: CryptoKey | null;
  onFocusPage: (pageId: string) => void;
  onRecordCursorPoint: (pageId: string, x: number, y: number) => void;
  onContextMenuRequest: (menu: CanvasContextMenuState) => void;
  onRightClickLassoChange?: (active: boolean) => void;
}

const HOLD_SNAP_DELAY_MS = 480;
const HOLD_MOVE_TOLERANCE = 5.5;
const LIVE_HANDWRITING_PAUSE_MS = 900;
const MAX_BACKING_DIMENSION = 4096;

export const PageCanvas: React.FC<PageCanvasProps> = ({
  page,
  pageNumber,
  totalPages,
  zoom,
  spacePressed,
  isPanning = false,
  whiteboardCamera = null,
  viewportSize,
  masterKeyOverride,
  onFocusPage,
  onRecordCursorPoint,
  onContextMenuRequest,
  onRightClickLassoChange,
}) => {
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);

  const unlockedMasterKey = useAppStore((s) => s.unlockedMasterKey);
  const effectiveMasterKey =
    masterKeyOverride !== undefined ? masterKeyOverride : unlockedMasterKey;
  const activeTool = useAppStore((s) => s.activeTool);
  const inkColor = useAppStore((s) => s.inkColor);
  const penSize = useAppStore((s) => s.penSize);
  const highlighterSize = useAppStore((s) => s.highlighterSize);
  const eraserMode = useAppStore((s) => s.eraserMode);
  const eraserSize = useAppStore((s) => s.eraserSize);
  const holdToSnapEnabled = useAppStore((s) => s.holdToSnapEnabled);
  const handwritingCorrectionEnabled = useAppStore((s) => s.handwritingCorrectionEnabled);
  const darkPaperView = useAppStore((s) => s.darkPaperView);
  const lassoSelection = useAppStore((s) => s.lassoSelection);
  const activeTextboxId = useAppStore((s) => s.activeTextboxId);
  const selectedTextboxIds = useAppStore((s) => s.selectedTextboxIds);
  const selectedImageIds = useAppStore((s) => s.selectedImageIds);

  const commitNewStroke = useAppStore((s) => s.commitNewStroke);
  const discardRecentPenStrokes = useAppStore((s) => s.discardRecentPenStrokes);
  const commitEraseStrokes = useAppStore((s) => s.commitEraseStrokes);
  const commitPrecisionErase = useAppStore((s) => s.commitPrecisionErase);
  const commitAiHandwritingReplacement = useAppStore((s) => s.commitAiHandwritingReplacement);
  const deleteElementsOffPage = useAppStore((s) => s.deleteElementsOffPage);
  const revertAltCloneSnapshot = useAppStore((s) => s.revertAltCloneSnapshot);
  const setUnifiedSelection = useAppStore((s) => s.setUnifiedSelection);
  const toggleElementInSelection = useAppStore((s) => s.toggleElementInSelection);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const commitMultiElementMove = useAppStore((s) => s.commitMultiElementMove);
  const altCloneMultiSelection = useAppStore((s) => s.altCloneMultiSelection);
  const commitAltMultiMove = useAppStore((s) => s.commitAltMultiMove);
  const spawnTextbox = useAppStore((s) => s.spawnTextbox);
  const beginEditTextbox = useAppStore((s) => s.beginEditTextbox);
  const selectTextbox = useAppStore((s) => s.selectTextbox);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const addPageImages = useAppStore((s) => s.addPageImages);

  const [dpr, setDpr] = useState<number>(() =>
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  );
  const [snapToast, setSnapToast] = useState<string | null>(null);
  const [liveErasedIds, setLiveErasedIds] = useState<string[]>([]);
  const [livePrecisionStrokes, setLivePrecisionStrokes] = useState<Stroke[] | null>(null);
  const [draggingTextboxId, setDraggingTextboxId] = useState<string | null>(null);
  const [activeOverlayImageId, setActiveOverlayImageId] = useState<string | null>(null);
  const [imageDecodeTick, setImageDecodeTick] = useState(0);
  const [hoveredTextboxId, setHoveredTextboxId] = useState<string | null>(null);
  const [hoveredTextboxOnText, setHoveredTextboxOnText] = useState(false);
  const [hoveredStrokeId, setHoveredStrokeId] = useState<string | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<BoundingBox | null>(null);
  const [liveMultiDrag, setLiveMultiDrag] = useState<{
    selection: PageElementSelection;
    dx: number;
    dy: number;
    isOffPage: boolean;
  } | null>(null);
  const [offPageCursor, setOffPageCursor] = useState<{
    clientX: number;
    clientY: number;
  } | null>(null);
  const [liveStrokeScale, setLiveStrokeScale] = useState<{
    strokeIds: string[];
    originBounds: BoundingBox;
    targetBounds: BoundingBox;
  } | null>(null);
  const [activeGuides, setActiveGuides] = useState<AlignmentGuide[]>([]);
  const [isDragOverFile, setIsDragOverFile] = useState(false);
  const [isRightClickLasso, setIsRightClickLasso] = useState(false);
  const rightClickLassoActiveRef = useRef(false);
  const rightClickLassoCleanupRef = useRef<(() => void) | null>(null);
  const contextMenuSuppressCleanupRef = useRef<(() => void) | null>(null);
  const onRightClickLassoChangeRef = useRef(onRightClickLassoChange);
  onRightClickLassoChangeRef.current = onRightClickLassoChange;

  const handleImageDecoded = useCallback(() => {
    setImageDecodeTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const updateDpr = () => setDpr(window.devicePixelRatio || 1);
    window.addEventListener('resize', updateDpr);
    return () => window.removeEventListener('resize', updateDpr);
  }, []);

  const isWhiteboard = Boolean(whiteboardCamera);
  const cameraRef = useRef<WhiteboardCamera | null>(whiteboardCamera);
  cameraRef.current = whiteboardCamera;
  const effectiveZoom = whiteboardCamera ? whiteboardCamera.zoom : zoom;
  const wbWidth = Math.max(1, Math.round(viewportSize?.width || 1200));
  const wbHeight = Math.max(1, Math.round(viewportSize?.height || 800));

  const rawBackingW = page.paper.width * dpr * zoom;
  const rawBackingH = page.paper.height * dpr * zoom;
  const isOversizedPage =
    !isWhiteboard &&
    (rawBackingW > MAX_BACKING_DIMENSION || rawBackingH > MAX_BACKING_DIMENSION);

  const cssWidth = isWhiteboard ? wbWidth : Math.max(1, Math.round(page.paper.width * zoom));
  const cssHeight = isWhiteboard ? wbHeight : Math.max(1, Math.round(page.paper.height * zoom));

  const [pageWindow, setPageWindow] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>(() => ({
    left: 0,
    top: 0,
    width: Math.min(Math.max(1, cssWidth), 1600),
    height: Math.min(Math.max(1, cssHeight), 1200),
  }));
  const pageWindowRef = useRef(pageWindow);
  pageWindowRef.current = pageWindow;

  const updateOversizedPageWindow = useCallback(
    (force = false) => {
      if (!isOversizedPage) return;
      const surfaceEl = pageSurfaceRef.current;
      const budgetCssDim = Math.floor(MAX_BACKING_DIMENSION / Math.max(1, dpr));
      const overscan = 240;

      let visLeft = 0;
      let visTop = 0;
      let visRight = Math.min(cssWidth, window.innerWidth || 1280);
      let visBottom = Math.min(cssHeight, window.innerHeight || 800);

      if (surfaceEl) {
        const sRect = surfaceEl.getBoundingClientRect();
        if (sRect.width > 0 && sRect.height > 0) {
          const scrollEl = surfaceEl.closest<HTMLElement>(
            '[data-testid="editor-canvas-viewport"], [data-testid^="split-pane-viewport-"]',
          );
          const vpRect = scrollEl
            ? scrollEl.getBoundingClientRect()
            : {
                left: 0,
                top: 0,
                right: window.innerWidth || 1280,
                bottom: window.innerHeight || 800,
              };
          visLeft = Math.max(0, vpRect.left - sRect.left);
          visTop = Math.max(0, vpRect.top - sRect.top);
          visRight = Math.min(cssWidth, Math.max(visLeft + 1, vpRect.right - sRect.left));
          visBottom = Math.min(cssHeight, Math.max(visTop + 1, vpRect.bottom - sRect.top));
        }
      }

      const prev = pageWindowRef.current;
      const marginL = visLeft - prev.left;
      const marginR = prev.left + prev.width - visRight;
      const marginT = visTop - prev.top;
      const marginB = prev.top + prev.height - visBottom;
      const needEdgeMarginX = prev.left > 0 ? 80 : 0;
      const needEdgeMarginRight = prev.left + prev.width < cssWidth ? 80 : 0;
      const needEdgeMarginY = prev.top > 0 ? 80 : 0;
      const needEdgeMarginBottom = prev.top + prev.height < cssHeight ? 80 : 0;

      const needsUpdate =
        force ||
        prev.left + prev.width > cssWidth ||
        prev.top + prev.height > cssHeight ||
        prev.width <= 1 ||
        prev.height <= 1 ||
        marginL < needEdgeMarginX ||
        marginR < needEdgeMarginRight ||
        marginT < needEdgeMarginY ||
        marginB < needEdgeMarginBottom;

      if (!needsUpdate) return;

      const visW = Math.max(1, visRight - visLeft);
      const visH = Math.max(1, visBottom - visTop);
      const winW = Math.max(
        1,
        Math.min(cssWidth, visW + overscan * 2, Math.max(visW, budgetCssDim)),
      );
      const winH = Math.max(
        1,
        Math.min(cssHeight, visH + overscan * 2, Math.max(visH, budgetCssDim)),
      );
      const winLeft = Math.max(
        0,
        Math.min(cssWidth - winW, Math.round(visLeft - Math.max(0, (winW - visW) / 2))),
      );
      const winTop = Math.max(
        0,
        Math.min(cssHeight - winH, Math.round(visTop - Math.max(0, (winH - visH) / 2))),
      );

      if (
        prev.left === winLeft &&
        prev.top === winTop &&
        prev.width === winW &&
        prev.height === winH
      ) {
        return;
      }

      const nextWin = { left: winLeft, top: winTop, width: winW, height: winH };
      pageWindowRef.current = nextWin;
      setPageWindow(nextWin);
    },
    [cssHeight, cssWidth, dpr, isOversizedPage],
  );

  useEffect(() => {
    if (!isOversizedPage) return;
    updateOversizedPageWindow(true);

    const surfaceEl = pageSurfaceRef.current;
    const scrollEl = surfaceEl?.closest<HTMLElement>(
      '[data-testid="editor-canvas-viewport"], [data-testid^="split-pane-viewport-"]',
    );

    let rafId: number | null = null;
    const onScrollOrResize = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateOversizedPageWindow(false);
      });
    };

    scrollEl?.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      scrollEl?.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [isOversizedPage, page.id, cssWidth, cssHeight, zoom, updateOversizedPageWindow]);

  const whiteboardDpr = useMemo(() => {
    if (!isWhiteboard) return dpr;
    return Math.min(
      dpr,
      MAX_BACKING_DIMENSION / wbWidth,
      MAX_BACKING_DIMENSION / wbHeight,
    );
  }, [dpr, isWhiteboard, wbWidth, wbHeight]);

  const windowDpr = useMemo(() => {
    if (!isOversizedPage) return dpr;
    return Math.min(
      dpr,
      MAX_BACKING_DIMENSION / Math.max(1, pageWindow.width),
      MAX_BACKING_DIMENSION / Math.max(1, pageWindow.height),
    );
  }, [dpr, isOversizedPage, pageWindow.height, pageWindow.width]);

  const renderScale = useMemo(() => {
    const rawScale = dpr * zoom;
    const maxAllowed = Math.min(
      MAX_BACKING_DIMENSION / Math.max(1, page.paper.width),
      MAX_BACKING_DIMENSION / Math.max(1, page.paper.height),
    );
    return Math.min(rawScale, maxAllowed);
  }, [dpr, zoom, page.paper.width, page.paper.height]);

  const backingWidth = isWhiteboard
    ? Math.max(1, Math.round(wbWidth * whiteboardDpr))
    : isOversizedPage
      ? Math.max(1, Math.round(pageWindow.width * windowDpr))
      : Math.max(1, Math.round(page.paper.width * renderScale));
  const backingHeight = isWhiteboard
    ? Math.max(1, Math.round(wbHeight * whiteboardDpr))
    : isOversizedPage
      ? Math.max(1, Math.round(pageWindow.height * windowDpr))
      : Math.max(1, Math.round(page.paper.height * renderScale));

  const visibleWorldBounds = useMemo<BoundingBox>(() => {
    if (whiteboardCamera) {
      const tl = screenToWorld(0, 0, whiteboardCamera);
      const br = screenToWorld(wbWidth, wbHeight, whiteboardCamera);
      return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
    }
    if (isOversizedPage) {
      const safeZoom = Math.max(0.005, zoom || 1);
      return {
        minX: pageWindow.left / safeZoom,
        minY: pageWindow.top / safeZoom,
        maxX: (pageWindow.left + pageWindow.width) / safeZoom,
        maxY: (pageWindow.top + pageWindow.height) / safeZoom,
      };
    }
    return {
      minX: 0,
      minY: 0,
      maxX: page.paper.width,
      maxY: page.paper.height,
    };
  }, [
    whiteboardCamera,
    wbWidth,
    wbHeight,
    isOversizedPage,
    zoom,
    pageWindow.left,
    pageWindow.top,
    pageWindow.width,
    pageWindow.height,
    page.paper.width,
    page.paper.height,
  ]);

  const applyCanvasTransform = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      if (whiteboardCamera) {
        ctx.setTransform(
          whiteboardDpr * whiteboardCamera.zoom,
          0,
          0,
          whiteboardDpr * whiteboardCamera.zoom,
          whiteboardDpr * whiteboardCamera.offsetX,
          whiteboardDpr * whiteboardCamera.offsetY,
        );
      } else if (isOversizedPage) {
        const effectiveWindowScale = windowDpr * zoom;
        ctx.setTransform(
          effectiveWindowScale,
          0,
          0,
          effectiveWindowScale,
          -pageWindow.left * windowDpr,
          -pageWindow.top * windowDpr,
        );
      } else {
        ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
      }
    },
    [
      isOversizedPage,
      pageWindow.left,
      pageWindow.top,
      renderScale,
      whiteboardCamera,
      whiteboardDpr,
      windowDpr,
      zoom,
    ],
  );

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
        const doc = await getPdfDocumentForAsset(bg.assetId, effectiveMasterKey);
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
    effectiveMasterKey,
  ]);

  const isPointerActiveRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const activePointsRef = useRef<StrokePoint[]>([]);
  const activeSimulatePressureRef = useRef<boolean>(true);
  const snappedShapeRef = useRef<ShapeGeometry | null>(null);
  const lastDrawPointRef = useRef<{ x: number; y: number } | null>(null);
  const shiftKeyDownRef = useRef(false);
  const holdTimerRef = useRef<number | null>(null);
  const holdAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const erasedSetRef = useRef<Set<string>>(new Set());
  const eraserStartStrokesRef = useRef<Stroke[] | null>(null);
  const workingStrokesRef = useRef<Stroke[] | null>(null);
  const precisionErasedChangedRef = useRef(false);
  const lastEraserPointRef = useRef<{ x: number; y: number } | null>(null);
  const eraserHoverPointRef = useRef<{ x: number; y: number } | null>(null);
  const lassoPointsRef = useRef<{ x: number; y: number }[]>([]);
  const rafPendingRef = useRef<number | null>(null);
  const snapToastTimerRef = useRef<number | null>(null);
  const handwritingTimerRef = useRef<number | null>(null);
  const handwritingSessionEpochRef = useRef(0);
  const activeWordStrokeIdsRef = useRef<Set<string>>(new Set());
  const activeWordBoundsRef = useRef<BoundingBox | null>(null);
  const inFlightStrokeIdsRef = useRef<Set<string>>(new Set());
  const lastHandwritingErrorToastAtRef = useRef<number>(0);
  const multiDragCleanupRef = useRef<(() => void) | null>(null);
  const marqueeCleanupRef = useRef<(() => void) | null>(null);
  const recentPenTextboxTapsRef = useRef<
    Array<{ strokeId: string; textboxId: string; clientX: number; clientY: number; time: number }>
  >([]);
  const ignoreDoubleClickUntilRef = useRef<number>(0);

  const showSnapBadge = useCallback((label: string) => {
    setSnapToast(label);
    if (snapToastTimerRef.current !== null) {
      window.clearTimeout(snapToastTimerRef.current);
    }
    snapToastTimerRef.current = window.setTimeout(() => {
      setSnapToast(null);
    }, 1500);
  }, []);

  const clearPendingHandwritingTimer = useCallback(() => {
    if (handwritingTimerRef.current !== null) {
      window.clearTimeout(handwritingTimerRef.current);
      handwritingTimerRef.current = null;
    }
  }, []);

  const resetHandwritingSession = useCallback(() => {
    clearPendingHandwritingTimer();
    handwritingSessionEpochRef.current += 1;
    activeWordStrokeIdsRef.current.clear();
    activeWordBoundsRef.current = null;
    inFlightStrokeIdsRef.current.clear();
  }, [clearPendingHandwritingTimer]);

  const flushActiveHandwritingWord = useCallback(() => {
    clearPendingHandwritingTimer();
    const pendingIds = Array.from(activeWordStrokeIdsRef.current);
    activeWordStrokeIdsRef.current = new Set();
    activeWordBoundsRef.current = null;
    if (pendingIds.length === 0) return;

    const curState = useAppStore.getState();
    const inPrimary = curState.pages.some((p) => p.id === page.id);
    const latestPage = inPrimary
      ? curState.pages.find((p) => p.id === page.id)
      : curState.splitPane?.pages.find((p) => p.id === page.id);
    const targetNotebook = inPrimary
      ? curState.activeNotebook
      : curState.splitPane?.notebook ?? null;
    const aiCfg = resolveActiveAiConfig(curState);
    const vaultBlocked = Boolean(
      targetNotebook?.isLocked && curState.blockAiOnVaultLocked,
    );
    if (!curState.handwritingCorrectionEnabled || !latestPage || !aiCfg.configured || vaultBlocked) {
      return;
    }

    const pendingSet = new Set(pendingIds);
    const cluster = latestPage.strokes.filter(
      (s) =>
        pendingSet.has(s.id) &&
        !s.locked &&
        !s.isTidied &&
        !inFlightStrokeIdsRef.current.has(s.id),
    );
    if (!isHandwritingClusterReady(cluster)) return;

    const clusterIds = cluster.map((s) => s.id);
    for (const id of clusterIds) {
      inFlightStrokeIdsRef.current.add(id);
    }
    const epoch = handwritingSessionEpochRef.current;

    void cleanHandwritingStrokesWithAi({
      strokes: cluster,
      config: aiCfg,
      guard: {
        isVaultLocked: Boolean(targetNotebook?.isLocked),
        blockAiOnVaultLocked: curState.blockAiOnVaultLocked,
      },
      mode: 'live',
    })
      .then((result) => {
        if (!result || epoch !== handwritingSessionEpochRef.current) return;
        commitAiHandwritingReplacement(page.id, clusterIds, result.strokes, {
          selectResult: false,
          requireAllPresent: true,
          toastMessage: null,
          alignWithAdjacentLine: true,
          sourceBounds: result.bounds,
        });
      })
      .catch((err) => {
        // Leave raw strokes untouched if AI provider call fails or is aborted
        const isAbort =
          err instanceof Error &&
          (err.name === 'AbortError' || /aborted/i.test(err.message));
        const nowTs = Date.now();
        if (!isAbort && nowTs - lastHandwritingErrorToastAtRef.current > 15000) {
          lastHandwritingErrorToastAtRef.current = nowTs;
          showSnapBadge('AI handwriting paused, check AI settings');
        }
      })
      .finally(() => {
        for (const id of clusterIds) {
          inFlightStrokeIdsRef.current.delete(id);
        }
      });
  }, [clearPendingHandwritingTimer, commitAiHandwritingReplacement, page.id, showSnapBadge]);

  useEffect(() => {
    if (!handwritingCorrectionEnabled) {
      resetHandwritingSession();
    }
  }, [handwritingCorrectionEnabled, resetHandwritingSession]);

  useEffect(() => {
    if (activeTool !== 'pan' || spacePressed) {
      setHoveredTextboxId(null);
      setHoveredStrokeId(null);
    }
  }, [activeTool, spacePressed, page.id]);

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

  // Redraw bottom static canvas ONLY when committed strokes/textboxes, paper, camera/scale, dark view, or drag preview change
  useEffect(() => {
    const canvas = staticCanvasRef.current;
    if (!canvas) return;
    syncCanvasSizes(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    applyCanvasTransform(ctx);

    if (isWhiteboard && whiteboardCamera) {
      renderWhiteboardBackground(
        ctx,
        effectivePaper,
        visibleWorldBounds,
        whiteboardCamera.zoom,
      );
    } else if (page.pdfBackground) {
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
      renderPaperBackground(
        ctx,
        effectivePaper,
        isOversizedPage ? visibleWorldBounds : undefined,
      );
    }

    const cullRect: BoundingBox | null =
      isWhiteboard || isOversizedPage
        ? {
            minX: visibleWorldBounds.minX - 120,
            minY: visibleWorldBounds.minY - 120,
            maxX: visibleWorldBounds.maxX + 120,
            maxY: visibleWorldBounds.maxY + 120,
          }
        : null;

    const sortedImages = [...(page.images ?? [])].sort(
      (a, b) => a.zIndex - b.zIndex,
    );
    for (const img of sortedImages) {
      if (img.id === activeOverlayImageId || hiddenDragImageIds.has(img.id)) continue;
      if (cullRect && !boundsOverlap(getImageBounds(img), cullRect)) continue;
      drawCommittedImage(ctx, img, handleImageDecoded);
    }

    const hiddenStrokeIds = new Set<string>(liveErasedIds);
    if (liveMultiDrag) {
      for (const id of liveMultiDrag.selection.strokeIds) hiddenStrokeIds.add(id);
    }
    if (liveStrokeScale) {
      for (const id of liveStrokeScale.strokeIds) hiddenStrokeIds.add(id);
    }

    const strokesToRender = livePrecisionStrokes ?? page.strokes;
    for (const stroke of strokesToRender) {
      if (hiddenStrokeIds.has(stroke.id)) continue;
      if (cullRect && !boundsOverlap(stroke.bounds, cullRect)) continue;
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
      if (cullRect && !boundsOverlap(getTextboxBounds(tb), cullRect)) continue;
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
    isWhiteboard,
    whiteboardCamera,
    visibleWorldBounds,
    applyCanvasTransform,
    liveErasedIds,
    livePrecisionStrokes,
    liveMultiDrag,
    liveStrokeScale,
    isOversizedPage,
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
      multiDrag: {
        selection: PageElementSelection;
        dx: number;
        dy: number;
        isOffPage?: boolean;
      } | null,
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

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      applyCanvasTransform(ctx);

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
      const fadeAlpha = multiDrag.isOffPage ? 0.45 : 1;

      ctx.save();
      ctx.translate(multiDrag.dx, multiDrag.dy);

      const sortedImgs = [...(currentPage.images ?? [])]
        .filter((im) => imgSet.has(im.id))
        .sort((a, b) => a.zIndex - b.zIndex);
      for (const img of sortedImgs) {
        drawCommittedImage(
          ctx,
          fadeAlpha < 1 ? { ...img, opacity: (img.opacity ?? 1) * fadeAlpha } : img,
          handleImageDecoded,
        );
      }

      for (const stroke of currentPage.strokes) {
        if (strokeSet.has(stroke.id)) {
          drawCommittedStroke(
            ctx,
            fadeAlpha < 1 ? { ...stroke, opacity: stroke.opacity * fadeAlpha } : stroke,
            false,
            smartDarkActive,
          );
        }
      }

      if (fadeAlpha < 1) {
        ctx.globalAlpha = fadeAlpha;
      }
      for (const tb of currentPage.textboxes ?? []) {
        if (tbSet.has(tb.id)) {
          drawCommittedTextbox(ctx, tb, smartDarkActive);
        }
      }

      ctx.restore();
    },
    [
      applyCanvasTransform,
      handleImageDecoded,
      page,
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

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    applyCanvasTransform(ctx);

    const invZoom = 1 / Math.max(0.01, effectiveZoom);

    // Draw Eraser ring cursor during both hover and active drag
    if (activeTool === 'eraser' && !spacePressed && !isPanning) {
      const pt = isPointerActiveRef.current
        ? lastEraserPointRef.current ?? eraserHoverPointRef.current
        : eraserHoverPointRef.current;
      if (pt) {
        ctx.save();
        if (eraserMode === 'precision') {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, eraserSize, 0, Math.PI * 2);
          ctx.fillStyle = isPointerActiveRef.current
            ? 'rgba(253, 110, 136, 0.14)'
            : 'rgba(219, 242, 252, 0.18)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.lineWidth = 3 * invZoom;
          ctx.stroke();
          ctx.strokeStyle = isPointerActiveRef.current
            ? 'rgba(253, 110, 136, 0.95)'
            : 'rgba(7, 45, 89, 0.88)';
          ctx.lineWidth = 1.5 * invZoom;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.5 * invZoom, 0, Math.PI * 2);
          ctx.fillStyle = isPointerActiveRef.current
            ? 'rgba(253, 110, 136, 0.95)'
            : 'rgba(7, 45, 89, 0.85)';
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, eraserSize, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(253, 110, 136, 0.14)';
          ctx.fill();
          ctx.setLineDash([4 * invZoom, 3 * invZoom]);
          ctx.strokeStyle = 'rgba(253, 110, 136, 0.92)';
          ctx.lineWidth = 1.6 * invZoom;
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    if (!isPointerActiveRef.current && !rightClickLassoActiveRef.current) return;

    if (
      (rightClickLassoActiveRef.current || activeTool === 'lasso') &&
      lassoPointsRef.current.length > 1
    ) {
      const pts = lassoPointsRef.current;
      ctx.save();
      ctx.strokeStyle = '#072D59';
      ctx.fillStyle = 'rgba(219, 242, 252, 0.28)';
      ctx.lineWidth = 1.75 * invZoom;
      ctx.setLineDash([6 * invZoom, 4 * invZoom]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
      ctx.fill();
      ctx.restore();
      if (rightClickLassoActiveRef.current) return;
    }

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      const isHighlighter = activeTool === 'highlighter';
      const color = inkColor;
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
    }
  }, [
    activeTool,
    applyCanvasTransform,
    effectiveZoom,
    eraserMode,
    eraserSize,
    highlighterSize,
    inkColor,
    isPanning,
    penSize,
    smartDarkActive,
    spacePressed,
    syncCanvasSizes,
  ]);

  useEffect(() => {
    if (activeTool !== 'eraser' || spacePressed || isPanning) {
      eraserHoverPointRef.current = null;
      clearActiveCanvas();
      return;
    }
    if (eraserHoverPointRef.current) {
      renderActiveFrame();
    }
  }, [activeTool, spacePressed, isPanning, eraserSize, eraserMode, effectiveZoom, clearActiveCanvas, renderActiveFrame]);

  const scheduleActiveRender = useCallback(() => {
    if (rafPendingRef.current !== null) return;
    rafPendingRef.current = window.requestAnimationFrame(renderActiveFrame);
  }, [renderActiveFrame]);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Shift') return;
      shiftKeyDownRef.current = true;
      if (
        !isPointerActiveRef.current ||
        (activeTool !== 'pen' && activeTool !== 'highlighter')
      ) {
        return;
      }
      if (snappedShapeRef.current && snappedShapeRef.current.kind !== 'line') {
        return;
      }
      const origin =
        snappedShapeRef.current?.kind === 'line'
          ? { x: snappedShapeRef.current.x1, y: snappedShapeRef.current.y1 }
          : activePointsRef.current[0];
      const current =
        lastDrawPointRef.current ??
        activePointsRef.current[activePointsRef.current.length - 1];
      if (!origin || !current) return;

      clearHoldTimer();
      const { x2, y2 } = snapLineEndToCardinalAxis(origin.x, origin.y, current.x, current.y);
      snappedShapeRef.current = {
        kind: 'line',
        x1: origin.x,
        y1: origin.y,
        x2,
        y2,
      };
      scheduleActiveRender();
    };

    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === 'Shift') {
        shiftKeyDownRef.current = false;
      }
    };

    const onBlur = () => {
      shiftKeyDownRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [activeTool, clearHoldTimer, scheduleActiveRender]);

  const toPagePoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const canvas = activeCanvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const cam = cameraRef.current;
      if (cam) {
        return screenToWorld(clientX - rect.left, clientY - rect.top, cam);
      }
      if (isOversizedPage) {
        const sRect = pageSurfaceRef.current?.getBoundingClientRect();
        if (sRect && sRect.width > 0 && sRect.height > 0) {
          return {
            x: ((clientX - sRect.left) / sRect.width) * page.paper.width,
            y: ((clientY - sRect.top) / sRect.height) * page.paper.height,
          };
        }
        const safeZoom = Math.max(0.005, zoom || 1);
        const pw = pageWindowRef.current;
        return {
          x: (clientX - rect.left + pw.left) / safeZoom,
          y: (clientY - rect.top + pw.top) / safeZoom,
        };
      }
      const x = ((clientX - rect.left) / Math.max(1, rect.width)) * page.paper.width;
      const y = ((clientY - rect.top) / Math.max(1, rect.height)) * page.paper.height;
      return { x, y };
    },
    [isOversizedPage, page.paper.height, page.paper.width, zoom],
  );

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
    if (eraserMode === 'precision') {
      const base = workingStrokesRef.current ?? page.strokes;
      const result = eraseStrokesPrecisionSegment(base, x1, y1, x2, y2, eraserSize);
      if (result.changed) {
        workingStrokesRef.current = result.strokes;
        precisionErasedChangedRef.current = true;
        setLivePrecisionStrokes(result.strokes);
      }
      return;
    }

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
      let lastOffPage = false;

      if (prevSnapshot) {
        const preview = { selection: workingSel, dx: 0, dy: 0, isOffPage: false };
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

        const rawDx = (ev.clientX - startClientX) / effectiveZoom;
        const rawDy = (ev.clientY - startClientY) / effectiveZoom;

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
          isWhiteboard,
        });

        const offPage = isWhiteboard
          ? false
          : isBoundsOffPage(
              {
                minX: originBounds.minX + dx,
                minY: originBounds.minY + dy,
                maxX: originBounds.maxX + dx,
                maxY: originBounds.maxY + dy,
              },
              freshPage.paper,
            );

        lastDx = dx;
        lastDy = dy;
        lastOffPage = offPage;
        setActiveGuides(offPage ? [] : guides);
        setOffPageCursor(offPage ? { clientX: ev.clientX, clientY: ev.clientY } : null);
        const nextPreview = { selection: workingSel, dx, dy, isOffPage: offPage };
        setLiveMultiDrag(nextPreview);
        renderTransformFrame(nextPreview, null);
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onWindowMove);
        window.removeEventListener('pointerup', onWindowUp);
        window.removeEventListener('pointercancel', onWindowUp);
        multiDragCleanupRef.current = null;
        setOffPageCursor(null);
      };

      const onWindowUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const dropOffPage = lastOffPage;
        cleanup();
        setLiveMultiDrag(null);
        setActiveGuides([]);
        clearActiveCanvas();

        if (dropOffPage) {
          if (prevSnapshot) {
            revertAltCloneSnapshot(page.id, prevSnapshot);
          } else {
            deleteElementsOffPage(page.id, workingSel);
          }
          return;
        }

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
      deleteElementsOffPage,
      effectiveZoom,
      isWhiteboard,
      page,
      renderTransformFrame,
      revertAltCloneSnapshot,
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
      const clampX = isWhiteboard
        ? (val: number) => val
        : (val: number) => Math.max(0, Math.min(page.paper.width, val));
      const clampY = isWhiteboard
        ? (val: number) => val
        : (val: number) => Math.max(0, Math.min(page.paper.height, val));
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
    [isWhiteboard, page, setUnifiedSelection, toPagePoint],
  );

  const strokeHitTolerance = isWhiteboard
    ? Math.max(8, 10 / Math.max(0.02, effectiveZoom))
    : effectiveZoom < 0.5
      ? Math.max(8, 8 / Math.max(0.02, effectiveZoom))
      : 8;

  const startRightClickLasso = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      rightClickLassoCleanupRef.current?.();
      contextMenuSuppressCleanupRef.current?.();

      onFocusPage(page.id);
      e.preventDefault();
      e.stopPropagation();
      clearSelection();

      const pointerId = e.pointerId;
      const startPt = toPagePoint(e.clientX, e.clientY);
      lassoPointsRef.current = [startPt];
      onRecordCursorPoint(page.id, startPt.x, startPt.y);

      rightClickLassoActiveRef.current = true;
      setIsRightClickLasso(true);
      onRightClickLassoChangeRef.current?.(true);
      renderActiveFrame();

      let sessionEnded = false;
      let contextMenuConsumed = false;
      let fallbackTimer: number | null = null;

      const removeSuppressor = () => {
        if (fallbackTimer !== null) {
          window.clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        window.removeEventListener('contextmenu', suppressContextMenu, { capture: true });
        window.removeEventListener('pointerdown', onNextPointerStart, { capture: true });
        window.removeEventListener('mousedown', onNextPointerStart, { capture: true });
        if (contextMenuSuppressCleanupRef.current === removeSuppressor) {
          contextMenuSuppressCleanupRef.current = null;
        }
      };

      const onNextPointerStart = () => {
        removeSuppressor();
      };

      const suppressContextMenu = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        contextMenuConsumed = true;
        if (sessionEnded) {
          removeSuppressor();
        }
      };

      window.addEventListener('contextmenu', suppressContextMenu, { capture: true });
      contextMenuSuppressCleanupRef.current = removeSuppressor;

      const onWindowMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId || !rightClickLassoActiveRef.current) return;
        const coalesced =
          typeof ev.getCoalescedEvents === 'function'
            ? ev.getCoalescedEvents()
            : [ev];
        const samples = coalesced.length > 0 ? coalesced : [ev];
        const pts = lassoPointsRef.current;
        let lastPt: { x: number; y: number } | null = null;
        for (const sample of samples) {
          const pt = toPagePoint(sample.clientX, sample.clientY);
          lastPt = pt;
          const prev = pts[pts.length - 1];
          if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) >= 3) {
            pts.push(pt);
          }
        }
        if (lastPt) {
          onRecordCursorPoint(page.id, lastPt.x, lastPt.y);
        }
        scheduleActiveRender();
      };

      let finished = false;
      const finishSession = (commit: boolean, unmountOnly = false) => {
        if (finished) return;
        finished = true;

        window.removeEventListener('pointermove', onWindowMove);
        window.removeEventListener('pointerup', onWindowUp);
        window.removeEventListener('pointercancel', onWindowCancel);
        window.removeEventListener('blur', onWindowBlur);
        if (rightClickLassoCleanupRef.current === cleanupWithoutCommit) {
          rightClickLassoCleanupRef.current = null;
        }

        if (rafPendingRef.current !== null) {
          window.cancelAnimationFrame(rafPendingRef.current);
          rafPendingRef.current = null;
        }

        rightClickLassoActiveRef.current = false;
        setIsRightClickLasso(false);
        onRightClickLassoChangeRef.current?.(false);

        const polygon = lassoPointsRef.current;
        lassoPointsRef.current = [];
        clearActiveCanvas();

        sessionEnded = true;
        if (unmountOnly || contextMenuConsumed) {
          removeSuppressor();
        } else {
          window.addEventListener('pointerdown', onNextPointerStart, { capture: true });
          window.addEventListener('mousedown', onNextPointerStart, { capture: true });
          fallbackTimer = window.setTimeout(removeSuppressor, 250);
        }

        if (commit && polygon.length >= 3) {
          const st = useAppStore.getState();
          const freshPage =
            st.pages.find((p) => p.id === page.id) ??
            st.splitPane?.pages.find((p) => p.id === page.id) ??
            page;
          const selectedIds = getStrokesInLasso(polygon, freshPage.strokes);
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
      };

      const onWindowUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        finishSession(true);
      };

      const onWindowCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        finishSession(false);
      };

      const onWindowBlur = () => {
        finishSession(false);
      };

      const cleanupWithoutCommit = () => {
        finishSession(false, true);
      };

      rightClickLassoCleanupRef.current = cleanupWithoutCommit;
      window.addEventListener('pointermove', onWindowMove);
      window.addEventListener('pointerup', onWindowUp);
      window.addEventListener('pointercancel', onWindowCancel);
      window.addEventListener('blur', onWindowBlur);
    },
    [
      clearActiveCanvas,
      clearSelection,
      onFocusPage,
      onRecordCursorPoint,
      page,
      renderActiveFrame,
      scheduleActiveRender,
      setUnifiedSelection,
      toPagePoint,
    ],
  );

  const handleSurfacePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 2) return;
    if (
      (activeTool !== 'pen' && activeTool !== 'pan') ||
      spacePressed ||
      isPanning ||
      isPointerActiveRef.current ||
      rightClickLassoActiveRef.current
    ) {
      return;
    }

    const pt = toPagePoint(e.clientX, e.clientY);

    const selectedTbHit = hitTestTextbox(
      pt.x,
      pt.y,
      (page.textboxes ?? []).filter(
        (tb) => selectedTextboxIds.includes(tb.id) || activeTextboxId === tb.id,
      ),
    );
    if (selectedTbHit) return;

    const selectedImgHit = (page.images ?? []).some(
      (im) =>
        selectedImageIds.includes(im.id) &&
        pt.x >= im.x - 4 &&
        pt.x <= im.x + im.width + 4 &&
        pt.y >= im.y - 4 &&
        pt.y <= im.y + im.height + 4,
    );
    if (selectedImgHit) return;

    const selectedStrokeIds =
      lassoSelection?.pageId === page.id ? lassoSelection.strokeIds : [];
    if (selectedStrokeIds.length > 0) {
      const selectedIdSet = new Set(selectedStrokeIds);
      const selectedStrokeHit = hitTestStroke(
        pt.x,
        pt.y,
        page.strokes.filter((s) => selectedIdSet.has(s.id)),
        strokeHitTolerance,
      );
      if (selectedStrokeHit) return;
    }

    startRightClickLasso(e);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || rightClickLassoActiveRef.current) return;
    onFocusPage(page.id);

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

      const hitStroke = hitTestStroke(x, y, page.strokes, strokeHitTolerance);
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

    if (spacePressed || e.button !== 0) {
      return;
    }

    clearSelection();

    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    isPointerActiveRef.current = true;
    activePointerIdRef.current = e.pointerId;
    snappedShapeRef.current = null;
    clearHoldTimer();

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      if (
        activeTool === 'pen' &&
        handwritingCorrectionEnabled &&
        activeWordStrokeIdsRef.current.size > 0
      ) {
        if (
          activeWordBoundsRef.current &&
          isNewHandwritingWordStart(activeWordBoundsRef.current, { x, y })
        ) {
          flushActiveHandwritingWord();
        } else {
          clearPendingHandwritingTimer();
        }
      }
      const isStylus = e.pointerType === 'pen';
      activeSimulatePressureRef.current = !isStylus;
      const pressure = isStylus ? Math.max(0.05, Math.min(1, e.pressure || 0.5)) : 0.5;

      lastDrawPointRef.current = { x, y };
      shiftKeyDownRef.current = e.shiftKey;
      activePointsRef.current = [{ x, y, pressure, t: e.timeStamp }];
      if (e.shiftKey) {
        snappedShapeRef.current = { kind: 'line', x1: x, y1: y, x2: x, y2: y };
        holdAnchorRef.current = null;
      } else {
        holdAnchorRef.current = { x, y };
        if (holdToSnapEnabled) {
          holdTimerRef.current = window.setTimeout(triggerHoldToSnap, HOLD_SNAP_DELAY_MS);
        }
      }
      renderActiveFrame();
    } else if (activeTool === 'eraser') {
      clearPendingHandwritingTimer();
      activeWordStrokeIdsRef.current.clear();
      activeWordBoundsRef.current = null;
      lastEraserPointRef.current = { x, y };
      eraserHoverPointRef.current = { x, y };
      if (eraserMode === 'precision') {
        const baseline = [...page.strokes];
        eraserStartStrokesRef.current = baseline;
        workingStrokesRef.current = baseline;
        precisionErasedChangedRef.current = false;
        setLivePrecisionStrokes(null);
      } else {
        erasedSetRef.current = new Set();
      }
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
      if (activeTool === 'eraser' && !spacePressed && !isPanning) {
        eraserHoverPointRef.current = hoverPt;
        scheduleActiveRender();
        if (hoveredTextboxId !== null) setHoveredTextboxId(null);
        if (hoveredTextboxOnText) setHoveredTextboxOnText(false);
        if (hoveredStrokeId !== null) setHoveredStrokeId(null);
        return;
      }
      const hitTb = hitTestTextbox(hoverPt.x, hoverPt.y, page.textboxes ?? []);
      const nextTbHover = hitTb ? hitTb.id : null;
      const nextOnText = Boolean(
        hitTb && !hitTb.locked && isPointOnTextboxText(hoverPt.x - hitTb.x, hoverPt.y - hitTb.y, hitTb),
      );
      if (nextTbHover !== hoveredTextboxId) {
        setHoveredTextboxId(nextTbHover);
      }
      if (nextOnText !== hoveredTextboxOnText) {
        setHoveredTextboxOnText(nextOnText);
      }
      if (activeTool === 'pan' && !spacePressed && !nextTbHover) {
        const hitSt = hitTestStroke(hoverPt.x, hoverPt.y, page.strokes, strokeHitTolerance);
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
        lastDrawPointRef.current = { x, y };
        if (e.shiftKey || sample.shiftKey) {
          shiftKeyDownRef.current = true;
        }
        const shiftLocked = e.shiftKey || sample.shiftKey || shiftKeyDownRef.current;

        if (
          shiftLocked &&
          (!snappedShapeRef.current || snappedShapeRef.current.kind === 'line')
        ) {
          clearHoldTimer();
          const origin =
            snappedShapeRef.current?.kind === 'line'
              ? { x: snappedShapeRef.current.x1, y: snappedShapeRef.current.y1 }
              : activePointsRef.current[0] ?? { x, y };
          const { x2, y2 } = snapLineEndToCardinalAxis(origin.x, origin.y, x, y);
          snappedShapeRef.current = {
            kind: 'line',
            x1: origin.x,
            y1: origin.y,
            x2,
            y2,
          };
          continue;
        }

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
        eraserHoverPointRef.current = { x, y };
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

  useEffect(() => {
    if (activeTool !== 'pen') {
      recentPenTextboxTapsRef.current = [];
    } else {
      ignoreDoubleClickUntilRef.current = 0;
    }
  }, [activeTool, page.id]);

  const cleanupStrayPenHandwritingIds = useCallback(
    (strayIds: string[]) => {
      if (strayIds.length === 0) return;
      for (const id of strayIds) {
        activeWordStrokeIdsRef.current.delete(id);
      }
      if (activeWordStrokeIdsRef.current.size === 0) {
        clearPendingHandwritingTimer();
        activeWordBoundsRef.current = null;
      }
      discardRecentPenStrokes(page.id, strayIds);
    },
    [clearPendingHandwritingTimer, discardRecentPenStrokes, page.id],
  );

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
      const color = inkColor;
      const size = isHighlighter ? highlighterSize : penSize;
      const opacity = isHighlighter ? 0.45 : 1;
      const snapped = snappedShapeRef.current;

      if (snapped) {
        recentPenTextboxTapsRef.current = [];
        const finalSnapped: ShapeGeometry =
          snapped.kind === 'line' &&
          Math.hypot(snapped.x2 - snapped.x1, snapped.y2 - snapped.y1) < 0.01
            ? { ...snapped, x2: snapped.x1 + 0.25 }
            : snapped;
        const pts = sampleShapePoints(finalSnapped, 0.5);
        const stroke: Stroke = {
          id: createId(),
          tool: activeTool,
          color,
          size,
          opacity,
          simulatePressure: false,
          points: pts,
          shape: finalSnapped,
          bounds: computeBoundsFromPoints(pts, size * 0.6, finalSnapped),
          createdAt: Date.now(),
        };
        commitNewStroke(page.id, stroke);
        if (
          activeTool === 'pen' &&
          handwritingCorrectionEnabled &&
          activeWordStrokeIdsRef.current.size > 0
        ) {
          flushActiveHandwritingWord();
        }
      } else if (activePointsRef.current.length > 0) {
        const rawPoints = [...activePointsRef.current];
        let isPenTap = false;
        let hitTextboxOnTap: Textbox | null = null;
        const now = Date.now();

        if (activeTool === 'pen') {
          const p0 = rawPoints[0];
          let maxTravel = 0;
          for (let i = 1; i < rawPoints.length; i++) {
            const dist = Math.hypot(rawPoints[i].x - p0.x, rawPoints[i].y - p0.y);
            if (dist > maxTravel) maxTravel = dist;
          }
          const maxTapTravelPage = Math.max(8, 8 / Math.max(0.25, effectiveZoom));
          isPenTap = maxTravel <= maxTapTravelPage;
          recentPenTextboxTapsRef.current = recentPenTextboxTapsRef.current.filter(
            (tap) => now - tap.time <= 1500,
          );
          if (isPenTap) {
            hitTextboxOnTap = hitTestTextbox(p0.x, p0.y, page.textboxes ?? []);
            if (hitTextboxOnTap) {
              const prevTap =
                recentPenTextboxTapsRef.current[recentPenTextboxTapsRef.current.length - 1];
              if (
                prevTap &&
                prevTap.textboxId === hitTextboxOnTap.id &&
                now - prevTap.time <= 500 &&
                Math.hypot(e.clientX - prevTap.clientX, e.clientY - prevTap.clientY) <= 16
              ) {
                activePointsRef.current = [];
                snappedShapeRef.current = null;
                lastDrawPointRef.current = null;
                shiftKeyDownRef.current = false;
                recentPenTextboxTapsRef.current = [];
                ignoreDoubleClickUntilRef.current = now + 350;
                cleanupStrayPenHandwritingIds([prevTap.strokeId]);
                onFocusPage(page.id);
                setActiveTool('pan');
                selectTextbox(hitTextboxOnTap.id);
                clearActiveCanvas();
                return;
              }
            } else {
              recentPenTextboxTapsRef.current = [];
            }
          } else {
            recentPenTextboxTapsRef.current = [];
          }
        }

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
          createdAt: now,
        };
        commitNewStroke(page.id, stroke);

        if (activeTool === 'pen' && isPenTap && hitTextboxOnTap) {
          recentPenTextboxTapsRef.current = [
            ...recentPenTextboxTapsRef.current.slice(-2),
            {
              strokeId: stroke.id,
              textboxId: hitTextboxOnTap.id,
              clientX: e.clientX,
              clientY: e.clientY,
              time: now,
            },
          ];
        }

        if (activeTool === 'pen' && handwritingCorrectionEnabled) {
          const stSnapshot = useAppStore.getState();
          const inPrimary = stSnapshot.pages.some((p) => p.id === page.id);
          const targetNotebook = inPrimary
            ? stSnapshot.activeNotebook
            : stSnapshot.splitPane?.notebook ?? null;
          const activeAi = resolveActiveAiConfig(stSnapshot);
          const vaultBlocked = Boolean(
            targetNotebook?.isLocked && stSnapshot.blockAiOnVaultLocked,
          );

          if (activeAi.configured && !vaultBlocked) {
            const isCandidate = isHandwritingCandidateStroke(stroke);
            const isAccessory =
              activeWordBoundsRef.current !== null &&
              isHandwritingAccessoryStroke(stroke, activeWordBoundsRef.current);

            if (isCandidate || isAccessory) {
              if (
                isCandidate &&
                !isAccessory &&
                activeWordBoundsRef.current &&
                isNewHandwritingWordStart(activeWordBoundsRef.current, {
                  x: stroke.bounds.minX,
                  y: (stroke.bounds.minY + stroke.bounds.maxY) / 2,
                })
              ) {
                flushActiveHandwritingWord();
              }

              activeWordStrokeIdsRef.current.add(stroke.id);
              activeWordBoundsRef.current = expandBoundingBox(
                activeWordBoundsRef.current,
                stroke.bounds,
              );
              clearPendingHandwritingTimer();
              handwritingTimerRef.current = window.setTimeout(() => {
                handwritingTimerRef.current = null;
                flushActiveHandwritingWord();
              }, LIVE_HANDWRITING_PAUSE_MS);
            } else if (activeWordStrokeIdsRef.current.size > 0) {
              flushActiveHandwritingWord();
            }
          }
        }
      }

      activePointsRef.current = [];
      snappedShapeRef.current = null;
      lastDrawPointRef.current = null;
      shiftKeyDownRef.current = false;
    } else if (activeTool === 'eraser') {
      if (eraserMode === 'precision') {
        const startStrokes = eraserStartStrokesRef.current;
        const endStrokes = workingStrokesRef.current;
        const didChange = precisionErasedChangedRef.current;
        eraserStartStrokesRef.current = null;
        workingStrokesRef.current = null;
        precisionErasedChangedRef.current = false;
        setLivePrecisionStrokes(null);
        if (didChange && startStrokes && endStrokes) {
          commitPrecisionErase(page.id, startStrokes, endStrokes);
        }
      } else {
        const toDelete = Array.from(erasedSetRef.current);
        erasedSetRef.current = new Set();
        setLiveErasedIds([]);
        if (toDelete.length > 0) {
          commitEraseStrokes(page.id, toDelete);
        }
      }
      lastEraserPointRef.current = null;
      renderActiveFrame();
      return;
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
      resetHandwritingSession();
      multiDragCleanupRef.current?.();
      marqueeCleanupRef.current?.();
      rightClickLassoCleanupRef.current?.();
      contextMenuSuppressCleanupRef.current?.();
      if (snapToastTimerRef.current !== null) {
        window.clearTimeout(snapToastTimerRef.current);
      }
      if (rafPendingRef.current !== null) {
        window.cancelAnimationFrame(rafPendingRef.current);
      }
    };
  }, [clearHoldTimer, page.id, resetHandwritingSession]);

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool !== 'pen' && Date.now() < ignoreDoubleClickUntilRef.current) return;
    if (spacePressed) return;
    if (
      activeTool !== 'pan' &&
      activeTool !== 'lasso' &&
      activeTool !== 'text' &&
      activeTool !== 'pen'
    ) {
      return;
    }
    const { x, y } = toPagePoint(e.clientX, e.clientY);
    onRecordCursorPoint(page.id, x, y);
    const hit = hitTestTextbox(x, y, page.textboxes ?? []);
    if (activeTool === 'pen') {
      if (!hit) return;
      const now = Date.now();
      const strayIds = recentPenTextboxTapsRef.current
        .filter((tap) => tap.textboxId === hit.id && now - tap.time <= 1500)
        .map((tap) => tap.strokeId);
      recentPenTextboxTapsRef.current = [];
      cleanupStrayPenHandwritingIds(strayIds);
      onFocusPage(page.id);
      setActiveTool('pan');
      selectTextbox(hit.id);
      return;
    }
    if (hit) {
      if (!hit.locked) beginEditTextbox(page.id, hit.id);
    } else {
      spawnTextbox({ pageId: page.id, x, y });
    }
  };

  const handleCanvasContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toPagePoint(e.clientX, e.clientY);
    const restrictToSelected = activeTool === 'pen' || activeTool === 'pan';
    const hit = hitTestTextbox(x, y, page.textboxes ?? []);
    if (hit) {
      const isTbSelected =
        selectedTextboxIds.includes(hit.id) || activeTextboxId === hit.id;
      if (restrictToSelected && !isTbSelected) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (!isTbSelected) {
        selectTextbox(hit.id);
      }
      onContextMenuRequest({
        pageId: page.id,
        clientX: e.clientX,
        clientY: e.clientY,
        targetType: 'textbox',
        textboxId: hit.id,
      });
      return;
    }
    const hitStroke = hitTestStroke(x, y, page.strokes, strokeHitTolerance);
    if (hitStroke) {
      const isStrokeSelected =
        lassoSelection?.pageId === page.id &&
        lassoSelection.strokeIds.includes(hitStroke.id);
      if (restrictToSelected && !isStrokeSelected) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (!isStrokeSelected) {
        setUnifiedSelection(
          page.id,
          { strokeIds: [hitStroke.id], textboxIds: [], imageIds: [] },
          { expandGroups: true },
        );
      }
      onContextMenuRequest({
        pageId: page.id,
        clientX: e.clientX,
        clientY: e.clientY,
        targetType: 'lasso',
      });
      return;
    }
    if (restrictToSelected) {
      e.preventDefault();
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

  const cursorClass = isPanning
    ? 'cursor-grabbing'
    : spacePressed
      ? 'cursor-grab active:cursor-grabbing'
      : isRightClickLasso
        ? 'cursor-crosshair'
        : activeTool === 'pan'
        ? hoveredTextboxLayout && hoveredTextboxOnText
          ? 'cursor-text'
          : hoveredStrokeBounds || hoveredTextboxLayout
            ? 'cursor-move'
            : 'cursor-default'
        : activeTool === 'text'
          ? 'cursor-text'
          : activeTool === 'eraser'
            ? 'cursor-none'
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
            unbounded: isWhiteboard,
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

  const worldOverlayChildren = (
    <>
      {/* Subtle 1px accent outline when hovering over an unselected Textbox or Scribble */}
      {hoveredTextboxLayout && (
        <div
          data-testid="textbox-hover-outline"
          style={{
            left: `${hoveredTextboxLayout.tb.x * effectiveZoom}px`,
            top: `${hoveredTextboxLayout.tb.y * effectiveZoom}px`,
            width: `${hoveredTextboxLayout.layout.width * effectiveZoom}px`,
            height: `${hoveredTextboxLayout.layout.height * effectiveZoom}px`,
            outline: '1px solid rgba(7, 45, 89, 0.5)',
          }}
          className="pointer-events-none absolute z-10"
        />
      )}

      {hoveredStrokeBounds && (
        <div
          data-testid="stroke-hover-outline"
          style={{
            left: `${(hoveredStrokeBounds.minX - 4) * effectiveZoom}px`,
            top: `${(hoveredStrokeBounds.minY - 4) * effectiveZoom}px`,
            width: `${Math.max(12, (hoveredStrokeBounds.maxX - hoveredStrokeBounds.minX + 8) * effectiveZoom)}px`,
            height: `${Math.max(12, (hoveredStrokeBounds.maxY - hoveredStrokeBounds.minY + 8) * effectiveZoom)}px`,
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
            left: `${marqueeRect.minX * effectiveZoom}px`,
            top: `${marqueeRect.minY * effectiveZoom}px`,
            width: `${(marqueeRect.maxX - marqueeRect.minX) * effectiveZoom}px`,
            height: `${(marqueeRect.maxY - marqueeRect.minY) * effectiveZoom}px`,
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
              left: `${guide.pos * effectiveZoom}px`,
              top: `${guide.start * effectiveZoom}px`,
              height: `${Math.max(1, (guide.end - guide.start) * effectiveZoom)}px`,
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
              top: `${guide.pos * effectiveZoom}px`,
              left: `${guide.start * effectiveZoom}px`,
              width: `${Math.max(1, (guide.end - guide.start) * effectiveZoom)}px`,
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
        zoom={effectiveZoom}
        spacePressed={spacePressed || isPanning || isRightClickLasso}
        isWhiteboard={isWhiteboard}
        hiddenImageIds={hiddenDragImageIds}
        onActiveOverlayImageChange={setActiveOverlayImageId}
        onGuidesChange={setActiveGuides}
        onOffPageDragChange={setOffPageCursor}
        onStartMultiDrag={startMultiDrag}
        onContextMenuRequest={onContextMenuRequest}
      />

      {/* Airtight Textbox Editor & Selection Overlay */}
      <TextboxOverlay
        page={page}
        zoom={effectiveZoom}
        spacePressed={spacePressed || isPanning || isRightClickLasso}
        isWhiteboard={isWhiteboard}
        hiddenTextboxIds={hiddenDragTextboxIds}
        ignoreDoubleClickUntilRef={ignoreDoubleClickUntilRef}
        onDraggingTextboxChange={setDraggingTextboxId}
        onGuidesChange={setActiveGuides}
        onOffPageDragChange={setOffPageCursor}
        onStartMultiDrag={startMultiDrag}
        onContextMenuRequest={onContextMenuRequest}
      />

      {/* Unified Stroke & Multi-Element Selection Overlay */}
      <UnifiedSelectionOverlay
        page={page}
        zoom={effectiveZoom}
        spacePressed={spacePressed || isPanning || isRightClickLasso}
        isWhiteboard={isWhiteboard}
        clientToWorld={toPagePoint}
        liveDragOffset={
          liveMultiDrag ? { dx: liveMultiDrag.dx, dy: liveMultiDrag.dy } : null
        }
        liveScaleBounds={liveStrokeScale ? liveStrokeScale.targetBounds : null}
        isOffPageDrag={Boolean(liveMultiDrag?.isOffPage)}
        onStrokeScalePreview={handleStrokeScalePreview}
        onStartMultiDrag={startMultiDrag}
        onContextMenuRequest={onContextMenuRequest}
      />
    </>
  );

  return (
    <div
      ref={pageSurfaceRef}
      data-page-id={page.id}
      data-testid={isWhiteboard ? 'whiteboard-surface' : `page-surface-${pageNumber}`}
      data-dark-paper={smartDarkActive ? 'true' : 'false'}
      data-pdf-page={page.pdfBackground ? 'true' : 'false'}
      data-pdf-rendered={page.pdfBackground && pdfBitmapRef.current ? 'true' : 'false'}
      data-pdf-render-scale={
        renderedPdfScaleRef.current ? renderedPdfScaleRef.current.toFixed(2) : '0'
      }
      onPointerDown={handleSurfacePointerDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => {
        void handleDrop(e);
      }}
      className={
        isWhiteboard
          ? `relative h-full w-full overflow-hidden ${
              isDragOverFile ? 'ring-2 ring-inset ring-[#FD6E88]' : ''
            }`
          : `relative mx-auto shrink-0 rounded-sm shadow-[0_6px_28px_rgba(7,45,89,0.12)] transition-shadow ${
              isDragOverFile
                ? 'ring-2 ring-[#FD6E88] ring-offset-2'
                : 'ring-1 ring-[#072D59]/10'
            }`
      }
      style={
        isWhiteboard
          ? { backgroundColor: effectivePaper.paperColor }
          : {
              width: `${cssWidth}px`,
              height: `${cssHeight}px`,
              backgroundColor: effectivePaper.paperColor,
            }
      }
    >
      {/* Layer 1: Static bottom canvas */}
      <canvas
        ref={staticCanvasRef}
        data-testid={`static-canvas-${pageNumber}`}
        className={`pointer-events-none absolute block ${
          isWhiteboard ? 'inset-0' : isOversizedPage ? '' : 'inset-0 rounded-sm'
        }`}
        style={
          isWhiteboard
            ? { width: '100%', height: '100%' }
            : isOversizedPage
              ? {
                  left: `${pageWindow.left}px`,
                  top: `${pageWindow.top}px`,
                  width: `${pageWindow.width}px`,
                  height: `${pageWindow.height}px`,
                }
              : {
                  width: `${cssWidth}px`,
                  height: `${cssHeight}px`,
                }
        }
      />

      {/* Layer 2: Active top canvas */}
      <canvas
        ref={activeCanvasRef}
        data-testid={`active-canvas-${pageNumber}`}
        data-off-page-drag={liveMultiDrag?.isOffPage ? 'true' : 'false'}
        data-right-click-lasso={isRightClickLasso ? 'true' : 'false'}
        data-eraser-mode={eraserMode}
        data-eraser-radius={eraserSize}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={finishPointerInteraction}
        onPointerLeave={() => {
          setHoveredTextboxId(null);
          setHoveredStrokeId(null);
          if (!isPointerActiveRef.current && activeTool === 'eraser') {
            eraserHoverPointRef.current = null;
            clearActiveCanvas();
          }
        }}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleCanvasContextMenu}
        className={`canvas-drawing-surface absolute block ${
          isWhiteboard ? 'inset-0' : isOversizedPage ? '' : 'inset-0 rounded-sm'
        } ${cursorClass}`}
        style={{
          ...(isWhiteboard
            ? { width: '100%', height: '100%' }
            : isOversizedPage
              ? {
                  left: `${pageWindow.left}px`,
                  top: `${pageWindow.top}px`,
                  width: `${pageWindow.width}px`,
                  height: `${pageWindow.height}px`,
                }
              : { width: `${cssWidth}px`, height: `${cssHeight}px` }),
          opacity: liveMultiDrag?.isOffPage ? 0.45 : undefined,
          mixBlendMode:
            activeTool === 'highlighter'
              ? smartDarkActive || isDarkColor(effectivePaper.paperColor)
                ? 'screen'
                : 'multiply'
              : 'normal',
        }}
      />

      {isWhiteboard && whiteboardCamera ? (
        <div
          data-testid="whiteboard-world-overlay"
          className="pointer-events-none absolute left-0 top-0 h-0 w-0 overflow-visible"
          style={{
            transform: `translate(${whiteboardCamera.offsetX}px, ${whiteboardCamera.offsetY}px)`,
          }}
        >
          {worldOverlayChildren}
        </div>
      ) : (
        worldOverlayChildren
      )}

      {/* Canva Drag-Off-Paper Delete Indicator near Cursor */}
      {!isWhiteboard && offPageCursor && (
        <div
          data-testid="off-page-delete-pill"
          style={{
            left: `${offPageCursor.clientX / getCssFallbackZoomFactor() + 14}px`,
            top: `${offPageCursor.clientY / getCssFallbackZoomFactor() + 14}px`,
          }}
          className="pointer-events-none fixed z-50 inline-flex items-center gap-1.5 rounded-full bg-[#FD6E88] px-2.5 py-1 text-xs font-bold text-white shadow-lg"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Release to delete</span>
        </div>
      )}

      {/* Hold-to-Snap feedback pill */}
      {snapToast && (
        <div className="folio-glass-badge pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-medium">
          {snapToast}
        </div>
      )}

      {/* Subtle page badge */}
      {!isWhiteboard && (
        <div className="folio-mono folio-glass-badge pointer-events-none absolute bottom-2 right-3 rounded-full px-2 py-0.5 text-[11px] font-medium">
          {pageNumber} / {totalPages}
        </div>
      )}
    </div>
  );
};
