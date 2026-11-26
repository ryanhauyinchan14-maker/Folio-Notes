// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../App';
import { COVER_PRESETS } from '../../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../../constants/papers';
import { db } from '../../../db/database';
import { useAppStore } from '../../../store/useAppStore';
import { NotebookEditor } from '../../editor/NotebookEditor';
import { HomeShelf } from '../HomeShelf';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function resetDbAndStore() {
  await db.folders.clear();
  await db.notebooks.clear();
  await db.pages.clear();
  await db.templates.clear();
  await db.pdfAssets.clear();
  await db.trashedNotebooks.clear();
  useAppStore.setState({
    currentFolderId: null,
    activeWorkspaceFilter: 'all',
    folders: [],
    notebooks: [],
    breadcrumbs: [],
    coverThumbnails: {},
    customTemplates: [],
    trashedNotebooks: [],
    recentDeletedNotebooks: [],
    activeNotebook: null,
    pages: [],
    activePageId: null,
    undoStack: [],
    redoStack: [],
    lassoSelection: null,
    activeTextboxId: null,
    selectedTextboxId: null,
    selectedTextboxIds: [],
    selectedImageIds: [],
    croppingImageId: null,
    activeTool: 'pen',
  });
}

describe('Milestone 1: 3-Mode Workspace Organization & Drawing Board Guardrails', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    HTMLElement.prototype.scrollIntoView = vi.fn();
    await resetDbAndStore();
    useAppStore.setState({ shelfLoading: false });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await resetDbAndStore();
    vi.restoreAllMocks();
  });

  it('filters HomeShelf across All, Drawing Board, Notes, and Slides via left nav rail with distinct cover badges', async () => {
    await act(async () => {
      const store = useAppStore.getState();
      await store.createNotebook({
        title: 'Sketch Folio',
        mode: 'notebook',
        folderId: null,
        cover: COVER_PRESETS[0].cover,
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: false,
      });
      await store.createNotebook({
        title: 'Physics Essay',
        mode: 'notes',
        folderId: null,
        cover: COVER_PRESETS[1].cover,
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: false,
      });
      await store.createNotebook({
        title: 'Keynote Pitch',
        mode: 'slides',
        folderId: null,
        cover: COVER_PRESETS[2].cover,
        paper: { ...DEFAULT_PAPER_CONFIG, width: 1920, height: 1080 },
        openImmediately: false,
      });
      await store.refreshShelf();
      root.render(<HomeShelf />);
    });

    expect(container.textContent).toContain('Sketch Folio');
    expect(container.textContent).toContain('Physics Essay');
    expect(container.textContent).toContain('Keynote Pitch');
    expect(container.querySelector('[data-testid="drawing-cover-badge"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="notes-cover-badge"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="slides-cover-badge"]')).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="rail-nav-drawing"]')!.click();
    });
    expect(container.textContent).toContain('Sketch Folio');
    expect(container.textContent).not.toContain('Physics Essay');
    expect(container.textContent).not.toContain('Keynote Pitch');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="rail-nav-notes"]')!.click();
    });
    expect(container.textContent).not.toContain('Sketch Folio');
    expect(container.textContent).toContain('Physics Essay');
    expect(container.textContent).not.toContain('Keynote Pitch');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="rail-nav-slides"]')!.click();
    });
    expect(container.textContent).not.toContain('Sketch Folio');
    expect(container.textContent).not.toContain('Physics Essay');
    expect(container.textContent).toContain('Keynote Pitch');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="rail-nav-home"]')!.click();
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(container.textContent).toContain('Sketch Folio');
    expect(container.textContent).toContain('Physics Essay');
    expect(container.textContent).toContain('Keynote Pitch');
  });

  it('creates Notes and 16:9 default Slides via quick-create buttons and routes App cleanly', async () => {
    await act(async () => {
      await useAppStore.getState().initApp();
      root.render(<App />);
    });

    // Quick create Note -> routes to NotesEditor
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="quick-create-note"]')!.click();
    });
    await vi.waitFor(
      () => {
        expect(container.querySelector('[data-testid="notes-editor-shell"]')).not.toBeNull();
      },
      { timeout: 3000 },
    );
    expect(useAppStore.getState().activeNotebook?.mode).toBe('notes');
    expect(useAppStore.getState().pages[0]?.noteData).toBeTruthy();

    // Return to Shelf
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="notes-back-to-shelf-btn"]')!.click();
    });
    await vi.waitFor(
      () => {
        expect(useAppStore.getState().activeNotebook).toBeNull();
      },
      { timeout: 3000 },
    );

    // Quick create Slides -> 16:9 (1920x1080) default, routes to SlidesEditor
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="quick-create-slides"]')!.click();
    });
    await vi.waitFor(
      () => {
        expect(container.querySelector('[data-testid="slides-editor-shell"]')).not.toBeNull();
      },
      { timeout: 3000 },
    );
    const slideNb = useAppStore.getState().activeNotebook;
    const slidePage = useAppStore.getState().pages[0];
    expect(slideNb?.mode).toBe('slides');
    expect(slideNb?.slideSizePreset).toBe('16:9');
    expect(slidePage?.paper.width).toBe(1920);
    expect(slidePage?.paper.height).toBe(1080);
    expect(slidePage?.slideData?.elements.length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('[data-testid="slides-editor-shell"]')).not.toBeNull();
  });

  it('removes Text tool button, T shortcut, double-click spawn, and random-key textbox spawning from Drawing Board Mode', async () => {
    await act(async () => {
      await useAppStore.getState().initApp();
      await useAppStore.getState().createNotebook({
        title: 'Procreate Sketchbook',
        mode: 'notebook',
        folderId: null,
        cover: COVER_PRESETS[0].cover,
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: true,
      });
      root.render(<NotebookEditor />);
    });

    // Mode badge reads "Drawing Board" and BottomDocks omits "Text" button
    expect(container.querySelector('[data-testid="editor-mode-badge"]')?.textContent).toBe(
      'Drawing Board',
    );
    expect(container.querySelector('button[aria-label="Text"]')).toBeNull();

    // Pressing 't' or random alphabet keys does NOT switch to text or spawn textboxes
    for (const key of ['t', 'a', 'q', 'z', 'x']) {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    }
    expect(useAppStore.getState().activeTool).not.toBe('text');
    expect(useAppStore.getState().pages[0]?.textboxes ?? []).toHaveLength(0);

    // Double-clicking empty canvas in Select mode also never spawns a textbox
    await act(async () => {
      useAppStore.getState().setActiveTool('pan');
    });
    const activeCanvas = container.querySelector<HTMLCanvasElement>('[data-testid="active-canvas-1"]')!;
    await act(async () => {
      activeCanvas.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, clientX: 200, clientY: 200 }),
      );
    });
    expect(useAppStore.getState().pages[0]?.textboxes ?? []).toHaveLength(0);
  });
});
