// @vitest-environment node
import 'fake-indexeddb/auto';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { COVER_PRESETS } from '../../constants/covers';
import { GoodNotesDatabase } from '../../db/database';
import { NotesRepository } from '../../db/repository';
import { generateRecoveryKey, initializeVault } from '../vaultCrypto';
import { isPdfFile, pdfViewportToPaperConfig } from '../pdfEngine';

async function createSamplePdfBytes(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]); // US Letter portrait
  doc.addPage([960, 540]); // 16:9 widescreen landscape
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('Offline PDF Import, Storage Lifecycle & Vault Encryption', () => {
  it('converts PDF points to 96-DPI Folio PaperConfig preserving aspect ratios and orientation', () => {
    const letter = pdfViewportToPaperConfig(612, 792);
    expect(letter.width).toBe(816);
    expect(letter.height).toBe(1056);
    expect(letter.orientation).toBe('portrait');
    expect(letter.sizePreset).toBe('custom');
    expect(letter.pattern).toBe('blank');

    const slide = pdfViewportToPaperConfig(960, 540);
    expect(slide.width).toBe(1280);
    expect(slide.height).toBe(720);
    expect(slide.orientation).toBe('landscape');
    expect(slide.sizePreset).toBe('custom');

    expect(isPdfFile({ name: 'Lecture-01.PDF', type: '' })).toBe(true);
    expect(isPdfFile({ name: 'scan', type: 'application/pdf' })).toBe(true);
    expect(isPdfFile({ name: 'photo.png', type: 'image/png' })).toBe(false);
  });

  it('stores binary pdfAssets once, appends pages, remaps IDs on duplicate, and garbage-collects on delete', async () => {
    const dbName = `test-db-pdf-ops-${Date.now()}`;
    const testDb = new GoodNotesDatabase(dbName);
    const repo = new NotesRepository(testDb);
    const pdfBytes = await createSamplePdfBytes();

    const { notebook, pages, asset } = await repo.createPdfNotebook({
      title: 'Mixed Deck',
      folderId: null,
      cover: COVER_PRESETS[0].cover,
      fileName: 'Mixed Deck.pdf',
      pdfBytes,
      pageSpecs: [
        { pageNumber: 1, paper: pdfViewportToPaperConfig(612, 792) },
        { pageNumber: 2, paper: pdfViewportToPaperConfig(960, 540) },
      ],
    });

    expect(pages).toHaveLength(2);
    expect(pages[0].pdfBackground).toEqual({ assetId: asset.id, pageNumber: 1 });
    expect(pages[1].pdfBackground).toEqual({ assetId: asset.id, pageNumber: 2 });
    expect(pages[0].paper.orientation).toBe('portrait');
    expect(pages[1].paper.orientation).toBe('landscape');

    // Append second PDF after page 1
    const extraBytes = await createSamplePdfBytes();
    const appended = await repo.appendPdfPagesToNotebook({
      notebookId: notebook.id,
      fileName: 'Appendix.pdf',
      pdfBytes: extraBytes,
      pageSpecs: [
        { pageNumber: 1, paper: pdfViewportToPaperConfig(612, 792) },
        { pageNumber: 2, paper: pdfViewportToPaperConfig(960, 540) },
      ],
      afterPageId: pages[0].id,
    });
    expect(appended).not.toBeNull();

    const loadedAfterAppend = await repo.getNotebookWithPages(notebook.id);
    expect(loadedAfterAppend?.pages).toHaveLength(4);
    expect(loadedAfterAppend?.pages[1].pdfBackground?.assetId).toBe(appended!.asset.id);
    expect((await testDb.pdfAssets.where('notebookId').equals(notebook.id).count())).toBe(2);

    // Duplicate notebook remaps pdfAssets cleanly to fresh IDs
    const duplicated = await repo.duplicateNotebook(notebook.id);
    expect(duplicated).not.toBeNull();
    const dupAssets = await testDb.pdfAssets.where('notebookId').equals(duplicated!.id).toArray();
    expect(dupAssets).toHaveLength(2);
    expect(dupAssets.map((a) => a.id)).not.toContain(asset.id);
    const dupLoaded = await repo.getNotebookWithPages(duplicated!.id);
    expect(dupLoaded?.pages[0].pdfBackground?.assetId).toBeOneOf(dupAssets.map((a) => a.id));

    // Delete both pages using the appended asset -> unreferenced asset GC deletes only that asset
    await repo.deletePageFromNotebook(notebook.id, appended!.pages[0].id);
    expect(await testDb.pdfAssets.get(appended!.asset.id)).toBeDefined();
    await repo.deletePageFromNotebook(notebook.id, appended!.pages[1].id);
    expect(await testDb.pdfAssets.get(appended!.asset.id)).toBeUndefined();
    expect(await testDb.pdfAssets.get(asset.id)).toBeDefined();

    // Folder recursive delete removes remaining pdfAssets without orphans
    const folder = await repo.createFolder('PDF Archive', null, '#072D59');
    await repo.updateNotebook(notebook.id, { folderId: folder.id });
    await repo.deleteFolderRecursive(folder.id);
    expect(await testDb.pdfAssets.get(asset.id)).toBeUndefined();
    expect(await testDb.pdfAssets.where('notebookId').equals(duplicated!.id).count()).toBe(2);

    await repo.deleteNotebook(duplicated!.id);
    expect(await testDb.pdfAssets.where('notebookId').equals(duplicated!.id).count()).toBe(0);
    testDb.close();
  });

  it('encrypts PDF binaries and pdfBackground inside Vault Lock and preserves pdfBackground during unlocked edits', async () => {
    const dbName = `test-db-pdf-vault-${Date.now()}`;
    const testDb = new GoodNotesDatabase(dbName);
    const repo = new NotesRepository(testDb);

    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
    };

    const { masterKey } = await initializeVault('PdfVault99!', generateRecoveryKey(), 10_000);
    const pdfBytes = await createSamplePdfBytes();
    const origView = new Uint8Array(pdfBytes);

    const { notebook, pages, asset } = await repo.createPdfNotebook({
      title: 'Confidential Contract',
      folderId: null,
      cover: COVER_PRESETS[0].cover,
      fileName: 'Contract.pdf',
      pdfBytes,
      pageSpecs: [{ pageNumber: 1, paper: pdfViewportToPaperConfig(612, 792) }],
    });

    await repo.lockNotebook(notebook.id, masterKey);

    const rawLockedAsset = await testDb.pdfAssets.get(asset.id);
    const rawLockedPage = await testDb.pages.get(pages[0].id);
    expect(rawLockedAsset?.data).toBeNull();
    expect(rawLockedAsset?.encryptedData?.cipherBuffer?.byteLength).toBeGreaterThan(0);
    expect(rawLockedPage?.pdfBackground).toBeNull();
    expect(rawLockedPage?.encryptedStrokes?.ciphertext).toBeTruthy();

    await expect(repo.getPdfAssetData(asset.id)).rejects.toThrow();

    const decryptedBytes = await repo.getPdfAssetData(asset.id, masterKey);
    expect(decryptedBytes).not.toBeNull();
    expect(new Uint8Array(decryptedBytes!)).toEqual(origView);

    const unlockedLoaded = await repo.getNotebookWithPages(notebook.id, masterKey);
    expect(unlockedLoaded?.pages[0].pdfBackground).toEqual({ assetId: asset.id, pageNumber: 1 });

    // Edit strokes on locked PDF page while unlocked -> pdfBackground must be preserved at rest!
    await repo.savePageStrokes(
      notebook.id,
      pages[0].id,
      [
        {
          id: 'sig-1',
          tool: 'pen',
          color: '#072D59',
          size: 3,
          opacity: 1,
          simulatePressure: false,
          points: [
            { x: 100, y: 100, pressure: 0.5 },
            { x: 180, y: 120, pressure: 0.5 },
          ],
          bounds: { minX: 97, minY: 97, maxX: 183, maxY: 123 },
          createdAt: Date.now(),
        },
      ],
      undefined,
      masterKey,
    );

    const rawAfterEdit = await testDb.pages.get(pages[0].id);
    expect(rawAfterEdit?.pdfBackground).toBeNull();
    const reopened = await repo.getNotebookWithPages(notebook.id, masterKey);
    expect(reopened?.pages[0].strokes).toHaveLength(1);
    expect(reopened?.pages[0].pdfBackground).toEqual({ assetId: asset.id, pageNumber: 1 });

    // Remove Vault Lock permanently -> plaintext asset bytes and pdfBackground restored
    await repo.removeNotebookLock(notebook.id, masterKey);
    const unsealedAsset = await testDb.pdfAssets.get(asset.id);
    const unsealedPage = await testDb.pages.get(pages[0].id);
    expect(unsealedAsset?.encryptedData).toBeNull();
    expect(new Uint8Array(unsealedAsset!.data as ArrayBuffer)).toEqual(origView);
    expect(unsealedPage?.pdfBackground).toEqual({ assetId: asset.id, pageNumber: 1 });

    testDb.close();
  });
});
