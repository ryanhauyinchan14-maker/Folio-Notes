// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeBoundsFromPoints } from '../../../canvas/geometry';
import { DEFAULT_PAPER_CONFIG } from '../../../constants/papers';
import { repository } from '../../../db/repository';
import { useAppStore } from '../../../store/useAppStore';
import type { Stroke } from '../../../types/notes';
import { COLOR_PICKER_DEBOUNCE_MS } from '../../common/DebouncedColorInput';
import { ContextualSubBar } from '../ContextualSubBar';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function makeTestStroke(id: string, color = '#072D59'): Stroke {
  const points = [
    { x: 40, y: 80, pressure: 0.5, t: 0 },
    { x: 140, y: 80, pressure: 0.5, t: 20 },
    { x: 240, y: 80, pressure: 0.5, t: 40 },
  ];
  return {
    id,
    tool: 'pen',
    color,
    size: 4,
    opacity: 1,
    simulatePressure: false,
    points,
    bounds: computeBoundsFromPoints(points, 4),
    createdAt: Date.now(),
  };
}

const SubBarHarness: React.FC = () => {
  const pages = useAppStore((s) => s.pages);
  const activePageId = useAppStore((s) => s.activePageId);
  const activePage = pages.find((p) => p.id === activePageId) ?? null;
  return <ContextualSubBar activePage={activePage} />;
};

