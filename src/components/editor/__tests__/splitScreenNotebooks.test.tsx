// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COVER_PRESETS } from '../../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../../constants/papers';
import { db } from '../../../db/database';
import { repository } from '../../../db/repository';
import { useAppStore } from '../../../store/useAppStore';
import { NotebookEditor } from '../NotebookEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe('Split Screen Dual-Notebook Editing with Shared Top Bar', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    window.localStorage.clear();
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    await db.pdfAssets.clear();
    await db.pages.clear();
    await db.notebooks.clear();
    await db.folders.clear();
    await db.templates.clear();
    await db.trashedNotebooks.clear();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      await useAppStore.getState().initApp();
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

  it('opens a second notebook from the Pages drawer Split View tab, lets the user edit both side-by-side using the shared top bar, swaps sides, and closes panes cleanly', async () => {
    let bookAId = '';
    let bookBId = '';

    await act(async () => {
      const bookA = await useAppStore.getState().createNotebook({
        title: 'Drama Script',
        folderId: null,
        cover: COVER_PRESETS[0].cover,
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: false,
      });
      const bookB = await useAppStore.getState().createNotebook({
        title: 'Physics Notes',
        folderId: null,
        cover: COVER_PRESETS[1].cover,
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: false,
      });
      bookAId = bookA.id;
      bookBId = bookB.id;
      await useAppStore.getState().openNotebook(bookAId);
      root.render(<NotebookEditor />);
    });

    // Open Pages drawer and switch to Split View tab
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="pages-drawer-toggle"]')!.click();
    });
    expect(container.querySelector('[data-testid="pages-drawer"]')).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="drawer-tab-split"]')!.click();
    });
    expect(container.querySelector('[data-testid="drawer-split-panel"]')).not.toBeNull();

    // Pick Physics Notes for split screen
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(`[data-testid="split-pick-notebook-${bookBId}"]`)!
        .click();
      await vi.waitFor(() => {
        expect(useAppStore.getState().splitPane?.notebook.id).toBe(bookBId);
      });
    });

    // Single shared top header & contextual subbar above both side-by-side panes
    expect(container.querySelectorAll('[data-testid="top-header-bar"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="contextual-subbar"]')).toHaveLength(1);

    const leftPane = container.querySelector<HTMLElement>('[data-testid="split-pane-left"]')!;
    const rightPane = container.querySelector<HTMLElement>('[data-testid="split-pane-right"]')!;
    expect(leftPane).not.toBeNull();
    expect(rightPane).not.toBeNull();
    expect(leftPane.getAttribute('data-notebook-id')).toBe(bookAId);
    expect(rightPane.getAttribute('data-notebook-id')).toBe(bookBId);
    expect(leftPane.getAttribute('data-focused')).toBe('true');
    expect(rightPane.getAttribute('data-focused')).toBe('false');

    // Draw stroke on Left pane (Drama Script) with navy color #072D59
    await act(async () => {
      useAppStore.getState().setActiveTool('pen');
      useAppStore.getState().setActiveColor('#072D59');
    });
    const leftCanvas = leftPane.querySelector<HTMLCanvasElement>('[data-testid="active-canvas-1"]')!;
    await act(async () => {
      dispatchPointer(leftCanvas, 'pointerdown', { clientX: 40, clientY: 60 });
      dispatchPointer(leftCanvas, 'pointermove', { clientX: 120, clientY: 90 });
      dispatchPointer(leftCanvas, 'pointerup', { clientX: 120, clientY: 90 });
    });

    expect(useAppStore.getState().activeNotebook?.id).toBe(bookAId);
    expect(useAppStore.getState().pages[0].strokes).toHaveLength(1);
    expect(useAppStore.getState().pages[0].strokes[0].color).toBe('#072D59');

    // Change shared top color picker to crimson #FD6E88 and draw directly on Right pane (Physics Notes)
    await act(async () => {
      useAppStore.getState().setActiveColor('#FD6E88');
    });
    const rightCanvas = rightPane.querySelector<HTMLCanvasElement>('[data-testid="active-canvas-1"]')!;
    await act(async () => {
      dispatchPointer(rightCanvas, 'pointerdown', { clientX: 50, clientY: 80 });
      dispatchPointer(rightCanvas, 'pointermove', { clientX: 140, clientY: 130 });
      dispatchPointer(rightCanvas, 'pointerup', { clientX: 140, clientY: 130 });
    });

    // Synchronous pane focus switched on first gesture and saved crimson stroke to Physics Notes!
    expect(useAppStore.getState().activePaneSide).toBe('right');
    expect(useAppStore.getState().activeNotebook?.id).toBe(bookBId);
    expect(useAppStore.getState().pages[0].strokes).toHaveLength(1);
    expect(useAppStore.getState().pages[0].strokes[0].color).toBe('#FD6E88');
    expect(useAppStore.getState().splitPane?.notebook.id).toBe(bookAId);
    expect(useAppStore.getState().splitPane?.pages[0].strokes).toHaveLength(1);

    // Spawn & edit textbox on Right pane, then click back to Left pane -> commits Right textbox and focuses Left
    await act(async () => {
      const rightPageId = useAppStore.getState().activePageId!;
      const tb = useAppStore.getState().spawnTextbox({
        pageId: rightPageId,
        x: 60,
        y: 150,
        initialText: 'F = ma',
      })!;
      expect(tb).not.toBeNull();
    });
    expect(useAppStore.getState().activeTextboxId).not.toBeNull();

    // Click Left pane header pill to focus Left without adding a second pen dot -> commits Right textbox & keeps Left's 1 stroke
    const leftBadge = container.querySelector<HTMLElement>('[data-testid="split-pane-badge-left"]')!;
    await act(async () => {
      dispatchPointer(leftBadge, 'pointerdown', { clientX: 30, clientY: 40 });
      dispatchPointer(leftBadge, 'pointerup', { clientX: 30, clientY: 40 });
    });
    expect(useAppStore.getState().activePaneSide).toBe('left');
    expect(useAppStore.getState().activeNotebook?.id).toBe(bookAId);
    expect(useAppStore.getState().splitPane?.pages[0].textboxes?.[0].text).toBe('F = ma');

    // Undo while focused on Left pane undoes ONLY Drama Script's stroke, leaving Physics Notes intact
    await act(async () => {
      useAppStore.getState().undo();
    });
    expect(useAppStore.getState().pages[0].strokes).toHaveLength(0);
    expect(useAppStore.getState().splitPane?.pages[0].strokes).toHaveLength(1);

    // Swap sides flips Left and Right panes cleanly
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="split-swap-sides-btn"]')!.click();
    });
    expect(
      container
        .querySelector('[data-testid="split-pane-left"]')
        ?.getAttribute('data-notebook-id'),
    ).toBe(bookBId);
    expect(
      container
        .querySelector('[data-testid="split-pane-right"]')
        ?.getAttribute('data-notebook-id'),
    ).toBe(bookAId);

    // Verify both notebooks persisted accurately in IndexedDB
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    const persistedB = await repository.getNotebookWithPages(bookBId);
    expect(persistedB?.pages[0].strokes).toHaveLength(1);
    expect(persistedB?.pages[0].textboxes?.[0].text).toBe('F = ma');

    // Closing Left pane (Physics Notes) promotes Right pane (Drama Script) to single full-screen editor
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="split-pane-close-left"]')!.click();
      await vi.waitFor(() => {
        expect(useAppStore.getState().splitPane).toBeNull();
      });
    });
    expect(container.querySelector('[data-testid="split-editor-container"]')).toBeNull();
    expect(useAppStore.getState().activeNotebook?.id).toBe(bookAId);
  });
});
