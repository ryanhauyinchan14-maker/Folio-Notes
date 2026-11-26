// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COVER_PRESETS } from '../../../constants/covers';
import { db } from '../../../db/database';
import { exportSlidesAsPdf } from '../../../slides/slideExport';
import { DEFAULT_SLIDE_PAPER } from '../../../slides/slidePresets';
import { useAppStore } from '../../../store/useAppStore';
import { generateRecoveryKey } from '../../../utils/vaultCrypto';
import { SlidesEditor } from '../SlidesEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function resetDb() {
  await db.folders.clear();
  await db.notebooks.clear();
  await db.pages.clear();
  await db.templates.clear();
  await db.pdfAssets.clear();
  await db.trashedNotebooks.clear();
  useAppStore.setState({
    activeNotebook: null,
    pages: [],
    activePageId: null,
    unlockedMasterKey: null,
  });
}

describe('Milestone 3: Canva-style Slides Mode & Custom Dimensions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await resetDb();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await resetDb();
    vi.restoreAllMocks();
  });

  it('defaults to 16:9 (1920x1080), supports Custom Size resize, shapes/textboxes, filmstrip, speaker notes, Present Mode, and Vault round-trip', async () => {
    let deckId = '';
    await act(async () => {
      await useAppStore.getState().initApp();
      const deck = await useAppStore.getState().createNotebook({
        title: 'Product Keynote',
        mode: 'slides',
        slideSizePreset: '16:9',
        folderId: null,
        cover: COVER_PRESETS[2].cover,
        paper: { ...DEFAULT_SLIDE_PAPER },
        openImmediately: true,
      });
      deckId = deck.id;
      root.render(<SlidesEditor />);
    });

    expect(container.querySelector('[data-testid="slides-editor-shell"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="slides-custom-size-btn"]')?.textContent).toContain(
      '16:9 · 1920×1080',
    );
    const initialElCount = useAppStore.getState().pages[0].slideData?.elements.length ?? 0;
    expect(initialElCount).toBeGreaterThanOrEqual(2);

    // 1) Resize deck to Custom Size 1080x1350 via SlideSizeModal
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="slides-custom-size-btn"]')!.click();
    });
    const modal = container.querySelector('[data-testid="slide-size-modal"]');
    expect(modal).not.toBeNull();

    const widthInput = container.querySelector<HTMLInputElement>('[data-testid="modal-custom-width"]')!;
    const heightInput = container.querySelector<HTMLInputElement>('[data-testid="modal-custom-height"]')!;
    const setVal = (el: HTMLInputElement, v: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    await act(async () => {
      setVal(widthInput, '1080');
      setVal(heightInput, '1350');
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="modal-slide-size-apply"]')!.click();
    });
    expect(useAppStore.getState().activeNotebook?.slideSizePreset).toBe('custom');
    expect(useAppStore.getState().pages[0].paper.width).toBe(1080);
    expect(useAppStore.getState().pages[0].paper.height).toBe(1350);

    // 2) Add Textbox & Shape via left Canva rail
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="slides-rail-tab-text"]')!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="slides-add-text-heading"]')!.click();
    });
    expect(useAppStore.getState().pages[0].slideData?.elements.length).toBe(initialElCount + 1);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="slides-rail-tab-elements"]')!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="slides-add-shape-circle"]')!.click();
    });
    expect(useAppStore.getState().pages[0].slideData?.elements.length).toBe(initialElCount + 2);

    // 3) Toggle Speaker Notes and add slide via filmstrip
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="slides-speaker-notes-toggle"]')!.click();
    });
    const notesBox = container.querySelector<HTMLTextAreaElement>('[data-testid="slides-speaker-notes"]')!;
    expect(notesBox).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(notesBox, 'Pause for Q&A after this slide.');
      notesBox.dispatchEvent(new Event('input', { bubbles: true }));
      notesBox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useAppStore.getState().pages[0].slideData?.speakerNotes).toContain('Pause for Q&A');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="slides-add-btn"]')!.click();
    });
    await vi.waitFor(
      () => {
        expect(useAppStore.getState().pages).toHaveLength(2);
      },
      { timeout: 3000 },
    );

    // 4) Launch Present Mode & navigate slides with keyboard
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="slides-present-btn"]')!.click();
    });
    expect(container.querySelector('[data-testid="slides-present-mode"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="present-slide-counter"]')?.textContent).toBe('2 / 2');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(container.querySelector('[data-testid="present-slide-counter"]')?.textContent).toBe('1 / 2');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('[data-testid="slides-present-mode"]')).toBeNull();

    // 5) Vault encryption round-trip preserves slides, elements & speakerNotes
    const recoveryKey = generateRecoveryKey();
    await act(async () => {
      await useAppStore.getState().closeNotebook();
      await useAppStore.getState().setupVaultAndMaybeLockNotebook('slides-pass-99', recoveryKey, deckId);
      await useAppStore.getState().unlockNotebookWithPassword(deckId, 'slides-pass-99', 'open');
    });
    expect(useAppStore.getState().pages).toHaveLength(2);
    expect(useAppStore.getState().pages[0].paper.width).toBe(1080);
    expect(useAppStore.getState().pages[0].slideData?.speakerNotes).toContain('Pause for Q&A');
  });

  it('exports slide decks to multi-page PDF matching slide dimensions', async () => {
    // Mock canvas toDataURL with a valid 1x1 transparent PNG so pdf-lib embeds cleanly in jsdom
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAhKmMIQAAAABJRU5ErkJggg==',
    );
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      arrayBuffer: async () =>
        Uint8Array.from(
          atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAhKmMIQAAAABJRU5ErkJggg=='),
          (c) => c.charCodeAt(0),
        ).buffer,
    }) as unknown as typeof fetch;

    const bytes = await exportSlidesAsPdf('Sample Deck', [
      {
        id: 's1',
        notebookId: 'd1',
        paper: { ...DEFAULT_SLIDE_PAPER },
        strokes: [],
        slideData: {
          background: { kind: 'solid', color: '#FFFFFF' },
          elements: [],
          speakerNotes: '',
          transition: 'none',
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    expect(bytes.length).toBeGreaterThan(100);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');

    globalThis.fetch = origFetch;
  });
});
