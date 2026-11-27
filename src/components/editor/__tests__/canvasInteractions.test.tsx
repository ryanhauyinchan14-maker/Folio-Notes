import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeBoundsFromPoints } from '../../../canvas/geometry';
import {
  getTextboxLineGlyphRects,
  measureTextboxLayout,
} from '../../../canvas/textLayout';
import { DEFAULT_WHITEBOARD_PAPER } from '../../../canvas/whiteboard';
import { COVER_PRESETS } from '../../../constants/covers';
import { useAppStore } from '../../../store/useAppStore';
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
  return new File([pngBytes], 'photo.png', { type: 'image/png' });
}

function dispatchPointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  coords: { clientX: number; clientY: number; button?: number; shiftKey?: boolean },
): void {
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: coords.clientX,
    clientY: coords.clientY,
    button: coords.button ?? 0,
    shiftKey: Boolean(coords.shiftKey),
  });
  Object.defineProperty(evt, 'pointerId', { value: 1 });
  Object.defineProperty(evt, 'pointerType', { value: 'mouse' });
  target.dispatchEvent(evt);
}

describe('Canva hitboxes, one-motion drag, photo insertion paths & single-undo sliders', () => {
  let container: HTMLDivElement;
  let root: Root;
  const origImage = globalThis.Image;

  beforeEach(async () => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    globalThis.Image = class MockImage {
      naturalWidth = 240;
      naturalHeight = 160;
      width = 240;
      height = 160;
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
        title: 'UI Test Notebook',
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

  it('supports one-motion drag on unselected textboxes, hides + on normal boxes, and shows move handle when tiny', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().activePageId!;

    // Create a normal 2-line textbox (>= 44x30 even under jsdom fallback metrics)
    let normalTbId = '';
    await act(async () => {
      useAppStore.getState().setActiveTool('pan');
      const normalTb = useAppStore.getState().spawnTextbox({
        pageId,
        x: 120,
        y: 140,
        initialText: 'Hello Canva\nLine Two',
        fontSize: 36,
      })!;
      normalTbId = normalTb.id;
      useAppStore.getState().commitTextboxSession(pageId, normalTb.id, false);
    });

    // Verify unselected hit target is present, and nothing is selected initially
    expect(container.querySelector('[data-testid="textbox-box"]')).toBeNull();
    const hitEl = container.querySelector<HTMLElement>(
      `[data-testid="textbox-hit-${normalTbId}"]`,
    )!;
    expect(hitEl).not.toBeNull();

    // Perform ONE continuous drag directly on the unselected textbox hit target
    await act(async () => {
      dispatchPointer(hitEl, 'pointerdown', { clientX: 130, clientY: 150 });
    });
    await act(async () => {
      dispatchPointer(hitEl, 'pointermove', { clientX: 210, clientY: 195 });
    });
    await act(async () => {
      dispatchPointer(hitEl, 'pointerup', { clientX: 210, clientY: 195 });
    });

    // Selected immediately AND moved by +80, +45 in one motion
    const selectedBox = container.querySelector('[data-testid="textbox-box"]');
    expect(selectedBox).not.toBeNull();
    const updatedTb = useAppStore
      .getState()
      .pages.find((p) => p.id === pageId)!
      .textboxes!.find((t) => t.id === normalTbId)!;
    expect(updatedTb.x).toBe(200);
    expect(updatedTb.y).toBe(185);

    // No top-left '+' button and NO small-element move handle on normal >=44x30 box
    expect(
      container.querySelector('button[aria-label="Drag to move textbox"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="small-element-move-handle"]'),
    ).toBeNull();

    // Now create a tiny textbox (< 44x30) and select it
    await act(async () => {
      const tinyTb = useAppStore.getState().spawnTextbox({
        pageId,
        x: 300,
        y: 300,
        initialText: 'x',
        fontSize: 14,
      })!;
      useAppStore.getState().commitTextboxSession(pageId, tinyTb.id, true);
    });

    expect(
      container.querySelector('[data-testid="small-element-move-handle"]'),
    ).not.toBeNull();
  });

  it('inserts photos via file input, drag-and-drop, and Ctrl+V paste; batches slider drags into 1 Undo', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().activePageId!;
    const surface = container.querySelector<HTMLElement>(
      '[data-testid="page-surface-1"]',
    )!;
    expect(surface).not.toBeNull();

    // Path 1: Multi-file input upload
    const fileInput = container.querySelector<HTMLInputElement>(
      '[data-testid="image-file-input"]',
    )!;
    const file1 = makePngBlob();
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [file1],
    });
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await vi.waitFor(
      () => {
        expect(useAppStore.getState().pages[0].images).toHaveLength(1);
      },
      { timeout: 3000 },
    );

    // Path 2: Drag-and-drop image file onto page surface
    const file2 = makePngBlob();
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
      clientX: number;
      clientY: number;
      dataTransfer: { files: File[]; types: string[] };
    };
    dropEvent.clientX = 160;
    dropEvent.clientY = 200;
    dropEvent.dataTransfer = { files: [file2], types: ['Files'] };

    await act(async () => {
      surface.dispatchEvent(dropEvent);
    });
    await vi.waitFor(
      () => {
        expect(useAppStore.getState().pages[0].images).toHaveLength(2);
      },
      { timeout: 3000 },
    );

    // Path 3: Clipboard paste event with image/png file
    const file3 = makePngBlob();
    const pasteEvent = new Event('paste', {
      bubbles: true,
      cancelable: true,
    }) as Event & {
      clipboardData: {
        items: { kind: string; type: string; getAsFile: () => File }[];
        files: File[];
      };
    };
    pasteEvent.clipboardData = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file3 }],
      files: [file3],
    };

    await act(async () => {
      window.dispatchEvent(pasteEvent);
    });
    await vi.waitFor(
      () => {
        expect(useAppStore.getState().pages[0].images).toHaveLength(3);
      },
      { timeout: 3000 },
    );

    // Contextual sub-bar must be in image mode & normal image has no small-element move handle
    const subbar = container.querySelector('[data-testid="contextual-subbar"]');
    expect(subbar?.getAttribute('data-mode')).toBe('image');
    expect(
      container.querySelector('[data-testid="small-element-move-handle"]'),
    ).toBeNull();

    // Test one-motion drag on unselected first image
    const img1 = useAppStore.getState().pages[0].images![0];
    const startX = img1.x;
    const hitImg1 = container.querySelector<HTMLElement>(
      `[data-testid="image-hit-${img1.id}"]`,
    )!;
    expect(hitImg1).not.toBeNull();

    await act(async () => {
      dispatchPointer(hitImg1, 'pointerdown', { clientX: 200, clientY: 200 });
    });
    await act(async () => {
      dispatchPointer(hitImg1, 'pointermove', { clientX: 255, clientY: 225 });
    });
    await act(async () => {
      dispatchPointer(hitImg1, 'pointerup', { clientX: 255, clientY: 225 });
    });

    const movedImg1 = useAppStore
      .getState()
      .pages.find((p) => p.id === pageId)!
      .images!.find((im) => im.id === img1.id)!;
    expect(movedImg1.x).toBe(startX + 55);

    // Verify Opacity range slider drag pushes ONLY ONE Undo entry across multiple ticks
    const undoCountBeforeSlider = useAppStore.getState().undoStack.length;
    const opacitySlider = container.querySelector<HTMLInputElement>(
      '[data-testid="image-opacity-slider"]',
    )!;
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;

    await act(async () => {
      dispatchPointer(opacitySlider, 'pointerdown', { clientX: 0, clientY: 0 });
    });
    await act(async () => {
      nativeValueSetter.call(opacitySlider, '85');
      opacitySlider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      nativeValueSetter.call(opacitySlider, '70');
      opacitySlider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      nativeValueSetter.call(opacitySlider, '55');
      opacitySlider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      dispatchPointer(opacitySlider, 'pointerup', { clientX: 0, clientY: 0 });
    });

    expect(
      useAppStore
        .getState()
        .pages.find((p) => p.id === pageId)!
        .images!.find((im) => im.id === img1.id)!.opacity,
    ).toBeCloseTo(0.55, 2);
    expect(useAppStore.getState().undoStack.length).toBe(undoCountBeforeSlider + 1);

    // One single Ctrl+Z / undo() restores 0.55 -> 1.0 in one step
    await act(async () => {
      useAppStore.getState().undo();
    });
    expect(
      useAppStore
        .getState()
        .pages.find((p) => p.id === pageId)!
        .images!.find((im) => im.id === img1.id)!.opacity,
    ).toBe(1);
  });

  it('supports 1-5 favorite ink slot shortcuts, saving custom slot, Tab Zen Mode, dark paper & dock positions', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    // Number keys 1-5 switch active favorite pen/highlighter slots when not typing in a textbox
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
    });
    expect(useAppStore.getState().activeTool).toBe('highlighter');
    expect(useAppStore.getState().highlighterColor).toBe('#FEF08A');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
    });
    expect(useAppStore.getState().activeTool).toBe('pen');
    expect(useAppStore.getState().penColor).toBe('#FD6E88');

    // Save custom ink setup into Slot 5 and recall via key '5'
    await act(async () => {
      useAppStore.getState().setActiveColor('#10B981');
      useAppStore.getState().setActiveSize(8);
      useAppStore.getState().saveCurrentToolToSlot(4, 'Emerald Bold');
    });
    await act(async () => {
      useAppStore.getState().setActiveTool('pan');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));
    });
    expect(useAppStore.getState().activeTool).toBe('pen');
    expect(useAppStore.getState().penColor).toBe('#10B981');
    expect(useAppStore.getState().penSize).toBe(8);

    // Pressing Tab toggles Zen Mode (hides TopHeaderBar & dock, shows Zen pill)
    expect(container.querySelector('[data-testid="top-header-bar"]')).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(
      container.querySelector('[data-testid="notebook-editor-root"]')?.getAttribute('data-zen-mode'),
    ).toBe('true');
    expect(container.querySelector('[data-testid="top-header-bar"]')).toBeNull();
    expect(container.querySelector('[data-testid="zen-mode-pill"]')).not.toBeNull();

    // Pressing Tab again exits Zen Mode cleanly
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(container.querySelector('[data-testid="top-header-bar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="zen-mode-pill"]')).toBeNull();

    // Dark paper button is removed from header; Desk Backdrop and Left Dock Position still apply cleanly
    expect(container.querySelector('[data-testid="dark-paper-toggle"]')).toBeNull();
    await act(async () => {
      useAppStore.getState().setDeskBackdrop('midnight-navy');
      useAppStore.getState().setDockPosition('left');
    });
    expect(
      container
        .querySelector('[data-testid="notebook-editor-root"]')
        ?.getAttribute('data-desk-backdrop'),
    ).toBe('midnight-navy');
    expect(
      container.querySelector('[data-testid="bottom-tool-dock"]')?.getAttribute('data-dock-position'),
    ).toBe('left');

    // Reset back cleanly
    await act(async () => {
      useAppStore.getState().setDeskBackdrop('cool-gray');
      useAppStore.getState().setDockPosition('bottom');
      useAppStore.getState().resetPenSlots();
    });
  });

  it('pastes plain clipboard text directly into notebooks and whiteboards without opening a textbox first', async () => {
    const dispatchTextPaste = (text: string) => {
      const pasteEvent = new Event('paste', {
        bubbles: true,
        cancelable: true,
      }) as Event & {
        clipboardData: {
          items: unknown[];
          files: File[];
          getData: (type: string) => string;
        };
      };
      pasteEvent.clipboardData = {
        items: [],
        files: [],
        getData: (type: string) => (type === 'text/plain' ? text : ''),
      };
      window.dispatchEvent(pasteEvent);
      return pasteEvent;
    };

    await act(async () => {
      useAppStore.getState().setActiveTool('pen');
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().activePageId!;
    expect(useAppStore.getState().selectedTextboxIds).toHaveLength(0);
    expect(useAppStore.getState().activeTextboxId).toBeNull();

    // 1. Short single-line paste while Pen tool is active & no textbox selected
    let paste1!: Event;
    await act(async () => {
      paste1 = dispatchTextPaste('Copied lecture notes');
    });
    expect(paste1.defaultPrevented).toBe(true);

    let textboxes = useAppStore.getState().pages[0].textboxes ?? [];
    expect(textboxes).toHaveLength(1);
    expect(textboxes[0].text).toBe('Copied lecture notes');
    expect(textboxes[0].wrapWidth).toBeUndefined();
    expect(useAppStore.getState().selectedTextboxIds).toEqual([textboxes[0].id]);

    // Single Undo removes the pasted textbox cleanly
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    expect(useAppStore.getState().pages[0].textboxes ?? []).toHaveLength(0);

    // 2. Multi-line CRLF text normalizes line breaks & sets readable wrapWidth
    await act(async () => {
      dispatchTextPaste('Line one\r\nLine two with extra details for lecture notes');
    });
    textboxes = useAppStore.getState().pages[0].textboxes ?? [];
    expect(textboxes).toHaveLength(1);
    expect(textboxes[0].text).toBe('Line one\nLine two with extra details for lecture notes');
    expect(textboxes[0].wrapWidth).toBeGreaterThan(200);

    // 3. Internal canvas copy takes precedence right after Ctrl+C; after blur (external copy), OS text takes precedence
    const strokePts = [
      { x: 120, y: 160, pressure: 0.5 },
      { x: 180, y: 160, pressure: 0.5 },
    ];
    await act(async () => {
      useAppStore.getState().commitNewStroke(pageId, {
        id: 'copy-stroke-1',
        tool: 'pen',
        color: '#072D59',
        size: 4,
        opacity: 1,
        simulatePressure: false,
        points: strokePts,
        bounds: computeBoundsFromPoints(strokePts, 3),
        createdAt: Date.now(),
      });
      useAppStore.getState().setUnifiedSelection(pageId, {
        strokeIds: ['copy-stroke-1'],
        textboxIds: [],
        imageIds: [],
      });
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    });

    // Immediate paste with stale text/plain in OS clipboard pastes internal stroke instead of text
    await act(async () => {
      dispatchTextPaste('Stale external clipboard text');
    });
    expect(useAppStore.getState().pages[0].strokes).toHaveLength(2);
    expect(useAppStore.getState().pages[0].textboxes ?? []).toHaveLength(1);

    // After switching away (window blur) and returning, OS clipboard text takes precedence
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    await act(async () => {
      dispatchTextPaste('Fresh note from browser');
    });
    textboxes = useAppStore.getState().pages[0].textboxes ?? [];
    expect(textboxes).toHaveLength(2);
    expect(textboxes[1].text).toBe('Fresh note from browser');

    // 4. Infinite Whiteboard direct paste without clipping coordinates
    await act(async () => {
      await useAppStore.getState().closeNotebook();
      await useAppStore.getState().createNotebook({
        title: 'Paste Whiteboard',
        mode: 'whiteboard',
        folderId: null,
        cover: COVER_PRESETS[3].cover,
        paper: { ...DEFAULT_WHITEBOARD_PAPER },
        openImmediately: true,
      });
    });

    await act(async () => {
      dispatchTextPaste('Whiteboard sticky concept');
    });
    const wbBoxes = useAppStore.getState().pages[0].textboxes ?? [];
    expect(wbBoxes).toHaveLength(1);
    expect(wbBoxes[0].text).toBe('Whiteboard sticky concept');
  });

  it('shows I-beam text cursor & edits only on glyph text, while keeping blank areas as move cursor/drag inside selected textboxes', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().activePageId!;
    let multiTbId = '';
    await act(async () => {
      useAppStore.getState().setActiveTool('pan');
      const tb = useAppStore.getState().spawnTextbox({
        pageId,
        x: 100,
        y: 120,
        initialText: 'dwdwdwa\nwdw\nd\nd\nd\n\n\ndwdwd',
        fontSize: 24,
      })!;
      multiTbId = tb.id;
      useAppStore.getState().commitTextboxSession(pageId, tb.id, true);
    });

    const tb = useAppStore
      .getState()
      .pages.find((p) => p.id === pageId)!
      .textboxes!.find((t) => t.id === multiTbId)!;
    const layout = measureTextboxLayout(tb);
    const rects = getTextboxLineGlyphRects(tb, layout);
    const line5Rect = rects.find((r) => r.lineIndex === 4)!;

    const origBcr = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset?.testid === 'textbox-box') {
        const curTb = useAppStore
          .getState()
          .pages.find((p) => p.id === pageId)!
          .textboxes!.find((t) => t.id === multiTbId)!;
        return {
          x: curTb.x,
          y: curTb.y,
          left: curTb.x,
          top: curTb.y,
          right: curTb.x + layout.width,
          bottom: curTb.y + layout.height,
          width: layout.width,
          height: layout.height,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return origBcr.call(this);
    });

    const tbBox = container.querySelector<HTMLElement>('[data-testid="textbox-box"]')!;
    expect(tbBox).not.toBeNull();

    // 1. Hover blank right-hand area next to short 'd' -> move cursor
    const blankRightX = tb.x + layout.width - 8;
    const line5MidY = tb.y + (line5Rect.minY + line5Rect.maxY) / 2;
    await act(async () => {
      dispatchPointer(tbBox, 'pointermove', { clientX: blankRightX, clientY: line5MidY });
    });
    expect(tbBox.getAttribute('data-hover-zone')).toBe('move');
    expect(tbBox.className).toContain('cursor-move');

    // Hover empty blank line -> move cursor
    const emptyLineY = tb.y + layout.firstAscent + 5 * layout.lineStep - 4;
    await act(async () => {
      dispatchPointer(tbBox, 'pointermove', { clientX: tb.x + 8, clientY: emptyLineY });
    });
    expect(tbBox.getAttribute('data-hover-zone')).toBe('move');
    expect(tbBox.className).toContain('cursor-move');

    // 2. Click without dragging on blank area keeps textbox selected without entering editing
    await act(async () => {
      dispatchPointer(tbBox, 'pointerdown', { clientX: blankRightX, clientY: line5MidY });
      dispatchPointer(tbBox, 'pointerup', { clientX: blankRightX, clientY: line5MidY });
    });
    expect(useAppStore.getState().activeTextboxId).toBeNull();
    expect(useAppStore.getState().selectedTextboxIds).toEqual([multiTbId]);

    // 3. Dragging from blank area moves the textbox smoothly
    await act(async () => {
      dispatchPointer(tbBox, 'pointerdown', { clientX: blankRightX, clientY: line5MidY });
    });
    await act(async () => {
      dispatchPointer(tbBox, 'pointermove', {
        clientX: blankRightX + 45,
        clientY: line5MidY + 25,
      });
    });
    await act(async () => {
      dispatchPointer(tbBox, 'pointerup', {
        clientX: blankRightX + 45,
        clientY: line5MidY + 25,
      });
    });
    const movedTb = useAppStore
      .getState()
      .pages.find((p) => p.id === pageId)!
      .textboxes!.find((t) => t.id === multiTbId)!;
    expect(movedTb.x).toBe(145);
    expect(movedTb.y).toBe(145);

    // 4. Hover directly on 'd' glyph of line 5 -> switches to I-beam cursor-text
    const movedTextX = movedTb.x + (line5Rect.minX + line5Rect.maxX) / 2;
    const movedTextY = movedTb.y + (line5Rect.minY + line5Rect.maxY) / 2;
    await act(async () => {
      dispatchPointer(tbBox, 'pointermove', { clientX: movedTextX, clientY: movedTextY });
    });
    expect(tbBox.getAttribute('data-hover-zone')).toBe('text');
    expect(tbBox.className).toContain('cursor-text');

    // 5. Clicking directly on 'd' enters text edit mode right on line 5
    await act(async () => {
      dispatchPointer(tbBox, 'pointerdown', { clientX: movedTextX, clientY: movedTextY });
    });
    await act(async () => {
      dispatchPointer(tbBox, 'pointerup', { clientX: movedTextX, clientY: movedTextY });
    });
    expect(useAppStore.getState().activeTextboxId).toBe(multiTbId);
    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="textbox-textarea"]',
    )!;
    expect(textarea).not.toBeNull();
    expect(textarea.selectionStart).toBeGreaterThanOrEqual(16);
    expect(textarea.selectionStart).toBeLessThanOrEqual(17);
  });

  it('draws straight horizontal and vertical lines in pen and highlighter mode while holding Shift', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().activePageId!;
    const canvas = container.querySelector<HTMLCanvasElement>('[data-testid="active-canvas-1"]')!;
    expect(canvas).not.toBeNull();

    const origBcr = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this === canvas) {
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
      return origBcr.call(this);
    });

    // 1. Pen + Shift held on pointerdown + horizontal-dominant diagonal drag
    await act(async () => {
      useAppStore.getState().setActiveTool('pen');
    });
    await act(async () => {
      dispatchPointer(canvas, 'pointerdown', { clientX: 100, clientY: 120, shiftKey: true });
      dispatchPointer(canvas, 'pointermove', { clientX: 280, clientY: 165, shiftKey: true });
      dispatchPointer(canvas, 'pointerup', { clientX: 280, clientY: 165, shiftKey: true });
    });

    let strokes = useAppStore.getState().pages.find((p) => p.id === pageId)!.strokes;
    expect(strokes).toHaveLength(1);
    expect(strokes[0].tool).toBe('pen');
    expect(strokes[0].opacity).toBe(1);
    expect(strokes[0].shape).toEqual({
      kind: 'line',
      x1: 100,
      y1: 120,
      x2: 280,
      y2: 120,
    });
    expect(container.textContent).not.toContain('Snapped to Line');

    // 2. Swinging cursor mid-drag while holding Shift flips axis dynamically from horizontal to vertical
    await act(async () => {
      dispatchPointer(canvas, 'pointerdown', { clientX: 100, clientY: 120, shiftKey: true });
      dispatchPointer(canvas, 'pointermove', { clientX: 220, clientY: 140, shiftKey: true });
      dispatchPointer(canvas, 'pointermove', { clientX: 130, clientY: 310, shiftKey: true });
      dispatchPointer(canvas, 'pointerup', { clientX: 130, clientY: 310, shiftKey: true });
    });

    strokes = useAppStore.getState().pages.find((p) => p.id === pageId)!.strokes;
    expect(strokes).toHaveLength(2);
    expect(strokes[1].shape).toEqual({
      kind: 'line',
      x1: 100,
      y1: 120,
      x2: 100,
      y2: 310,
    });

    // 3. Highlighter + Shift held + vertical-dominant drag
    await act(async () => {
      useAppStore.getState().setActiveTool('highlighter');
    });
    await act(async () => {
      dispatchPointer(canvas, 'pointerdown', { clientX: 200, clientY: 150, shiftKey: true });
      dispatchPointer(canvas, 'pointermove', { clientX: 235, clientY: 390, shiftKey: true });
      dispatchPointer(canvas, 'pointerup', { clientX: 235, clientY: 390, shiftKey: true });
    });

    strokes = useAppStore.getState().pages.find((p) => p.id === pageId)!.strokes;
    expect(strokes).toHaveLength(3);
    expect(strokes[2].tool).toBe('highlighter');
    expect(strokes[2].opacity).toBe(0.45);
    expect(strokes[2].shape).toEqual({
      kind: 'line',
      x1: 200,
      y1: 150,
      x2: 200,
      y2: 390,
    });

    // 4. Pressing Shift mid-stroke and releasing Shift right before pointerup preserves straight line
    await act(async () => {
      useAppStore.getState().setActiveTool('pen');
    });
    await act(async () => {
      dispatchPointer(canvas, 'pointerdown', { clientX: 150, clientY: 200 });
      dispatchPointer(canvas, 'pointermove', { clientX: 290, clientY: 235 });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', shiftKey: false }));
      dispatchPointer(canvas, 'pointerup', { clientX: 290, clientY: 235 });
    });

    strokes = useAppStore.getState().pages.find((p) => p.id === pageId)!.strokes;
    expect(strokes).toHaveLength(4);
    expect(strokes[3].shape).toEqual({
      kind: 'line',
      x1: 150,
      y1: 200,
      x2: 290,
      y2: 200,
    });
  });

  it('removes 560x72 / 96pt cap and supports typing exact W, H, and pt numbers for textboxes, images, and strokes', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().activePageId!;

    const typeIntoSubbarInput = async (testId: string, nextVal: string) => {
      const input = container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!;
      expect(input).not.toBeNull();
      await act(async () => {
        input.focus();
      });
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, nextVal);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        );
      });
    };

    // 1. Spawn and select a textbox with "bdwdwwdwd", then scale corner far beyond old 96pt / 560x72 limit
    let tbId = '';
    await act(async () => {
      useAppStore.getState().setActiveTool('pan');
      const tb = useAppStore.getState().spawnTextbox({
        pageId,
        x: 100,
        y: 120,
        initialText: 'bdwdwwdwd',
        fontSize: 57,
      })!;
      tbId = tb.id;
      useAppStore.getState().commitTextboxSession(pageId, tb.id, true);
    });

    const brHandle = container.querySelector<HTMLButtonElement>('[data-testid="textbox-handle-br"]')!;
    expect(brHandle).not.toBeNull();
    await act(async () => {
      dispatchPointer(brHandle, 'pointerdown', { clientX: 390, clientY: 165 });
      dispatchPointer(brHandle, 'pointermove', { clientX: 980, clientY: 360 });
      dispatchPointer(brHandle, 'pointerup', { clientX: 980, clientY: 360 });
    });

    let curTb = useAppStore
      .getState()
      .pages.find((p) => p.id === pageId)!
      .textboxes!.find((t) => t.id === tbId)!;
    expect(curTb.fontSize).toBeGreaterThan(120);
    expect(measureTextboxLayout(curTb).width).toBeGreaterThan(600);

    // 2. Type exact pt, W, H numbers directly into top bar inputs + verify 1-step Undo
    await typeIntoSubbarInput('subbar-font-size', '250');
    curTb = useAppStore
      .getState()
      .pages.find((p) => p.id === pageId)!
      .textboxes!.find((t) => t.id === tbId)!;
    expect(curTb.fontSize).toBe(250);

    await typeIntoSubbarInput('subbar-dim-w', '1000');
    curTb = useAppStore
      .getState()
      .pages.find((p) => p.id === pageId)!
      .textboxes!.find((t) => t.id === tbId)!;
    expect(Math.abs(Math.round(measureTextboxLayout(curTb).width) - 1000)).toBeLessThanOrEqual(2);

    await typeIntoSubbarInput('subbar-dim-h', '180');
    curTb = useAppStore
      .getState()
      .pages.find((p) => p.id === pageId)!
      .textboxes!.find((t) => t.id === tbId)!;
    expect(Math.abs(Math.round(measureTextboxLayout(curTb).height) - 180)).toBeLessThanOrEqual(2);

    const fontBeforeUndo = curTb.fontSize;
    await act(async () => {
      useAppStore.getState().undo();
    });
    const tbAfterUndo = useAppStore
      .getState()
      .pages.find((p) => p.id === pageId)!
      .textboxes!.find((t) => t.id === tbId)!;
    expect(tbAfterUndo.fontSize).not.toBe(fontBeforeUndo);

    // 3. Image exact W & H numeric inputs
    const imgId = 'img-dim-test';
    await act(async () => {
      useAppStore.getState().addPageImages(pageId, [
        {
          id: imgId,
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAhKmMIQAAAABJRU5ErkJggg==',
          naturalWidth: 400,
          naturalHeight: 300,
          x: 80,
          y: 250,
          width: 240,
          height: 180,
          opacity: 1,
          borderRadius: 0,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          flipX: false,
          flipY: false,
          zIndex: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);
      useAppStore.getState().selectImage(imgId);
    });

    await typeIntoSubbarInput('subbar-dim-w', '900');
    await typeIntoSubbarInput('subbar-dim-h', '600');
    const updatedImg = useAppStore
      .getState()
      .pages.find((p) => p.id === pageId)!
      .images!.find((im) => im.id === imgId)!;
    expect(updatedImg.width).toBe(900);
    expect(updatedImg.height).toBe(600);

    // 4. Stroke exact W & H numeric inputs
    const strokePts = [
      { x: 100, y: 100, pressure: 0.5 },
      { x: 300, y: 200, pressure: 0.5 },
    ];
    const strokeId = 'st-dim-test';
    await act(async () => {
      useAppStore.getState().commitNewStroke(pageId, {
        id: strokeId,
        tool: 'pen',
        color: '#072D59',
        size: 4,
        opacity: 1,
        simulatePressure: false,
        points: strokePts,
        bounds: computeBoundsFromPoints(strokePts, 2.4),
        createdAt: Date.now(),
      });
      useAppStore.getState().setUnifiedSelection(pageId, {
        strokeIds: [strokeId],
        textboxIds: [],
        imageIds: [],
      });
    });

    await typeIntoSubbarInput('subbar-dim-w', '500');
    await typeIntoSubbarInput('subbar-dim-h', '250');
    const scaledStroke = useAppStore
      .getState()
      .pages.find((p) => p.id === pageId)!
      .strokes.find((s) => s.id === strokeId)!;
    const scaledStrokeW = Math.round(scaledStroke.bounds.maxX - scaledStroke.bounds.minX);
    const scaledStrokeH = Math.round(scaledStroke.bounds.maxY - scaledStroke.bounds.minY);
    expect(scaledStrokeW).toBeGreaterThanOrEqual(490);
    expect(scaledStrokeW).toBeLessThanOrEqual(505);
    expect(scaledStrokeH).toBeGreaterThanOrEqual(240);
    expect(scaledStrokeH).toBeLessThanOrEqual(255);
  });

  it('toggles Subtle UI Sounds in Settings -> Appearance and renders morphing tab tracks cleanly', async () => {
    await act(async () => {
      await useAppStore.getState().setUiSoundsEnabled(false);
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const localRoot = createRoot(host);

    await act(async () => {
      localRoot.render(<SettingsModal open onClose={() => {}} initialTab="appearance" />);
    });

    try {
      const appearanceTab = host.querySelector('[data-morph-key="appearance"]');
      expect(appearanceTab).toBeTruthy();

      const toggleBtn = host.querySelector(
        '[data-testid="settings-ui-sounds-toggle"]',
      ) as HTMLButtonElement | null;
      expect(toggleBtn).toBeTruthy();
      expect(toggleBtn?.getAttribute('aria-checked')).toBe('false');
      expect(useAppStore.getState().uiSoundsEnabled).toBe(false);

      await act(async () => {
        toggleBtn?.click();
      });

      expect(toggleBtn?.getAttribute('aria-checked')).toBe('true');
      expect(useAppStore.getState().uiSoundsEnabled).toBe(true);

      const generalTab = host.querySelector(
        '[data-testid="settings-tab-general"]',
      ) as HTMLButtonElement | null;
      expect(generalTab).toBeTruthy();
      await act(async () => {
        generalTab?.click();
      });

      expect(host.querySelectorAll('[data-morph-key]').length).toBeGreaterThan(4);
    } finally {
      await act(async () => {
        localRoot.unmount();
        await useAppStore.getState().setUiSoundsEnabled(false);
      });
      host.remove();
    }
  });

  it('switches from pen mode to select mode on double-click/double-tap over text without leaving stray strokes', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().activePageId!;
    let tbId = '';
    await act(async () => {
      const tb = useAppStore.getState().spawnTextbox({
        pageId,
        x: 120,
        y: 140,
        initialText: 'when i doubleclick on text like this in pen mode, make it select mode',
        fontSize: 22,
      })!;
      tbId = tb.id;
      useAppStore.getState().commitTextboxSession(pageId, tb.id, false);
      useAppStore.getState().setActiveTool('pen');
    });

    const initialUndoLen = useAppStore.getState().undoStack.length;
    const canvas = container.querySelector<HTMLCanvasElement>('[data-testid="active-canvas-1"]')!;
    expect(canvas).not.toBeNull();
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 816,
      height: 1056,
      right: 816,
      bottom: 1056,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Simulate real mouse/stylus double-tap sequence + trailing native dblclick
    await act(async () => {
      dispatchPointer(canvas, 'pointerdown', { clientX: 150, clientY: 155 });
    });
    await act(async () => {
      dispatchPointer(canvas, 'pointerup', { clientX: 150, clientY: 155 });
    });
    await act(async () => {
      dispatchPointer(canvas, 'pointerdown', { clientX: 152, clientY: 156 });
    });
    await act(async () => {
      dispatchPointer(canvas, 'pointerup', { clientX: 152, clientY: 156 });
    });

    const selectedOverlayAfterTap = container.querySelector<HTMLElement>(
      '[data-testid="textbox-box"]',
    );
    await act(async () => {
      (selectedOverlayAfterTap ?? canvas).dispatchEvent(
        new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          clientX: 152,
          clientY: 156,
        }),
      );
    });

    const stateAfterDoubleClick = useAppStore.getState();
    const pageAfterDoubleClick = stateAfterDoubleClick.pages.find((p) => p.id === pageId)!;
    expect(stateAfterDoubleClick.activeTool).toBe('pan');
    expect(stateAfterDoubleClick.selectedTextboxIds).toEqual([tbId]);
    expect(stateAfterDoubleClick.activeTextboxId).toBeNull();
    expect(pageAfterDoubleClick.strokes).toHaveLength(0);
    expect(stateAfterDoubleClick.undoStack).toHaveLength(initialUndoLen);

    // Also verify slow/synthetic canvas dblclick in pen mode switches cleanly to Select
    await act(async () => {
      useAppStore.getState().setActiveTool('pen');
    });
    await act(async () => {
      canvas.dispatchEvent(
        new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          clientX: 152,
          clientY: 156,
        }),
      );
    });
    expect(useAppStore.getState().activeTool).toBe('pan');
    expect(useAppStore.getState().selectedTextboxIds).toEqual([tbId]);
    expect(useAppStore.getState().activeTextboxId).toBeNull();

    // Double-clicking empty paper in pen mode must stay in pen mode and not spawn textboxes
    await act(async () => {
      useAppStore.getState().setActiveTool('pen');
    });
    const tbCountBeforeEmpty = useAppStore
      .getState()
      .pages.find((p) => p.id === pageId)!
      .textboxes!.length;
    await act(async () => {
      dispatchPointer(canvas, 'pointerdown', { clientX: 600, clientY: 800 });
      dispatchPointer(canvas, 'pointerup', { clientX: 600, clientY: 800 });
      dispatchPointer(canvas, 'pointerdown', { clientX: 601, clientY: 801 });
      dispatchPointer(canvas, 'pointerup', { clientX: 601, clientY: 801 });
      canvas.dispatchEvent(
        new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          clientX: 601,
          clientY: 801,
        }),
      );
    });
    expect(useAppStore.getState().activeTool).toBe('pen');
    expect(useAppStore.getState().selectedTextboxIds).toEqual([]);
    expect(
      useAppStore.getState().pages.find((p) => p.id === pageId)!.textboxes,
    ).toHaveLength(tbCountBeforeEmpty);

    // Single tap on a textbox in pen mode stays in pen mode and keeps the dot stroke
    const strokesBeforeSingleTap = useAppStore
      .getState()
      .pages.find((p) => p.id === pageId)!.strokes.length;
    await act(async () => {
      dispatchPointer(canvas, 'pointerdown', { clientX: 150, clientY: 155 });
    });
    await act(async () => {
      dispatchPointer(canvas, 'pointerup', { clientX: 150, clientY: 155 });
    });
    expect(useAppStore.getState().activeTool).toBe('pen');
    expect(
      useAppStore.getState().pages.find((p) => p.id === pageId)!.strokes.length,
    ).toBe(strokesBeforeSingleTap + 1);
  });

  it('progressively dismisses selection / page menu on Escape and returns to the Home Shelf when idle', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().activePageId!;
    const activeNotebookId = useAppStore.getState().activeNotebook?.id;
    expect(activeNotebookId).toBeTruthy();

    // 1. When a textbox is selected, first Escape deselects instead of leaving the notebook
    await act(async () => {
      const tb = useAppStore.getState().spawnTextbox({
        pageId,
        x: 100,
        y: 120,
        initialText: 'Selected note',
      })!;
      useAppStore.getState().commitTextboxSession(pageId, tb.id, true);
    });
    expect(useAppStore.getState().selectedTextboxIds).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(useAppStore.getState().selectedTextboxIds).toEqual([]);
    expect(useAppStore.getState().activeNotebook?.id).toBe(activeNotebookId);

    // 2. When the Page dropdown is open, Escape closes the menu first without leaving the notebook
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="page-menu-button"]')?.click();
    });
    expect(container.querySelector('[data-testid="page-dropdown-menu"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    expect(container.querySelector('[data-testid="page-dropdown-menu"]')).toBeNull();
    expect(useAppStore.getState().activeNotebook?.id).toBe(activeNotebookId);

    // 3. When idle on the notebook page, Escape returns cleanly to the Home Shelf
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await vi.waitFor(
      () => {
        expect(useAppStore.getState().activeNotebook).toBeNull();
      },
      { timeout: 3000 },
    );
  });

  it('renders a generously padded selection frame and handles around selected textboxes without overlapping glyphs', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().activePageId!;
    let tbId = '';
    await act(async () => {
      useAppStore.getState().setActiveTool('pan');
      const tb = useAppStore.getState().spawnTextbox({
        pageId,
        x: 140,
        y: 160,
        initialText: 'Memorize drama script',
        fontSize: 24,
      })!;
      tbId = tb.id;
      useAppStore.getState().commitTextboxSession(pageId, tb.id, true);
    });

    const tb = useAppStore
      .getState()
      .pages.find((p) => p.id === pageId)!
      .textboxes!.find((t) => t.id === tbId)!;
    const layout = measureTextboxLayout(tb);

    const tbBox = container.querySelector<HTMLElement>('[data-testid="textbox-box"]')!;
    expect(tbBox).not.toBeNull();
    expect(tbBox.style.outline).toBe('');

    const frame = container.querySelector<HTMLElement>('[data-testid="textbox-selection-frame"]')!;
    expect(frame).not.toBeNull();
    expect(frame.style.left).toBe('-14px');
    expect(frame.style.right).toBe('-14px');
    expect(frame.style.top).toBe('-9px');
    expect(frame.style.bottom).toBe('-9px');
    expect(frame.style.border).toContain('solid');

    expect(frame.querySelector('[data-testid="textbox-handle-tl"]')).not.toBeNull();
    expect(frame.querySelector('[data-testid="textbox-handle-tr"]')).not.toBeNull();
    expect(frame.querySelector('[data-testid="textbox-handle-bl"]')).not.toBeNull();
    expect(frame.querySelector('[data-testid="textbox-handle-br"]')).not.toBeNull();
    expect(frame.querySelector('[data-testid="textbox-handle-wrap"]')).not.toBeNull();

    // Pointer inside padded breathing room gives move cursor; over glyphs gives text cursor
    const origBcr = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset?.testid === 'textbox-box') {
        return {
          x: tb.x,
          y: tb.y,
          left: tb.x,
          top: tb.y,
          right: tb.x + layout.width,
          bottom: tb.y + layout.height,
          width: layout.width,
          height: layout.height,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return origBcr.call(this);
    });

    await act(async () => {
      dispatchPointer(tbBox, 'pointermove', { clientX: tb.x - 8, clientY: tb.y + 4 });
    });
    expect(tbBox.getAttribute('data-hover-zone')).toBe('move');

    await act(async () => {
      dispatchPointer(tbBox, 'pointermove', { clientX: tb.x + 12, clientY: tb.y + 8 });
    });
    expect(tbBox.getAttribute('data-hover-zone')).toBe('text');
  });
});
