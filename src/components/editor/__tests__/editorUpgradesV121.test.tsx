// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../App';
import { computeBoundsFromPoints } from '../../../canvas/geometry';
import { DEFAULT_WHITEBOARD_PAPER } from '../../../canvas/whiteboard';
import { UNIFIED_INK_SWATCHES } from '../../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../../constants/papers';
import { useAppStore } from '../../../store/useAppStore';
import type { Stroke } from '../../../types/notes';
import { getWorkspacePreferences } from '../../../utils/settings';
import { generateRecoveryKey } from '../../../utils/vaultCrypto';
import { SettingsModal } from '../../modals/SettingsModal';
import { NotebookEditor } from '../NotebookEditor';
import { PageCanvas } from '../PageCanvas';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function dispatchPointer(
  target: EventTarget,
  type: string,
  opts: {
    clientX: number;
    clientY: number;
    pointerId?: number;
    button?: number;
    buttons?: number;
  },
): void {
  const Ctor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
  const ev = new Ctor(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX,
    clientY: opts.clientY,
    button: opts.button ?? 0,
    buttons: opts.buttons ?? 1,
  });
  Object.defineProperty(ev, 'pointerId', { value: opts.pointerId ?? 1 });
  target.dispatchEvent(ev);
}

function makeHorizontalStroke(
  id: string,
  y: number,
  x1 = 40,
  x2 = 280,
  locked = false,
): Stroke {
  const points = [
    { x: x1, y, pressure: 0.5, t: 0 },
    { x: (x1 + x2) / 2, y, pressure: 0.5, t: 20 },
    { x: x2, y, pressure: 0.5, t: 40 },
  ];
  return {
    id,
    tool: 'pen',
    color: '#072D59',
    size: 4,
    opacity: 1,
    simulatePressure: false,
    points,
    bounds: computeBoundsFromPoints(points, 4),
    locked,
    createdAt: Date.now(),
  };
}

