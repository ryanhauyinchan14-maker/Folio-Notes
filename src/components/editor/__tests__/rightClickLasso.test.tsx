// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeBoundsFromPoints } from '../../../canvas/geometry';
import { useAppStore } from '../../../store/useAppStore';
import type { Stroke } from '../../../types/notes';
import { NotebookEditor } from '../NotebookEditor';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function dispatchPointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  opts: {
    clientX: number;
    clientY: number;
    button?: number;
    buttons?: number;
    pointerId?: number;
  },
): void {
  const Ctor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
  const ev = new Ctor(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX,
    clientY: opts.clientY,
    button: opts.button ?? 0,
    buttons: opts.buttons ?? (opts.button === 2 ? 2 : 1),
  });
  Object.defineProperty(ev, 'pointerId', { value: opts.pointerId ?? 1 });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
  target.dispatchEvent(ev);
}

function dispatchContextMenu(
  target: EventTarget,
  coords: { clientX: number; clientY: number },
): MouseEvent {
  const ev = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: coords.clientX,
    clientY: coords.clientY,
    button: 2,
  });
  target.dispatchEvent(ev);
  return ev;
}

function makeStroke(id: string, x1: number, y1: number, x2: number, y2: number): Stroke {
  const points = [
    { x: x1, y: y1, pressure: 0.5, t: 0 },
    { x: (x1 + x2) / 2, y: (y1 + y2) / 2, pressure: 0.5, t: 20 },
    { x: x2, y: y2, pressure: 0.5, t: 40 },
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
    createdAt: Date.now(),
  };
}

