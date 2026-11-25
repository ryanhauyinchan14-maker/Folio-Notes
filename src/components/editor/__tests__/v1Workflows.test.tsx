import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeBoundsFromPoints } from '../../../canvas/geometry';
import { useAppStore } from '../../../store/useAppStore';
import type { Stroke } from '../../../types/notes';
import { SettingsModal } from '../../modals/SettingsModal';
import { NotebookEditor } from '../NotebookEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makePngBlob(): File {
  const pngBytes = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
    0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 11, 73, 68, 65, 84,
    120, 156, 99, 96, 0, 0, 0, 2, 0, 1, 226, 33, 188, 51, 0, 0, 0, 0, 73, 69,
    78, 68, 174, 66, 96, 130,
  ]);
  return new File([pngBytes], 'diagram.png', { type: 'image/png' });
}

function dispatchPointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  coords: {
    clientX: number;
    clientY: number;
    button?: number;
    shiftKey?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
  },
): void {
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: coords.clientX,
    clientY: coords.clientY,
    button: coords.button ?? 0,
    shiftKey: coords.shiftKey ?? false,
    altKey: coords.altKey ?? false,
    ctrlKey: coords.ctrlKey ?? false,
  });
  Object.defineProperty(evt, 'pointerId', { value: 1 });
  Object.defineProperty(evt, 'pointerType', { value: 'mouse' });
  target.dispatchEvent(evt);
}

function buildTestStroke(id: string, x1: number, y1: number, x2: number, y2: number): Stroke {
  const points = [
    { x: x1, y: y1, pressure: 0.5 },
    { x: (x1 + x2) / 2, y: (y1 + y2) / 2, pressure: 0.5 },
    { x: x2, y: y2, pressure: 0.5 },
  ];
  return {
    id,
    tool: 'pen',
    color: '#072D59',
    size: 4,
    opacity: 1,
    simulatePressure: false,
    points,
    bounds: computeBoundsFromPoints(points, 2.4),
    createdAt: Date.now(),
  };
}

