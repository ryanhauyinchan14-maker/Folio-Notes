import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COVER_PRESETS } from '../../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../../constants/papers';
import { useAppStore } from '../../../store/useAppStore';
import { TemplatePickerModal } from '../../modals/TemplatePickerModal';
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

  it('renders clean 3-icon nav capsule, shader-backed compact header, and non-duplicated actions', async () => {
    await act(async () => {
      root.render(<HomeShelf />);
    });

    const rail = container.querySelector('[data-testid="home-icon-rail"]')!;
    expect(rail).not.toBeNull();
    expect(rail.className).toContain('fixed');
    expect(rail.className).toContain('overflow-hidden');
    expect(rail.className).toContain('rounded-full');
    expect(rail.className).toContain('md:rounded-[24px]');
    expect(rail.className).not.toContain('md:sticky');
    expect(rail.querySelector('[data-testid="home-rail-shader"]')).not.toBeNull();
    expect(rail.querySelector('.folio-rail-scrim')).not.toBeNull();

    expect(container.querySelector('[data-testid="rail-nav-home"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rail-nav-templates"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rail-nav-settings"]')).not.toBeNull();

    // Removed duplicate/slop chrome must stay absent
    expect(container.querySelector('[data-testid="rail-new-notebook-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="rail-nav-folders"]')).toBeNull();
    expect(container.querySelector('[data-testid="folders-jump-popover"]')).toBeNull();
    expect(container.querySelector('[data-testid="workspace-stats-pill"]')).toBeNull();
    expect(container.querySelector('[data-testid="command-palette-trigger"]')).toBeNull();
    expect(container.querySelector('[data-testid="hero-bento-new-notebook"]')).toBeNull();
    expect(container.querySelector('[data-testid="quick-create-templates"]')).toBeNull();
    expect(container.querySelector('[data-testid="quick-create-blank"]')).toBeNull();
    expect(container.querySelector('[data-testid="quick-create-ruled"]')).toBeNull();
    expect(container.querySelector('[data-testid="quick-create-grid"]')).toBeNull();
    expect(container.querySelector('[data-testid="quick-create-cornell"]')).toBeNull();

    const canvas = container.querySelector('.folio-shelf-canvas')!;
    expect(canvas).not.toBeNull();
    expect(canvas.className).toContain('md:pl-[96px]');
    expect(container.firstElementChild?.className).not.toContain('overflow-x-hidden');
    expect(container.querySelector('[data-testid="notebooks-grid"]')).not.toBeNull();

    const hero = container.querySelector('[data-testid="home-hero-banner"]')!;
    expect(hero).not.toBeNull();
    expect(hero.querySelector('[data-testid="home-hero-shader"]')).not.toBeNull();
    expect(hero.textContent).toContain('Your Notes, Ready.');
    expect(hero.textContent).toContain('canvas');
    expect(hero.textContent).not.toContain('LOCAL-FIRST');
    expect(hero.textContent).not.toContain('Cover, folder & template');

    const newCanvasBtn = container.querySelector('[data-testid="hero-new-notebook-btn"]')!;
    const newDocBtn = container.querySelector('[data-testid="quick-create-note"]')!;
    const newSlidesBtn = container.querySelector('[data-testid="quick-create-slides"]')!;
    expect(newCanvasBtn.textContent).toContain('New Canvas');
    expect(newDocBtn.textContent).toContain('New Doc');
    expect(newSlidesBtn.textContent).toContain('New Slides');
    expect(newCanvasBtn.className).toContain('folio-btn-crimson');
    expect(newDocBtn.className).toContain('folio-btn-crimson');
    expect(newSlidesBtn.className).toContain('folio-btn-crimson');
    expect(newCanvasBtn.className).toContain('rounded-full');
    expect(newDocBtn.className).toContain('rounded-full');
    expect(newSlidesBtn.className).toContain('rounded-full');
    expect(container.querySelector('[data-testid="quick-create-whiteboard"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="import-pdf-btn"]')?.textContent).toContain(
      'Import PDF',
    );
    expect(container.querySelector('[data-testid="import-folio-btn"]')?.textContent).toContain(
      'Import',
    );
  });

  it('supports direct shelf folder navigation with breadcrumbs and filters matching templates from search', async () => {
    await act(async () => {
      await useAppStore.getState().createFolder('Semester One', '#072D59');
      root.render(<HomeShelf />);
    });

    const folderBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Semester One'),
    )!;
    expect(folderBtn).toBeTruthy();
    await act(async () => {
      folderBtn.click();
    });

    expect(useAppStore.getState().currentFolderId).not.toBeNull();
    const hero = container.querySelector('[data-testid="home-hero-banner"]')!;
    expect(hero.textContent).toContain('Semester One');
    expect(hero.textContent).toContain('All Notes');

    const searchInput = container.querySelector<HTMLInputElement>('[data-testid="shelf-search-input"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(searchInput, 'cornell');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const matchingTpl = container.querySelector('[data-testid="matching-templates-section"]');
    expect(matchingTpl).not.toBeNull();
    expect(matchingTpl?.textContent).toContain('Study Notes (Cornell)');
  });

  it('creates and opens a Graph notebook immediately from Templates Gallery', async () => {
    const mockGetContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    try {
      await act(async () => {
        root.render(<HomeShelf />);
      });

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="rail-nav-templates"]')!.click();
      });

      const gridPresetBtn = container.querySelector<HTMLButtonElement>(
        '[data-testid="template-preset-builtin-grid"]',
      )!;
      expect(gridPresetBtn).not.toBeNull();

      await act(async () => {
        gridPresetBtn.click();
        await vi.waitFor(() => {
          const state = useAppStore.getState();
          expect(state.activeNotebook).not.toBeNull();
          expect(state.activeNotebook?.title).toBe('Graph Paper');
          expect(state.activeNotebook?.defaultPaper.pattern).toBe('grid');
        });
      });
    } finally {
      mockGetContext.mockRestore();
    }
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

  it('shows grouped Whiteboards & Built-in Papers without descriptions or badges, switches inline variants, launches a preset, filters hero search, and hides whiteboards in Add Page mode', async () => {
    const mockGetContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      await act(async () => {
        root.render(<HomeShelf />);
      });

      // Open Paper & Template Gallery from clean rail Templates button
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="rail-nav-templates"]')!.click();
      });

      expect(container.querySelector('[data-testid="template-tab-all"]')?.textContent).toContain(
        'All (16)',
      );
      expect(container.querySelector('[data-testid="template-tab-notes"]')?.textContent).toContain(
        'Docs (4)',
      );
      expect(container.querySelector('[data-testid="template-tab-slides"]')?.textContent).toContain(
        'Slides (4)',
      );
      expect(
        container.querySelector('[data-testid="template-tab-whiteboards"]')?.textContent,
      ).toContain('Whiteboards (3)');
      expect(container.querySelector('[data-testid="template-tab-papers"]')?.textContent).toContain(
        'Built in Papers (5)',
      );

      const wbSection = container.querySelector('[data-testid="gallery-whiteboards-section"]');
      expect(wbSection).not.toBeNull();
      expect(wbSection?.textContent).toContain('Dotted Whiteboard');
      expect(wbSection?.textContent).toContain('Grid Whiteboard');
      expect(wbSection?.textContent).toContain('Blank Whiteboard');
      expect(wbSection?.textContent).not.toContain('Dark Whiteboard');
      expect(wbSection?.textContent).not.toContain('Notes and sketches');
      expect(wbSection?.textContent).not.toContain('Math and diagrams');
      expect(wbSection?.textContent).not.toContain('Open canvas, no borders');
      expect(wbSection?.textContent).not.toContain('Low-light dotted canvas');
      expect(wbSection?.textContent).not.toContain('Unlimited');
      expect(wbSection?.textContent).not.toContain('Infinite');

      const dottedWbCard = wbSection?.querySelector(
        '[data-testid="template-card-builtin-wb-dotted"]',
      );
      expect(
        dottedWbCard?.querySelector('[data-testid="template-variant-builtin-wb-dark-dots"]')
          ?.textContent,
      ).toContain('Dark');

      const papersSection = container.querySelector('[data-testid="gallery-papers-section"]');
      expect(papersSection).not.toBeNull();
      expect(papersSection?.textContent).toContain('Lined Paper');
      expect(papersSection?.textContent).toContain('Graph Paper');
      expect(papersSection?.textContent).toContain('Dotted Paper');
      expect(papersSection?.textContent).toContain('Study Notes (Cornell)');
      expect(papersSection?.textContent).toContain('Blank Paper');
      // Consolidated variants live inside parent cards instead of duplicate top-level cards or descriptions
      expect(papersSection?.textContent).not.toContain('Yellow Lined Pad');
      expect(papersSection?.textContent).not.toContain('Wide Blank Page');
      expect(papersSection?.textContent).not.toContain('Dark Graph Paper');
      expect(papersSection?.textContent).not.toContain('Standard lined paper with a left margin');
      expect(papersSection?.textContent).not.toContain('Small square grid for math');
      expect(papersSection?.textContent).not.toContain('Yellow lined notepad');
      expect(papersSection?.textContent).not.toContain('Dark background with a square grid');

      const linedCard = papersSection?.querySelector(
        '[data-testid="template-card-builtin-ruled-letter"]',
      );
      expect(
        linedCard?.querySelector('[data-testid="template-variant-builtin-wide-ruled"]')
          ?.textContent,
      ).toContain('Wide Cream');
      expect(
        linedCard?.querySelector('[data-testid="template-variant-builtin-legal-pad"]')?.textContent,
      ).toContain('Yellow');

      const graphCard = papersSection?.querySelector('[data-testid="template-card-builtin-grid"]');
      expect(
        graphCard?.querySelector('[data-testid="template-variant-builtin-dark-grid"]')?.textContent,
      ).toContain('Dark');

      const blankCard = papersSection?.querySelector('[data-testid="template-card-builtin-blank"]');
      expect(
        blankCard?.querySelector('[data-testid="template-variant-builtin-landscape-sketch"]')
          ?.textContent,
      ).toContain('Wide');

      // Tab filtering: Whiteboards, Built-in Papers, My Templates
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('[data-testid="template-tab-whiteboards"]')!
          .click();
      });
      expect(container.querySelector('[data-testid="gallery-whiteboards-section"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="gallery-papers-section"]')).toBeNull();

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="template-tab-papers"]')!.click();
      });
      expect(container.querySelector('[data-testid="gallery-papers-section"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="gallery-whiteboards-section"]')).toBeNull();

      // Switching inline variant on Graph Paper to Dark and launching creates Dark Graph Paper
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('[data-testid="template-variant-builtin-dark-grid"]')!
          .click();
      });
      expect(
        container
          .querySelector('[data-testid="template-variant-builtin-dark-grid"]')
          ?.getAttribute('aria-pressed'),
      ).toBe('true');
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('[data-testid="template-preset-builtin-grid"]')!
          .click();
        await vi.waitFor(() => {
          const state = useAppStore.getState();
          expect(state.activeNotebook).not.toBeNull();
          expect(state.activeNotebook?.mode).toBe('notebook');
          expect(state.activeNotebook?.title).toBe('Dark Graph Paper');
          expect(state.activeNotebook?.defaultPaper.pattern).toBe('grid');
          expect(state.activeNotebook?.defaultPaper.paperColor).toBe('#1E293B');
        });
      });

      // Return to shelf, reopen gallery, test My Templates empty state and launch Grid Whiteboard
      await act(async () => {
        await useAppStore.getState().closeNotebook();
        container.querySelector<HTMLButtonElement>('[data-testid="rail-nav-templates"]')!.click();
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="template-tab-custom"]')!.click();
      });
      expect(container.textContent).toContain('No saved templates in My Templates yet');

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('[data-testid="template-tab-whiteboards"]')!
          .click();
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('[data-testid="template-preset-builtin-wb-grid"]')!
          .click();
        await vi.waitFor(() => {
          const state = useAppStore.getState();
          expect(state.activeNotebook).not.toBeNull();
          expect(state.activeNotebook?.mode).toBe('whiteboard');
          expect(state.activeNotebook?.title).toBe('Grid Whiteboard');
          expect(state.activeNotebook?.defaultPaper.pattern).toBe('grid');
        });
      });

      // Test selecting Yellow variant inside Lined Paper
      await act(async () => {
        await useAppStore.getState().closeNotebook();
        container.querySelector<HTMLButtonElement>('[data-testid="rail-nav-templates"]')!.click();
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('[data-testid="template-variant-builtin-legal-pad"]')!
          .click();
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[data-testid="template-preset-builtin-ruled-letter"]',
          )!
          .click();
        await vi.waitFor(() => {
          const state = useAppStore.getState();
          expect(state.activeNotebook?.title).toBe('Yellow Lined Pad');
          expect(state.activeNotebook?.defaultPaper.paperColor).toBe('#FEF7C3');
        });
      });

      // Return to shelf and test hero search for "whiteboard" and "yellow"
      await act(async () => {
        await useAppStore.getState().closeNotebook();
      });
      const searchInput = container.querySelector<HTMLInputElement>(
        '[data-testid="shelf-search-input"]',
      )!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(searchInput, 'yellow');
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(
        container.querySelector('[data-testid="matching-templates-section"]')?.textContent,
      ).toContain('Yellow Lined Pad');

      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(searchInput, 'whiteboard');
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const matchingTpl = container.querySelector('[data-testid="matching-templates-section"]');
      expect(matchingTpl).not.toBeNull();
      expect(matchingTpl?.textContent).toContain('Dotted Whiteboard');
      expect(matchingTpl?.textContent).toContain('Dark Whiteboard');

      const dotBoardHit = Array.from(matchingTpl!.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Dotted Whiteboard'),
      )!;
      await act(async () => {
        dotBoardHit.click();
        await vi.waitFor(() => {
          const state = useAppStore.getState();
          expect(state.activeNotebook?.mode).toBe('whiteboard');
          expect(state.activeNotebook?.title).toBe('Dotted Whiteboard');
        });
      });

      // Inside-notebook Add Page from Template mode hides Whiteboards and shows 5 Built-in Papers + Same as Current Page
      await act(async () => {
        await useAppStore.getState().closeNotebook();
        root.render(
          <TemplatePickerModal
            open={true}
            currentPaper={DEFAULT_PAPER_CONFIG}
            onSelect={() => {}}
            onClose={() => {}}
          />,
        );
      });
      expect(container.querySelector('[data-testid="template-tab-whiteboards"]')).toBeNull();
      expect(container.querySelector('[data-testid="template-tab-papers"]')?.textContent).toContain(
        'Built in Papers (5)',
      );
      expect(container.textContent).toContain('Same as Current Page');
      expect(container.querySelector('[data-testid="gallery-papers-section"]')).not.toBeNull();
    } finally {
      mockGetContext.mockRestore();
    }
  });

  it('opens Ctrl+K Command Palette to search templates/notebooks and pauses BookTiltCard tilt when menu opens', async () => {
    await act(async () => {
      await useAppStore.getState().createNotebook({
        title: 'Quantum Studio Book',
        folderId: null,
        cover: { ...COVER_PRESETS[0].cover },
        paper: DEFAULT_PAPER_CONFIG,
        openImmediately: false,
      });
      root.render(<HomeShelf />);
    });

    const card = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid^="book-tilt-card-"]'),
    ).find((el) => el.textContent?.includes('Quantum Studio Book'))!;
    expect(card).toBeTruthy();
    expect(card.getAttribute('data-menu-open')).toBe('false');
    expect(card.querySelector('[data-testid^="book-card-quick-bar-"]')).toBeNull();

    const menuBtn = card.querySelector<HTMLButtonElement>(
      'button[aria-label="Notebook options for Quantum Studio Book"]',
    )!;
    await act(async () => {
      menuBtn.click();
    });
    expect(card.getAttribute('data-menu-open')).toBe('true');
    expect(card.className).toContain('z-40');

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
      );
    });

    const palette = container.querySelector('[data-testid="command-palette-modal"]');
    expect(palette).not.toBeNull();

    const paletteInput = container.querySelector<HTMLInputElement>(
      '[data-testid="command-palette-input"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(paletteInput, 'cornell');
      paletteInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(palette?.textContent).toContain('Study Notes (Cornell)');

    await act(async () => {
      paletteInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(container.querySelector('[data-testid="command-palette-modal"]')).toBeNull();
  });

  it('keeps BookTiltCard hit-targets stationary for reliable cover and metadata clicks and resets tilt when menu opens', async () => {
    let createdId = '';
    await act(async () => {
      const created = await useAppStore.getState().createNotebook({
        title: 'Responsive Click Book',
        folderId: null,
        cover: { ...COVER_PRESETS[0].cover },
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: false,
      });
      createdId = created.id;
      root.render(<HomeShelf />);
    });

    const openSurface = container.querySelector<HTMLButtonElement>(
      `[data-testid="book-card-open-surface-${createdId}"]`,
    )!;
    const visualLayer = container.querySelector<HTMLElement>(
      `[data-testid="book-card-visual-${createdId}"]`,
    )!;
    const metaBtn = container.querySelector<HTMLButtonElement>(
      `[data-testid="book-card-meta-open-${createdId}"]`,
    )!;
    expect(openSurface).toBeTruthy();
    expect(visualLayer).toBeTruthy();
    expect(metaBtn).toBeTruthy();

    // Cover button stays flat/unshrunk while inner visual wrapper ignores pointer hit-testing
    expect(openSurface.className).not.toContain('folio-press');
    expect(openSurface.style.transformStyle).not.toBe('preserve-3d');
    expect(visualLayer.className).toContain('pointer-events-none');

    vi.spyOn(openSurface, 'getBoundingClientRect').mockReturnValue({
      left: 50,
      top: 100,
      width: 200,
      height: 266,
      right: 250,
      bottom: 366,
      x: 50,
      y: 100,
      toJSON: () => ({}),
    });

    // Simulate hover tilt + pointerdown/pointerup/click sequence on the cover
    await act(async () => {
      const moveEvt = new MouseEvent('pointermove', {
        bubbles: true,
        clientX: 210,
        clientY: 140,
      });
      Object.defineProperty(moveEvt, 'pointerType', { value: 'mouse' });
      Object.defineProperty(moveEvt, 'buttons', { value: 0 });
      openSurface.dispatchEvent(moveEvt);
      await new Promise((r) => setTimeout(r, 30));

      const downEvt = new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 210,
        clientY: 140,
      });
      const upEvt = new MouseEvent('pointerup', {
        bubbles: true,
        button: 0,
        clientX: 210,
        clientY: 140,
      });
      openSurface.dispatchEvent(downEvt);
      openSurface.dispatchEvent(upEvt);
      openSurface.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(useAppStore.getState().activeNotebook?.id).toBe(createdId);

    // Return to shelf and verify clicking metadata / subtitle opens the notebook reliably
    await act(async () => {
      await useAppStore.getState().closeNotebook();
    });
    expect(useAppStore.getState().activeNotebook).toBeNull();

    const metaAfterClose = container.querySelector<HTMLButtonElement>(
      `[data-testid="book-card-meta-open-${createdId}"]`,
    )!;
    await act(async () => {
      metaAfterClose.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(useAppStore.getState().activeNotebook?.id).toBe(createdId);

    // Return to shelf, hover to tilt, open menu, and verify tilt resets cleanly to flat
    await act(async () => {
      await useAppStore.getState().closeNotebook();
    });
    const surface2 = container.querySelector<HTMLButtonElement>(
      `[data-testid="book-card-open-surface-${createdId}"]`,
    )!;
    const visual2 = container.querySelector<HTMLElement>(
      `[data-testid="book-card-visual-${createdId}"]`,
    )!;
    vi.spyOn(surface2, 'getBoundingClientRect').mockReturnValue({
      left: 50,
      top: 100,
      width: 200,
      height: 266,
      right: 250,
      bottom: 366,
      x: 50,
      y: 100,
      toJSON: () => ({}),
    });
    await act(async () => {
      const moveEvt = new MouseEvent('pointermove', {
        bubbles: true,
        clientX: 210,
        clientY: 140,
      });
      Object.defineProperty(moveEvt, 'pointerType', { value: 'mouse' });
      Object.defineProperty(moveEvt, 'buttons', { value: 0 });
      surface2.dispatchEvent(moveEvt);
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(visual2.style.transform).toContain('rotateX(');

    const menuBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Notebook options for Responsive Click Book"]',
    )!;
    await act(async () => {
      menuBtn.click();
    });
    expect(visual2.style.transform).toBe('rotateX(0deg) rotateY(0deg) translateY(0px) scale(1)');
  });
});