describe('v1.4.16 Right-click-hold temporary Lasso in Pen & Select vs selected element context menu', () => {
  let container: HTMLDivElement;
  let root: Root;
  const origImage = globalThis.Image;

  beforeEach(async () => {
    window.localStorage.clear();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    globalThis.Image = class MockImage {
      naturalWidth = 200;
      naturalHeight = 140;
      width = 200;
      height = 140;
      complete = true;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_val: string) {
        queueMicrotask(() => {
          this.onload?.();
        });
      }
    } as unknown as typeof Image;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const testid = this.dataset?.testid;
      if (
        testid === 'active-canvas-1' ||
        testid === 'static-canvas-1' ||
        testid === 'page-surface-1'
      ) {
        return {
          left: 0,
          top: 0,
          right: 816,
          bottom: 1056,
          width: 816,
          height: 1056,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        left: 0,
        top: 0,
        right: 120,
        bottom: 40,
        width: 120,
        height: 40,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      await useAppStore.getState().initApp();
      await useAppStore.getState().createNotebook({
        title: 'Right Click Lasso Notebook',
        folderId: null,
        cover: {
          styleId: 'classic-navy',
          primaryColor: '#1E3A5F',
          accentColor: '#60A5FA',
          pattern: 'spine-band',
        },
        paper: {
          sizePreset: 'letter',
          orientation: 'portrait',
          width: 816,
          height: 1056,
          pattern: 'ruled',
          spacing: 32,
          marginLine: true,
          paperColor: '#FFFFFF',
        },
        openImmediately: true,
      });
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    globalThis.Image = origImage;
    await useAppStore.getState().closeNotebook();
    vi.restoreAllMocks();
  });

  it('activates temporary Lasso while holding right click in Pen mode, selects enclosed strokes, and returns to Pen — while keeping right-click menu on selected stroke', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().activePageId!;
    const stroke = makeStroke('s-pen-1', 150, 150, 230, 150);

    await act(async () => {
      useAppStore.getState().setActiveTool('pen');
      useAppStore.getState().commitNewStroke(pageId, stroke);
    });

    const canvas = container.querySelector<HTMLCanvasElement>('[data-testid="active-canvas-1"]')!;
    const penBtn = () => container.querySelector<HTMLButtonElement>('button[aria-label="Pen"]')!;
    const lassoBtn = () => container.querySelector<HTMLButtonElement>('button[aria-label="Lasso"]')!;

    expect(penBtn().getAttribute('aria-pressed')).toBe('true');
    expect(canvas.dataset.rightClickLasso).toBe('false');

    // Right-click directly over unselected stroke in Pen mode -> enters temporary Lasso (does NOT open context menu)
    await act(async () => {
      dispatchPointer(canvas, 'pointerdown', { clientX: 140, clientY: 145, button: 2 });
    });

    expect(canvas.dataset.rightClickLasso).toBe('true');
    expect(lassoBtn().getAttribute('aria-pressed')).toBe('true');
    expect(penBtn().getAttribute('aria-pressed')).toBe('false');
    expect(useAppStore.getState().activeTool).toBe('pen');
    expect(container.querySelector('[data-testid="canvas-context-menu"]')).toBeNull();

    // Drag polygon enclosing s-pen-1 (150..230, 150)
    await act(async () => {
      dispatchPointer(window, 'pointermove', { clientX: 250, clientY: 120, button: 2 });
      dispatchPointer(window, 'pointermove', { clientX: 250, clientY: 185, button: 2 });
      dispatchPointer(window, 'pointermove', { clientX: 130, clientY: 185, button: 2 });
      dispatchPointer(window, 'pointermove', { clientX: 130, clientY: 120, button: 2 });
    });

    // Release right click & dispatch trailing contextmenu event
    await act(async () => {
      dispatchPointer(window, 'pointerup', { clientX: 130, clientY: 120, button: 2, buttons: 0 });
    });
    let trailingMenuEv!: MouseEvent;
    await act(async () => {
      trailingMenuEv = dispatchContextMenu(canvas, { clientX: 130, clientY: 120 });
    });

    expect(trailingMenuEv.defaultPrevented).toBe(true);
    expect(canvas.dataset.rightClickLasso).toBe('false');
    expect(penBtn().getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="canvas-context-menu"]')).toBeNull();
    expect(useAppStore.getState().lassoSelection?.strokeIds).toEqual(['s-pen-1']);

    // Now stroke is in "clicked on"/selected mode -> right-clicking selection box keeps CanvasContextMenu
    const lassoBox = container.querySelector<HTMLElement>('[data-testid="lasso-selection-box"]')!;
    expect(lassoBox).not.toBeNull();

    await act(async () => {
      dispatchPointer(lassoBox, 'pointerdown', { clientX: 190, clientY: 150, button: 2 });
      dispatchPointer(lassoBox, 'pointerup', {
        clientX: 190,
        clientY: 150,
        button: 2,
        buttons: 0,
      });
      dispatchContextMenu(lassoBox, { clientX: 190, clientY: 150 });
    });

    expect(canvas.dataset.rightClickLasso).toBe('false');
    const menu = container.querySelector('[data-testid="canvas-context-menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain('Copy');
    expect(menu?.textContent).toContain('Duplicate');
    expect(menu?.textContent).toContain('Tidy Handwriting (AI)');
    expect(menu?.textContent).toContain('Ask AI');
    expect(menu?.textContent).toContain('Math Hint');
    expect(menu?.textContent).toContain('Transcribe');
    expect(menu?.textContent).toContain('Delete');
  });

  it('activates temporary Lasso on right click in Select mode even over unselected elements, while preserving menu on clicked/selected textbox & image', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().activePageId!;
    const stroke = makeStroke('s-sel-1', 420, 420, 500, 420);
    let tbId = '';
    const imgId = 'img-sel-1';

    await act(async () => {
      useAppStore.getState().setActiveTool('pan');
      useAppStore.getState().commitNewStroke(pageId, stroke);
      const tb = useAppStore.getState().spawnTextbox({
        pageId,
        x: 380,
        y: 380,
        initialText: 'Note Block',
        fontSize: 20,
      })!;
      tbId = tb.id;
      useAppStore.getState().commitTextboxSession(pageId, tb.id, false);
      useAppStore.getState().addPageImages(pageId, [
        {
          id: imgId,
          dataUrl: 'data:image/png;base64,AA==',
          naturalWidth: 200,
          naturalHeight: 140,
          x: 80,
          y: 80,
          width: 140,
          height: 100,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          borderRadius: 0,
          opacity: 1,
          flipX: false,
          flipY: false,
          zIndex: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);
      useAppStore.getState().clearSelection();
    });

    const canvas = container.querySelector<HTMLCanvasElement>('[data-testid="active-canvas-1"]')!;
    const selectBtn = () => container.querySelector<HTMLButtonElement>('button[aria-label="Select"]')!;
    const lassoBtn = () => container.querySelector<HTMLButtonElement>('button[aria-label="Lasso"]')!;
    const tbHit = container.querySelector<HTMLElement>(`[data-testid="textbox-hit-${tbId}"]`)!;
    const imgHit = container.querySelector<HTMLElement>(`[data-testid="image-hit-${imgId}"]`)!;
    expect(tbHit).not.toBeNull();
    expect(imgHit).not.toBeNull();

    // Right-click hold starting directly on UNSELECTED textbox -> enters Lasso and selects enclosed stroke
    await act(async () => {
      dispatchPointer(tbHit, 'pointerdown', { clientX: 390, clientY: 390, button: 2 });
    });
    expect(canvas.dataset.rightClickLasso).toBe('true');
    expect(lassoBtn().getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      dispatchPointer(window, 'pointermove', { clientX: 520, clientY: 390, button: 2 });
      dispatchPointer(window, 'pointermove', { clientX: 520, clientY: 460, button: 2 });
      dispatchPointer(window, 'pointermove', { clientX: 390, clientY: 460, button: 2 });
      dispatchPointer(window, 'pointerup', { clientX: 390, clientY: 460, button: 2, buttons: 0 });
      dispatchContextMenu(tbHit, { clientX: 390, clientY: 460 });
    });

    expect(canvas.dataset.rightClickLasso).toBe('false');
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="canvas-context-menu"]')).toBeNull();
    expect(useAppStore.getState().lassoSelection?.strokeIds).toEqual(['s-sel-1']);

    // Right-click starting on UNSELECTED image also enters temporary Lasso (not image context menu)
    await act(async () => {
      useAppStore.getState().clearSelection();
    });
    const imgHit2 = container.querySelector<HTMLElement>(`[data-testid="image-hit-${imgId}"]`)!;
    await act(async () => {
      dispatchPointer(imgHit2, 'pointerdown', { clientX: 100, clientY: 100, button: 2 });
    });
    expect(canvas.dataset.rightClickLasso).toBe('true');
    await act(async () => {
      dispatchPointer(window, 'pointerup', { clientX: 110, clientY: 110, button: 2, buttons: 0 });
      dispatchContextMenu(imgHit2, { clientX: 110, clientY: 110 });
    });
    expect(canvas.dataset.rightClickLasso).toBe('false');
    expect(container.querySelector('[data-testid="canvas-context-menu"]')).toBeNull();

    // Now select the textbox ("clicked on" mode) and right-click it -> keeps CanvasContextMenu
    await act(async () => {
      useAppStore.getState().selectTextbox(tbId);
    });
    const tbBox = container.querySelector<HTMLElement>('[data-testid="textbox-box"]')!;
    expect(tbBox).not.toBeNull();
    await act(async () => {
      dispatchPointer(tbBox, 'pointerdown', { clientX: 395, clientY: 395, button: 2 });
      dispatchPointer(tbBox, 'pointerup', { clientX: 395, clientY: 395, button: 2, buttons: 0 });
      dispatchContextMenu(tbBox, { clientX: 395, clientY: 395 });
    });
    expect(canvas.dataset.rightClickLasso).toBe('false');
    expect(container.querySelector('[data-testid="canvas-context-menu"]')).not.toBeNull();

    // Now select the image ("clicked on" mode) and right-click it -> keeps CanvasContextMenu
    await act(async () => {
      useAppStore.getState().selectImage(imgId);
    });
    const imgBox = container.querySelector<HTMLElement>('[data-testid="image-box"]')!;
    expect(imgBox).not.toBeNull();
    await act(async () => {
      dispatchPointer(imgBox, 'pointerdown', { clientX: 120, clientY: 120, button: 2 });
      dispatchPointer(imgBox, 'pointerup', { clientX: 120, clientY: 120, button: 2, buttons: 0 });
      dispatchContextMenu(imgBox, { clientX: 120, clientY: 120 });
    });
    expect(canvas.dataset.rightClickLasso).toBe('false');
    const imgMenu = container.querySelector('[data-testid="canvas-context-menu"]');
    expect(imgMenu).not.toBeNull();
    expect(imgMenu?.textContent).toContain('Crop Photo');
  });

  it('does not trigger right-click lasso in Highlighter mode', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    await act(async () => {
      useAppStore.getState().setActiveTool('highlighter');
    });

    const canvas = container.querySelector<HTMLCanvasElement>('[data-testid="active-canvas-1"]')!;
    await act(async () => {
      dispatchPointer(canvas, 'pointerdown', { clientX: 200, clientY: 200, button: 2 });
    });
    expect(canvas.dataset.rightClickLasso).toBe('false');
    await act(async () => {
      dispatchPointer(window, 'pointerup', { clientX: 200, clientY: 200, button: 2, buttons: 0 });
    });
  });
});
