import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { SnapshotCropRect } from '../../ai/pageSnapshot';
import {
  clampWhiteboardZoom,
  computeFitContentCamera,
  createOriginCamera,
  getPageContentBounds,
  screenToWorld,
  type WhiteboardCamera,
  zoomCameraAtPoint,
} from '../../canvas/whiteboard';
import { useAppStore } from '../../store/useAppStore';
import type { Page } from '../../types/notes';
import type { CanvasContextMenuState } from './CanvasContextMenu';
import { PageCanvas } from './PageCanvas';

export interface WhiteboardCanvasHandle {
  fitContent: () => void;
  resetView: () => void;
  getVisibleWorldCenter: () => { x: number; y: number };
  getVisibleWorldRect: () => SnapshotCropRect;
  getCamera: () => WhiteboardCamera;
}

interface WhiteboardCanvasProps {
  page: Page;
  spacePressed: boolean;
  zoomOverride?: number;
  masterKeyOverride?: CryptoKey | null;
  isFocusedPane?: boolean;
  viewportTestId?: string;
  onFocusPage: (pageId: string) => void;
  onRecordCursorPoint: (pageId: string, x: number, y: number) => void;
  onContextMenuRequest: (menu: CanvasContextMenuState) => void;
  onRightClickLassoChange?: (active: boolean) => void;
}