describe('v1.2.1 Editor Upgrades: Unified Color, AI Study Handwriting Relocation & Precision/Stroke Eraser', () => {
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
      await useAppStore.getState().initApp();
      await useAppStore.getState().createNotebook({
        title: 'v1.2.1 Upgrades Notebook',
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
      useAppStore.getState().setZoom(1);
      useAppStore.getState().setActiveTool('pen');
      useAppStore.getState().setActiveColor(UNIFIED_INK_SWATCHES[0]);
      useAppStore.getState().setEraserMode('precision');
      useAppStore.getState().setEraserSize(18);
      useAppStore.getState().resetPenSlots();
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

  it('houses Handwriting Correction inside AI Study Sidebar & Settings AI tab instead of the Pen sub-bar', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    // Pen sub-bar must NOT contain handwriting-correction-toggle
    expect(container.querySelector('[data-testid="handwriting-correction-toggle"]')).toBeNull();
    await act(async () => {
      useAppStore.getState().setActiveTool('highlighter');
    });
    expect(container.querySelector('[data-testid="handwriting-correction-toggle"]')).toBeNull();

    // Open AI Study Sidebar
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="ai-sidebar-toggle"]')!.click();
    });

    const hwCard = container.querySelector('[data-testid="ai-handwriting-correction-card"]');
    expect(hwCard).not.toBeNull();
    expect(
      container.querySelector('[data-testid="ai-handwriting-status-badge"]')?.textContent,
    ).toBe('No AI Key');

    // Enable with no key silently updates state without showing a missing-key popup toast
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="ai-sidebar-handwriting-toggle"]')!
        .click();
    });
    expect(useAppStore.getState().handwritingCorrectionEnabled).toBe(true);
    expect(useAppStore.getState().editorToast).toBeNull();

    // Configure Gemini key and switch to Text (transcribe) tab inside AI Sidebar
    await act(async () => {
      useAppStore.getState().setActiveAiProvider('gemini');
      useAppStore.getState().setAiProviderKey('gemini', 'AIza-ready-key');
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="ai-mode-transcribe"]')!.click();
    });
    expect(
      container.querySelector('[data-testid="ai-handwriting-status-badge"]')?.textContent,
    ).toBe('Gemini · Ready');
    expect(
      container.querySelector('[data-testid="ai-sidebar-tidy-handwriting-btn"]'),
    ).not.toBeNull();

    // Select an unlocked pen stroke -> Tidy button activates inside AI Study
    const pageId = useAppStore.getState().pages[0].id;
    const penStroke = makeHorizontalStroke('tidy-s1', 150, 40, 200);
    await act(async () => {
      useAppStore.getState().commitNewStroke(pageId, penStroke);
      useAppStore.getState().setUnifiedSelection(pageId, {
        strokeIds: [penStroke.id],
        textboxIds: [],
        imageIds: [],
      });
    });
    const tidyBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="ai-sidebar-tidy-handwriting-btn"]',
    )!;
    expect(tidyBtn.disabled).toBe(false);

    // Settings Modal: absent from General tab, present in AI & Providers tab
    const settingsDiv = document.createElement('div');
    document.body.appendChild(settingsDiv);
    const settingsRoot = createRoot(settingsDiv);
    await act(async () => {
      settingsRoot.render(<SettingsModal open={true} initialTab="general" onClose={() => {}} />);
    });
    expect(settingsDiv.querySelector('[data-testid="settings-handwriting-toggle"]')).toBeNull();

    await act(async () => {
      settingsDiv.querySelector<HTMLButtonElement>('[data-testid="settings-tab-ai"]')!.click();
    });
    expect(
      settingsDiv.querySelector('[data-testid="settings-handwriting-toggle"]'),
    ).not.toBeNull();
    expect(
      settingsDiv.querySelector('[data-testid="settings-handwriting-offline-fallback"]'),
    ).toBeNull();

    // Locking the notebook displays Vault-Locked · Blocked badge and disables on-demand tidying
    const wbId = useAppStore.getState().activeNotebook!.id;
    const rk = generateRecoveryKey();
    await act(async () => {
      await useAppStore.getState().setupVaultAndMaybeLockNotebook('vault-pass-99', rk, wbId);
      await useAppStore.getState().unlockNotebookWithPassword(wbId, 'vault-pass-99', 'open');
    });
    expect(
      container.querySelector('[data-testid="ai-handwriting-status-badge"]')?.textContent,
    ).toBe('Vault Locked · Blocked');

    await act(async () => {
      settingsRoot.unmount();
    });
    settingsDiv.remove();
  });

  it('unifies Pen & Highlighter color state across swatches, custom color picker, canvas strokes & 1–5 favorite slots', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    // Curated swatch bar has all 10 unified colors including Yellow (#FACC15)
    const swatchButtons = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="tool-color-swatches"] > button',
    );
    expect(swatchButtons.length).toBe(10);

    // Click Yellow while Pen is active
    const yellowBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label*="Yellow (#FACC15)"]',
    )!;
    expect(yellowBtn).not.toBeNull();
    await act(async () => {
      yellowBtn.click();
    });
    expect(useAppStore.getState().inkColor).toBe('#FACC15');
    expect(useAppStore.getState().penColor).toBe('#FACC15');
    expect(useAppStore.getState().highlighterColor).toBe('#FACC15');

    // Switch to Highlighter -> Yellow stays selected cleanly and renders multiply / screen blend
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Highlighter"]')!.click();
    });
    expect(useAppStore.getState().activeTool).toBe('highlighter');
    expect(useAppStore.getState().inkColor).toBe('#FACC15');
    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label*="Yellow (#FACC15)"]')!
        .getAttribute('aria-pressed'),
    ).toBe('true');

    const activeCanvas = container.querySelector<HTMLCanvasElement>(
      '[data-testid="active-canvas-1"]',
    )!;
    expect(activeCanvas.style.mixBlendMode).toBe('multiply');

    await act(async () => {
      dispatchPointer(activeCanvas, 'pointerdown', { clientX: 80, clientY: 160, pointerId: 1 });
      dispatchPointer(activeCanvas, 'pointermove', { clientX: 220, clientY: 160, pointerId: 1 });
      dispatchPointer(activeCanvas, 'pointerup', { clientX: 220, clientY: 160, pointerId: 1 });
    });
    expect(useAppStore.getState().pages[0].strokes[0]).toMatchObject({
      tool: 'highlighter',
      color: '#FACC15',
      opacity: 0.45,
    });

    // Dark paper flips Highlighter blend to screen
    await act(async () => {
      const page = useAppStore.getState().pages[0];
      await useAppStore.getState().applyPaperToPage(page.id, {
        ...page.paper,
        paperColor: '#131B2E',
      });
    });
    expect(activeCanvas.style.mixBlendMode).toBe('screen');

    // Custom color picker sets inkColor without overwriting any curated swatch
    const customInput = container.querySelector<HTMLInputElement>(
      '[data-testid="custom-ink-color-input"]',
    )!;
    const valSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      valSetter.call(customInput, '#14b8a6');
      customInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useAppStore.getState().inkColor).toBe('#14b8a6');
    expect(useAppStore.getState().inkSwatches).toEqual(UNIFIED_INK_SWATCHES);

    // Switching back to Pen keeps #14b8a6 and commits opaque Pen stroke
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Pen"]')!.click();
    });
    expect(useAppStore.getState().inkColor).toBe('#14b8a6');
    await act(async () => {
      dispatchPointer(activeCanvas, 'pointerdown', { clientX: 80, clientY: 220, pointerId: 2 });
      dispatchPointer(activeCanvas, 'pointermove', { clientX: 220, clientY: 220, pointerId: 2 });
      dispatchPointer(activeCanvas, 'pointerup', { clientX: 220, clientY: 220, pointerId: 2 });
    });
    expect(useAppStore.getState().pages[0].strokes[1]).toMatchObject({
      tool: 'pen',
      color: '#14b8a6',
      opacity: 1,
    });

    // Keys 1–5 favorite slots synchronize unified inkColor
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
    });
    expect(useAppStore.getState().activeTool).toBe('highlighter');
    expect(useAppStore.getState().inkColor).toBe('#FEF08A');
    expect(useAppStore.getState().penColor).toBe('#FEF08A');
  });

  it('supports Precision vs. Stroke Eraser toggle, S/M/L presets, single-step Undo carving, locked protection & whiteboard parity', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().pages[0].id;
    const unlockedStroke = makeHorizontalStroke('carve-me', 120, 40, 280, false);
    const lockedStroke = makeHorizontalStroke('keep-locked', 124, 40, 280, true);
    await act(async () => {
      useAppStore.getState().commitNewStroke(pageId, unlockedStroke);
      useAppStore.getState().commitNewStroke(pageId, lockedStroke);
    });

    // Bottom dock uses updated "Eraser (E)" label/title
    const eraserDockBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Eraser"]')!;
    expect(eraserDockBtn).not.toBeNull();
    expect(eraserDockBtn.title).toBe('Eraser (E)');

    await act(async () => {
      eraserDockBtn.click();
    });

    // Sub-bar defaults to Precision mode + M (18px)
    const precBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="eraser-mode-precision"]',
    )!;
    const strokeBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="eraser-mode-stroke"]',
    )!;
    expect(precBtn.getAttribute('aria-pressed')).toBe('true');
    expect(strokeBtn.getAttribute('aria-pressed')).toBe('false');
    expect(
      container
        .querySelector('[data-testid="eraser-size-m"]')!
        .getAttribute('aria-pressed'),
    ).toBe('true');

    const activeCanvas = container.querySelector<HTMLCanvasElement>(
      '[data-testid="active-canvas-1"]',
    )!;
    expect(activeCanvas.getAttribute('data-eraser-mode')).toBe('precision');
    expect(activeCanvas.getAttribute('data-eraser-radius')).toBe('18');
    expect(activeCanvas.className).toContain('cursor-none');

    // Drag Precision Eraser across middle of stroke (x=160, y=90 -> y=160) -> splits unlockedStroke into 2 pieces, preserves lockedStroke
    await act(async () => {
      dispatchPointer(activeCanvas, 'pointerdown', { clientX: 160, clientY: 90, pointerId: 3 });
      dispatchPointer(activeCanvas, 'pointermove', { clientX: 160, clientY: 160, pointerId: 3 });
      dispatchPointer(activeCanvas, 'pointerup', { clientX: 160, clientY: 160, pointerId: 3 });
    });

    const afterPrecision = useAppStore.getState().pages[0].strokes;
    expect(afterPrecision).toHaveLength(3); // left half + right half + locked
    expect(afterPrecision[0].points[afterPrecision[0].points.length - 1].x).toBeLessThan(145);
    expect(afterPrecision[1].points[0].x).toBeGreaterThan(175);
    expect(afterPrecision[2].id).toBe('keep-locked');

    // Single Ctrl+Z undo restores original intact stroke
    await act(async () => {
      useAppStore.getState().undo();
    });
    expect(useAppStore.getState().pages[0].strokes.map((s) => s.id)).toEqual([
      'carve-me',
      'keep-locked',
    ]);

    // Switching to Stroke mode persists to localStorage and deletes entire unlocked stroke on touch
    await act(async () => {
      strokeBtn.click();
    });
    expect(useAppStore.getState().eraserMode).toBe('stroke');
    expect(getWorkspacePreferences().eraserMode).toBe('stroke');
    expect(activeCanvas.getAttribute('data-eraser-mode')).toBe('stroke');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="eraser-size-s"]')!.click();
    });
    expect(useAppStore.getState().eraserSize).toBe(8);
    expect(activeCanvas.getAttribute('data-eraser-radius')).toBe('8');

    await act(async () => {
      dispatchPointer(activeCanvas, 'pointerdown', { clientX: 100, clientY: 120, pointerId: 4 });
      dispatchPointer(activeCanvas, 'pointerup', { clientX: 100, clientY: 120, pointerId: 4 });
    });
    expect(useAppStore.getState().pages[0].strokes.map((s) => s.id)).toEqual(['keep-locked']);

    // Works cleanly on Infinite Whiteboards too
    await act(async () => {
      useAppStore.getState().setEraserMode('precision');
      await useAppStore.getState().createNotebook({
        title: 'Eraser Whiteboard',
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
    const wbStroke = makeHorizontalStroke('wb-carve', 0, -200, 100, false);
    await act(async () => {
      useAppStore.getState().commitNewStroke(wbPageId, wbStroke);
      useAppStore.getState().setActiveTool('eraser');
    });

    const wbCanvas = container.querySelector<HTMLCanvasElement>('[data-testid="active-canvas-1"]')!;
    expect(wbCanvas.getAttribute('data-eraser-mode')).toBe('precision');
    expect(wbCanvas.getAttribute('data-eraser-radius')).toBe('8');

    // Origin on empty 1200x800 whiteboard sits at screen (600, 400); carving at world x=0, y=0 (screen 600, 400) splits wb-carve into 2!
    await act(async () => {
      dispatchPointer(wbCanvas, 'pointerdown', { clientX: 600, clientY: 360, pointerId: 5 });
      dispatchPointer(wbCanvas, 'pointermove', { clientX: 600, clientY: 440, pointerId: 5 });
      dispatchPointer(wbCanvas, 'pointerup', { clientX: 600, clientY: 440, pointerId: 5 });
    });
    expect(useAppStore.getState().pages[0].strokes).toHaveLength(2);
  });

  it('toggles fullscreen on F11 via desktop bridge and browser Fullscreen API fallback', async () => {
    const toggleFullscreenMock = vi.fn(async () => true);
    window.folioDesktop = {
      isElectron: true,
      platform: 'win32',
      setUiZoomFactor: (f) => f,
      getUiZoomFactor: () => 1,
      toggleFullscreen: toggleFullscreenMock,
      aiFetch: vi.fn(),
    };

    await act(async () => {
      root.render(<App />);
    });

    // F11 calls native Electron toggleFullscreen bridge
    const f11Ev = new KeyboardEvent('keydown', {
      key: 'F11',
      code: 'F11',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(f11Ev);
    });
    expect(f11Ev.defaultPrevented).toBe(true);
    expect(toggleFullscreenMock).toHaveBeenCalledTimes(1);

    // Repeat or modified F11 presses are ignored
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F11', code: 'F11', repeat: true, bubbles: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F11', code: 'F11', ctrlKey: true, bubbles: true }),
      );
    });
    expect(toggleFullscreenMock).toHaveBeenCalledTimes(1);

    // Web browser fallback when window.folioDesktop is absent
    delete window.folioDesktop;
    const origFsEnabled = Object.getOwnPropertyDescriptor(document, 'fullscreenEnabled');
    const origFsEl = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    const origReq = document.documentElement.requestFullscreen;
    const origExit = (document as { exitFullscreen?: () => Promise<void> }).exitFullscreen;

    const reqMock = vi.fn(async () => {});
    const exitMock = vi.fn(async () => {});
    let fsEl: Element | null = null;
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fsEl,
    });
    document.documentElement.requestFullscreen = reqMock as () => Promise<void>;
    (document as { exitFullscreen: () => Promise<void> }).exitFullscreen = exitMock;

    try {
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'F11', code: 'F11', bubbles: true, cancelable: true }),
        );
      });
      expect(reqMock).toHaveBeenCalledTimes(1);

      fsEl = document.documentElement;
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'F11', code: 'F11', bubbles: true, cancelable: true }),
        );
      });
      expect(exitMock).toHaveBeenCalledTimes(1);
    } finally {
      if (origFsEnabled) Object.defineProperty(document, 'fullscreenEnabled', origFsEnabled);
      else delete (document as { fullscreenEnabled?: boolean }).fullscreenEnabled;
      if (origFsEl) Object.defineProperty(document, 'fullscreenElement', origFsEl);
      else delete (document as { fullscreenElement?: Element | null }).fullscreenElement;
      document.documentElement.requestFullscreen = origReq;
      if (origExit) {
        (document as { exitFullscreen?: () => Promise<void> }).exitFullscreen = origExit;
      } else {
        delete (document as { exitFullscreen?: () => Promise<void> }).exitFullscreen;
      }
    }
  });

  it('hides the contextual sub-bar completely when Select (V), Text (T), or Lasso (L) has no selection', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    for (const idleTool of ['pan', 'text', 'lasso'] as const) {
      await act(async () => {
        useAppStore.getState().setActiveTool(idleTool);
      });
      expect(container.querySelector('[data-testid="contextual-subbar"]')).toBeNull();
    }

    await act(async () => {
      useAppStore.getState().setActiveTool('pen');
    });
    expect(container.querySelector('[data-testid="contextual-subbar"]')).not.toBeNull();

    await act(async () => {
      useAppStore.getState().setActiveTool('eraser');
    });
    expect(container.querySelector('[data-testid="contextual-subbar"]')).not.toBeNull();
  });

  it('streams AI handwriting correction live as you write the next word without cancelling in-flight requests or showing popup toasts', async () => {
    interface Deferred<T> {
      promise: Promise<T>;
      resolve: (v: T) => void;
    }
    const createDeferred = <T,>(): Deferred<T> => {
      let resolve!: (v: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };

    const deferredQueue: Array<
      Deferred<{ ok: boolean; status: number; statusText: string; bodyText: string }>
    > = [];
    const aiFetchMock = vi.fn().mockImplementation(() => {
      const d = createDeferred<{
        ok: boolean;
        status: number;
        statusText: string;
        bodyText: string;
      }>();
      deferredQueue.push(d);
      return d.promise;
    });

    const origPath2D = globalThis.Path2D;
    globalThis.Path2D = class MockPath2D {
      moveTo() {}
      lineTo() {}
      quadraticCurveTo() {}
      closePath() {}
    } as unknown as typeof Path2D;

    const ctxSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => {
        return {
          fillStyle: '#FFFFFF',
          strokeStyle: '#000000',
          lineWidth: 1,
          globalAlpha: 1,
          globalCompositeOperation: 'source-over',
          textBaseline: 'alphabetic',
          textAlign: 'left',
          font: '24px sans-serif',
          setTransform: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          scale: vi.fn(),
          translate: vi.fn(),
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          strokeRect: vi.fn(),
          fill: vi.fn(),
          stroke: vi.fn(),
          clip: vi.fn(),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          quadraticCurveTo: vi.fn(),
          arc: vi.fn(),
          closePath: vi.fn(),
          setLineDash: vi.fn(),
          measureText: vi.fn((t: string) => ({
            width: t.length * 10,
            fontBoundingBoxAscent: 18,
            fontBoundingBoxDescent: 4,
            actualBoundingBoxAscent: 14,
            actualBoundingBoxDescent: 2,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: t.length * 10,
          })),
          fillText: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
      });
    const toDataUrlSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,SldU');

    window.folioDesktop = {
      isElectron: true,
      platform: 'win32',
      setUiZoomFactor: (f) => f,
      getUiZoomFactor: () => 1,
      aiFetch: aiFetchMock,
    };

    function PageHarness() {
      const page = useAppStore((s) => s.pages[0]);
      if (!page) return null;
      return (
        <PageCanvas
          page={page}
          pageNumber={1}
          totalPages={1}
          zoom={1}
          spacePressed={false}
          onFocusPage={() => {}}
          onRecordCursorPoint={() => {}}
          onContextMenuRequest={() => {}}
        />
      );
    }

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await act(async () => {
        useAppStore.getState().setActiveAiProvider('grok');
        useAppStore.getState().setAiProviderKey('grok', 'xai-live-test');
        useAppStore.getState().setHandwritingCorrectionEnabled(true);
        useAppStore.getState().setActiveTool('pen');
        root.render(<PageHarness />);
      });

      const canvas = container.querySelector<HTMLCanvasElement>(
        '[data-testid="active-canvas-1"]',
      )!;
      expect(canvas).not.toBeNull();

      // Draw Word 1 at x=80..150, y=200..235 (7 points -> ready handwriting cluster)
      await act(async () => {
        dispatchPointer(canvas, 'pointerdown', { clientX: 80, clientY: 220, pointerId: 1 });
        for (const [px, py] of [
          [90, 205],
          [105, 230],
          [120, 205],
          [135, 230],
          [145, 210],
          [150, 225],
        ]) {
          dispatchPointer(canvas, 'pointermove', { clientX: px, clientY: py, pointerId: 1 });
        }
        dispatchPointer(canvas, 'pointerup', { clientX: 150, clientY: 225, pointerId: 1 });
      });

      expect(useAppStore.getState().pages[0].strokes).toHaveLength(1);
      expect(aiFetchMock).toHaveBeenCalledTimes(0);

      // Advance only 100ms (< 900ms trailing pause), then start Word 2 at x=200, y=215
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(aiFetchMock).toHaveBeenCalledTimes(0);

      await act(async () => {
        dispatchPointer(canvas, 'pointerdown', { clientX: 200, clientY: 215, pointerId: 2 });
        dispatchPointer(canvas, 'pointermove', { clientX: 218, clientY: 205, pointerId: 2 });
        dispatchPointer(canvas, 'pointermove', { clientX: 232, clientY: 230, pointerId: 2 });
      });

      // Word 1 fired immediately (0ms) as soon as Word 2 started!
      expect(aiFetchMock).toHaveBeenCalledTimes(1);

      // Resolve Word 1 AI response while Word 2 pointer is STILL down
      await act(async () => {
        deferredQueue[0].resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          bodyText: JSON.stringify({ choices: [{ message: { content: 'Hello' } }] }),
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      const word1Strokes = useAppStore.getState().pages[0].strokes;
      expect(word1Strokes.length).toBeGreaterThan(0);
      expect(word1Strokes.every((s) => s.tool === 'pen' && s.isTidied === true)).toBe(true);
      expect(useAppStore.getState().pages[0].textboxes ?? []).toHaveLength(0);
      expect(useAppStore.getState().handwritingTidyToast).toBeNull();
      const word1GroupId = word1Strokes[0].groupId;
      const word1Count = word1Strokes.length;

      // Finish drawing Word 2 and lift pen
      await act(async () => {
        for (const [px, py] of [
          [245, 205],
          [258, 228],
          [268, 208],
          [275, 225],
        ]) {
          dispatchPointer(canvas, 'pointermove', { clientX: px, clientY: py, pointerId: 2 });
        }
        dispatchPointer(canvas, 'pointerup', { clientX: 275, clientY: 225, pointerId: 2 });
      });

      const strokesWithRawWord2 = useAppStore.getState().pages[0].strokes;
      expect(strokesWithRawWord2).toHaveLength(word1Count + 1);
      expect(strokesWithRawWord2.filter((s) => !s.isTidied)).toHaveLength(1);
      expect(aiFetchMock).toHaveBeenCalledTimes(1);

      // Advance 900ms trailing pause -> Word 2 triggers automatically
      await act(async () => {
        vi.advanceTimersByTime(900);
      });
      expect(aiFetchMock).toHaveBeenCalledTimes(2);

      await act(async () => {
        deferredQueue[1].resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          bodyText: JSON.stringify({ choices: [{ message: { content: 'world' } }] }),
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      const finalStrokes = useAppStore.getState().pages[0].strokes;
      expect(finalStrokes.length).toBeGreaterThan(word1Count);
      expect(finalStrokes.every((s) => s.tool === 'pen' && s.isTidied === true)).toBe(true);
      const groupIds = new Set(finalStrokes.map((s) => s.groupId).filter(Boolean));
      expect(groupIds.size).toBe(2);
      expect(Boolean(word1GroupId && groupIds.has(word1GroupId))).toBe(true);
      expect(useAppStore.getState().pages[0].textboxes ?? []).toHaveLength(0);
      expect(useAppStore.getState().handwritingTidyToast).toBeNull();
    } finally {
      vi.useRealTimers();
      ctxSpy.mockReturnValue(null);
      toDataUrlSpy.mockRestore();
      globalThis.Path2D = origPath2D;
    }
  });
});
