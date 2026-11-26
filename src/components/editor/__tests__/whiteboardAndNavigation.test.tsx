// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
import { App } from '../../../App';
import { computeBoundsFromPoints } from '../../../canvas/geometry';
import {
  clampNotebookZoom,
  computeFitContentCamera,
  createOriginCamera,
  DEFAULT_WHITEBOARD_PAPER,
  getNotebookMinZoom,
  getPageContentBounds,
  NOTEBOOK_MIN_ZOOM,
  normalizeWhiteboardPageForExport,
  screenToWorld,
  stepCanvasZoom,
  WHITEBOARD_EXPORT_MARGIN,
  WHITEBOARD_MAX_ZOOM,
  WHITEBOARD_MIN_ZOOM,
  worldToScreen,
  zoomCameraAtPoint,
} from '../../../canvas/whiteboard';
import { DEFAULT_PAPER_CONFIG } from '../../../constants/papers';
import { useAppStore } from '../../../store/useAppStore';
import type { Page, Stroke } from '../../../types/notes';
import {
  buildFolioNotebookExport,
  exportPageToSvg,
  renderPageToCanvas,
} from '../../../utils/exportNotebook';
import { DEFAULT_UI_SCALE } from '../../../utils/uiZoom';
import { generateRecoveryKey } from '../../../utils/vaultCrypto';

function dispatchPointer(
  target: EventTarget,
  type: string,
  opts: {
    clientX: number;
    clientY: number;
    pointerId?: number;
    button?: number;
    buttons?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  },
): Event {
  const InitCtor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
  const ev = new InitCtor(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX,
    clientY: opts.clientY,
    button: opts.button ?? 0,
    buttons: opts.buttons ?? (opts.button === 1 ? 4 : 1),
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
  });
  Object.defineProperty(ev, 'pointerId', { value: opts.pointerId ?? 1 });
  target.dispatchEvent(ev);
  return ev;
}

function dispatchMouse(
  target: EventTarget,
  type: string,
  opts: {
    clientX: number;
    clientY: number;
    button?: number;
    buttons?: number;
  },
): MouseEvent {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX,
    clientY: opts.clientY,
    button: opts.button ?? 0,
    buttons: opts.buttons ?? (opts.button === 1 ? 4 : 1),
  });
  target.dispatchEvent(ev);
  return ev;
}

function buildStroke(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tool: 'pen' | 'highlighter' = 'pen',
): Stroke {
  const points = [
    { x: x1, y: y1, pressure: 0.5, t: 0 },
    { x: (x1 + x2) / 2, y: (y1 + y2) / 2, pressure: 0.5, t: 20 },
    { x: x2, y: y2, pressure: 0.5, t: 40 },
  ];
  return {
    id,
    tool,
    color: '#072D59',
    size: 4,
    opacity: 1,
    simulatePressure: false,
    points,
    bounds: computeBoundsFromPoints(points, 4),
    createdAt: Date.now(),
  };
}

function createMock2DContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return {
    canvas,
    fillStyle: '#FFFFFF',
    strokeStyle: '#072D59',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '16px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    setLineDash: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 24 })),
  } as unknown as CanvasRenderingContext2D;
}