describe('v1.0 Universal Select, Grouping, Locking, Alignment, Shortcuts & Tabbed Settings', () => {
  let container: HTMLDivElement;
  let root: Root;
  const origImage = globalThis.Image;
  let origGetBCR: typeof HTMLElement.prototype.getBoundingClientRect;

  beforeEach(async () => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    origGetBCR = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (
        this.dataset?.testid === 'active-canvas-1' ||
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

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      await useAppStore.getState().initApp();
      await useAppStore.getState().createNotebook({
        title: 'v1 Workflow Notebook',
        folderId: null,
        cover: {
          styleId: 'classic-navy',
          primaryColor: '#072D59',
          accentColor: '#DBF2FC',
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

  it('supports direct element-by-element scribble dragging, corner scaling & undo with V tool', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().activePageId!;
    const s1 = buildTestStroke('stroke-alpha', 100, 120, 200, 120);
    await act(async () => {
      useAppStore.getState().commitNewStroke(pageId, s1);
      useAppStore.getState().setActiveTool('pan');
    });

    const canvas = container.querySelector<HTMLElement>(
      '[data-testid="active-canvas-1"]',
    )!;
    expect(canvas).not.toBeNull();

    // Drag directly on the unselected stroke in ONE continuous motion
    await act(async () => {
      dispatchPointer(canvas, 'pointerdown', { clientX: 150, clientY: 122 });
    });
    await act(async () => {
      dispatchPointer(window, 'pointermove', { clientX: 210, clientY: 162 });
    });
    await act(async () => {
      dispatchPointer(window, 'pointerup', { clientX: 210, clientY: 162 });
    });

    const moved = useAppStore.getState().pages[0].strokes.find((s) => s.id === 'stroke-alpha')!;
    expect(moved.points[0].x).toBeCloseTo(160, 0);
    expect(moved.points[0].y).toBeCloseTo(160, 0);

    // Lasso/Stroke box must stay active with corner scale handles
    const brHandle = container.querySelector<HTMLElement>(
      '[data-testid="stroke-handle-br"]',
    )!;
    expect(brHandle).not.toBeNull();

    await act(async () => {
      dispatchPointer(brHandle, 'pointerdown', { clientX: 260, clientY: 160 });
    });
    await act(async () => {
      dispatchPointer(brHandle, 'pointermove', { clientX: 340, clientY: 160 });
    });
    await act(async () => {
      dispatchPointer(brHandle, 'pointerup', { clientX: 340, clientY: 160 });
    });

    const scaled = useAppStore.getState().pages[0].strokes.find((s) => s.id === 'stroke-alpha')!;
    expect(scaled.bounds.maxX - scaled.bounds.minX).toBeGreaterThan(
      moved.bounds.maxX - moved.bounds.minX + 40,
    );
  });

  it('supports marquee drag-box, Shift+Click multi-select, mixed Group/Ungroup, Align, Lock, and AI shortcut isolation', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().activePageId!;
    const s1 = buildTestStroke('s-marquee', 90, 100, 170, 100);

    await act(async () => {
      useAppStore.getState().commitNewStroke(pageId, s1);
      const tb = useAppStore.getState().spawnTextbox({
        pageId,
        x: 120,
        y: 160,
        initialText: 'Grouped Header',
        fontSize: 24,
      })!;
      useAppStore.getState().commitTextboxSession(pageId, tb.id, false);
    });

    // Also add an image via file input
    const fileInput = container.querySelector<HTMLInputElement>(
      '[data-testid="image-file-input"]',
    )!;
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [makePngBlob()],
    });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 40));
    });

    const imgId = useAppStore.getState().pages[0].images![0].id;
    const tbId = useAppStore.getState().pages[0].textboxes![0].id;

    // Put elements cleanly inside marquee region [80..260, 80..240]
    await act(async () => {
      useAppStore.getState().commitImageMutation(pageId, imgId, {
        x: 150,
        y: 180,
        width: 80,
        height: 50,
      });
      useAppStore.getState().clearSelection();
      useAppStore.getState().setActiveTool('pan');
    });

    const canvas = container.querySelector<HTMLElement>(
      '[data-testid="active-canvas-1"]',
    )!;

    // 1. Marquee drag on empty paper around all 3 elements
    await act(async () => {
      dispatchPointer(canvas, 'pointerdown', { clientX: 60, clientY: 60 });
    });
    await act(async () => {
      dispatchPointer(window, 'pointermove', { clientX: 280, clientY: 260 });
    });
    expect(
      container.querySelector('[data-testid="marquee-selection-rect"]'),
    ).not.toBeNull();
    await act(async () => {
      dispatchPointer(window, 'pointerup', { clientX: 280, clientY: 260 });
    });

    // All 3 elements selected in multi-selection mode
    expect(useAppStore.getState().lassoSelection?.strokeIds).toEqual(['s-marquee']);
    expect(useAppStore.getState().selectedTextboxIds).toEqual([tbId]);
    expect(useAppStore.getState().selectedImageIds).toEqual([imgId]);
    expect(container.querySelector('[data-testid="multi-selection-box"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="contextual-subbar"]')?.getAttribute('data-mode'),
    ).toBe('multi');

    // 2. Shift+Click toggles textbox out, then back in
    await act(async () => {
      useAppStore.getState().toggleElementInSelection(pageId, { kind: 'textbox', id: tbId });
    });
    expect(useAppStore.getState().selectedTextboxIds).toEqual([]);
    await act(async () => {
      useAppStore.getState().toggleElementInSelection(pageId, { kind: 'textbox', id: tbId });
    });
    expect(useAppStore.getState().selectedTextboxIds).toEqual([tbId]);

    // 3. Align Left puts image, stroke, and textbox on the shared leftmost edge
    const alignLeftBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="align-left-btn"]',
    )!;
    expect(alignLeftBtn).not.toBeNull();
    await act(async () => {
      alignLeftBtn.click();
    });
    const alignedPage = useAppStore.getState().pages[0];
    expect(alignedPage.textboxes![0].x).toBeCloseTo(alignedPage.strokes[0].bounds.minX, 0);
    expect(alignedPage.images![0].x).toBeCloseTo(alignedPage.strokes[0].bounds.minX, 0);

    // 4. Group with Ctrl+G -> clears selection, click single textbox selects entire group
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true }),
      );
    });
    const groupedPage = useAppStore.getState().pages[0];
    const gid = groupedPage.textboxes![0].groupId;
    expect(gid).toBeTruthy();
    expect(groupedPage.strokes[0].groupId).toBe(gid);
    expect(groupedPage.images![0].groupId).toBe(gid);

    await act(async () => {
      useAppStore.getState().clearSelection();
      useAppStore.getState().selectTextbox(tbId);
    });
    expect(useAppStore.getState().lassoSelection?.strokeIds).toEqual(['s-marquee']);
    expect(useAppStore.getState().selectedImageIds).toEqual([imgId]);

    // Double-clicking grouped textbox edits it without breaking groupId
    await act(async () => {
      useAppStore.getState().beginEditTextbox(pageId, tbId);
      useAppStore.getState().updateTextboxLive(pageId, tbId, { text: 'Edited Inside Group' });
      useAppStore.getState().commitTextboxSession(pageId, tbId, true);
    });
    expect(useAppStore.getState().pages[0].textboxes![0].groupId).toBe(gid);

    // 5. Lock toggle protects against nudge, erase, and delete
    await act(async () => {
      useAppStore.getState().selectTextbox(tbId);
    });
    const lockBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="subbar-lock-toggle"]',
    )!;
    await act(async () => {
      lockBtn.click();
    });
    expect(useAppStore.getState().pages[0].strokes[0].locked).toBe(true);
    expect(container.querySelector('[data-testid="element-lock-badge"]')).not.toBeNull();

    const beforeLockX = useAppStore.getState().pages[0].textboxes![0].x;
    await act(async () => {
      useAppStore.getState().nudgeSelection(pageId, 20, 0);
      useAppStore.getState().commitEraseStrokes(pageId, ['s-marquee']);
      useAppStore.getState().deleteActiveSelection(pageId);
    });
    expect(useAppStore.getState().pages[0].textboxes![0].x).toBe(beforeLockX);
    expect(useAppStore.getState().pages[0].strokes).toHaveLength(1);
    expect(useAppStore.getState().pages[0].images).toHaveLength(1);

    // Unlock and Ungroup with Ctrl+Shift+G
    await act(async () => {
      useAppStore.getState().toggleLockSelection(pageId, false);
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'G',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(useAppStore.getState().pages[0].textboxes![0].groupId).toBeUndefined();
    expect(useAppStore.getState().pages[0].strokes[0].groupId).toBeUndefined();

    // 6. Typing printable keys inside Gemini AI chat textarea must NOT spawn textboxes or switch tools
    await act(async () => {
      useAppStore.getState().setGeminiApiKey('AIzaDummyForFocusTest');
      const aiBtn = container.querySelector<HTMLButtonElement>(
        '[data-testid="ai-sidebar-toggle"]',
      )!;
      aiBtn.click();
    });
    const aiInput = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="ai-chat-input"]',
    )!;
    expect(aiInput).not.toBeNull();
    const tbCountBefore = useAppStore.getState().pages[0].textboxes!.length;
    await act(async () => {
      aiInput.focus();
      aiInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'v', bubbles: true }),
      );
      aiInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', bubbles: true }),
      );
    });
    expect(useAppStore.getState().pages[0].textboxes!.length).toBe(tbCountBefore);

    await act(async () => {
      useAppStore.getState().clearStoredGeminiApiKey();
    });
  });

  it('renders the 5-tab SettingsModal and displays real IndexedDB storage statistics', async () => {
    await act(async () => {
      root.render(<SettingsModal open={true} onClose={() => {}} />);
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(container.querySelector('[data-testid="settings-modal"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-panel-general"]')).not.toBeNull();

    // Switch through Appearance, AI & Gemini, Privacy & Vault, and Backup & Data
    const switchTab = async (tab: string) => {
      const btn = container.querySelector<HTMLButtonElement>(
        `[data-testid="settings-tab-${tab}"]`,
      )!;
      expect(btn).not.toBeNull();
      await act(async () => {
        btn.click();
      });
      expect(container.querySelector(`[data-testid="settings-panel-${tab}"]`)).not.toBeNull();
    };

    await switchTab('appearance');
    expect(container.querySelector('[data-testid="settings-dark-paper-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="settings-high-contrast-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="settings-ui-scale-slider"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-ui-sounds-toggle"]')).not.toBeNull();

    await switchTab('ai');
    expect(container.querySelector('[data-testid="gemini-model-select"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="test-gemini-key-btn"]')).not.toBeNull();

    await switchTab('vault');
    expect(container.querySelector('[data-testid="settings-vault-section"]')).not.toBeNull();

    await switchTab('data');
    expect(container.querySelector('[data-testid="settings-storage-summary"]')).not.toBeNull();
    expect(
      Number(
        container.querySelector('[data-testid="storage-stat-notebooks"]')?.textContent,
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      Number(container.querySelector('[data-testid="storage-stat-pages"]')?.textContent),
    ).toBeGreaterThanOrEqual(1);
  });
});
