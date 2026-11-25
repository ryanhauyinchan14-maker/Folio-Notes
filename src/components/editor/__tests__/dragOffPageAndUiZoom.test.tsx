// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../App';
import { computeBoundsFromPoints } from '../../../canvas/geometry';
import { isBoundsOffPage } from '../../../canvas/selection';
import { useAppStore } from '../../../store/useAppStore';
import type { Stroke } from '../../../types/notes';
import { DEFAULT_UI_SCALE } from '../../../utils/uiZoom';
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
  return new File([pngBytes], 'offpage-photo.png', { type: 'image/png' });
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

describe('Canva Drag-Off-Paper Delete & Chrome-style Whole-GUI Scaling', () => {
  let container: HTMLDivElement;
  let root: Root;
  const origImage = globalThis.Image;
  let origGetBCR: typeof HTMLElement.prototype.getBoundingClientRect;

  beforeEach(async () => {
    window.localStorage.clear();
    document.documentElement.style.zoom = '';
    delete document.documentElement.dataset.uiScale;
    delete window.folioDesktop;

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
      naturalWidth = 160;
      naturalHeight = 120;
      width = 160;
      height = 120;
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
      useAppStore.getState().setUiScale(DEFAULT_UI_SCALE);
      useAppStore.getState().setCtrlScrollBehavior('smart');
      useAppStore.getState().setZoom(1);
      await useAppStore.getState().initApp();
      await useAppStore.getState().createNotebook({
        title: 'Drag Delete & Zoom Notebook',
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

  it('computes off-page threshold accurately (center outside OR > 85% area outside)', () => {
    const paper = { width: 816, height: 1056 };

    // Inside paper
    expect(isBoundsOffPage({ minX: 100, minY: 100, maxX: 220, maxY: 160 }, paper)).toBe(false);

    // Center still inside, 40% outside -> keep
    expect(isBoundsOffPage({ minX: -40, minY: 100, maxX: 60, maxY: 180 }, paper)).toBe(false);

    // Center crosses right edge -> off-page
    expect(isBoundsOffPage({ minX: 780, minY: 100, maxX: 880, maxY: 180 }, paper)).toBe(true);

    // >85% area outside top edge -> off-page
    expect(isBoundsOffPage({ minX: 100, minY: -90, maxX: 200, maxY: 10 }, paper)).toBe(true);
  });

  it('fades dragged elements off-page, shows Crimson Release-to-delete pill, deletes cleanly on release, and restores exact coords on Ctrl+Z', async () => {
    await act(async () => {
      root.render(<NotebookEditor />);
    });

    const pageId = useAppStore.getState().activePageId!;

    // 1. Textbox drag-off-paper to delete + exact coordinate Undo
    let tbId = '';
    await act(async () => {
      useAppStore.getState().setActiveTool('pan');
      const tb = useAppStore.getState().spawnTextbox({
        pageId,
        x: 120,
        y: 140,
        initialText: 'Drag Me Off',
        fontSize: 28,
      })!;
      tbId = tb.id;
      useAppStore.getState().commitTextboxSession(pageId, tb.id, true);
    });

    const tbBox = container.querySelector<HTMLElement>('[data-testid="textbox-box"]')!;
    expect(tbBox).not.toBeNull();

    await act(async () => {
      dispatchPointer(tbBox, 'pointerdown', { clientX: 130, clientY: 150 });
    });
    // Drag way past right edge (> 816) so element leaves paper bounds
    await act(async () => {
      dispatchPointer(tbBox, 'pointermove', { clientX: 960, clientY: 155 });
    });

    expect(tbBox.getAttribute('data-off-page-drag')).toBe('true');
    expect(tbBox.style.opacity).toBe('0.45');
    const pill = container.querySelector('[data-testid="off-page-delete-pill"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toContain('Release to delete');

    await act(async () => {
      dispatchPointer(tbBox, 'pointerup', { clientX: 960, clientY: 155 });
    });

    expect(useAppStore.getState().pages[0].textboxes).toHaveLength(0);
    expect(container.querySelector('[data-testid="off-page-delete-pill"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="editor-toast"]')?.textContent,
    ).toContain('Deleted off-page item');

    // Ctrl+Z / undo restores the textbox to its EXACT pre-drag coordinates
    await act(async () => {
      useAppStore.getState().undo();
    });
    const restoredTb = useAppStore.getState().pages[0].textboxes!.find((t) => t.id === tbId)!;
    expect(restoredTb).toBeTruthy();
    expect(restoredTb.x).toBe(120);
    expect(restoredTb.y).toBe(140);

    // 2. PageImage drag-off-paper to delete + Undo
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
    const img = useAppStore.getState().pages[0].images![0];
    const origImgX = img.x;
    const origImgY = img.y;

    const imgBox = container.querySelector<HTMLElement>('[data-testid="image-box"]')!;
    await act(async () => {
      dispatchPointer(imgBox, 'pointerdown', { clientX: origImgX + 20, clientY: origImgY + 20 });
    });
    await act(async () => {
      dispatchPointer(imgBox, 'pointermove', { clientX: -500, clientY: origImgY + 20 });
    });
    expect(imgBox.getAttribute('data-off-page-drag')).toBe('true');
    expect(container.querySelector('[data-testid="off-page-delete-pill"]')).not.toBeNull();
    await act(async () => {
      dispatchPointer(imgBox, 'pointerup', { clientX: -500, clientY: origImgY + 20 });
    });

    expect(useAppStore.getState().pages[0].images).toHaveLength(0);
    await act(async () => {
      useAppStore.getState().undo();
    });
    expect(useAppStore.getState().pages[0].images![0].x).toBe(origImgX);
    expect(useAppStore.getState().pages[0].images![0].y).toBe(origImgY);

    // 3. Multi-element / Group (Stroke + Textbox) drag-off-page deletes both & Undo restores both
    const s1 = buildTestStroke('s-group-off', 140, 220, 240, 220);
    await act(async () => {
      useAppStore.getState().commitNewStroke(pageId, s1);
      useAppStore.getState().setUnifiedSelection(
        pageId,
        { strokeIds: ['s-group-off'], textboxIds: [tbId], imageIds: [] },
        { expandGroups: false },
      );
      useAppStore.getState().groupSelection(pageId);
    });

    const multiBox = container.querySelector<HTMLElement>(
      '[data-testid="multi-selection-box"]',
    )!;
    expect(multiBox).not.toBeNull();
    await act(async () => {
      dispatchPointer(multiBox, 'pointerdown', { clientX: 160, clientY: 180 });
    });
    await act(async () => {
      dispatchPointer(window, 'pointermove', { clientX: 1020, clientY: 180 });
    });
    expect(
      container.querySelector('[data-testid="multi-selection-box"]')?.getAttribute('data-off-page-drag'),
    ).toBe('true');
    expect(container.querySelector('[data-testid="off-page-delete-pill"]')).not.toBeNull();

    await act(async () => {
      dispatchPointer(window, 'pointerup', { clientX: 1020, clientY: 180 });
    });
    expect(useAppStore.getState().pages[0].strokes).toHaveLength(0);
    expect(useAppStore.getState().pages[0].textboxes).toHaveLength(0);

    await act(async () => {
      useAppStore.getState().undo();
    });
    expect(useAppStore.getState().pages[0].strokes).toHaveLength(1);
    expect(useAppStore.getState().pages[0].strokes[0].points[0].x).toBe(140);
    expect(useAppStore.getState().pages[0].textboxes![0].x).toBe(120);

    // 4. Locked elements cannot be dragged or deleted off-page
    await act(async () => {
      useAppStore.getState().selectTextbox(tbId);
      useAppStore.getState().toggleLockSelection(pageId, true);
      useAppStore.getState().selectTextbox(tbId);
    });
    const lockedBox = container.querySelector<HTMLElement>(
      '[data-testid="multi-selection-box"]',
    )!;
    await act(async () => {
      dispatchPointer(lockedBox, 'pointerdown', { clientX: 150, clientY: 160 });
      dispatchPointer(window, 'pointermove', { clientX: 980, clientY: 160 });
      dispatchPointer(window, 'pointerup', { clientX: 980, clientY: 160 });
    });
    expect(container.querySelector('[data-testid="off-page-delete-pill"]')).toBeNull();
    expect(useAppStore.getState().pages[0].strokes).toHaveLength(1);
    expect(useAppStore.getState().pages[0].textboxes).toHaveLength(1);
  });

  it('supports smart context-aware Ctrl+Scroll, Ctrl+Shift+=/-/0 whole-GUI scaling, Settings buttons, and Alt+Scroll paper zoom', async () => {
    await act(async () => {
      root.render(<App />);
    });

    const viewport = container.querySelector<HTMLElement>(
      '[data-testid="editor-canvas-viewport"]',
    )!;
    expect(viewport).not.toBeNull();

    // 1. Default is 'smart': Ctrl + Wheel inside editor zooms paper canvas ONLY (never GUI chrome)
    expect(useAppStore.getState().ctrlScrollBehavior).toBe('smart');
    await act(async () => {
      viewport.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(useAppStore.getState().zoom).toBeCloseTo(Math.exp(0.18), 2);
    expect(useAppStore.getState().uiScale).toBe(1.35);
    expect(container.querySelector('[data-testid="ui-zoom-badge"]')).toBeNull();

    // Switching ctrlScrollBehavior to 'gui-scale' makes Ctrl + Wheel inside editor scale whole GUI
    await act(async () => {
      useAppStore.getState().setZoom(1);
      useAppStore.getState().setCtrlScrollBehavior('gui-scale');
    });
    await act(async () => {
      window.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(useAppStore.getState().uiScale).toBe(1.4);
    expect(document.documentElement.style.zoom).toBe('1.4');
    expect(container.querySelector('[data-testid="ui-zoom-badge"]')?.textContent).toContain('140%');

    // Paper canvas zoom remained untouched at 100%
    expect(useAppStore.getState().zoom).toBe(1);

    // 2. Ctrl + Shift + = / - / 0 keyboard shortcuts step GUI scale and reset
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
    expect(useAppStore.getState().uiScale).toBe(1.5);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '_',
          code: 'Minus',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(useAppStore.getState().uiScale).toBe(1.4);

    // Reset button in transient pill resets back to 135%
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="ui-zoom-reset-btn"]')!.click();
    });
    expect(useAppStore.getState().uiScale).toBe(1.35);

    // 3. Alt + Wheel inside editor canvas viewport zooms ONLY paper canvas
    await act(async () => {
      viewport.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, altKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(useAppStore.getState().zoom).toBeCloseTo(Math.exp(0.18), 2);
    expect(useAppStore.getState().uiScale).toBe(1.35);

    // 4. Switching Ctrl+Scroll Behavior in store/settings to 'paper-zoom' makes Ctrl+Wheel zoom paper instead of GUI
    await act(async () => {
      useAppStore.getState().setZoom(1);
      useAppStore.getState().setCtrlScrollBehavior('paper-zoom');
    });
    await act(async () => {
      viewport.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(useAppStore.getState().zoom).toBeCloseTo(Math.exp(0.18), 2);
    expect(useAppStore.getState().uiScale).toBe(1.35);

    // 5. SettingsModal Appearance UI Scale slider works and Ctrl+Scroll Behavior setting is hidden from UI
    const settingsDiv = document.createElement('div');
    document.body.appendChild(settingsDiv);
    const settingsRoot = createRoot(settingsDiv);

    await act(async () => {
      settingsRoot.render(<SettingsModal open={true} onClose={() => {}} />);
    });

    expect(settingsDiv.querySelector('[data-testid="settings-ctrl-scroll-smart"]')).toBeNull();
    expect(settingsDiv.querySelector('[data-testid="settings-ctrl-scroll-gui"]')).toBeNull();
    expect(settingsDiv.querySelector('[data-testid="settings-ctrl-scroll-paper"]')).toBeNull();

    await act(async () => {
      settingsDiv.querySelector<HTMLButtonElement>('[data-testid="settings-tab-appearance"]')!.click();
    });
    const slider = settingsDiv.querySelector<HTMLInputElement>(
      '[data-testid="settings-ui-scale-slider"]',
    )!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(slider, '110');
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useAppStore.getState().uiScale).toBe(1.1);
    expect(
      settingsDiv.querySelector('[data-testid="settings-ui-scale-value"]')?.textContent,
    ).toBe('110%');

    await act(async () => {
      settingsDiv.querySelector<HTMLButtonElement>('[data-testid="settings-ui-scale-reset"]')!.click();
    });
    expect(useAppStore.getState().uiScale).toBe(1.35);

    await act(async () => {
      settingsRoot.unmount();
    });
    settingsDiv.remove();
  });
});