describe('Custom color picker debounce, stroke cache preservation & 1-step Undo batching', () => {
  let container: HTMLDivElement;
  let root: Root;
  let pageId: string;

  beforeEach(async () => {
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      await useAppStore.getState().initApp();
      await useAppStore.getState().createNotebook({
        title: 'Color Picker Debounce Test',
        folderId: null,
        cover: {
          styleId: 'classic-navy',
          primaryColor: '#072D59',
          accentColor: '#DBF2FC',
          pattern: 'solid',
        },
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: true,
      });
    });

    pageId = useAppStore.getState().activePageId!;
  });

  afterEach(async () => {
    vi.clearAllTimers();
    vi.useRealTimers();
    try {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      await useAppStore.getState().closeNotebook();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('keeps drawing untouched while dragging, previews 100ms after stopping, preserves points ref, and commits 1 Undo + 1 save', async () => {
    const initialStroke = makeTestStroke('stroke-recolor-1', '#072D59');
    const originalPointsRef = initialStroke.points;
    const saveSpy = vi.spyOn(repository, 'savePageStrokes').mockResolvedValue();

    await act(async () => {
      useAppStore.getState().commitNewStroke(pageId, initialStroke);
      useAppStore.getState().setUnifiedSelection(pageId, {
        strokeIds: [initialStroke.id],
        textboxIds: [],
        imageIds: [],
      });
      root.render(<SubBarHarness />);
    });

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="custom-recolor-input"]',
    )!;
    expect(input).not.toBeNull();

    const valSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    saveSpy.mockClear();
    const initialUndoCount = useAppStore.getState().undoStack.length;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const fireInput = (hex: string) => {
      valSetter.call(input, hex);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    // Rapid drag events every 40ms (< 100ms): drawing must stay at original color
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#7d3169']) {
      await act(async () => {
        fireInput(hex);
        vi.advanceTimersByTime(40);
      });
      expect(useAppStore.getState().pages[0].strokes[0].color).toBe('#072D59');
      expect(saveSpy).toHaveBeenCalledTimes(0);
      expect(useAppStore.getState().undoStack.length).toBe(initialUndoCount);
    }

    // 40ms elapsed above; advance 59ms -> 99ms total since last input: still untouched
    await act(async () => {
      vi.advanceTimersByTime(59);
    });
    expect(useAppStore.getState().pages[0].strokes[0].color).toBe('#072D59');

    // Advance 2ms -> 101ms total (> 100ms debounce): drawing previews #7d3169 with zero save/undo
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(COLOR_PICKER_DEBOUNCE_MS).toBe(100);
    expect(useAppStore.getState().pages[0].strokes[0].color).toBe('#7d3169');
    expect(useAppStore.getState().pages[0].strokes[0].points).toBe(originalPointsRef);
    expect(saveSpy).toHaveBeenCalledTimes(0);
    expect(useAppStore.getState().undoStack.length).toBe(initialUndoCount);

    // Drag again to #112233 -> #445566 and pause 105ms
    await act(async () => {
      fireInput('#112233');
      vi.advanceTimersByTime(30);
      fireInput('#445566');
    });
    expect(useAppStore.getState().pages[0].strokes[0].color).toBe('#7d3169');

    await act(async () => {
      vi.advanceTimersByTime(105);
    });
    expect(useAppStore.getState().pages[0].strokes[0].color).toBe('#445566');
    expect(useAppStore.getState().pages[0].strokes[0].points).toBe(originalPointsRef);
    expect(saveSpy).toHaveBeenCalledTimes(0);
    expect(useAppStore.getState().undoStack.length).toBe(initialUndoCount);

    // Close picker -> native 'change' commits 1 Undo step + 1 IndexedDB save
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useAppStore.getState().pages[0].strokes[0].color).toBe('#445566');
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().undoStack.length).toBe(initialUndoCount + 1);

    // Single Ctrl+Z / undo reverts directly to initial #072D59
    await act(async () => {
      useAppStore.getState().undo();
    });
    expect(useAppStore.getState().pages[0].strokes[0].color).toBe('#072D59');
  });

  it('commits immediately on quick click-and-close before the 100ms debounce expires', async () => {
    const initialStroke = makeTestStroke('stroke-quick-pick', '#072D59');
    const saveSpy = vi.spyOn(repository, 'savePageStrokes').mockResolvedValue();

    await act(async () => {
      useAppStore.getState().commitNewStroke(pageId, initialStroke);
      useAppStore.getState().setUnifiedSelection(pageId, {
        strokeIds: [initialStroke.id],
        textboxIds: [],
        imageIds: [],
      });
      root.render(<SubBarHarness />);
    });

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="custom-recolor-input"]',
    )!;
    const valSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    saveSpy.mockClear();
    const initialUndoCount = useAppStore.getState().undoStack.length;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await act(async () => {
      valSetter.call(input, '#fd6e88');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(20);
    });
    expect(useAppStore.getState().pages[0].strokes[0].color).toBe('#072D59');

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(useAppStore.getState().pages[0].strokes[0].color).toBe('#fd6e88');
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().undoStack.length).toBe(initialUndoCount + 1);
  });

  it('debounces selected textbox custom color while dragging and commits 1 Undo + 1 save on close', async () => {
    const saveSpy = vi.spyOn(repository, 'savePageStrokes').mockResolvedValue();
    let tbId = '';
    await act(async () => {
      const tb = useAppStore.getState().spawnTextbox({
        pageId,
        x: 100,
        y: 120,
        initialText: 'Header',
        fontSize: 24,
        color: '#072D59',
      })!;
      tbId = tb.id;
      useAppStore.getState().commitTextboxSession(pageId, tbId, true);
      root.render(<SubBarHarness />);
    });

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="custom-text-color-input"]',
    )!;
    expect(input).not.toBeNull();

    const valSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    saveSpy.mockClear();
    const initialUndoCount = useAppStore.getState().undoStack.length;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await act(async () => {
      valSetter.call(input, '#aa1122');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(50);
      valSetter.call(input, '#1188aa');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(50);
    });
    expect(useAppStore.getState().pages[0].textboxes![0].color).toBe('#072D59');
    expect(saveSpy).toHaveBeenCalledTimes(0);

    await act(async () => {
      vi.advanceTimersByTime(60);
    });
    expect(useAppStore.getState().pages[0].textboxes![0].color).toBe('#1188aa');
    expect(saveSpy).toHaveBeenCalledTimes(0);
    expect(useAppStore.getState().undoStack.length).toBe(initialUndoCount);

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().undoStack.length).toBe(initialUndoCount + 1);

    await act(async () => {
      useAppStore.getState().undo();
    });
    expect(useAppStore.getState().pages[0].textboxes![0].color).toBe('#072D59');
  });
});
