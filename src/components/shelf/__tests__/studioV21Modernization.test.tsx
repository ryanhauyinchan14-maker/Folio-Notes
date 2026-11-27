// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../App';
import { db } from '../../../db/database';
import { useAppStore } from '../../../store/useAppStore';
import { DEFAULT_UI_SCALE } from '../../../utils/uiZoom';
import { SettingsModal } from '../../modals/SettingsModal';
import { CoverPreview } from '../CoverPreview';
import { HomeShelf } from '../HomeShelf';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function clearDb() {
  await db.folders.clear();
  await db.notebooks.clear();
  await db.pages.clear();
  await db.templates.clear();
  await db.pdfAssets.clear();
  await db.trashedNotebooks.clear();
}

describe('Folio Studio v2.1 Modernization: 200% Zoom, Framed PDF Covers, 3-Mode Templates & Studio Settings', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    window.localStorage.clear();
    document.documentElement.style.zoom = '';
    delete document.documentElement.dataset.uiScale;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    HTMLElement.prototype.scrollIntoView = vi.fn();
    await clearDb();
    useAppStore.setState({
      activeNotebook: null,
      pages: [],
      activePageId: null,
      activeWorkspaceFilter: 'all',
      uiScale: DEFAULT_UI_SCALE,
      defaultBrushId: 'technical',
      defaultNotePageStyle: 'paginated',
      defaultSlideSizePreset: '16:9',
      shelfLoading: false,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await useAppStore.getState().closeNotebook();
    await clearDb();
    vi.restoreAllMocks();
  });

  it('frames both new and legacy imported PDF covers smaller & centered inside a navy notebook outline while keeping full-bleed custom images intact', async () => {
    const samplePdfThumb = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

    await act(async () => {
      root.render(
        <div>
          <div data-testid="legacy-pdf-cover">
            <CoverPreview
              title="Lesson 6.1 Solutions"
              mode="notebook"
              cover={{
                styleId: 'custom-image',
                primaryColor: '#072D59',
                accentColor: '#DBF2FC',
                pattern: 'solid',
                customImageDataUrl: samplePdfThumb,
              }}
            />
          </div>
          <div data-testid="new-pdf-cover">
            <CoverPreview
              title="Calculus Notes"
              mode="notebook"
              cover={{
                styleId: 'custom-image',
                primaryColor: '#072D59',
                accentColor: '#DBF2FC',
                pattern: 'solid',
                customImageDataUrl: samplePdfThumb,
                imagePresentation: 'inset',
              }}
            />
          </div>
          <div data-testid="fullbleed-photo-cover">
            <CoverPreview
              title="Photo Journal"
              mode="notebook"
              cover={{
                styleId: 'custom-image',
                primaryColor: '#334155',
                accentColor: '#94A3B8',
                pattern: 'solid',
                customImageDataUrl: samplePdfThumb,
                imagePresentation: 'full',
              }}
            />
          </div>
        </div>,
      );
    });

    const legacy = container.querySelector('[data-testid="legacy-pdf-cover"]')!;
    const fresh = container.querySelector('[data-testid="new-pdf-cover"]')!;
    const full = container.querySelector('[data-testid="fullbleed-photo-cover"]')!;

    expect(legacy.querySelector('[data-cover-presentation="inset"]')).not.toBeNull();
    expect(legacy.querySelector('[data-testid="pdf-inset-cover-preview"] img')).not.toBeNull();
    expect(legacy.textContent).toContain('PDF');

    expect(fresh.querySelector('[data-cover-presentation="inset"]')).not.toBeNull();
    expect(fresh.querySelector('[data-testid="pdf-inset-cover-preview"] img')).not.toBeNull();

    expect(full.querySelector('[data-cover-presentation="full"]')).not.toBeNull();
    expect(full.querySelector('[data-testid="pdf-inset-cover-preview"]')).toBeNull();
  });

  it('allows Ctrl+Scroll on Home Shelf and Settings UI Scale controls to zoom smoothly up to 200%', async () => {
    await act(async () => {
      await useAppStore.getState().initApp();
      useAppStore.getState().setUiScale(1.85);
      root.render(<App />);
    });

    // Scroll up 4 times with Ctrl held on shelf: 1.85 -> 1.9 -> 1.95 -> 2.0 -> 2.0 (clamped)
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        window.dispatchEvent(
          new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }),
        );
      });
    }
    expect(useAppStore.getState().uiScale).toBe(2.0);
    expect(document.documentElement.style.zoom).toBe('2');

    // Settings Appearance slider max=200 and quick preset buttons (175%, 200%) work cleanly
    await act(async () => {
      root.render(<SettingsModal open={true} initialTab="appearance" onClose={() => {}} />);
    });
    const slider = container.querySelector<HTMLInputElement>(
      '[data-testid="settings-ui-scale-slider"]',
    )!;
    expect(slider.max).toBe('200');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="settings-ui-scale-preset-175"]')!.click();
    });
    expect(useAppStore.getState().uiScale).toBe(1.75);
    expect(container.querySelector('[data-testid="settings-ui-scale-value"]')?.textContent).toBe('175%');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="settings-ui-scale-preset-200"]')!.click();
    });
    expect(useAppStore.getState().uiScale).toBe(2.0);
    expect(container.querySelector('[data-testid="settings-ui-scale-value"]')?.textContent).toBe('200%');
  });

  it('launches curated Docs and multi-slide Decks directly from Studio Template Gallery', async () => {
    await act(async () => {
      await useAppStore.getState().initApp();
      root.render(<HomeShelf />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="rail-nav-templates"]')!.click();
    });

    // Click Docs tab and launch Meeting Notes template
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="template-tab-notes"]')!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="template-preset-tpl-note-meeting"]')!.click();
    });
    await vi.waitFor(
      () => {
        expect(useAppStore.getState().activeNotebook?.mode).toBe('notes');
        expect(useAppStore.getState().activeNotebook?.title).toBe('Meeting Notes');
      },
      { timeout: 3000 },
    );
    expect(useAppStore.getState().pages[0]?.noteData?.plainText).toContain('Meeting Notes');

    // Return to shelf and launch 3-slide Pitch Deck from Slides tab
    await act(async () => {
      await useAppStore.getState().closeNotebook();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="rail-nav-templates"]')!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="template-tab-slides"]')!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="template-preset-tpl-slide-pitch"]')!.click();
    });
    await vi.waitFor(
      () => {
        expect(useAppStore.getState().activeNotebook?.mode).toBe('slides');
        expect(useAppStore.getState().activeNotebook?.title).toBe('Pitch Deck');
        expect(useAppStore.getState().pages).toHaveLength(3);
      },
      { timeout: 3000 },
    );
    expect(useAppStore.getState().activeNotebook?.slideSizePreset).toBe('16:9');
  });

  it('applies Studio Mode Defaults from Settings when creating Docs and Slides', async () => {
    await act(async () => {
      await useAppStore.getState().initApp();
      root.render(<SettingsModal open={true} initialTab="general" onClose={() => {}} />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="settings-default-note-style-pageless"]')!.click();
      const slideSelect = container.querySelector<HTMLSelectElement>(
        '[data-testid="settings-default-slide-size-select"]',
      )!;
      slideSelect.value = '1:1';
      slideSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(useAppStore.getState().defaultNotePageStyle).toBe('pageless');
    expect(useAppStore.getState().defaultSlideSizePreset).toBe('1:1');

    await act(async () => {
      root.render(<HomeShelf />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="quick-create-note"]')!.click();
    });
    await vi.waitFor(
      () => {
        expect(useAppStore.getState().activeNotebook?.mode).toBe('notes');
      },
      { timeout: 3000 },
    );
    expect(useAppStore.getState().pages[0]?.noteData?.pageStyle).toBe('pageless');

    await act(async () => {
      await useAppStore.getState().closeNotebook();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="quick-create-slides"]')!.click();
    });
    await vi.waitFor(
      () => {
        expect(useAppStore.getState().activeNotebook?.mode).toBe('slides');
      },
      { timeout: 3000 },
    );
    expect(useAppStore.getState().activeNotebook?.slideSizePreset).toBe('1:1');
    expect(useAppStore.getState().pages[0]?.paper.width).toBe(1080);
    expect(useAppStore.getState().pages[0]?.paper.height).toBe(1080);
  });
});
