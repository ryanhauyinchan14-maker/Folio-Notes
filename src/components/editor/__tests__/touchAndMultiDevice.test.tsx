// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WHITEBOARD_PAPER } from '../../../canvas/whiteboard';
import { COVER_PRESETS } from '../../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../../constants/papers';
import { useAppStore } from '../../../store/useAppStore';
import { PageCanvas } from '../PageCanvas';
import { WhiteboardCanvas, type WhiteboardCanvasHandle } from '../WhiteboardCanvas';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function dispatchTouchPointer(
  target: EventTarget,
  type: string,
  opts: {
    clientX: number;
    clientY: number;
    pointerId: number;
    pointerType?: string;
    button?: number;
  },
): void {
  const Ctor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
  const ev = new Ctor(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX,
    clientY: opts.clientY,
    button: opts.button ?? 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    ...(typeof PointerEvent !== 'undefined'
      ? {
          pointerId: opts.pointerId,
          pointerType: opts.pointerType ?? 'touch',
        }
      : {}),
  });
  if (typeof PointerEvent === 'undefined') {
    Object.defineProperty(ev, 'pointerId', { value: opts.pointerId });
    Object.defineProperty(ev, 'pointerType', { value: opts.pointerType ?? 'touch' });
  }
  target.dispatchEvent(ev);
}

describe('Touch, Stylus & Multi-Device Pinch-Zoom Support', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('aborts accidental 1-finger stroke when a 2nd finger touches down for pinch/scroll while keeping single stylus/touch strokes intact', async () => {
    await act(async () => {
      await useAppStore.getState().initApp();
      await useAppStore.getState().createNotebook({
        title: 'Touch Pinch Guard',
        folderId: null,
        cover: COVER_PRESETS[0].cover,
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: true,
      });
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

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
          measureText: vi.fn(() => ({ width: 20 })),
          fillText: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
      });

    function Harness() {
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

    try {
      await act(async () => {
        useAppStore.getState().setActiveTool('pen');
        root.render(<Harness />);
      });

      const canvas = container.querySelector<HTMLCanvasElement>('[data-testid="active-canvas-1"]')!;
      expect(canvas).not.toBeNull();

      // 1. Two-finger pinch sequence: finger 1 down, move, finger 2 down -> aborts accidental stroke
      await act(async () => {
        dispatchTouchPointer(canvas, 'pointerdown', {
          clientX: 120,
          clientY: 200,
          pointerId: 101,
          pointerType: 'touch',
        });
        dispatchTouchPointer(canvas, 'pointermove', {
          clientX: 130,
          clientY: 205,
          pointerId: 101,
          pointerType: 'touch',
        });
        dispatchTouchPointer(canvas, 'pointerdown', {
          clientX: 240,
          clientY: 200,
          pointerId: 102,
          pointerType: 'touch',
        });
        dispatchTouchPointer(canvas, 'pointerup', {
          clientX: 130,
          clientY: 205,
          pointerId: 101,
          pointerType: 'touch',
        });
        dispatchTouchPointer(canvas, 'pointerup', {
          clientX: 240,
          clientY: 200,
          pointerId: 102,
          pointerType: 'touch',
        });
      });

      expect(useAppStore.getState().pages[0].strokes).toHaveLength(0);

      // 2. Single Apple Pencil / stylus stroke commits cleanly
      await act(async () => {
        dispatchTouchPointer(canvas, 'pointerdown', {
          clientX: 100,
          clientY: 160,
          pointerId: 201,
          pointerType: 'pen',
        });
        dispatchTouchPointer(canvas, 'pointermove', {
          clientX: 180,
          clientY: 190,
          pointerId: 201,
          pointerType: 'pen',
        });
        dispatchTouchPointer(canvas, 'pointerup', {
          clientX: 180,
          clientY: 190,
          pointerId: 201,
          pointerType: 'pen',
        });
      });

      expect(useAppStore.getState().pages[0].strokes).toHaveLength(1);
    } finally {
      await act(async () => {
        root.unmount();
      });
      await useAppStore.getState().closeNotebook();
      container.remove();
      ctxSpy.mockRestore();
      globalThis.Path2D = origPath2D;
    }
  });

  it('supports two-finger touch pinch-to-zoom and pan on WhiteboardCanvas without leaving stray strokes', async () => {
    await act(async () => {
      await useAppStore.getState().initApp();
      await useAppStore.getState().createNotebook({
        title: 'Touch Whiteboard Pinch',
        mode: 'whiteboard',
        folderId: null,
        cover: COVER_PRESETS[0].cover,
        paper: { ...DEFAULT_WHITEBOARD_PAPER },
        openImmediately: true,
      });
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const wbRef = { current: null as WhiteboardCanvasHandle | null };

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
          measureText: vi.fn(() => ({ width: 20 })),
          fillText: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
      });

    function WbHarness() {
      const page = useAppStore((s) => s.pages[0]);
      if (!page) return null;
      return (
        <WhiteboardCanvas
          ref={(node) => {
            wbRef.current = node;
          }}
          page={page}
          spacePressed={false}
          onFocusPage={() => {}}
          onRecordCursorPoint={() => {}}
          onContextMenuRequest={() => {}}
        />
      );
    }

    try {
      await act(async () => {
        useAppStore.getState().setActiveTool('pen');
        root.render(<WbHarness />);
      });

      const viewport = container.querySelector<HTMLElement>('[data-whiteboard-viewport="true"]')!;
      const initialZoom = wbRef.current!.getCamera().zoom;

      // Spread two fingers apart -> zoom in smoothly
      await act(async () => {
        dispatchTouchPointer(viewport, 'pointerdown', {
          clientX: 300,
          clientY: 300,
          pointerId: 301,
          pointerType: 'touch',
        });
        dispatchTouchPointer(viewport, 'pointerdown', {
          clientX: 400,
          clientY: 300,
          pointerId: 302,
          pointerType: 'touch',
        });
        dispatchTouchPointer(viewport, 'pointermove', {
          clientX: 250,
          clientY: 300,
          pointerId: 301,
          pointerType: 'touch',
        });
        dispatchTouchPointer(viewport, 'pointermove', {
          clientX: 450,
          clientY: 300,
          pointerId: 302,
          pointerType: 'touch',
        });
        dispatchTouchPointer(viewport, 'pointerup', {
          clientX: 250,
          clientY: 300,
          pointerId: 301,
          pointerType: 'touch',
        });
        dispatchTouchPointer(viewport, 'pointerup', {
          clientX: 450,
          clientY: 300,
          pointerId: 302,
          pointerType: 'touch',
        });
      });

      expect(wbRef.current!.getCamera().zoom).toBeGreaterThan(initialZoom * 1.4);
      expect(useAppStore.getState().pages[0].strokes).toHaveLength(0);
    } finally {
      await act(async () => {
        root.unmount();
      });
      await useAppStore.getState().closeNotebook();
      container.remove();
      ctxSpy.mockRestore();
      globalThis.Path2D = origPath2D;
    }
  });
});
