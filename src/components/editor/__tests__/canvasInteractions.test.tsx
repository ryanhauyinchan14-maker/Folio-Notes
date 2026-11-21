import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
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
  coords: { clientX: number; clientY: number; button?: number },
): void {
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: coords.clientX,
    clientY: coords.clientY,
    button: coords.button ?? 0,
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
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(useAppStore.getState().pages[0].images).toHaveLength(1);

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
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(useAppStore.getState().pages[0].images).toHaveLength(2);

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
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(useAppStore.getState().pages[0].images).toHaveLength(3);

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

    // Toggle Dark Paper View, Desk Backdrop, and Left Dock Position
    await act(async () => {
      useAppStore.getState().setDarkPaperView(true);
      useAppStore.getState().setDeskBackdrop('midnight-navy');
      useAppStore.getState().setDockPosition('left');
    });
    expect(
      container.querySelector('[data-testid="page-surface-1"]')?.getAttribute('data-dark-paper'),
    ).toBe('true');
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
      useAppStore.getState().setDarkPaperView(false);
      useAppStore.getState().setDeskBackdrop('cool-gray');
      useAppStore.getState().setDockPosition('bottom');
      useAppStore.getState().resetPenSlots();
    });
  });
});