export const WhiteboardCanvas = forwardRef<WhiteboardCanvasHandle, WhiteboardCanvasProps>(
  (
    {
      page,
      spacePressed,
      zoomOverride,
      masterKeyOverride,
      isFocusedPane = true,
      viewportTestId = 'editor-canvas-viewport',
      onFocusPage,
      onRecordCursorPoint,
      onContextMenuRequest,
      onRightClickLassoChange,
    },
    ref,
  ) => {
    const storeZoom = useAppStore((s) => s.zoom);
    const effectiveZoom = zoomOverride !== undefined ? zoomOverride : storeZoom;
    const setZoom = useAppStore((s) => s.setZoom);
    const ctrlScrollBehavior = useAppStore((s) => s.ctrlScrollBehavior);

    const viewportRef = useRef<HTMLDivElement | null>(null);
    const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>(() => {
      if (typeof window !== 'undefined') {
        return {
          width: Math.max(300, window.innerWidth || 1200),
          height: Math.max(200, (window.innerHeight || 800) - 96),
        };
      }
      return { width: 1200, height: 800 };
    });
    const viewportSizeRef = useRef(viewportSize);
    viewportSizeRef.current = viewportSize;

    const initialBounds = getPageContentBounds(page);
    const [camera, setCamera] = useState<WhiteboardCamera>(() =>
      initialBounds
        ? computeFitContentCamera(initialBounds, viewportSize.width, viewportSize.height)
        : createOriginCamera(viewportSize.width, viewportSize.height, 1),
    );
    const cameraRef = useRef<WhiteboardCamera>(camera);
    cameraRef.current = camera;
    const syncedStoreZoomRef = useRef<number>(camera.zoom);
    const initializedPageIdRef = useRef<string | null>(null);

    const [isPanning, setIsPanning] = useState(false);
    const panCleanupRef = useRef<(() => void) | null>(null);

    const applyCamera = useCallback(
      (nextCamera: WhiteboardCamera, syncStore = true) => {
        cameraRef.current = nextCamera;
        setCamera(nextCamera);
        if (syncStore && isFocusedPane) {
          syncedStoreZoomRef.current = nextCamera.zoom;
          setZoom(nextCamera.zoom);
        }
      },
      [isFocusedPane, setZoom],
    );

    // Measure viewport size cleanly with ResizeObserver + jsdom fallback
    useEffect(() => {
      const el = viewportRef.current;
      if (!el) return;

      const measure = () => {
        const rect = el.getBoundingClientRect();
        const w = Math.round(el.clientWidth || rect.width);
        const h = Math.round(el.clientHeight || rect.height);
        if (w > 0 && h > 0) {
          setViewportSize((prev) =>
            prev.width === w && prev.height === h ? prev : { width: w, height: h },
          );
        }
      };

      measure();

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
      }
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }, []);

    // Re-center or fit existing content when opening a new whiteboard page
    useEffect(() => {
      if (initializedPageIdRef.current === page.id) return;
      initializedPageIdRef.current = page.id;

      const el = viewportRef.current;
      const rect = el?.getBoundingClientRect();
      const vw = Math.max(300, Math.round(el?.clientWidth || rect?.width || viewportSizeRef.current.width));
      const vh = Math.max(200, Math.round(el?.clientHeight || rect?.height || viewportSizeRef.current.height));
      if (el && (vw !== viewportSizeRef.current.width || vh !== viewportSizeRef.current.height)) {
        setViewportSize({ width: vw, height: vh });
      }

      const bounds = getPageContentBounds(page);
      const nextCam = bounds
        ? computeFitContentCamera(bounds, vw, vh)
        : createOriginCamera(vw, vh, 1);
      applyCamera(nextCam, true);
    }, [applyCamera, page]);

    // Sync external zoom controls (BottomDocks, Ctrl+=/−/0) around viewport center
    useEffect(() => {
      if (Math.abs(effectiveZoom - syncedStoreZoomRef.current) < 0.0005) return;
      syncedStoreZoomRef.current = effectiveZoom;
      const vw = viewportSizeRef.current.width;
      const vh = viewportSizeRef.current.height;
      const next = zoomCameraAtPoint(cameraRef.current, effectiveZoom, vw / 2, vh / 2);
      cameraRef.current = next;
      setCamera(next);
    }, [effectiveZoom]);

    // Imperative handle for BottomDocks Fit Content / Reset View & AI insertion center
    useImperativeHandle(
      ref,
      () => ({
        fitContent: () => {
          const st = useAppStore.getState();
          const latestPage =
            st.pages.find((p) => p.id === page.id) ??
            st.splitPane?.pages.find((p) => p.id === page.id) ??
            page;
          const bounds = getPageContentBounds(latestPage);
          const next = computeFitContentCamera(
            bounds,
            viewportSizeRef.current.width,
            viewportSizeRef.current.height,
          );
          applyCamera(next, true);
        },
        resetView: () => {
          const next = createOriginCamera(
            viewportSizeRef.current.width,
            viewportSizeRef.current.height,
            1,
          );
          applyCamera(next, true);
        },
        getVisibleWorldCenter: () =>
          screenToWorld(
            viewportSizeRef.current.width / 2,
            viewportSizeRef.current.height / 2,
            cameraRef.current,
          ),
        getVisibleWorldRect: () => {
          const vw = Math.max(32, viewportSizeRef.current.width);
          const vh = Math.max(32, viewportSizeRef.current.height);
          const topLeft = screenToWorld(0, 0, cameraRef.current);
          const bottomRight = screenToWorld(vw, vh, cameraRef.current);
          return {
            x: Math.floor(topLeft.x),
            y: Math.floor(topLeft.y),
            width: Math.max(32, Math.ceil(bottomRight.x - topLeft.x)),
            height: Math.max(32, Math.ceil(bottomRight.y - topLeft.y)),
          };
        },
        getCamera: () => cameraRef.current,
      }),
      [applyCamera, page],
    );

    // Cursor-anchored wheel zooming (Ctrl+Scroll in smart/paper-zoom, Alt+Scroll, Trackpad Pinch)
    useEffect(() => {
      const el = viewportRef.current;
      if (!el) return;

      const onWheel = (e: WheelEvent) => {
        const isAltScroll = e.altKey && !e.ctrlKey && !e.metaKey;
        const isCtrlOrMeta = e.ctrlKey || e.metaKey;
        const isTrackpadPinch =
          e.ctrlKey &&
          !e.metaKey &&
          e.deltaMode === 0 &&
          Math.abs(e.deltaY) > 0 &&
          Math.abs(e.deltaY) < 25;

        const shouldZoomCanvas =
          isAltScroll ||
          isTrackpadPinch ||
          (isCtrlOrMeta &&
            (ctrlScrollBehavior === 'smart' || ctrlScrollBehavior === 'paper-zoom'));

        if (!shouldZoomCanvas) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        if (e.deltaY === 0) return;

        const sensitivity = isTrackpadPinch ? 0.01 : 0.0018;
        const nextZoom = clampWhiteboardZoom(
          cameraRef.current.zoom * Math.exp(-e.deltaY * sensitivity),
        );
        const rect = el.getBoundingClientRect();
        const pivotX = rect.width > 0 ? e.clientX - rect.left : viewportSizeRef.current.width / 2;
        const pivotY = rect.height > 0 ? e.clientY - rect.top : viewportSizeRef.current.height / 2;

        const nextCam = zoomCameraAtPoint(cameraRef.current, nextZoom, pivotX, pivotY);
        applyCamera(nextCam, true);
      };

      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }, [applyCamera, ctrlScrollBehavior]);

    const startPanSession = useCallback((pointerId: number, startX: number, startY: number) => {
      panCleanupRef.current?.();
      setIsPanning(true);

      let lastX = startX;
      let lastY = startY;

      const onWindowMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const dx = ev.clientX - lastX;
        const dy = ev.clientY - lastY;
        lastX = ev.clientX;
        lastY = ev.clientY;
        if (dx === 0 && dy === 0) return;
        setCamera((prev) => {
          const next = {
            ...prev,
            offsetX: prev.offsetX + dx,
            offsetY: prev.offsetY + dy,
          };
          cameraRef.current = next;
          return next;
        });
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onWindowMove);
        window.removeEventListener('pointerup', onWindowEnd);
        window.removeEventListener('pointercancel', onWindowEnd);
        window.removeEventListener('blur', onWindowBlur);
        panCleanupRef.current = null;
        setIsPanning(false);
      };

      const onWindowEnd = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanup();
      };

      const onWindowBlur = () => {
        cleanup();
      };

      panCleanupRef.current = cleanup;
      window.addEventListener('pointermove', onWindowMove);
      window.addEventListener('pointerup', onWindowEnd);
      window.addEventListener('pointercancel', onWindowEnd);
      window.addEventListener('blur', onWindowBlur);
    }, []);

    useEffect(() => {
      return () => {
        panCleanupRef.current?.();
      };
    }, []);

    const handleMouseDownCapture = (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    };

    const handleAuxClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    };

    const handlePointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
      const shouldPan = e.button === 1 || (spacePressed && e.button === 0);
      if (!shouldPan) return;

      e.preventDefault();
      e.stopPropagation();
      if (document.activeElement instanceof HTMLButtonElement) {
        document.activeElement.blur();
      }
      startPanSession(e.pointerId, e.clientX, e.clientY);
    };

    return (
      <main
        ref={viewportRef}
        data-testid={viewportTestId}
        data-whiteboard-viewport="true"
        data-panning={isPanning ? 'true' : 'false'}
        onMouseDownCapture={handleMouseDownCapture}
        onAuxClickCapture={handleAuxClickCapture}
        onAuxClick={handleAuxClickCapture}
        onPointerDownCapture={handlePointerDownCapture}
        className={`relative flex-1 overflow-hidden select-none ${
          isPanning ? 'cursor-grabbing' : spacePressed ? 'cursor-grab' : ''
        }`}
      >
        <PageCanvas
          page={page}
          pageNumber={1}
          totalPages={1}
          zoom={camera.zoom}
          spacePressed={spacePressed}
          isPanning={isPanning}
          whiteboardCamera={camera}
          viewportSize={viewportSize}
          masterKeyOverride={masterKeyOverride}
          onFocusPage={onFocusPage}
          onRecordCursorPoint={onRecordCursorPoint}
          onContextMenuRequest={onContextMenuRequest}
          onRightClickLassoChange={onRightClickLassoChange}
        />
      </main>
    );
  },
);

WhiteboardCanvas.displayName = 'WhiteboardCanvas';
