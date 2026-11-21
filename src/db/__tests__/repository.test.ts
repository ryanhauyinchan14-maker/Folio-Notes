// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { COVER_PRESETS } from '../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../constants/papers';
import { buildFolioNotebookExport } from '../../utils/exportNotebook';
import { generateRecoveryKey, initializeVault } from '../../utils/vaultCrypto';
import { GoodNotesDatabase } from '../database';
import { NotesRepository } from '../repository';

describe('NotesRepository (IndexedDB persistence & templates)', () => {
  it('seeds exactly one removable starter notebook on initial populate and stays deleted', async () => {
    const dbName = `test-db-seed-${Date.now()}`;
    const db1 = new GoodNotesDatabase(dbName);
    const repo1 = new NotesRepository(db1);

    const initial = await repo1.getShelfItems(null);
    expect(initial.notebooks).toHaveLength(1);
    expect(initial.notebooks[0].title).toBe('Quick Notes');

    await repo1.deleteNotebook(initial.notebooks[0].id);
    db1.close();

    // Reopen same database — populate must NOT re-seed the deleted notebook
    const db2 = new GoodNotesDatabase(dbName);
    const repo2 = new NotesRepository(db2);
    const afterReopen = await repo2.getShelfItems(null);
    expect(afterReopen.notebooks).toHaveLength(0);
    db2.close();
  });

  it('supports unlimited nested folders, custom templates, and page creation from templates', async () => {
    const dbName = `test-db-ops-${Date.now()}`;
    const testDb = new GoodNotesDatabase(dbName);
    const repo = new NotesRepository(testDb);

    // Nested folders: Root -> Semester 1 -> Physics
    const sem1 = await repo.createFolder('Semester 1', null, '#3B82F6');
    const physics = await repo.createFolder('Physics', sem1.id, '#10B981');

    const nestedShelf = await repo.getShelfItems(physics.id);
    expect(nestedShelf.breadcrumbs.map((b) => b.name)).toEqual(['Semester 1', 'Physics']);

    // Create notebook inside Physics folder
    const { notebook, firstPage } = await repo.createNotebook({
      title: 'Mechanics',
      folderId: physics.id,
      cover: COVER_PRESETS[0].cover,
      paper: { ...DEFAULT_PAPER_CONFIG, pattern: 'grid', paperColor: '#FDF8EC' },
    });

    // Save strokes on page 1
    const sampleStroke = {
      id: 'stroke-orig',
      tool: 'pen' as const,
      color: '#2563EB',
      size: 4,
      opacity: 1,
      simulatePressure: true,
      points: [
        { x: 50, y: 50, pressure: 0.5 },
        { x: 150, y: 50, pressure: 0.5 },
      ],
      bounds: { minX: 46, minY: 46, maxX: 154, maxY: 54 },
      createdAt: Date.now(),
    };
    await repo.savePageStrokes(notebook.id, firstPage.id, [sampleStroke]);

    // Save current page as template into My Templates
    const savedTpl = await repo.saveCustomTemplate({
      name: 'Physics Header Grid',
      category: 'page-template',
      paper: firstPage.paper,
      strokes: [sampleStroke],
      thumbnailDataUrl: 'data:image/png;base64,test',
    });

    const templates = await repo.getCustomTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe('Physics Header Grid');
    expect(templates[0].strokes).toHaveLength(1);

    // Create page 2 from saved template and verify cloned stroke has fresh ID
    const page2 = await repo.addPageToNotebook({
      notebookId: notebook.id,
      paper: savedTpl.paper,
      initialStrokes: savedTpl.strokes,
    });
    expect(page2).not.toBeNull();
    expect(page2!.paper.pattern).toBe('grid');
    expect(page2!.paper.paperColor).toBe('#FDF8EC');
    expect(page2!.strokes).toHaveLength(1);
    expect(page2!.strokes[0].id).not.toBe('stroke-orig');

    // Verify notebook pages order persisted
    const loaded = await repo.getNotebookWithPages(notebook.id);
    expect(loaded?.pages).toHaveLength(2);
    testDb.close();
  });

  it('encrypts locked notebook strokes in IndexedDB and decrypts only with Master Key', async () => {
    const dbName = `test-db-lock-${Date.now()}`;
    const testDb = new GoodNotesDatabase(dbName);
    const repo = new NotesRepository(testDb);

    // Minimal localStorage stub for initializeVault
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

    const { masterKey } = await initializeVault('TestVault99!', generateRecoveryKey(), 10_000);
    const { notebook, firstPage } = await repo.createNotebook({
      title: 'Private Journal',
      folderId: null,
      cover: COVER_PRESETS[0].cover,
    });

    const secretStroke = {
      id: 'secret-1',
      tool: 'pen' as const,
      color: '#1E293B',
      size: 4,
      opacity: 1,
      simulatePressure: true,
      points: [
        { x: 100, y: 120, pressure: 0.5 },
        { x: 220, y: 180, pressure: 0.5 },
      ],
      bounds: { minX: 96, minY: 116, maxX: 224, maxY: 184 },
      createdAt: Date.now(),
    };
    const secretTextbox = {
      id: 'tb-secret-1',
      x: 150,
      y: 240,
      text: 'Confidential note',
      fontFamily: 'sans' as const,
      fontSize: 22,
      bold: false,
      italic: false,
      color: '#1E293B',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const secretImage = {
      id: 'img-secret-1',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      naturalWidth: 400,
      naturalHeight: 300,
      x: 80,
      y: 90,
      width: 240,
      height: 180,
      crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      opacity: 0.85,
      borderRadius: 12,
      flipX: true,
      flipY: false,
      zIndex: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await repo.savePageStrokes(
      notebook.id,
      firstPage.id,
      [secretStroke],
      undefined,
      null,
      [secretTextbox],
      [secretImage],
    );

    // Lock notebook: IndexedDB row must contain encryptedStrokes and ZERO plaintext strokes/textboxes/images
    await repo.lockNotebook(notebook.id, masterKey);
    const lockedNb = await testDb.notebooks.get(notebook.id);
    const lockedPage = await testDb.pages.get(firstPage.id);
    expect(lockedNb?.isLocked).toBe(true);
    expect(lockedPage?.strokes).toEqual([]);
    expect(lockedPage?.textboxes).toEqual([]);
    expect(lockedPage?.images).toEqual([]);
    expect(lockedPage?.encryptedStrokes?.ciphertext).toBeTruthy();
    expect(lockedPage?.thumbnailDataUrl).toBeUndefined();

    // Opening without Master Key must throw
    await expect(repo.getNotebookWithPages(notebook.id)).rejects.toThrow();

    // Opening with Master Key decrypts strokes, textboxes, AND images in memory
    const unlocked = await repo.getNotebookWithPages(notebook.id, masterKey);
    expect(unlocked?.pages[0].strokes).toHaveLength(1);
    expect(unlocked?.pages[0].strokes[0].id).toBe('secret-1');
    expect(unlocked?.pages[0].textboxes).toHaveLength(1);
    expect(unlocked?.pages[0].textboxes?.[0].text).toBe('Confidential note');
    expect(unlocked?.pages[0].images).toHaveLength(1);
    expect(unlocked?.pages[0].images?.[0].opacity).toBe(0.85);
    expect(unlocked?.pages[0].images?.[0].flipX).toBe(true);
    expect(unlocked?.pages[0].images?.[0].crop.width).toBe(0.8);

    // Editing while unlocked still persists encrypted payload at rest in IndexedDB
    const secondStroke = { ...secretStroke, id: 'secret-2' };
    await repo.savePageStrokes(
      notebook.id,
      firstPage.id,
      [secretStroke, secondStroke],
      undefined,
      masterKey,
      [secretTextbox],
      [secretImage],
    );
    const rawPageWhileUnlocked = await testDb.pages.get(firstPage.id);
    expect(rawPageWhileUnlocked?.strokes).toEqual([]);
    expect(rawPageWhileUnlocked?.textboxes).toEqual([]);
    expect(rawPageWhileUnlocked?.images).toEqual([]);
    expect(rawPageWhileUnlocked?.encryptedStrokes?.ciphertext).toBeTruthy();

    // Removing lock permanently restores plaintext strokes, textboxes, and images
    await repo.removeNotebookLock(notebook.id, masterKey);
    const unsealedNb = await testDb.notebooks.get(notebook.id);
    const unsealedPage = await testDb.pages.get(firstPage.id);
    expect(unsealedNb?.isLocked).toBe(false);
    expect(unsealedPage?.strokes).toHaveLength(2);
    expect(unsealedPage?.textboxes).toHaveLength(1);
    expect(unsealedPage?.images).toHaveLength(1);
    expect(unsealedPage?.images?.[0].borderRadius).toBe(12);
    expect(unsealedPage?.encryptedStrokes).toBeNull();
    testDb.close();
  });

  it('imports .folio.json archives with fresh IDs and exports/restores workspace backups while skipping Vault-locked notebooks', async () => {
    const dbName1 = `test-db-backup-src-${Date.now()}`;
    const db1 = new GoodNotesDatabase(dbName1);
    const repo1 = new NotesRepository(db1);

    // LocalStorage stub for vault key creation
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

    const { masterKey } = await initializeVault('BackupVault99!', generateRecoveryKey(), 10_000);
    const parentFolder = await repo1.createFolder('Courses', null, '#3B82F6');
    const childFolder = await repo1.createFolder('CS 101', parentFolder.id, '#10B981');

    const { notebook: publicNb, firstPage } = await repo1.createNotebook({
      title: 'Algorithms',
      folderId: childFolder.id,
      cover: COVER_PRESETS[0].cover,
    });
    await repo1.savePageStrokes(publicNb.id, firstPage.id, [
      {
        id: 'orig-stroke-id',
        tool: 'pen',
        color: '#111827',
        size: 4,
        opacity: 1,
        simulatePressure: true,
        points: [
          { x: 10, y: 10, pressure: 0.5 },
          { x: 40, y: 40, pressure: 0.5 },
        ],
        bounds: { minX: 6, minY: 6, maxX: 44, maxY: 44 },
        createdAt: Date.now(),
      },
    ]);

    const { notebook: secretNb } = await repo1.createNotebook({
      title: 'Secret Diary',
      folderId: null,
      cover: COVER_PRESETS[0].cover,
    });
    await repo1.lockNotebook(secretNb.id, masterKey);

    await repo1.saveCustomTemplate({
      name: 'Algo Template',
      category: 'page-template',
      paper: DEFAULT_PAPER_CONFIG,
      strokes: [],
      thumbnailDataUrl: 'data:image/png;base64,test',
    });

    // Export full workspace backup: skips Vault-locked Secret Diary
    const backup = await repo1.exportWorkspaceBackup();
    expect(backup.skippedLockedTitles).toEqual(['Secret Diary']);
    expect(backup.folders.map((f) => f.name).sort()).toEqual(['CS 101', 'Courses']);
    expect(backup.notebooks.map((entry) => entry.notebook.title)).toContain('Algorithms');
    expect(backup.notebooks.map((entry) => entry.notebook.title)).not.toContain('Secret Diary');
    expect(backup.templates.map((t) => t.name)).toContain('Algo Template');

    // Import .folio.json into same DB -> fresh IDs
    const loadedPublic = await repo1.getNotebookWithPages(publicNb.id);
    const archive = buildFolioNotebookExport(loadedPublic!.notebook, loadedPublic!.pages);
    const { notebook: importedNb, pages: importedPages } = await repo1.importFolioNotebook(
      archive,
      null,
    );
    expect(importedNb.id).not.toBe(publicNb.id);
    expect(importedNb.title).toBe('Algorithms');
    expect(importedPages[0].strokes[0].id).not.toBe('orig-stroke-id');
    db1.close();

    // Restore workspace backup into a brand-new database preserving nested folder hierarchy
    const dbName2 = `test-db-backup-dest-${Date.now()}`;
    const db2 = new GoodNotesDatabase(dbName2);
    const repo2 = new NotesRepository(db2);
    const summary = await repo2.importWorkspaceBackup(backup);
    expect(summary).toEqual({
      importedFolders: 2,
      importedNotebooks: 2, // starter notebook from backup + Algorithms
      importedTemplates: 1,
    });

    const restoredRoot = await repo2.getShelfItems(null);
    const courses = restoredRoot.folders.find((f) => f.name === 'Courses');
    expect(courses).toBeDefined();
    const restoredChildShelf = await repo2.getShelfItems(courses!.id);
    const cs101 = restoredChildShelf.folders.find((f) => f.name === 'CS 101');
    expect(cs101).toBeDefined();
    const csShelf = await repo2.getShelfItems(cs101!.id);
    expect(csShelf.notebooks.map((n) => n.title)).toContain('Algorithms');
    expect((await repo2.getCustomTemplates()).map((t) => t.name)).toContain('Algo Template');
    db2.close();
  });
});
