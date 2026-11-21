import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import { HomeShelf } from '../HomeShelf';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Seal & Crimson Canva-inspired HomeShelf', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      await useAppStore.getState().navigateToFolder(null);
      await useAppStore.getState().initApp();
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await useAppStore.getState().closeNotebook();
  });

  it('renders icon rail, hero banner, and all 6 quick-create circular actions', async () => {
    await act(async () => {
      root.render(<HomeShelf />);
    });

    expect(container.querySelector('[data-testid="home-icon-rail"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rail-new-notebook-btn"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rail-nav-home"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rail-nav-folders"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rail-nav-templates"]')).not.toBeNull();
    expect(container.querySelector('.folio-shelf-canvas')).not.toBeNull();
    expect(container.querySelector('[data-testid="notebooks-grid"]')).not.toBeNull();

    const hero = container.querySelector('[data-testid="home-hero-banner"]')!;
    expect(hero).not.toBeNull();
    expect(hero.textContent).toContain('Your Notes, Ready.');
    expect(hero.textContent).not.toContain('LOCAL-FIRST');
    expect(hero.textContent).not.toContain('Handwritten notebooks, folders, photos');

    expect(container.querySelector('[data-testid="quick-create-blank"]')?.textContent).toContain(
      '+ Blank',
    );
    expect(container.querySelector('[data-testid="quick-create-ruled"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="quick-create-grid"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="quick-create-cornell"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="quick-create-templates"]')?.textContent).toContain(
      'Templates',
    );
    expect(container.querySelector('[data-testid="import-pdf-btn"]')?.textContent).toContain(
      'Import PDF',
    );
    expect(container.querySelector('[data-testid="import-folio-btn"]')?.textContent).toContain(
      'Import',
    );
  });

  it('supports Folders quick-jump navigation and filters matching templates from hero search', async () => {
    await act(async () => {
      await useAppStore.getState().createFolder('Semester One', '#072D59');
      root.render(<HomeShelf />);
    });

    const foldersNav = container.querySelector<HTMLButtonElement>('[data-testid="rail-nav-folders"]')!;
    await act(async () => {
      foldersNav.click();
    });

    const popover = container.querySelector('[data-testid="folders-jump-popover"]')!;
    expect(popover).not.toBeNull();
    expect(popover.textContent).toContain('Semester One');

    const folderBtn = Array.from(popover.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Semester One'),
    )!;
    await act(async () => {
      folderBtn.click();
    });

    expect(useAppStore.getState().currentFolderId).not.toBeNull();
    expect(container.querySelector('[data-testid="home-hero-banner"]')?.textContent).toContain(
      'Semester One',
    );

    const searchInput = container.querySelector<HTMLInputElement>('[data-testid="shelf-search-input"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(searchInput, 'cornell');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const matchingTpl = container.querySelector('[data-testid="matching-templates-section"]');
    expect(matchingTpl).not.toBeNull();
    expect(matchingTpl?.textContent).toContain('Cornell Notes');
  });

  it('creates and opens a Grid notebook immediately on clicking the Grid quick-create button', async () => {
    const mockGetContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    await act(async () => {
      root.render(<HomeShelf />);
    });

    const gridBtn = container.querySelector<HTMLButtonElement>('[data-testid="quick-create-grid"]')!;
    await act(async () => {
      gridBtn.click();
      await vi.waitFor(() => {
        const state = useAppStore.getState();
        expect(state.activeNotebook).not.toBeNull();
        expect(state.activeNotebook?.title).toBe('Grid Notes');
        expect(state.activeNotebook?.defaultPaper.pattern).toBe('grid');
      });
    });
    mockGetContext.mockRestore();
  });

  it('allows clicking and editing the hero workspace headline directly on the shelf', async () => {
    await act(async () => {
      root.render(<HomeShelf />);
    });

    const headlineBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="hero-headline-button"]',
    )!;
    expect(headlineBtn.textContent).toContain('Your Notes, Ready.');

    await act(async () => {
      headlineBtn.click();
    });

    const headlineInput = container.querySelector<HTMLInputElement>(
      '[data-testid="hero-headline-input"]',
    )!;
    expect(headlineInput).not.toBeNull();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(headlineInput, 'Research Studio');
      headlineInput.dispatchEvent(new Event('input', { bubbles: true }));
      headlineInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      headlineInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(useAppStore.getState().heroHeadline).toBe('Research Studio');
    expect(
      container.querySelector('[data-testid="hero-headline-button"]')?.textContent,
    ).toContain('Research Studio');

    await act(async () => {
      useAppStore.getState().setHeroHeadline('Your Notes, Ready.');
    });
  });
});
