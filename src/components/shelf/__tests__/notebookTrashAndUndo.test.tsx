// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '../../modals/SettingsModal';
import { HomeShelf } from '../HomeShelf';
import { COVER_PRESETS } from '../../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../../constants/papers';
import { db } from '../../../db/database';
import { repository, TRASH_RETENTION_MS } from '../../../db/repository';
import { useAppStore } from '../../../store/useAppStore';
import { generateRecoveryKey, unlockMasterKeyWithPassword } from '../../../utils/vaultCrypto';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function waitForUi(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    if (predicate()) return;
  }
}

describe('7-day Trash in Settings & 5-second Ctrl+Z Delete Undo', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    window.localStorage.clear();
    await db.pdfAssets.clear();
    await db.pages.clear();
    await db.notebooks.clear();
    await db.folders.clear();
    await db.templates.clear();
    await db.trashedNotebooks.clear();

    useAppStore.getState().dismissNotebookDeleteUndo();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      await useAppStore.getState().navigateToFolder(null);
      await useAppStore.getState().initApp();
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    useAppStore.getState().dismissNotebookDeleteUndo();
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await useAppStore.getState().closeNotebook();
  });

  it('moves deleted notebooks (including PDFs and strokes) to Trash for 7 days, restores with original or fallback folder, and purges expired items', async () => {
    const folder = await repository.createFolder('Biology 101', null, '#072D59');
    const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]).buffer;

    const { notebook, pages } = await repository.createPdfNotebook({
      title: 'Cell Lecture',
      folderId: folder.id,
      cover: COVER_PRESETS[0].cover,
      fileName: 'cells.pdf',
      pdfBytes,
      pageSpecs: [{ pageNumber: 1, paper: { ...DEFAULT_PAPER_CONFIG } }],
    });

    await repository.savePageStrokes(notebook.id, pages[0].id, [
      {
        id: 'cell-stroke-1',
        tool: 'pen',
        color: '#072D59',
        size: 4,
        opacity: 1,
        simulatePressure: true,
        points: [
          { x: 20, y: 20, pressure: 0.5 },
          { x: 90, y: 60, pressure: 0.5 },
        ],
        bounds: { minX: 16, minY: 16, maxX: 94, maxY: 64 },
        createdAt: Date.now(),
      },
    ]);

    const t0 = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0);

    const trashed = await repository.deleteNotebook(notebook.id);
    expect(trashed).not.toBeNull();
    expect(trashed?.deletedAt).toBe(t0);
    expect(trashed?.expiresAt).toBe(t0 + TRASH_RETENTION_MS);
    expect(trashed?.originalFolderName).toBe('Biology 101');
    expect(await db.notebooks.get(notebook.id)).toBeUndefined();
    expect(await db.pages.where('notebookId').equals(notebook.id).count()).toBe(0);
    expect(await db.pdfAssets.where('notebookId').equals(notebook.id).count()).toBe(0);

    // Still present at 6 days, 23 hours
    const almostExpired = t0 + TRASH_RETENTION_MS - 60_000;
    expect(await repository.getTrashedNotebooks(almostExpired)).toHaveLength(1);

    // Restore while folder exists -> returns to Biology 101 with strokes and PDF intact
    const restoredInFolder = await repository.restoreTrashedNotebook(notebook.id, t0 + 1000);
    expect(restoredInFolder?.folderId).toBe(folder.id);
    const loadedRestored = await repository.getNotebookWithPages(notebook.id);
    expect(loadedRestored?.pages[0].strokes).toHaveLength(1);
    const restoredAssets = await repository.getPdfAssetRecordsForNotebook(notebook.id);
    expect(restoredAssets).toHaveLength(1);

    // Delete entire folder recursively -> moves notebook to Trash; restore falls back to root Shelf (null)
    const folderTrashed = await repository.deleteFolderRecursive(folder.id);
    expect(folderTrashed).toHaveLength(1);
    expect(await db.folders.get(folder.id)).toBeUndefined();
    const restoredFallback = await repository.restoreTrashedNotebook(notebook.id, t0 + 2000);
    expect(restoredFallback?.folderId).toBeNull();

    // Auto-expiry purges items at >= 7 days
    await repository.deleteNotebook(notebook.id);
    const expiredNow = t0 + TRASH_RETENTION_MS + 1;
    nowSpy.mockReturnValue(expiredNow);
    const purgedCount = await repository.purgeExpiredTrashedNotebooks(expiredNow);
    expect(purgedCount).toBe(1);
    expect(await repository.getTrashedNotebooks(expiredNow)).toHaveLength(0);
  });

  it('keeps Vault-locked notebooks encrypted in Trash and decryptable after restore', async () => {
    const lockedNb = await useAppStore.getState().createNotebook({
      title: 'Sealed Notes',
      folderId: null,
      cover: COVER_PRESETS[2].cover,
      paper: { ...DEFAULT_PAPER_CONFIG },
      openImmediately: false,
    });

    const pageId = lockedNb.pageOrder[0];
    await repository.savePageStrokes(
      lockedNb.id,
      pageId,
      [
        {
          id: 'vault-stroke-1',
          tool: 'pen',
          color: '#072D59',
          size: 4,
          opacity: 1,
          simulatePressure: false,
          points: [
            { x: 10, y: 10, pressure: 0.5 },
            { x: 50, y: 50, pressure: 0.5 },
          ],
          bounds: { minX: 6, minY: 6, maxX: 54, maxY: 54 },
          createdAt: Date.now(),
        },
      ],
      undefined,
      null,
    );

    const rk = generateRecoveryKey();
    await useAppStore.getState().setupVaultAndMaybeLockNotebook('VaultPass123!', rk, lockedNb.id);
    await useAppStore
      .getState()
      .deleteLockedNotebookWithPassword(lockedNb.id, 'VaultPass123!');

    const trashed = await db.trashedNotebooks.get(lockedNb.id);
    expect(trashed).toBeDefined();
    expect(trashed?.notebook.isLocked).toBe(true);
    expect(trashed?.pages[0].strokes).toEqual([]);
    expect(trashed?.pages[0].encryptedStrokes?.ciphertext).toBeTruthy();

    await useAppStore.getState().restoreTrashedNotebook(lockedNb.id);
    const masterKey = await unlockMasterKeyWithPassword('VaultPass123!', false);
    const decrypted = await repository.getNotebookWithPages(lockedNb.id, masterKey);
    expect(decrypted?.notebook.isLocked).toBe(true);
    expect(decrypted?.pages[0].strokes).toHaveLength(1);
  });

  it('supports Ctrl+Z to restore a deleted notebook within 5 seconds, expires Ctrl+Z after 5 seconds while keeping it in Settings Trash, and manages Trash in SettingsModal', async () => {
    const nbUndo = await useAppStore.getState().createNotebook({
      title: 'Quick Restore Book',
      folderId: null,
      cover: COVER_PRESETS[0].cover,
      paper: { ...DEFAULT_PAPER_CONFIG },
      openImmediately: false,
    });
    const nbExpiredUndo = await useAppStore.getState().createNotebook({
      title: 'Older Deleted Book',
      folderId: null,
      cover: COVER_PRESETS[1].cover,
      paper: { ...DEFAULT_PAPER_CONFIG },
      openImmediately: false,
    });

    await act(async () => {
      root.render(<HomeShelf />);
    });

    // Delete first notebook via HomeShelf card menu
    const menuBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Notebook options for Quick Restore Book"]',
    )!;
    await act(async () => {
      menuBtn.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="notebook-card-delete-btn"]')!.click();
    });

    await waitForUi(() => Boolean(container.querySelector('[data-testid="delete-undo-toast"]')));
    expect(container.querySelector('[data-testid="delete-undo-toast"]')?.textContent).toContain(
      'Quick Restore Book',
    );
    expect(await db.notebooks.get(nbUndo.id)).toBeUndefined();
    expect(useAppStore.getState().trashedNotebooks.some((t) => t.id === nbUndo.id)).toBe(true);

    // Ctrl+Z inside search input must NOT hijack input undo
    const searchInput = container.querySelector<HTMLInputElement>(
      '[data-testid="shelf-search-input"]',
    )!;
    await act(async () => {
      searchInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      );
    });
    expect(await db.notebooks.get(nbUndo.id)).toBeUndefined();

    // Global Ctrl+Z on HomeShelf within 5 seconds restores the deleted notebook immediately
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      );
    });
    await waitForUi(
      () =>
        container.querySelector('[data-testid="delete-undo-toast"]') === null &&
        !useAppStore.getState().trashedNotebooks.some((t) => t.id === nbUndo.id) &&
        useAppStore.getState().notebooks.some((n) => n.id === nbUndo.id),
    );
    expect(await db.notebooks.get(nbUndo.id)).toBeDefined();
    expect(useAppStore.getState().trashedNotebooks.some((t) => t.id === nbUndo.id)).toBe(false);

    // Delete second notebook, advance Date.now past 5 seconds -> Ctrl+Z no longer restores, stays in Trash
    const deleteTime = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(deleteTime);
    await act(async () => {
      await useAppStore.getState().deleteNotebook(nbExpiredUndo.id);
    });
    expect(container.querySelector('[data-testid="delete-undo-toast"]')).not.toBeNull();

    nowSpy.mockReturnValue(deleteTime + 5_200);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      );
    });
    await waitForUi(() => container.querySelector('[data-testid="delete-undo-toast"]') === null);
    expect(await db.notebooks.get(nbExpiredUndo.id)).toBeUndefined();
    expect(await db.trashedNotebooks.get(nbExpiredUndo.id)).toBeDefined();
    nowSpy.mockRestore();

    // Open SettingsModal -> Trash tab is no longer listed in Settings while deleted notebooks remain in 7-day Trash
    await act(async () => {
      await useAppStore.getState().deleteNotebook(nbUndo.id);
      root.render(<SettingsModal open={true} initialTab="general" onClose={() => {}} />);
    });

    expect(container.querySelector('[data-testid="settings-tab-trash"]')).toBeNull();
    expect(container.querySelector('[data-testid="settings-tab-trash-count"]')).toBeNull();
    expect(container.querySelector('[data-testid="settings-trash-section"]')).toBeNull();
    expect(await db.trashedNotebooks.get(nbUndo.id)).toBeDefined();
    expect(await db.trashedNotebooks.get(nbExpiredUndo.id)).toBeDefined();
  });

  it('renders a Recently Deleted book cover grid directly below Notebooks on HomeShelf and supports restore, Delete Forever, and Empty Trash', async () => {
    const bookOne = await useAppStore.getState().createNotebook({
      title: 'Sketch Pad',
      folderId: null,
      cover: COVER_PRESETS[0].cover,
      paper: { ...DEFAULT_PAPER_CONFIG },
      openImmediately: false,
    });
    const bookTwo = await useAppStore.getState().createNotebook({
      title: 'Chemistry Notes',
      folderId: null,
      cover: COVER_PRESETS[1].cover,
      paper: { ...DEFAULT_PAPER_CONFIG },
      openImmediately: false,
    });

    await act(async () => {
      root.render(<HomeShelf />);
    });

    // Absent when Trash is empty
    expect(container.querySelector('[data-testid="recently-deleted-section"]')).toBeNull();

    // Delete both notebooks -> Recently Deleted (2) appears right below Notebooks with cover cards
    await act(async () => {
      await useAppStore.getState().deleteNotebook(bookOne.id);
      await useAppStore.getState().deleteNotebook(bookTwo.id);
    });
    useAppStore.getState().dismissNotebookDeleteUndo();

    await waitForUi(() =>
      Boolean(container.querySelector('[data-testid="recently-deleted-section"]')),
    );
    const section = container.querySelector('[data-testid="recently-deleted-section"]')!;
    expect(section.querySelector('h2')?.textContent).toContain('Recently Deleted (2)');

    const cardOne = section.querySelector(`[data-testid="recently-deleted-card-${bookOne.id}"]`)!;
    expect(cardOne).not.toBeNull();
    expect(cardOne.textContent).toContain('Sketch Pad');
    expect(cardOne.textContent).toContain('days left');

    // Click cover restore on bookOne -> returns to active Notebooks and leaves Recently Deleted (1)
    await act(async () => {
      section
        .querySelector<HTMLButtonElement>(
          `[data-testid="recently-deleted-cover-restore-${bookOne.id}"]`,
        )!
        .click();
    });
    await waitForUi(
      () =>
        Boolean(container.querySelector('[data-testid="recently-deleted-section"]')) &&
        container.querySelector(`[data-testid="recently-deleted-card-${bookOne.id}"]`) === null &&
        useAppStore.getState().notebooks.some((n) => n.id === bookOne.id),
    );
    expect(await db.notebooks.get(bookOne.id)).toBeDefined();
    expect(
      container.querySelector('[data-testid="recently-deleted-section"] h2')?.textContent,
    ).toContain('Recently Deleted (1)');

    // Delete bookOne again so we can test menu "Delete Forever" on bookOne and "Empty Trash" on bookTwo
    await act(async () => {
      await useAppStore.getState().deleteNotebook(bookOne.id);
    });
    useAppStore.getState().dismissNotebookDeleteUndo();
    await waitForUi(
      () => container.querySelector(`[data-testid="recently-deleted-card-${bookOne.id}"]`) !== null,
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Recently deleted options for Sketch Pad"]',
        )!
        .click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(`[data-testid="recently-deleted-delete-${bookOne.id}"]`)!
        .click();
    });
    await waitForUi(
      () => container.querySelector(`[data-testid="recently-deleted-card-${bookOne.id}"]`) === null,
    );
    expect(await db.trashedNotebooks.get(bookOne.id)).toBeUndefined();

    // Empty Trash clears bookTwo cleanly and hides Recently Deleted section
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="shelf-empty-trash-btn"]')!.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="shelf-confirm-empty-trash-btn"]')!
        .click();
    });
    await waitForUi(
      () => container.querySelector('[data-testid="recently-deleted-section"]') === null,
    );
    expect(await db.trashedNotebooks.count()).toBe(0);
  });
});
