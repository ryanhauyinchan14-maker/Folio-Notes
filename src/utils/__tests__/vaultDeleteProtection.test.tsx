// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnlockNotebookModal } from '../../components/modals/UnlockNotebookModal';
import { HomeShelf } from '../../components/shelf/HomeShelf';
import { COVER_PRESETS } from '../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../constants/papers';
import { db } from '../../db/database';
import { repository } from '../../db/repository';
import { useAppStore } from '../../store/useAppStore';
import { generateRecoveryKey } from '../vaultCrypto';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function waitForUi(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
    if (predicate()) return;
  }
}

describe('Vault Delete Protection (Notebooks, Nested Folders & Unlock Modal)', () => {
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

  it('rejects unauthenticated deletion of locked notebooks and folders with nested locked notebooks while allowing unlocked deletes', async () => {
    const unlockedNb = await useAppStore.getState().createNotebook({
      title: 'Regular Notes',
      folderId: null,
      cover: COVER_PRESETS[0].cover,
      paper: { ...DEFAULT_PAPER_CONFIG },
      openImmediately: false,
    });

    const lockedNb = await useAppStore.getState().createNotebook({
      title: 'Secret Diary',
      folderId: null,
      cover: COVER_PRESETS[1].cover,
      paper: { ...DEFAULT_PAPER_CONFIG },
      openImmediately: false,
    });

    const parentFolder = await repository.createFolder('Private Parent', null, '#072D59');
    const childFolder = await repository.createFolder(
      'Private Child',
      parentFolder.id,
      '#072D59',
    );
    const unlockedFolder = await repository.createFolder('Open Folder', null, '#072D59');

    const nestedLockedNb = await useAppStore.getState().createNotebook({
      title: 'Deep Vault',
      folderId: childFolder.id,
      cover: COVER_PRESETS[2].cover,
      paper: { ...DEFAULT_PAPER_CONFIG },
      openImmediately: false,
    });

    const rk = generateRecoveryKey();
    await useAppStore.getState().setupVaultAndMaybeLockNotebook('vault-secret-42', rk, lockedNb.id);
    await useAppStore.getState().lockNotebookWithPassword(nestedLockedNb.id, 'vault-secret-42');

    // Direct deletion without password MUST reject and keep locked notebook + pages intact
    await expect(useAppStore.getState().deleteNotebook(lockedNb.id)).rejects.toThrow(/Vault password/i);
    expect(await db.notebooks.get(lockedNb.id)).toBeDefined();
    expect(await db.pages.where('notebookId').equals(lockedNb.id).count()).toBe(1);

    // Direct deletion of parent folder containing nested locked notebook MUST reject
    expect(await repository.folderContainsLockedNotebook(parentFolder.id)).toBe(true);
    await expect(useAppStore.getState().deleteFolder(parentFolder.id)).rejects.toThrow(/Vault password/i);
    expect(await db.folders.get(parentFolder.id)).toBeDefined();
    expect(await db.folders.get(childFolder.id)).toBeDefined();
    expect(await db.notebooks.get(nestedLockedNb.id)).toBeDefined();

    // Unlocked notebook and empty/unlocked folder still delete cleanly without password
    await useAppStore.getState().deleteNotebook(unlockedNb.id);
    expect(await db.notebooks.get(unlockedNb.id)).toBeUndefined();
    await useAppStore.getState().deleteFolder(unlockedFolder.id);
    expect(await db.folders.get(unlockedFolder.id)).toBeUndefined();

    // Wrong password rejects and leaves locked notebook & protected folder intact
    await expect(
      useAppStore.getState().deleteLockedNotebookWithPassword(lockedNb.id, 'wrong-pass'),
    ).rejects.toThrow();
    expect(await db.notebooks.get(lockedNb.id)).toBeDefined();

    await expect(
      useAppStore.getState().deleteFolderWithPassword(parentFolder.id, 'wrong-pass'),
    ).rejects.toThrow();
    expect(await db.folders.get(parentFolder.id)).toBeDefined();
    expect(await db.notebooks.get(nestedLockedNb.id)).toBeDefined();

    // Correct password cleanly deletes both locked notebook and protected nested folder
    await useAppStore.getState().deleteLockedNotebookWithPassword(lockedNb.id, 'vault-secret-42');
    expect(await db.notebooks.get(lockedNb.id)).toBeUndefined();

    await useAppStore.getState().deleteFolderWithPassword(parentFolder.id, 'vault-secret-42');
    expect(await db.folders.get(parentFolder.id)).toBeUndefined();
    expect(await db.folders.get(childFolder.id)).toBeUndefined();
    expect(await db.notebooks.get(nestedLockedNb.id)).toBeUndefined();
  });

  it('removes the unauthenticated delete bypass from UnlockNotebookModal and requires password verification in HomeShelf delete flows', async () => {
    const lockedNb = await useAppStore.getState().createNotebook({
      title: 'Top Secret Book',
      folderId: null,
      cover: COVER_PRESETS[0].cover,
      paper: { ...DEFAULT_PAPER_CONFIG },
      openImmediately: false,
    });
    const protectedFolder = await repository.createFolder('Locked Folder', null, '#072D59');
    const folderLockedNb = await useAppStore.getState().createNotebook({
      title: 'Inside Folder Vault',
      folderId: protectedFolder.id,
      cover: COVER_PRESETS[1].cover,
      paper: { ...DEFAULT_PAPER_CONFIG },
      openImmediately: false,
    });

    const rk = generateRecoveryKey();
    await useAppStore.getState().setupVaultAndMaybeLockNotebook('master-pass-99', rk, lockedNb.id);
    await useAppStore.getState().lockNotebookWithPassword(folderLockedNb.id, 'master-pass-99');

    // 1. UnlockNotebookModal in open mode must NOT expose unauthenticated "Delete Locked Notebook"
    await act(async () => {
      root.render(
        <UnlockNotebookModal
          open={true}
          notebook={useAppStore.getState().notebooks.find((n) => n.id === lockedNb.id)!}
          mode="open"
          onClose={() => {}}
        />,
      );
    });
    expect(container.textContent).not.toContain('Delete Locked Notebook');

    // 2. HomeShelf Unlock & Delete flow for locked notebook
    await act(async () => {
      root.render(<HomeShelf />);
    });

    const nbMenuBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Notebook options for Top Secret Book"]',
    )!;
    await act(async () => {
      nbMenuBtn.click();
    });

    const deleteNbBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="notebook-card-delete-btn"]',
    )!;
    expect(deleteNbBtn.textContent).toContain('Unlock & Delete');
    await act(async () => {
      deleteNbBtn.click();
    });

    expect(container.querySelector('[data-testid="unlock-delete-warning"]')).not.toBeNull();

    // Submit wrong password -> shows error and keeps notebook
    await act(async () => {
      const pwInput = container.querySelector<HTMLInputElement>('#unlock-vault-password')!;
      setInputValue(pwInput, 'bad-password');
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="unlock-confirm-delete-btn"]')!.click();
    });
    await waitForUi(() => Boolean(container.querySelector('[data-testid="unlock-error-message"]')));
    expect(container.querySelector('[data-testid="unlock-error-message"]')?.textContent).toContain(
      'Incorrect Vault Password',
    );
    expect(await db.notebooks.get(lockedNb.id)).toBeDefined();

    // Submit correct password -> deletes locked notebook and closes modal
    await act(async () => {
      const pwInput = container.querySelector<HTMLInputElement>('#unlock-vault-password')!;
      setInputValue(pwInput, 'master-pass-99');
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="unlock-confirm-delete-btn"]')!.click();
    });
    await waitForUi(() => container.querySelector('#unlock-notebook-title') === null);
    expect(await db.notebooks.get(lockedNb.id)).toBeUndefined();
    expect(container.querySelector('#unlock-notebook-title')).toBeNull();

    // 3. HomeShelf Delete Folder flow for folder containing a locked notebook
    const folderMenuBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Folder options for Locked Folder"]',
    )!;
    await act(async () => {
      folderMenuBtn.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="folder-card-delete-btn"]')!.click();
    });
    await waitForUi(
      () =>
        container.querySelector('#unlock-notebook-title')?.textContent === 'Delete Protected Folder',
    );

    expect(container.querySelector('#unlock-notebook-title')?.textContent).toBe(
      'Delete Protected Folder',
    );

    // Wrong password preserves folder & locked child notebook
    await act(async () => {
      const pwInput = container.querySelector<HTMLInputElement>('#unlock-vault-password')!;
      setInputValue(pwInput, 'wrong-folder-pass');
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="unlock-confirm-delete-btn"]')!.click();
    });
    await waitForUi(() => Boolean(container.querySelector('[data-testid="unlock-error-message"]')));
    expect(container.querySelector('[data-testid="unlock-error-message"]')).not.toBeNull();
    expect(await db.folders.get(protectedFolder.id)).toBeDefined();
    expect(await db.notebooks.get(folderLockedNb.id)).toBeDefined();

    // Correct password deletes protected folder & nested locked notebook
    await act(async () => {
      const pwInput = container.querySelector<HTMLInputElement>('#unlock-vault-password')!;
      setInputValue(pwInput, 'master-pass-99');
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="unlock-confirm-delete-btn"]')!.click();
    });
    await waitForUi(() => container.querySelector('#unlock-notebook-title') === null);
    expect(await db.folders.get(protectedFolder.id)).toBeUndefined();
    expect(await db.notebooks.get(folderLockedNb.id)).toBeUndefined();
  });
});