describe('v1.2.0 Context-Aware Ctrl+Scroll, Infinite Whiteboard & Kleki Middle-Click Panning', () => {
  let container: HTMLDivElement;
  let root: Root;
  let origGetBCR: typeof HTMLElement.prototype.getBoundingClientRect;

  beforeEach(async () => {
    window.localStorage.clear();
    document.documentElement.style.zoom = '';
    delete document.documentElement.dataset.uiScale;
    delete window.folioDesktop;

    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    origGetBCR = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const testid = this.dataset?.testid;
      if (
        this.dataset?.whiteboardViewport === 'true' ||
        testid === 'whiteboard-surface' ||
        testid === 'editor-canvas-viewport'
      ) {
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 1200,
          bottom: 800,
          width: 1200,
          height: 800,
          toJSON: () => ({}),
        } as DOMRect;
      }
      if (
        testid === 'page-surface-1' ||
        testid === 'active-canvas-1' ||
        this.dataset?.pageId !== undefined
      ) {
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 816,
          bottom: 1056,
          width: 816,
          height: 1056,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return origGetBCR.call(this);
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      useAppStore.getState().setUiScale(DEFAULT_UI_SCALE);
      useAppStore.getState().setCtrlScrollBehavior('smart');
      useAppStore.getState().setZoom(1);
      await useAppStore.getState().initApp();
      await useAppStore.getState().closeNotebook();
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await useAppStore.getState().closeNotebook();
    vi.restoreAllMocks();
  });

  it('computes whiteboard camera coordinates, fit-content bounds, and +48px normalized SVG/PNG/folio exports accurately', async () => {
    const cam = createOriginCamera(1200, 800, 1);
    expect(cam).toEqual({ offsetX: 600, offsetY: 400, zoom: 1 });

    // Round-trip negative world coordinates cleanly
    const worldPt = { x: -420, y: -260 };
    const screenPt = worldToScreen(worldPt.x, worldPt.y, cam);
    expect(screenPt).toEqual({ x: 180, y: 140 });
    expect(screenToWorld(screenPt.x, screenPt.y, cam)).toEqual(worldPt);

    // Cursor-anchored zoom keeps the world point under (pivotX, pivotY) pinned
    const zoomed = zoomCameraAtPoint(cam, 2.4, 320, 210);
    const beforeWorld = screenToWorld(320, 210, cam);
    const afterWorld = screenToWorld(320, 210, zoomed);
    expect(afterWorld.x).toBeCloseTo(beforeWorld.x, 4);
    expect(afterWorld.y).toBeCloseTo(beforeWorld.y, 4);

    // Extreme zooms clamp within whiteboard [0.05, 5.0]
    expect(zoomCameraAtPoint(cam, 0.01, 600, 400).zoom).toBe(WHITEBOARD_MIN_ZOOM);
    expect(zoomCameraAtPoint(cam, 99, 600, 400).zoom).toBe(WHITEBOARD_MAX_ZOOM);

    // Page spanning x: [-300..-100], y: [-200..40]
    const rawStroke = buildStroke('wb-s1', -300, -200, -100, 40);
    rawStroke.bounds = { minX: -300, minY: -200, maxX: -100, maxY: 40 };

    const rawPage: Page = {
      id: 'wb-page-1',
      notebookId: 'wb-1',
      paper: { ...DEFAULT_WHITEBOARD_PAPER },
      strokes: [rawStroke],
      textboxes: [],
      images: [],
      createdAt: 1,
      updatedAt: 1,
    };

    const bounds = getPageContentBounds(rawPage)!;
    expect(bounds).toEqual({ minX: -300, minY: -200, maxX: -100, maxY: 40 });

    const fitCam = computeFitContentCamera(bounds, 1200, 800, 72);
    const centerScreen = worldToScreen(-200, -80, fitCam);
    expect(centerScreen.x).toBeCloseTo(600, 1);
    expect(centerScreen.y).toBeCloseTo(400, 1);

    // +48px margin normalization shifts negative world elements cleanly into positive export space
    const normalized = normalizeWhiteboardPageForExport(rawPage, WHITEBOARD_EXPORT_MARGIN);
    expect(normalized.paper.width).toBe(200 + 48 * 2); // 296
    expect(normalized.paper.height).toBe(240 + 48 * 2); // 336
    expect(normalized.strokes[0].points[0].x).toBe(48);
    expect(normalized.strokes[0].points[2].x).toBe(248);
    expect(normalized.strokes[0].points[0].y).toBe(48);
    expect(normalized.strokes[0].points[2].y).toBe(288);

    // SVG export uses normalized 296x336 bounds
    const svg = exportPageToSvg({
      page: rawPage,
      includeBackground: true,
      includeAnnotations: true,
      isWhiteboard: true,
    });
    expect(svg).toContain('width="296"');
    expect(svg).toContain('height="336"');
    expect(svg).toContain('M 48.');
    expect(svg).toContain('248 288');

    // PNG canvas export sizes the offscreen canvas to 296x336
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return createMock2DContext(this);
    });
    const origPath2D = (globalThis as { Path2D?: typeof Path2D }).Path2D;
    (globalThis as { Path2D: unknown }).Path2D = class MockPath2D {
      moveTo = vi.fn();
      lineTo = vi.fn();
      quadraticCurveTo = vi.fn();
      bezierCurveTo = vi.fn();
      closePath = vi.fn();
      rect = vi.fn();
      arc = vi.fn();
      addPath = vi.fn();
    };
    let renderedCanvas: HTMLCanvasElement;
    try {
      renderedCanvas = await renderPageToCanvas(rawPage, {
        scale: 1,
        includeBackground: true,
        includeAnnotations: true,
        isWhiteboard: true,
      });
    } finally {
      (globalThis as { Path2D?: typeof Path2D }).Path2D = origPath2D;
    }
    expect(renderedCanvas.width).toBe(296);
    expect(renderedCanvas.height).toBe(336);

    // .folio.json export preserves mode: 'whiteboard'
    const exportedJson = buildFolioNotebookExport(
      {
        id: 'wb-1',
        title: 'My Whiteboard',
        mode: 'whiteboard',
        folderId: null,
        cover: {
          styleId: 'classic-navy',
          primaryColor: '#072D59',
          accentColor: '#DBF2FC',
          pattern: 'solid',
        },
        defaultPaper: { ...DEFAULT_WHITEBOARD_PAPER },
        pageOrder: [rawPage.id],
        lastOpenedPageId: rawPage.id,
        createdAt: 1,
        updatedAt: 1,
      },
      [rawPage],
    );
    expect(exportedJson.notebook.mode).toBe('whiteboard');
  });

  it('applies context-aware Ctrl+Scroll (GUI on Home Shelf, Canvas in Notebook & Whiteboard) while keeping Ctrl+Shift+=/−/0 global', async () => {
    await act(async () => {
      root.render(<App />);
    });

    // 1. On Home Shelf (activeNotebook === null), Ctrl + Scroll scales whole GUI
    expect(useAppStore.getState().activeNotebook).toBeNull();
    expect(useAppStore.getState().ctrlScrollBehavior).toBe('smart');

    await act(async () => {
      window.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(useAppStore.getState().uiScale).toBe(1.4);
    expect(document.documentElement.style.zoom).toBe('1.4');
    expect(container.querySelector('[data-testid="ui-zoom-badge"]')?.textContent).toContain('140%');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="ui-zoom-reset-btn"]')!.click();
    });
    expect(useAppStore.getState().uiScale).toBe(1.35);
    expect(document.documentElement.style.zoom).toBe('1.35');

    // Re-mount cleanly so the transient 1.5s HomeShelf badge timer does not linger into the Editor test
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(<App />);
    });

    // 2. Inside a Standard Notebook, Ctrl + Scroll zooms ONLY paper canvas (never GUI chrome)
    await act(async () => {
      await useAppStore.getState().createNotebook({
        title: 'Standard Notebook',
        mode: 'notebook',
        folderId: null,
        cover: {
          styleId: 'classic-navy',
          primaryColor: '#072D59',
          accentColor: '#DBF2FC',
          pattern: 'spine-band',
        },
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: true,
      });
    });

    const nbViewport = container.querySelector<HTMLElement>('[data-testid="editor-canvas-viewport"]')!;
    expect(nbViewport).not.toBeNull();
    expect(container.querySelector('[data-testid="pages-drawer-toggle"]')).not.toBeNull();

    await act(async () => {
      nbViewport.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -100,
          ctrlKey: true,
          clientX: 400,
          clientY: 300,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(useAppStore.getState().zoom).toBeCloseTo(Math.exp(0.18), 2);
    expect(useAppStore.getState().uiScale).toBe(1.35);
    expect(document.documentElement.style.zoom).toBe('1.35');
    expect(container.querySelector('[data-testid="ui-zoom-badge"]')).toBeNull();

    // 3. Inside an Infinite Whiteboard, Ctrl + Scroll zooms ONLY the whiteboard camera
    await act(async () => {
      await useAppStore.getState().createNotebook({
        title: 'Infinite Board',
        mode: 'whiteboard',
        folderId: null,
        cover: {
          styleId: 'classic-navy',
          primaryColor: '#072D59',
          accentColor: '#DBF2FC',
          pattern: 'solid',
        },
        paper: { ...DEFAULT_WHITEBOARD_PAPER },
        openImmediately: true,
      });
    });

    const wbViewport = container.querySelector<HTMLElement>('[data-whiteboard-viewport="true"]')!;
    expect(wbViewport).not.toBeNull();
    expect(container.querySelector('[data-testid="whiteboard-surface"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pages-drawer-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="whiteboard-fit-content-btn"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="whiteboard-reset-view-btn"]')).not.toBeNull();

    await act(async () => {
      wbViewport.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -100,
          ctrlKey: true,
          clientX: 600,
          clientY: 400,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(useAppStore.getState().zoom).toBeCloseTo(Math.exp(0.18), 2);
    expect(useAppStore.getState().uiScale).toBe(1.35);
    expect(document.documentElement.style.zoom).toBe('1.35');
    expect(container.querySelector('[data-testid="ui-zoom-badge"]')).toBeNull();

    // Explicit Ctrl+Shift+= global GUI scaling shortcut still works inside the editor
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '+',
          code: 'Equal',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(useAppStore.getState().uiScale).toBe(1.45);
  });

  it('supports Kleki-style middle-mouse panning in BOTH Infinite Whiteboard and Standard Notebook without drawing ink or losing selection', async () => {
    await act(async () => {
      root.render(<App />);
      await useAppStore.getState().createNotebook({
        title: 'Panning Whiteboard',
        mode: 'whiteboard',
        folderId: null,
        cover: {
          styleId: 'classic-navy',
          primaryColor: '#072D59',
          accentColor: '#DBF2FC',
          pattern: 'solid',
        },
        paper: { ...DEFAULT_WHITEBOARD_PAPER },
        openImmediately: true,
      });
    });

    const wbPageId = useAppStore.getState().pages[0].id;
    const existingStroke = buildStroke('existing-wb-s1', 40, 40, 120, 40);
    await act(async () => {
      useAppStore.getState().commitNewStroke(wbPageId, existingStroke);
      useAppStore.getState().setActiveTool('pan');
      useAppStore.getState().setUnifiedSelection(wbPageId, {
        strokeIds: [existingStroke.id],
        textboxIds: [],
        imageIds: [],
      });
    });

    const wbViewport = container.querySelector<HTMLElement>('[data-whiteboard-viewport="true"]')!;
    const worldOverlayBefore = container.querySelector<HTMLElement>(
      '[data-testid="whiteboard-world-overlay"]',
    )!;
    const initialTransform = worldOverlayBefore.style.transform;

    // Suppress Windows autoscroll orb on mousedown/pointerdown/auxclick with middle button & keep selection under Universal Select ('pan') tool
    let mousedownEv!: MouseEvent;
    let pointerdownEv!: Event;
    let auxclickEv!: MouseEvent;
    await act(async () => {
      mousedownEv = dispatchMouse(wbViewport, 'mousedown', {
        clientX: 600,
        clientY: 400,
        button: 1,
      });
      pointerdownEv = dispatchPointer(wbViewport, 'pointerdown', {
        clientX: 600,
        clientY: 400,
        button: 1,
        pointerId: 7,
      });
      auxclickEv = dispatchMouse(wbViewport, 'auxclick', {
        clientX: 600,
        clientY: 400,
        button: 1,
      });
    });
    expect(mousedownEv.defaultPrevented).toBe(true);
    expect(pointerdownEv.defaultPrevented).toBe(true);
    expect(auxclickEv.defaultPrevented).toBe(true);
    expect(wbViewport.getAttribute('data-panning')).toBe('true');
    expect(wbViewport.className).toContain('cursor-grabbing');

    await act(async () => {
      dispatchPointer(window, 'pointermove', {
        clientX: 450,
        clientY: 320,
        button: 1,
        pointerId: 7,
      });
    });

    const worldOverlayMoved = container.querySelector<HTMLElement>(
      '[data-testid="whiteboard-world-overlay"]',
    )!;
    expect(worldOverlayMoved.style.transform).not.toBe(initialTransform);
    expect(worldOverlayMoved.style.transform).toContain('450px, 320px');

    await act(async () => {
      dispatchPointer(window, 'pointerup', {
        clientX: 450,
        clientY: 320,
        button: 1,
        pointerId: 7,
      });
    });
    expect(wbViewport.getAttribute('data-panning')).toBe('false');
    expect(wbViewport.className).not.toContain('cursor-grabbing');
    expect(useAppStore.getState().activeTool).toBe('pan');
    expect(useAppStore.getState().lassoSelection?.strokeIds).toEqual([existingStroke.id]);

    // Now pan with Pen tool active on Infinite Whiteboard -> draws zero ink and stays in Pen
    await act(async () => {
      useAppStore.getState().setActiveTool('pen');
      dispatchPointer(wbViewport, 'pointerdown', {
        clientX: 450,
        clientY: 320,
        button: 1,
        pointerId: 8,
      });
      dispatchPointer(window, 'pointermove', {
        clientX: 490,
        clientY: 350,
        button: 1,
        pointerId: 8,
      });
      dispatchPointer(window, 'pointerup', {
        clientX: 490,
        clientY: 350,
        button: 1,
        pointerId: 8,
      });
    });
    expect(useAppStore.getState().activeTool).toBe('pen');
    expect(useAppStore.getState().pages[0].strokes).toHaveLength(1);

    // Now switch to a Standard Notebook with Pen active and verify middle-click pans viewport scroll without drawing ink
    await act(async () => {
      await useAppStore.getState().createNotebook({
        title: 'Panning Standard Notebook',
        mode: 'notebook',
        folderId: null,
        cover: {
          styleId: 'classic-navy',
          primaryColor: '#072D59',
          accentColor: '#DBF2FC',
          pattern: 'spine-band',
        },
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: true,
      });
      useAppStore.getState().setActiveTool('pen');
    });

    const nbViewport = container.querySelector<HTMLElement>('[data-testid="editor-canvas-viewport"]')!;
    const activeCanvas = container.querySelector<HTMLElement>('[data-testid="active-canvas-1"]')!;
    nbViewport.scrollLeft = 200;
    nbViewport.scrollTop = 200;

    await act(async () => {
      mousedownEv = dispatchMouse(activeCanvas, 'mousedown', {
        clientX: 300,
        clientY: 300,
        button: 1,
      });
      pointerdownEv = dispatchPointer(activeCanvas, 'pointerdown', {
        clientX: 300,
        clientY: 300,
        button: 1,
        pointerId: 9,
      });
      auxclickEv = dispatchMouse(activeCanvas, 'auxclick', {
        clientX: 300,
        clientY: 300,
        button: 1,
      });
    });
    expect(mousedownEv.defaultPrevented).toBe(true);
    expect(pointerdownEv.defaultPrevented).toBe(true);
    expect(auxclickEv.defaultPrevented).toBe(true);
    expect(nbViewport.getAttribute('data-panning')).toBe('true');

    await act(async () => {
      dispatchPointer(window, 'pointermove', {
        clientX: 240,
        clientY: 260,
        button: 1,
        pointerId: 9,
      });
    });
    expect(nbViewport.scrollLeft).toBe(260);
    expect(nbViewport.scrollTop).toBe(240);

    await act(async () => {
      dispatchPointer(window, 'pointerup', {
        clientX: 240,
        clientY: 260,
        button: 1,
        pointerId: 9,
      });
    });
    expect(nbViewport.getAttribute('data-panning')).toBe('false');
    expect(useAppStore.getState().activeTool).toBe('pen');
    expect(useAppStore.getState().pages[0].strokes).toHaveLength(0);
  });

  it('supports negative whiteboard coords without off-paper delete, Fit Content/Reset View, Vault encryption round-trip, and HomeShelf Board badge/quick-create', async () => {
    let wbId = '';
    await act(async () => {
      root.render(<App />);
      const created = await useAppStore.getState().createNotebook({
        title: 'Vaulted Infinite Board',
        mode: 'whiteboard',
        folderId: null,
        cover: {
          styleId: 'classic-navy',
          primaryColor: '#072D59',
          accentColor: '#DBF2FC',
          pattern: 'solid',
        },
        paper: { ...DEFAULT_WHITEBOARD_PAPER },
        openImmediately: true,
      });
      wbId = created.id;
    });

    const pageId = useAppStore.getState().pages[0].id;
    const negStroke = buildStroke('neg-s1', -500, -320, -360, -240);

    let tbId = '';
    await act(async () => {
      useAppStore.getState().commitNewStroke(pageId, negStroke);
      const tb = useAppStore.getState().spawnTextbox({
        pageId,
        x: -480,
        y: -300,
        initialText: 'Negative World Text',
      })!;
      tbId = tb.id;
      useAppStore.getState().commitTextboxSession(pageId, tb.id, true);
    });

    // Coordinates stay negative (never clamped to >= 0)
    const spawnedTb = useAppStore.getState().pages[0].textboxes!.find((t) => t.id === tbId)!;
    expect(spawnedTb.x).toBe(-480);
    expect(spawnedTb.y).toBe(-300);

    // Dragging the textbox across huge distances on a whiteboard NEVER shows Release-to-delete or deletes it
    const tbBox = container.querySelector<HTMLElement>('[data-testid="textbox-box"]')!;
    expect(tbBox).not.toBeNull();
    await act(async () => {
      dispatchPointer(tbBox, 'pointerdown', { clientX: 120, clientY: 110 });
      dispatchPointer(window, 'pointermove', { clientX: 2500, clientY: 1800 });
    });
    expect(container.querySelector('[data-testid="off-page-delete-pill"]')).toBeNull();

    await act(async () => {
      dispatchPointer(window, 'pointerup', { clientX: 2500, clientY: 1800 });
    });
    expect(useAppStore.getState().pages[0].textboxes).toHaveLength(1);

    // Fit Content & Reset View buttons work
    await act(async () => {
      useAppStore.getState().setZoom(2.5);
    });
    expect(useAppStore.getState().zoom).toBe(2.5);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="whiteboard-fit-content-btn"]')!
        .click();
    });
    expect(useAppStore.getState().zoom).not.toBe(2.5);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="whiteboard-reset-view-btn"]')!
        .click();
    });
    expect(useAppStore.getState().zoom).toBe(1);

    // Vault Lock encryption & unlock round-trip preserves whiteboard mode and negative-coord data
    const recoveryKey = generateRecoveryKey();
    await act(async () => {
      await useAppStore.getState().closeNotebook();
      await useAppStore.getState().setupVaultAndMaybeLockNotebook('secret-pass-123', recoveryKey, wbId);
      await useAppStore.getState().refreshShelf();
    });
    expect(useAppStore.getState().notebooks.find((n) => n.id === wbId)?.isLocked).toBe(true);

    // HomeShelf renders "Infinite Board" badge for whiteboard cover
    const boardBadge = container.querySelector('[data-testid="whiteboard-cover-badge"]');
    expect(boardBadge).not.toBeNull();
    expect(boardBadge?.textContent).toContain('Infinite Board');

    // Unlocking opens the whiteboard with all negative-coord elements intact
    await act(async () => {
      await useAppStore.getState().unlockNotebookWithPassword(wbId, 'secret-pass-123', 'open');
    });
    expect(useAppStore.getState().activeNotebook?.mode).toBe('whiteboard');
    expect(useAppStore.getState().pages[0].strokes).toHaveLength(1);
    expect(useAppStore.getState().pages[0].strokes[0].points[0]).toMatchObject({ x: -500, y: -320 });
    expect(useAppStore.getState().pages[0].textboxes).toHaveLength(1);
    expect(useAppStore.getState().pages[0].textboxes![0].text).toBe('Negative World Text');

    // Close back to shelf and verify quick-create Whiteboard chip creates a new whiteboard
    await act(async () => {
      await useAppStore.getState().closeNotebook();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="quick-create-whiteboard"]')!.click();
    });
    await vi.waitFor(() => {
      expect(useAppStore.getState().activeNotebook?.mode).toBe('whiteboard');
    });
  });

  it('computes dynamic min zoom for oversized pages and allows deep Ctrl+Scroll zoom-out on huge sheets', async () => {
    // 1. Unit checks for getNotebookMinZoom & stepCanvasZoom
    expect(getNotebookMinZoom({ width: 816, height: 1056 })).toBe(NOTEBOOK_MIN_ZOOM);
    expect(getNotebookMinZoom({ width: 794, height: 1123 })).toBe(NOTEBOOK_MIN_ZOOM);
    expect(getNotebookMinZoom({ width: 4000, height: 4000 })).toBe(0.1);
    expect(getNotebookMinZoom({ width: 10000, height: 10000 })).toBe(0.04);
    expect(getNotebookMinZoom({ width: 24000, height: 24000 })).toBe(0.0167);
    expect(
      getNotebookMinZoom([
        { paper: { ...DEFAULT_PAPER_CONFIG, width: 816, height: 1056 } },
        { paper: { ...DEFAULT_PAPER_CONFIG, width: 10000, height: 8000 } },
      ]),
    ).toBe(0.04);
    expect(clampNotebookZoom(0.01, 0.0167)).toBe(0.0167);

    // Proportional stepping below 50% steps smoothly instead of slamming to minimum
    expect(stepCanvasZoom(0.45, -1, 0.0167, 3.5)).toBe(0.36);
    expect(stepCanvasZoom(0.1, -1, 0.0167, 3.5)).toBe(0.08);
    expect(stepCanvasZoom(0.0167, -1, 0.0167, 3.5)).toBe(0.0167);
    expect(stepCanvasZoom(0.02, 1, 0.0167, 3.5)).toBe(0.025);

    // 2. Live NotebookEditor Ctrl+Scroll stops at 35% on Letter, then unlocks deep zoom on 24,000x24,000
    await act(async () => {
      root.render(<App />);
    });

    await act(async () => {
      await useAppStore.getState().createNotebook({
        title: 'Big Page Zoom Test',
        mode: 'notebook',
        folderId: null,
        cover: {
          styleId: 'classic-navy',
          primaryColor: '#072D59',
          accentColor: '#DBF2FC',
          pattern: 'spine-band',
        },
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: true,
      });
    });

    const viewport = container.querySelector<HTMLElement>('[data-testid="editor-canvas-viewport"]')!;
    expect(viewport).not.toBeNull();

    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        viewport.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: 500,
            ctrlKey: true,
            clientX: 400,
            clientY: 300,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    }
    expect(useAppStore.getState().zoom).toBe(NOTEBOOK_MIN_ZOOM);

    // Resize page to 24,000 x 24,000 px and verify Ctrl+Scroll zooms smoothly down to ~1.7%
    const pageId = useAppStore.getState().pages[0].id;
    await act(async () => {
      useAppStore.getState().setZoom(1);
      await useAppStore.getState().applyPaperToPage(pageId, {
        ...DEFAULT_PAPER_CONFIG,
        sizePreset: 'custom',
        width: 24000,
        height: 24000,
      });
    });

    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        viewport.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: 500,
            ctrlKey: true,
            clientX: 400,
            clientY: 300,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    }
    expect(useAppStore.getState().zoom).toBe(0.0167);
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="zoom-level-button"]')?.textContent,
    ).toBe('1.7%');

    // Shrinking the page back to standard Letter automatically clamps zoom back up to 35%
    await act(async () => {
      await useAppStore.getState().applyPaperToPage(pageId, { ...DEFAULT_PAPER_CONFIG });
    });
    expect(useAppStore.getState().zoom).toBe(NOTEBOOK_MIN_ZOOM);
  });
});
