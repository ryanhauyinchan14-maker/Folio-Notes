import { cloneStrokeWithNewId } from '../canvas/geometry';
import { remapGroupIdsForClones } from '../canvas/selection';
import { generatePageThumbnail } from '../canvas/thumbnail';
import { DEFAULT_WHITEBOARD_PAPER } from '../canvas/whiteboard';
import { DEFAULT_PAPER_CONFIG } from '../constants/papers';
import {
  DEFAULT_SLIDE_SIZE_PRESET,
  createStarterSlideData,
  resolveSlidePaperConfig,
} from '../slides/slidePresets';
import type {
  CoverConfig,
  DrawingLayer,
  EncryptedPayload,
  Folder,
  Notebook,
  NotebookMode,
  NoteDocumentData,
  Page,
  PageImage,
  PaperConfig,
  PaperTemplate,
  PdfAsset,
  PdfPageBackground,
  SlideData,
  SlideSizePresetId,
  Stroke,
  Textbox,
  TrashedNotebookRecord,
} from '../types/notes';

export function createDefaultNoteDocumentData(): NoteDocumentData {
  return {
    contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
    contentHtml: '<p></p>',
    plainText: '',
    pageStyle: 'paginated',
    pageMargins: 'normal',
    defaultFont: 'Inter, system-ui, sans-serif',
    headerText: '',
    footerText: '',
    showPageNumbers: false,
  };
}
import {
  ensurePageImagesDecoded,
  type FolioNotebookExport,
  type FolioWorkspaceBackup,
  type SerializedPdfAsset,
} from '../utils/exportNotebook';
import { createId } from '../utils/id';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  decryptBinaryPayload,
  decryptJsonPayload,
  encryptBinaryPayload,
  encryptJsonPayload,
} from '../utils/vaultCrypto';
import { db, type GoodNotesDatabase } from './database';

async function readBinaryData(data: ArrayBuffer | Blob): Promise<ArrayBuffer> {
  if (data instanceof ArrayBuffer) {
    return data.slice(0);
  }
  return data.arrayBuffer();
}

function clonePaper(paper: PaperConfig): PaperConfig {
  return { ...paper };
}

function clonePdfBackground(
  bg: PdfPageBackground | null | undefined,
): PdfPageBackground | null {
  return bg ? { ...bg } : null;
}

function cloneStrokes(strokes: Stroke[]): Stroke[] {
  return strokes.map((s) => cloneStrokeWithNewId(s));
}

function cloneTextboxes(textboxes: Textbox[] | undefined): Textbox[] {
  if (!textboxes || textboxes.length === 0) return [];
  const now = Date.now();
  return textboxes.map((tb) => ({
    ...tb,
    id: createId(),
    createdAt: now,
    updatedAt: now,
  }));
}

function cloneImages(images: PageImage[] | undefined): PageImage[] {
  if (!images || images.length === 0) return [];
  const now = Date.now();
  return images.map((img) => ({
    ...img,
    id: createId(),
    crop: { ...img.crop },
    createdAt: now,
    updatedAt: now,
  }));
}

function clonePageAnnotations(
  rawStrokes: Stroke[] | undefined,
  rawTextboxes: Textbox[] | undefined,
  rawImages: PageImage[] | undefined,
): { strokes: Stroke[]; textboxes: Textbox[]; images: PageImage[] } {
  return remapGroupIdsForClones(
    cloneStrokes(rawStrokes ?? []),
    cloneTextboxes(rawTextboxes),
    cloneImages(rawImages),
    false,
  );
}

export const TRASH_RETENTION_DAYS = 7;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const NOTEBOOK_UNDO_WINDOW_MS = 5_000;

export function formatTrashTimeRemaining(expiresAt: number, now = Date.now()): string {
  const remainingMs = Math.max(0, expiresAt - now);
  const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
  if (remainingHours <= 1) return '<1 hour left';
  if (remainingHours < 24) return `${remainingHours} hours left`;
  const remainingDays = Math.min(
    TRASH_RETENTION_DAYS,
    Math.ceil(remainingMs / (24 * 60 * 60 * 1000)),
  );
  return `${remainingDays} ${remainingDays === 1 ? 'day' : 'days'} left`;
}

export interface LocalStorageSummary {
  folderCount: number;
  notebookCount: number;
  pageCount: number;
  templateCount: number;
  pdfAssetCount: number;
  trashedNotebookCount: number;
  estimatedBytes: number | null;
}

interface EncryptedPagePayloadShape {
  strokes: Stroke[];
  layers?: DrawingLayer[];
  textboxes?: Textbox[];
  images?: PageImage[];
  noteData?: NoteDocumentData | null;
  slideData?: SlideData | null;
  pdfBackground?: PdfPageBackground | null;
}

async function decryptPageContent(
  encryptedPayload: EncryptedPayload,
  masterKey: CryptoKey,
): Promise<{
  strokes: Stroke[];
  layers?: DrawingLayer[];
  textboxes: Textbox[];
  images: PageImage[];
  noteData?: NoteDocumentData | null;
  slideData?: SlideData | null;
  pdfBackground: PdfPageBackground | null;
}> {
  const decoded = await decryptJsonPayload<Stroke[] | EncryptedPagePayloadShape>(
    encryptedPayload,
    masterKey,
  );
  if (Array.isArray(decoded)) {
    return { strokes: decoded, textboxes: [], images: [], pdfBackground: null };
  }
  return {
    strokes: decoded.strokes ?? [],
    layers: decoded.layers,
    textboxes: decoded.textboxes ?? [],
    images: decoded.images ?? [],
    noteData: decoded.noteData ?? null,
    slideData: decoded.slideData ?? null,
    pdfBackground: decoded.pdfBackground ?? null,
  };
}

export class NotesRepository {
  private database: GoodNotesDatabase;

  constructor(database: GoodNotesDatabase = db) {
    this.database = database;
  }

  async getAllFolders(): Promise<Folder[]> {
    return this.database.folders.orderBy('name').toArray();
  }

  async getAllNotebooks(): Promise<Notebook[]> {
    const list = await this.database.notebooks.toArray();
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getFolderBreadcrumbs(folderId: string | null): Promise<Folder[]> {
    const chain: Folder[] = [];
    let currentId = folderId;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const folder = await this.database.folders.get(currentId);
      if (!folder) break;
      chain.unshift(folder);
      currentId = folder.parentId;
    }

    return chain;
  }

  async getShelfItems(folderId: string | null): Promise<{
    folders: Folder[];
    notebooks: Notebook[];
    breadcrumbs: Folder[];
    coverThumbnails: Record<string, string | undefined>;
  }> {
    const [allFolders, allNotebooks, breadcrumbs] = await Promise.all([
      this.database.folders.toArray(),
      this.database.notebooks.toArray(),
      this.getFolderBreadcrumbs(folderId),
    ]);

    const folders = allFolders
      .filter((f) => f.parentId === folderId)
      .sort((a, b) => a.name.localeCompare(b.name));

    const notebooks = allNotebooks
      .filter((n) => n.folderId === folderId)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const coverThumbnails: Record<string, string | undefined> = {};
    const unlockedFirstPageNotebooks: Array<{ nbId: string; pageId: string }> = [];
    for (const nb of notebooks) {
      if (nb.isLocked) {
        coverThumbnails[nb.id] = undefined;
        continue;
      }
      if (nb.pageOrder.length > 0) {
        unlockedFirstPageNotebooks.push({ nbId: nb.id, pageId: nb.pageOrder[0] });
      }
    }
    if (unlockedFirstPageNotebooks.length > 0) {
      const firstPages = await this.database.pages.bulkGet(
        unlockedFirstPageNotebooks.map((item) => item.pageId),
      );
      unlockedFirstPageNotebooks.forEach((item, idx) => {
        coverThumbnails[item.nbId] = firstPages[idx]?.thumbnailDataUrl;
      });
    }

    return { folders, notebooks, breadcrumbs, coverThumbnails };
  }

  async createFolder(
    name: string,
    parentId: string | null,
    color: string,
  ): Promise<Folder> {
    const now = Date.now();
    const folder: Folder = {
      id: createId(),
      name: name.trim() || 'Untitled Folder',
      parentId,
      color,
      createdAt: now,
      updatedAt: now,
    };
    await this.database.folders.add(folder);
    return folder;
  }

  async renameFolder(id: string, name: string, color?: string): Promise<void> {
    const patch: Partial<Folder> = {
      name: name.trim() || 'Untitled Folder',
      updatedAt: Date.now(),
    };
    if (color) patch.color = color;
    await this.database.folders.update(id, patch);
  }

  async moveFolder(id: string, targetParentId: string | null): Promise<void> {
    if (id === targetParentId) return;

    // Prevent circular hierarchy by checking if targetParentId is a descendant of id
    let checkId = targetParentId;
    while (checkId) {
      if (checkId === id) return;
      const parent = await this.database.folders.get(checkId);
      checkId = parent?.parentId ?? null;
    }

    await this.database.folders.update(id, {
      parentId: targetParentId,
      updatedAt: Date.now(),
    });
  }

  private collectSubtreeFolderIds(allFolders: Folder[], rootFolderId: string): Set<string> {
    const ids = new Set<string>([rootFolderId]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const f of allFolders) {
        if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
          ids.add(f.id);
          expanded = true;
        }
      }
    }
    return ids;
  }

  /**
   * Returns true if `folderId` or any nested descendant subfolder contains at least one
   * Vault-locked notebook.
   */
  async folderContainsLockedNotebook(folderId: string): Promise<boolean> {
    const [allFolders, allNotebooks] = await Promise.all([
      this.database.folders.toArray(),
      this.database.notebooks.toArray(),
    ]);
    const folderIds = this.collectSubtreeFolderIds(allFolders, folderId);
    return allNotebooks.some((nb) =>
      Boolean(nb.folderId && folderIds.has(nb.folderId) && nb.isLocked),
    );
  }

  async deleteFolderRecursive(
    folderId: string,
    authorizedMasterKey?: CryptoKey,
  ): Promise<TrashedNotebookRecord[]> {
    const now = Date.now();
    const expiresAt = now + TRASH_RETENTION_MS;
    const trashedRecords: TrashedNotebookRecord[] = [];

    await this.database.transaction(
      'rw',
      this.database.folders,
      this.database.notebooks,
      this.database.pages,
      this.database.pdfAssets,
      this.database.trashedNotebooks,
      async () => {
        const allFolders = await this.database.folders.toArray();
        const folderById = new Map(allFolders.map((f) => [f.id, f]));
        const folderIdsToDelete = this.collectSubtreeFolderIds(allFolders, folderId);

        const allNotebooks = await this.database.notebooks.toArray();
        const notebooksToDelete = allNotebooks.filter(
          (nb) => nb.folderId && folderIdsToDelete.has(nb.folderId),
        );

        if (notebooksToDelete.some((nb) => Boolean(nb.isLocked)) && !authorizedMasterKey) {
          throw new Error(
            'Vault password is required to delete a folder containing locked notebooks.',
          );
        }

        const notebookIdsToDelete = notebooksToDelete.map((nb) => nb.id);
        if (notebookIdsToDelete.length > 0) {
          const [pagesToTrash, assetsToTrash] = await Promise.all([
            this.database.pages.where('notebookId').anyOf(notebookIdsToDelete).toArray(),
            this.database.pdfAssets.where('notebookId').anyOf(notebookIdsToDelete).toArray(),
          ]);
          const pagesByNb = new Map<string, Page[]>();
          for (const page of pagesToTrash) {
            const list = pagesByNb.get(page.notebookId) ?? [];
            list.push(page);
            pagesByNb.set(page.notebookId, list);
          }
          const assetsByNb = new Map<string, PdfAsset[]>();
          for (const asset of assetsToTrash) {
            const list = assetsByNb.get(asset.notebookId) ?? [];
            list.push(asset);
            assetsByNb.set(asset.notebookId, list);
          }

          for (const nb of notebooksToDelete) {
            trashedRecords.push({
              id: nb.id,
              notebook: { ...nb },
              pages: pagesByNb.get(nb.id) ?? [],
              pdfAssets: assetsByNb.get(nb.id) ?? [],
              originalFolderName: nb.folderId ? folderById.get(nb.folderId)?.name ?? null : null,
              deletedAt: now,
              expiresAt,
            });
          }

          await this.database.trashedNotebooks.bulkPut(trashedRecords);
          await this.database.pdfAssets.where('notebookId').anyOf(notebookIdsToDelete).delete();
          await this.database.pages.where('notebookId').anyOf(notebookIdsToDelete).delete();
          await this.database.notebooks.bulkDelete(notebookIdsToDelete);
        }

        await this.database.folders.bulkDelete(Array.from(folderIdsToDelete));
      },
    );

    return trashedRecords;
  }

  async createNotebook(params: {
    title: string;
    mode?: NotebookMode;
    slideSizePreset?: SlideSizePresetId;
    folderId: string | null;
    cover: CoverConfig;
    paper?: PaperConfig;
    initialStrokes?: Stroke[];
    initialTextboxes?: Textbox[];
    initialImages?: PageImage[];
    initialNoteData?: NoteDocumentData;
    initialSlides?: SlideData[];
  }): Promise<{ notebook: Notebook; firstPage: Page }> {
    const now = Date.now();
    const notebookId = createId();
    const mode: NotebookMode =
      params.mode === 'whiteboard' || params.mode === 'notes' || params.mode === 'slides'
        ? params.mode
        : 'notebook';
    const isWhiteboard = mode === 'whiteboard';
    const isNotes = mode === 'notes';
    const isSlides = mode === 'slides';
    const slideSizePreset: SlideSizePresetId | undefined = isSlides
      ? params.slideSizePreset ?? DEFAULT_SLIDE_SIZE_PRESET
      : undefined;
    const paper = clonePaper(
      params.paper ??
        (isSlides
          ? resolveSlidePaperConfig(slideSizePreset)
          : isWhiteboard
            ? DEFAULT_WHITEBOARD_PAPER
            : DEFAULT_PAPER_CONFIG),
    );
    const { strokes, textboxes, images } = clonePageAnnotations(
      params.initialStrokes,
      params.initialTextboxes,
      params.initialImages,
    );
    const defaultUntitled = isSlides
      ? 'Untitled Presentation'
      : isNotes
        ? 'Untitled Document'
        : isWhiteboard
          ? 'Untitled Whiteboard'
          : 'Untitled Canvas';
    const resolvedTitle = params.title.trim() || defaultUntitled;
    const noteData = isNotes
      ? params.initialNoteData
        ? structuredClone(params.initialNoteData)
        : createDefaultNoteDocumentData()
      : null;
    const slidesToCreate: SlideData[] | null = isSlides
      ? params.initialSlides && params.initialSlides.length > 0
        ? params.initialSlides.map((s) => structuredClone(s))
        : [createStarterSlideData(paper.width, paper.height, resolvedTitle)]
      : null;

    const thumbnailDataUrl = generatePageThumbnail(
      paper,
      strokes,
      240,
      textboxes,
      images,
      undefined,
      isWhiteboard,
    );

    const createdPages: Page[] = slidesToCreate
      ? slidesToCreate.map((slideData, idx) => ({
          id: createId(),
          notebookId,
          paper: clonePaper(paper),
          strokes: idx === 0 ? strokes : [],
          textboxes: idx === 0 ? textboxes : [],
          images: idx === 0 ? images : [],
          slideData,
          thumbnailDataUrl,
          createdAt: now + idx,
          updatedAt: now + idx,
        }))
      : [
          {
            id: createId(),
            notebookId,
            paper,
            strokes,
            textboxes,
            images,
            ...(noteData ? { noteData } : {}),
            thumbnailDataUrl,
            createdAt: now,
            updatedAt: now,
          },
        ];

    const firstPage = createdPages[0];
    const pageOrder = createdPages.map((p) => p.id);

    const notebook: Notebook = {
      id: notebookId,
      title: resolvedTitle,
      mode,
      ...(slideSizePreset ? { slideSizePreset } : {}),
      folderId: params.folderId,
      cover: { ...params.cover },
      defaultPaper: clonePaper(paper),
      pageOrder,
      lastOpenedPageId: firstPage.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.database.transaction('rw', this.database.notebooks, this.database.pages, async () => {
      if (createdPages.length === 1) {
        await this.database.pages.add(firstPage);
      } else {
        await this.database.pages.bulkAdd(createdPages);
      }
      await this.database.notebooks.add(notebook);
    });

    return { notebook, firstPage };
  }

  async updateNotebook(
    id: string,
    patch: Partial<
      Pick<
        Notebook,
        'title' | 'folderId' | 'cover' | 'defaultPaper' | 'lastOpenedPageId' | 'slideSizePreset'
      >
    >,
  ): Promise<void> {
    await this.database.notebooks.update(id, {
      ...patch,
      updatedAt: Date.now(),
    });
  }

  async duplicateNotebook(notebookId: string): Promise<Notebook | null> {
    const original = await this.database.notebooks.get(notebookId);
    if (!original) return null;

    const [originalPages, originalAssets] = await Promise.all([
      this.database.pages.where('notebookId').equals(notebookId).toArray(),
      this.database.pdfAssets.where('notebookId').equals(notebookId).toArray(),
    ]);
    const pageMap = new Map(originalPages.map((p) => [p.id, p]));

    const now = Date.now();
    const newNotebookId = createId();
    const assetIdMap = new Map<string, string>();
    const clonedAssets: PdfAsset[] = [];

    for (const asset of originalAssets) {
      if (!asset.data) continue;
      const newAssetId = createId();
      assetIdMap.set(asset.id, newAssetId);
      clonedAssets.push({
        id: newAssetId,
        notebookId: newNotebookId,
        name: asset.name,
        data: await readBinaryData(asset.data),
        encryptedData: null,
        pageCount: asset.pageCount,
        createdAt: now,
      });
    }

    const newPages: Page[] = [];
    const newOrder: string[] = [];

    for (const oldPageId of original.pageOrder) {
      const src = pageMap.get(oldPageId);
      if (!src) continue;
      const newPageId = createId();
      newOrder.push(newPageId);
      const mappedPdfBackground = src.pdfBackground
        ? {
            assetId: assetIdMap.get(src.pdfBackground.assetId) ?? src.pdfBackground.assetId,
            pageNumber: src.pdfBackground.pageNumber,
          }
        : null;

      const clonedContent = clonePageAnnotations(src.strokes, src.textboxes, src.images);
      newPages.push({
        id: newPageId,
        notebookId: newNotebookId,
        paper: clonePaper(src.paper),
        strokes: clonedContent.strokes,
        ...(src.layers ? { layers: src.layers.map((l) => ({ ...l })) } : {}),
        textboxes: clonedContent.textboxes,
        images: clonedContent.images,
        ...(src.noteData ? { noteData: structuredClone(src.noteData) } : {}),
        ...(src.slideData ? { slideData: structuredClone(src.slideData) } : {}),
        pdfBackground: mappedPdfBackground,
        thumbnailDataUrl: src.thumbnailDataUrl,
        createdAt: now,
        updatedAt: now,
      });
    }

    const clonedNotebook: Notebook = {
      ...original,
      id: newNotebookId,
      title: `${original.title} (Copy)`,
      mode: original.mode ?? 'notebook',
      cover: { ...original.cover },
      defaultPaper: clonePaper(original.defaultPaper),
      pageOrder: newOrder,
      lastOpenedPageId: newOrder[0] ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await this.database.transaction(
      'rw',
      this.database.notebooks,
      this.database.pages,
      this.database.pdfAssets,
      async () => {
        if (clonedAssets.length > 0) {
          await this.database.pdfAssets.bulkAdd(clonedAssets);
        }
        if (newPages.length > 0) {
          await this.database.pages.bulkAdd(newPages);
        }
        await this.database.notebooks.add(clonedNotebook);
      },
    );

    return clonedNotebook;
  }

  async deleteNotebook(
    notebookId: string,
    authorizedMasterKey?: CryptoKey,
  ): Promise<TrashedNotebookRecord | null> {
    const now = Date.now();
    const expiresAt = now + TRASH_RETENTION_MS;
    let trashedRecord: TrashedNotebookRecord | null = null;

    await this.database.transaction(
      'rw',
      this.database.folders,
      this.database.notebooks,
      this.database.pages,
      this.database.pdfAssets,
      this.database.trashedNotebooks,
      async () => {
        const nb = await this.database.notebooks.get(notebookId);
        if (!nb) return;
        if (nb.isLocked && !authorizedMasterKey) {
          throw new Error('Vault password is required to delete a locked notebook.');
        }

        const [pages, pdfAssets, originalFolder] = await Promise.all([
          this.database.pages.where('notebookId').equals(notebookId).toArray(),
          this.database.pdfAssets.where('notebookId').equals(notebookId).toArray(),
          nb.folderId ? this.database.folders.get(nb.folderId) : Promise.resolve(undefined),
        ]);

        trashedRecord = {
          id: nb.id,
          notebook: { ...nb },
          pages,
          pdfAssets,
          originalFolderName: originalFolder?.name ?? null,
          deletedAt: now,
          expiresAt,
        };

        await this.database.trashedNotebooks.put(trashedRecord);
        await this.database.pdfAssets.where('notebookId').equals(notebookId).delete();
        await this.database.pages.where('notebookId').equals(notebookId).delete();
        await this.database.notebooks.delete(notebookId);
      },
    );

    return trashedRecord;
  }

  async purgeExpiredTrashedNotebooks(now = Date.now()): Promise<number> {
    return this.database.trashedNotebooks.where('expiresAt').belowOrEqual(now).delete();
  }

  async getTrashedNotebooks(now = Date.now()): Promise<TrashedNotebookRecord[]> {
    await this.purgeExpiredTrashedNotebooks(now);
    const items = await this.database.trashedNotebooks.toArray();
    return items.sort((a, b) => b.deletedAt - a.deletedAt);
  }

  async getTrashedNotebookCount(now = Date.now()): Promise<number> {
    await this.purgeExpiredTrashedNotebooks(now);
    return this.database.trashedNotebooks.count();
  }

  async restoreTrashedNotebook(notebookId: string, now = Date.now()): Promise<Notebook | null> {
    await this.purgeExpiredTrashedNotebooks(now);
    let restored: Notebook | null = null;

    await this.database.transaction(
      'rw',
      this.database.folders,
      this.database.notebooks,
      this.database.pages,
      this.database.pdfAssets,
      this.database.trashedNotebooks,
      async () => {
        const record = await this.database.trashedNotebooks.get(notebookId);
        if (!record) return;

        let resolvedFolderId = record.notebook.folderId ?? null;
        if (resolvedFolderId) {
          const folderExists = await this.database.folders.get(resolvedFolderId);
          if (!folderExists) {
            resolvedFolderId = null;
          }
        }

        const restoredNotebook: Notebook = {
          ...record.notebook,
          folderId: resolvedFolderId,
          updatedAt: now,
        };

        if (record.pdfAssets.length > 0) {
          await this.database.pdfAssets.bulkPut(record.pdfAssets);
        }
        if (record.pages.length > 0) {
          await this.database.pages.bulkPut(record.pages);
        }
        await this.database.notebooks.put(restoredNotebook);
        await this.database.trashedNotebooks.delete(notebookId);
        restored = restoredNotebook;
      },
    );

    return restored;
  }

  async permanentlyDeleteTrashedNotebook(notebookId: string): Promise<void> {
    await this.database.trashedNotebooks.delete(notebookId);
  }

  async emptyTrash(): Promise<number> {
    const count = await this.database.trashedNotebooks.count();
    await this.database.trashedNotebooks.clear();
    return count;
  }

  async getLockedNotebookCount(): Promise<number> {
    const all = await this.database.notebooks.toArray();
    return all.filter((n) => Boolean(n.isLocked)).length;
  }

  async lockNotebook(notebookId: string, masterKey: CryptoKey): Promise<void> {
    const notebook = await this.database.notebooks.get(notebookId);
    if (!notebook) return;

    const [rawPages, rawAssets] = await Promise.all([
      this.database.pages.where('notebookId').equals(notebookId).toArray(),
      this.database.pdfAssets.where('notebookId').equals(notebookId).toArray(),
    ]);

    // Perform all async WebCrypto encryption BEFORE opening the Dexie transaction
    const encryptedUpdates: { pageId: string; encryptedStrokes: EncryptedPayload }[] = [];
    for (const page of rawPages) {
      if (
        page.encryptedStrokes &&
        page.strokes.length === 0 &&
        (!page.textboxes || page.textboxes.length === 0) &&
        (!page.images || page.images.length === 0) &&
        !page.pdfBackground &&
        notebook.isLocked
      ) {
        continue;
      }
      const encryptedStrokes = await encryptJsonPayload(
        {
          strokes: page.strokes,
          ...(page.layers ? { layers: page.layers } : {}),
          textboxes: page.textboxes ?? [],
          images: page.images ?? [],
          ...(page.noteData ? { noteData: page.noteData } : {}),
          ...(page.slideData ? { slideData: page.slideData } : {}),
          pdfBackground: clonePdfBackground(page.pdfBackground),
        },
        masterKey,
      );
      encryptedUpdates.push({ pageId: page.id, encryptedStrokes });
    }

    const encryptedAssets: { assetId: string; encryptedData: EncryptedPayload }[] = [];
    for (const asset of rawAssets) {
      if (asset.encryptedData && !asset.data && notebook.isLocked) {
        continue;
      }
      if (!asset.data) continue;
      const rawBuf = await readBinaryData(asset.data);
      const encryptedData = await encryptBinaryPayload(rawBuf, masterKey);
      encryptedAssets.push({ assetId: asset.id, encryptedData });
    }

    const now = Date.now();
    await this.database.transaction(
      'rw',
      this.database.notebooks,
      this.database.pages,
      this.database.pdfAssets,
      async () => {
        for (const item of encryptedUpdates) {
          await this.database.pages.update(item.pageId, {
            strokes: [],
            layers: undefined,
            textboxes: [],
            images: [],
            noteData: null,
            slideData: null,
            pdfBackground: null,
            encryptedStrokes: item.encryptedStrokes,
            thumbnailDataUrl: undefined,
            updatedAt: now,
          });
        }
        for (const item of encryptedAssets) {
          await this.database.pdfAssets.update(item.assetId, {
            data: null,
            encryptedData: item.encryptedData,
          });
        }
        await this.database.notebooks.update(notebookId, {
          isLocked: true,
          updatedAt: now,
        });
      },
    );
  }

  async removeNotebookLock(notebookId: string, masterKey: CryptoKey): Promise<void> {
    const notebook = await this.database.notebooks.get(notebookId);
    if (!notebook) return;

    const [rawPages, rawAssets] = await Promise.all([
      this.database.pages.where('notebookId').equals(notebookId).toArray(),
      this.database.pdfAssets.where('notebookId').equals(notebookId).toArray(),
    ]);

    // Perform all async WebCrypto decryption BEFORE opening the Dexie transaction
    const decryptedUpdates: {
      pageId: string;
      strokes: Stroke[];
      layers?: DrawingLayer[];
      textboxes: Textbox[];
      images: PageImage[];
      noteData?: NoteDocumentData | null;
      slideData?: SlideData | null;
      pdfBackground: PdfPageBackground | null;
      thumbnailDataUrl?: string;
    }[] = [];

    for (const page of rawPages) {
      const content = page.encryptedStrokes
        ? await decryptPageContent(page.encryptedStrokes, masterKey)
        : {
            strokes: page.strokes,
            layers: page.layers,
            textboxes: page.textboxes ?? [],
            images: page.images ?? [],
            noteData: page.noteData,
            slideData: page.slideData,
            pdfBackground: clonePdfBackground(page.pdfBackground),
          };
      const thumbnailDataUrl = content.pdfBackground
        ? undefined
        : generatePageThumbnail(
            page.paper,
            content.strokes,
            240,
            content.textboxes,
            content.images,
          );
      decryptedUpdates.push({
        pageId: page.id,
        strokes: content.strokes,
        layers: content.layers,
        textboxes: content.textboxes,
        images: content.images,
        noteData: content.noteData,
        slideData: content.slideData,
        pdfBackground: content.pdfBackground,
        thumbnailDataUrl,
      });
    }

    const decryptedAssets: { assetId: string; data: ArrayBuffer }[] = [];
    for (const asset of rawAssets) {
      if (asset.encryptedData) {
        const plainBuf = await decryptBinaryPayload(asset.encryptedData, masterKey);
        decryptedAssets.push({ assetId: asset.id, data: plainBuf });
      }
    }

    const now = Date.now();
    await this.database.transaction(
      'rw',
      this.database.notebooks,
      this.database.pages,
      this.database.pdfAssets,
      async () => {
        for (const item of decryptedUpdates) {
          await this.database.pages.update(item.pageId, {
            strokes: item.strokes,
            ...(item.layers ? { layers: item.layers } : {}),
            textboxes: item.textboxes,
            images: item.images,
            ...(item.noteData !== undefined ? { noteData: item.noteData } : {}),
            ...(item.slideData !== undefined ? { slideData: item.slideData } : {}),
            pdfBackground: item.pdfBackground,
            encryptedStrokes: null,
            thumbnailDataUrl: item.thumbnailDataUrl,
            updatedAt: now,
          });
        }
        for (const item of decryptedAssets) {
          await this.database.pdfAssets.update(item.assetId, {
            data: item.data,
            encryptedData: null,
          });
        }
        await this.database.notebooks.update(notebookId, {
          isLocked: false,
          updatedAt: now,
        });
      },
    );
  }

  async getNotebookWithPages(
    notebookId: string,
    masterKey?: CryptoKey | null,
  ): Promise<{ notebook: Notebook; pages: Page[] } | null> {
    const notebook = await this.database.notebooks.get(notebookId);
    if (!notebook) return null;

    const rawPages = await this.database.pages
      .where('notebookId')
      .equals(notebookId)
      .toArray();
    const byId = new Map(rawPages.map((p) => [p.id, p]));

    const ordered: Page[] = [];
    for (const pid of notebook.pageOrder) {
      const found = byId.get(pid);
      if (found) ordered.push(found);
    }

    // Recover any orphaned pages if order was out of sync
    for (const p of rawPages) {
      if (!notebook.pageOrder.includes(p.id)) {
        ordered.push(p);
      }
    }

    if (notebook.isLocked) {
      if (!masterKey) {
        throw new Error('Notebook is locked. Master key required to decrypt pages.');
      }
      const decryptedPages: Page[] = [];
      for (const p of ordered) {
        const content = p.encryptedStrokes
          ? await decryptPageContent(p.encryptedStrokes, masterKey)
          : {
              strokes: p.strokes,
              textboxes: p.textboxes ?? [],
              images: p.images ?? [],
              pdfBackground: clonePdfBackground(p.pdfBackground),
            };
        decryptedPages.push({
          ...p,
          strokes: content.strokes,
          ...(content.layers ? { layers: content.layers } : {}),
          textboxes: content.textboxes,
          images: content.images,
          ...(content.noteData ? { noteData: content.noteData } : {}),
          ...(content.slideData ? { slideData: content.slideData } : {}),
          pdfBackground: content.pdfBackground,
        });
      }
      return { notebook, pages: decryptedPages };
    }

    return {
      notebook,
      pages: ordered.map((p) => ({
        ...p,
        textboxes: p.textboxes ?? [],
        images: p.images ?? [],
        pdfBackground: p.pdfBackground ?? null,
      })),
    };
  }

  async getPdfAssetData(
    assetId: string,
    masterKey?: CryptoKey | null,
  ): Promise<ArrayBuffer | null> {
    const asset = await this.database.pdfAssets.get(assetId);
    if (!asset) return null;
    if (asset.data) {
      return readBinaryData(asset.data);
    }
    if (asset.encryptedData) {
      if (!masterKey) {
        throw new Error('PDF asset is encrypted. Master key required.');
      }
      return decryptBinaryPayload(asset.encryptedData, masterKey);
    }
    return null;
  }

  async getPdfAssetsForNotebook(
    notebookId: string,
    masterKey?: CryptoKey | null,
  ): Promise<Map<string, ArrayBuffer>> {
    const assets = await this.database.pdfAssets
      .where('notebookId')
      .equals(notebookId)
      .toArray();
    const map = new Map<string, ArrayBuffer>();
    for (const asset of assets) {
      if (asset.data) {
        map.set(asset.id, await readBinaryData(asset.data));
      } else if (asset.encryptedData) {
        if (!masterKey) {
          throw new Error('PDF asset is encrypted. Master key required.');
        }
        map.set(asset.id, await decryptBinaryPayload(asset.encryptedData, masterKey));
      }
    }
    return map;
  }

  async getPdfAssetRecordsForNotebook(notebookId: string): Promise<PdfAsset[]> {
    return this.database.pdfAssets.where('notebookId').equals(notebookId).toArray();
  }

  async createPdfNotebook(params: {
    title: string;
    folderId: string | null;
    cover: CoverConfig;
    fileName: string;
    pdfBytes: ArrayBuffer;
    pageSpecs: Array<{
      pageNumber: number;
      paper: PaperConfig;
      thumbnailDataUrl?: string;
    }>;
  }): Promise<{ notebook: Notebook; pages: Page[]; asset: PdfAsset }> {
    const now = Date.now();
    const notebookId = createId();
    const assetId = createId();

    const asset: PdfAsset = {
      id: assetId,
      notebookId,
      name: params.fileName,
      data: params.pdfBytes.slice(0),
      encryptedData: null,
      pageCount: params.pageSpecs.length,
      createdAt: now,
    };

    const pages: Page[] = params.pageSpecs.map((spec) => ({
      id: createId(),
      notebookId,
      paper: clonePaper(spec.paper),
      strokes: [],
      textboxes: [],
      images: [],
      pdfBackground: { assetId, pageNumber: spec.pageNumber },
      encryptedStrokes: null,
      thumbnailDataUrl: spec.thumbnailDataUrl,
      createdAt: now,
      updatedAt: now,
    }));

    const defaultPaper = clonePaper(params.pageSpecs[0]?.paper ?? DEFAULT_PAPER_CONFIG);
    const pageOrder = pages.map((p) => p.id);

    const notebook: Notebook = {
      id: notebookId,
      title: params.title.trim() || 'Imported PDF',
      folderId: params.folderId,
      cover: { ...params.cover },
      defaultPaper,
      pageOrder,
      lastOpenedPageId: pageOrder[0] ?? null,
      isLocked: false,
      createdAt: now,
      updatedAt: now,
    };

    await this.database.transaction(
      'rw',
      this.database.notebooks,
      this.database.pages,
      this.database.pdfAssets,
      async () => {
        await this.database.pdfAssets.add(asset);
        if (pages.length > 0) {
          await this.database.pages.bulkAdd(pages);
        }
        await this.database.notebooks.add(notebook);
      },
    );

    return { notebook, pages, asset };
  }

  async appendPdfPagesToNotebook(params: {
    notebookId: string;
    fileName: string;
    pdfBytes: ArrayBuffer;
    pageSpecs: Array<{
      pageNumber: number;
      paper: PaperConfig;
      thumbnailDataUrl?: string;
    }>;
    afterPageId?: string;
    masterKey?: CryptoKey | null;
  }): Promise<{ pages: Page[]; asset: PdfAsset } | null> {
    const notebook = await this.database.notebooks.get(params.notebookId);
    if (!notebook || params.pageSpecs.length === 0) return null;

    const now = Date.now();
    const assetId = createId();
    const rawCopy = params.pdfBytes.slice(0);

    let dbAsset: PdfAsset;
    const dbPages: Page[] = [];
    const memoryPages: Page[] = [];

    if (notebook.isLocked) {
      if (!params.masterKey) {
        throw new Error('Cannot import PDF into a locked notebook without the Master Key.');
      }
      const encryptedData = await encryptBinaryPayload(rawCopy, params.masterKey);
      dbAsset = {
        id: assetId,
        notebookId: params.notebookId,
        name: params.fileName,
        data: null,
        encryptedData,
        pageCount: params.pageSpecs.length,
        createdAt: now,
      };

      for (const spec of params.pageSpecs) {
        const pdfBackground: PdfPageBackground = { assetId, pageNumber: spec.pageNumber };
        const encryptedStrokes = await encryptJsonPayload(
          { strokes: [], textboxes: [], images: [], pdfBackground },
          params.masterKey,
        );
        const pageId = createId();
        const dbPage: Page = {
          id: pageId,
          notebookId: params.notebookId,
          paper: clonePaper(spec.paper),
          strokes: [],
          textboxes: [],
          images: [],
          pdfBackground: null,
          encryptedStrokes,
          thumbnailDataUrl: undefined,
          createdAt: now,
          updatedAt: now,
        };
        dbPages.push(dbPage);
        memoryPages.push({
          ...dbPage,
          pdfBackground,
        });
      }
    } else {
      dbAsset = {
        id: assetId,
        notebookId: params.notebookId,
        name: params.fileName,
        data: rawCopy,
        encryptedData: null,
        pageCount: params.pageSpecs.length,
        createdAt: now,
      };

      for (const spec of params.pageSpecs) {
        const page: Page = {
          id: createId(),
          notebookId: params.notebookId,
          paper: clonePaper(spec.paper),
          strokes: [],
          textboxes: [],
          images: [],
          pdfBackground: { assetId, pageNumber: spec.pageNumber },
          encryptedStrokes: null,
          thumbnailDataUrl: spec.thumbnailDataUrl,
          createdAt: now,
          updatedAt: now,
        };
        dbPages.push(page);
        memoryPages.push(page);
      }
    }

    const insertedIds = memoryPages.map((p) => p.id);
    const nextOrder = [...notebook.pageOrder];
    if (params.afterPageId) {
      const idx = nextOrder.indexOf(params.afterPageId);
      if (idx !== -1) {
        nextOrder.splice(idx + 1, 0, ...insertedIds);
      } else {
        nextOrder.push(...insertedIds);
      }
    } else {
      nextOrder.push(...insertedIds);
    }

    await this.database.transaction(
      'rw',
      this.database.notebooks,
      this.database.pages,
      this.database.pdfAssets,
      async () => {
        await this.database.pdfAssets.add(dbAsset);
        await this.database.pages.bulkAdd(dbPages);
        await this.database.notebooks.update(params.notebookId, {
          pageOrder: nextOrder,
          lastOpenedPageId: insertedIds[0] ?? notebook.lastOpenedPageId,
          updatedAt: now,
        });
      },
    );

    return { pages: memoryPages, asset: dbAsset };
  }

  async addPageToNotebook(params: {
    notebookId: string;
    paper: PaperConfig;
    initialStrokes?: Stroke[];
    initialTextboxes?: Textbox[];
    initialImages?: PageImage[];
    initialSlideData?: SlideData | null;
    pdfBackground?: PdfPageBackground | null;
    thumbnailDataUrl?: string;
    afterPageId?: string;
    masterKey?: CryptoKey | null;
  }): Promise<Page | null> {
    const notebook = await this.database.notebooks.get(params.notebookId);
    if (!notebook) return null;

    const now = Date.now();
    const pageId = createId();
    const paper = clonePaper(params.paper);
    const { strokes, textboxes, images } = clonePageAnnotations(
      params.initialStrokes,
      params.initialTextboxes,
      params.initialImages,
    );
    const pdfBackground = clonePdfBackground(params.pdfBackground);
    const slideData = params.initialSlideData
      ? structuredClone(params.initialSlideData)
      : undefined;

    let dbPage: Page;
    let memoryPage: Page;

    if (notebook.isLocked) {
      if (!params.masterKey) {
        throw new Error('Cannot add page to a locked notebook without the Master Key.');
      }
      const encryptedStrokes = await encryptJsonPayload(
        {
          strokes,
          textboxes,
          images,
          ...(slideData ? { slideData } : {}),
          pdfBackground,
        },
        params.masterKey,
      );
      dbPage = {
        id: pageId,
        notebookId: params.notebookId,
        paper,
        strokes: [],
        textboxes: [],
        images: [],
        ...(slideData ? { slideData: null } : {}),
        pdfBackground: null,
        encryptedStrokes,
        thumbnailDataUrl: undefined,
        createdAt: now,
        updatedAt: now,
      };
      memoryPage = {
        ...dbPage,
        strokes,
        textboxes,
        images,
        ...(slideData ? { slideData } : {}),
        pdfBackground,
      };
    } else {
      const thumbnailDataUrl =
        params.thumbnailDataUrl ??
        generatePageThumbnail(paper, strokes, 240, textboxes, images);
      dbPage = {
        id: pageId,
        notebookId: params.notebookId,
        paper,
        strokes,
        textboxes,
        images,
        ...(slideData ? { slideData } : {}),
        pdfBackground,
        thumbnailDataUrl,
        createdAt: now,
        updatedAt: now,
      };
      memoryPage = dbPage;
    }

    const nextOrder = [...notebook.pageOrder];
    if (params.afterPageId) {
      const idx = nextOrder.indexOf(params.afterPageId);
      if (idx !== -1) {
        nextOrder.splice(idx + 1, 0, pageId);
      } else {
        nextOrder.push(pageId);
      }
    } else {
      nextOrder.push(pageId);
    }

    await this.database.transaction('rw', this.database.notebooks, this.database.pages, async () => {
      await this.database.pages.add(dbPage);
      await this.database.notebooks.update(params.notebookId, {
        pageOrder: nextOrder,
        lastOpenedPageId: pageId,
        updatedAt: now,
      });
    });

    return memoryPage;
  }

  async duplicatePage(
    notebookId: string,
    pageId: string,
    masterKey?: CryptoKey | null,
  ): Promise<Page | null> {
    const notebook = await this.database.notebooks.get(notebookId);
    const src = await this.database.pages.get(pageId);
    if (!src || !notebook) return null;

    let initialStrokes = src.strokes;
    let initialTextboxes = src.textboxes ?? [];
    let initialImages = src.images ?? [];
    let initialSlideData = src.slideData ? structuredClone(src.slideData) : null;
    let initialPdfBackground = clonePdfBackground(src.pdfBackground);
    if (notebook.isLocked) {
      if (!masterKey) {
        throw new Error('Cannot duplicate page of locked notebook without Master Key.');
      }
      if (src.encryptedStrokes) {
        const content = await decryptPageContent(src.encryptedStrokes, masterKey);
        initialStrokes = content.strokes;
        initialTextboxes = content.textboxes;
        initialImages = content.images;
        initialSlideData = content.slideData ? structuredClone(content.slideData) : null;
        initialPdfBackground = content.pdfBackground;
      }
    }

    return this.addPageToNotebook({
      notebookId,
      paper: src.paper,
      initialStrokes,
      initialTextboxes,
      initialImages,
      ...(initialSlideData
        ? {
            initialSlideData: {
              ...initialSlideData,
              elements: initialSlideData.elements.map((el) => ({ ...el, id: createId() })),
            },
          }
        : {}),
      pdfBackground: initialPdfBackground,
      thumbnailDataUrl: initialPdfBackground ? src.thumbnailDataUrl : undefined,
      afterPageId: pageId,
      masterKey,
    });
  }

  async deletePageFromNotebook(notebookId: string, pageId: string): Promise<string[] | null> {
    const notebook = await this.database.notebooks.get(notebookId);
    if (!notebook || notebook.pageOrder.length <= 1) return null;

    const deletedPage = await this.database.pages.get(pageId);
    const nextOrder = notebook.pageOrder.filter((id) => id !== pageId);
    const nextOpened =
      notebook.lastOpenedPageId === pageId ? nextOrder[0] ?? null : notebook.lastOpenedPageId;

    await this.database.transaction(
      'rw',
      this.database.notebooks,
      this.database.pages,
      this.database.pdfAssets,
      async () => {
        await this.database.pages.delete(pageId);
        await this.database.notebooks.update(notebookId, {
          pageOrder: nextOrder,
          lastOpenedPageId: nextOpened,
          updatedAt: Date.now(),
        });

        const assetIdToCheck = !notebook.isLocked
          ? deletedPage?.pdfBackground?.assetId
          : undefined;
        if (assetIdToCheck) {
          const remaining = await this.database.pages
            .where('notebookId')
            .equals(notebookId)
            .toArray();
          const stillReferenced = remaining.some(
            (p) => p.pdfBackground?.assetId === assetIdToCheck,
          );
          if (!stillReferenced) {
            await this.database.pdfAssets.delete(assetIdToCheck);
          }
        }
      },
    );

    return nextOrder;
  }

  async reorderNotebookPages(notebookId: string, newOrder: string[]): Promise<void> {
    await this.database.notebooks.update(notebookId, {
      pageOrder: [...newOrder],
      updatedAt: Date.now(),
    });
  }

  async savePageStrokes(
    notebookId: string,
    pageId: string,
    strokes: Stroke[],
    thumbnailDataUrl?: string,
    masterKey?: CryptoKey | null,
    textboxes?: Textbox[],
    images?: PageImage[],
    pdfBackground?: PdfPageBackground | null,
  ): Promise<void> {
    const notebook = await this.database.notebooks.get(notebookId);
    const needsExisting =
      textboxes === undefined ||
      images === undefined ||
      Boolean(notebook?.isLocked);
    const existingPage = needsExisting ? await this.database.pages.get(pageId) : undefined;
    let effectiveTextboxes = textboxes ?? existingPage?.textboxes ?? [];
    let effectiveImages = images ?? existingPage?.images ?? [];
    let effectivePdfBackground =
      pdfBackground !== undefined
        ? clonePdfBackground(pdfBackground)
        : clonePdfBackground(existingPage?.pdfBackground);
    let effectiveLayers = existingPage?.layers;
    let effectiveNoteData = existingPage?.noteData;
    let effectiveSlideData = existingPage?.slideData;

    const now = Date.now();
    let patch: Partial<Page>;

    if (notebook?.isLocked) {
      if (!masterKey) {
        throw new Error('Cannot persist strokes for a locked notebook without Master Key.');
      }
      if (existingPage?.encryptedStrokes) {
        const prev = await decryptPageContent(existingPage.encryptedStrokes, masterKey);
        if (textboxes === undefined) effectiveTextboxes = prev.textboxes;
        if (images === undefined) effectiveImages = prev.images;
        if (pdfBackground === undefined) effectivePdfBackground = prev.pdfBackground;
        if (prev.layers) effectiveLayers = prev.layers;
        if (prev.noteData !== undefined) effectiveNoteData = prev.noteData;
        if (prev.slideData !== undefined) effectiveSlideData = prev.slideData;
      }

      const encryptedStrokes = await encryptJsonPayload(
        {
          strokes,
          ...(effectiveLayers ? { layers: effectiveLayers } : {}),
          textboxes: effectiveTextboxes,
          images: effectiveImages,
          ...(effectiveNoteData ? { noteData: effectiveNoteData } : {}),
          ...(effectiveSlideData ? { slideData: effectiveSlideData } : {}),
          pdfBackground: effectivePdfBackground,
        },
        masterKey,
      );
      patch = {
        strokes: [],
        layers: undefined,
        textboxes: [],
        images: [],
        pdfBackground: null,
        encryptedStrokes,
        thumbnailDataUrl: undefined,
        updatedAt: now,
      };
    } else {
      patch = {
        strokes,
        encryptedStrokes: null,
        updatedAt: now,
      };
      if (textboxes !== undefined) {
        patch.textboxes = textboxes;
      }
      if (images !== undefined) {
        patch.images = images;
      }
      if (pdfBackground !== undefined) {
        patch.pdfBackground = clonePdfBackground(pdfBackground);
      }
      if (thumbnailDataUrl !== undefined) {
        patch.thumbnailDataUrl = thumbnailDataUrl;
      }
    }

    await this.database.transaction('rw', this.database.notebooks, this.database.pages, async () => {
      await this.database.pages.update(pageId, patch);
      await this.database.notebooks.update(notebookId, { updatedAt: now });
    });
  }

  async savePageLayers(
    notebookId: string,
    pageId: string,
    layers: DrawingLayer[],
    strokes?: Stroke[],
    masterKey?: CryptoKey | null,
  ): Promise<void> {
    const notebook = await this.database.notebooks.get(notebookId);
    const now = Date.now();
    let patch: Partial<Page>;

    if (notebook?.isLocked) {
      if (!masterKey) {
        throw new Error('Cannot persist layers for a locked notebook without Master Key.');
      }
      const existingPage = await this.database.pages.get(pageId);
      const prev = existingPage?.encryptedStrokes
        ? await decryptPageContent(existingPage.encryptedStrokes, masterKey)
        : {
            strokes: existingPage?.strokes ?? [],
            textboxes: existingPage?.textboxes ?? [],
            images: existingPage?.images ?? [],
            pdfBackground: clonePdfBackground(existingPage?.pdfBackground),
          };
      const encryptedStrokes = await encryptJsonPayload(
        {
          ...prev,
          layers,
          ...(strokes !== undefined ? { strokes } : {}),
        },
        masterKey,
      );
      patch = {
        strokes: [],
        layers: undefined,
        encryptedStrokes,
        updatedAt: now,
      };
    } else {
      patch = {
        layers,
        ...(strokes !== undefined ? { strokes } : {}),
        updatedAt: now,
      };
    }

    await this.database.transaction('rw', this.database.notebooks, this.database.pages, async () => {
      await this.database.pages.update(pageId, patch);
      await this.database.notebooks.update(notebookId, { updatedAt: now });
    });
  }

  async saveNoteDocument(
    notebookId: string,
    pageId: string,
    noteData: NoteDocumentData,
    masterKey?: CryptoKey | null,
  ): Promise<void> {
    const notebook = await this.database.notebooks.get(notebookId);
    const now = Date.now();
    let patch: Partial<Page>;
    if (notebook?.isLocked) {
      if (!masterKey) {
        throw new Error('Cannot persist note document for a locked notebook without Master Key.');
      }
      const existingPage = await this.database.pages.get(pageId);
      const prev = existingPage?.encryptedStrokes
        ? await decryptPageContent(existingPage.encryptedStrokes, masterKey)
        : { strokes: [], textboxes: [], images: [], pdfBackground: null };
      const encryptedStrokes = await encryptJsonPayload(
        { ...prev, noteData },
        masterKey,
      );
      patch = {
        noteData: null,
        encryptedStrokes,
        updatedAt: now,
      };
    } else {
      patch = {
        noteData,
        updatedAt: now,
      };
    }

    await this.database.transaction('rw', this.database.notebooks, this.database.pages, async () => {
      await this.database.pages.update(pageId, patch);
      await this.database.notebooks.update(notebookId, { updatedAt: now });
    });
  }

  async saveSlidePage(
    notebookId: string,
    pageId: string,
    slideData: SlideData,
    paper?: PaperConfig,
    masterKey?: CryptoKey | null,
  ): Promise<void> {
    const notebook = await this.database.notebooks.get(notebookId);
    const now = Date.now();
    let patch: Partial<Page>;
    if (notebook?.isLocked) {
      if (!masterKey) {
        throw new Error('Cannot persist slide for a locked deck without Master Key.');
      }
      const existingPage = await this.database.pages.get(pageId);
      const prev = existingPage?.encryptedStrokes
        ? await decryptPageContent(existingPage.encryptedStrokes, masterKey)
        : { strokes: [], textboxes: [], images: [], pdfBackground: null };
      const encryptedStrokes = await encryptJsonPayload(
        { ...prev, slideData },
        masterKey,
      );
      patch = {
        ...(paper ? { paper: clonePaper(paper) } : {}),
        slideData: null,
        encryptedStrokes,
        updatedAt: now,
      };
    } else {
      patch = {
        ...(paper ? { paper: clonePaper(paper) } : {}),
        slideData,
        updatedAt: now,
      };
    }

    await this.database.transaction('rw', this.database.notebooks, this.database.pages, async () => {
      await this.database.pages.update(pageId, patch);
      await this.database.notebooks.update(notebookId, { updatedAt: now });
    });
  }

  async savePageTextboxes(
    notebookId: string,
    pageId: string,
    textboxes: Textbox[],
    strokes?: Stroke[],
    masterKey?: CryptoKey | null,
  ): Promise<void> {
    const notebook = await this.database.notebooks.get(notebookId);
    const existingPage =
      strokes === undefined || notebook?.isLocked
        ? await this.database.pages.get(pageId)
        : undefined;
    let effectiveStrokes = strokes ?? existingPage?.strokes ?? [];
    let effectiveImages = existingPage?.images ?? [];
    let effectivePdfBackground = clonePdfBackground(existingPage?.pdfBackground);
    const now = Date.now();
    let patch: Partial<Page>;

    if (notebook?.isLocked) {
      if (!masterKey) {
        throw new Error('Cannot persist textboxes for a locked notebook without Master Key.');
      }
      if (existingPage?.encryptedStrokes) {
        const prev = await decryptPageContent(existingPage.encryptedStrokes, masterKey);
        if (strokes === undefined) effectiveStrokes = prev.strokes;
        effectiveImages = prev.images;
        effectivePdfBackground = prev.pdfBackground;
      }
      const encryptedStrokes = await encryptJsonPayload(
        {
          strokes: effectiveStrokes,
          textboxes,
          images: effectiveImages,
          pdfBackground: effectivePdfBackground,
        },
        masterKey,
      );
      patch = {
        strokes: [],
        textboxes: [],
        images: [],
        pdfBackground: null,
        encryptedStrokes,
        thumbnailDataUrl: undefined,
        updatedAt: now,
      };
    } else {
      patch = {
        textboxes,
        encryptedStrokes: null,
        updatedAt: now,
      };
    }

    await this.database.transaction('rw', this.database.notebooks, this.database.pages, async () => {
      await this.database.pages.update(pageId, patch);
      await this.database.notebooks.update(notebookId, { updatedAt: now });
    });
  }

  async savePagePaper(
    notebookId: string,
    pageId: string,
    paper: PaperConfig,
    thumbnailDataUrl?: string,
  ): Promise<void> {
    const notebook = await this.database.notebooks.get(notebookId);
    const now = Date.now();
    const patch: Partial<Page> = {
      paper: clonePaper(paper),
      updatedAt: now,
    };
    if (!notebook?.isLocked && thumbnailDataUrl !== undefined) {
      patch.thumbnailDataUrl = thumbnailDataUrl;
    }

    await this.database.transaction('rw', this.database.notebooks, this.database.pages, async () => {
      await this.database.pages.update(pageId, patch);
      await this.database.notebooks.update(notebookId, { updatedAt: now });
    });
  }

  async getCustomTemplates(): Promise<PaperTemplate[]> {
    return this.database.templates.orderBy('updatedAt').reverse().toArray();
  }

  async saveCustomTemplate(params: {
    name: string;
    mode?: NotebookMode;
    category: 'paper-preset' | 'page-template';
    paper: PaperConfig;
    strokes: Stroke[];
    textboxes?: Textbox[];
    images?: PageImage[];
    thumbnailDataUrl?: string;
  }): Promise<PaperTemplate> {
    const now = Date.now();
    const clonedPaper = clonePaper(params.paper);
    const {
      strokes: clonedStrokes,
      textboxes: clonedTextboxes,
      images: clonedImages,
    } = clonePageAnnotations(params.strokes, params.textboxes, params.images);
    const thumbnailDataUrl =
      params.thumbnailDataUrl ??
      generatePageThumbnail(
        clonedPaper,
        clonedStrokes,
        240,
        clonedTextboxes,
        clonedImages,
        undefined,
        params.mode === 'whiteboard',
      );

    const template: PaperTemplate = {
      id: createId(),
      name: params.name.trim() || 'Untitled Template',
      ...(params.mode ? { mode: params.mode } : {}),
      category: params.category,
      paper: clonedPaper,
      strokes: clonedStrokes,
      textboxes: clonedTextboxes,
      images: clonedImages,
      thumbnailDataUrl,
      createdAt: now,
      updatedAt: now,
    };

    await this.database.templates.add(template);
    return template;
  }

  async deleteCustomTemplate(id: string): Promise<void> {
    await this.database.templates.delete(id);
  }

  async importFolioNotebook(
    archive: FolioNotebookExport,
    targetFolderId: string | null,
  ): Promise<{ notebook: Notebook; pages: Page[] }> {
    const now = Date.now();
    const notebookId = createId();

    const firstImages = archive.pages[0]?.images;
    if (firstImages && firstImages.length > 0) {
      await ensurePageImagesDecoded(firstImages);
    }

    const assetIdMap = new Map<string, string>();
    const assetsToInsert: PdfAsset[] = (archive.pdfAssets ?? []).map((srcAsset) => {
      const newAssetId = createId();
      assetIdMap.set(srcAsset.id, newAssetId);
      return {
        id: newAssetId,
        notebookId,
        name: srcAsset.name || 'Imported Document.pdf',
        data: base64ToArrayBuffer(srcAsset.base64Data),
        encryptedData: null,
        pageCount: srcAsset.pageCount,
        createdAt: srcAsset.createdAt ?? now,
      };
    });

    const importedMode: NotebookMode =
      archive.notebook.mode === 'whiteboard' ||
      archive.notebook.mode === 'notes' ||
      archive.notebook.mode === 'slides'
        ? archive.notebook.mode
        : 'notebook';
    const isImportedWhiteboard = importedMode === 'whiteboard';

    const pages: Page[] = archive.pages.map((srcPage, idx) => {
      const paper = clonePaper(srcPage.paper ?? archive.notebook.defaultPaper ?? DEFAULT_PAPER_CONFIG);
      const { strokes, textboxes, images } = clonePageAnnotations(
        srcPage.strokes,
        srcPage.textboxes,
        srcPage.images,
      );
      const mappedPdfBg = srcPage.pdfBackground
        ? {
            assetId: assetIdMap.get(srcPage.pdfBackground.assetId) ?? srcPage.pdfBackground.assetId,
            pageNumber: srcPage.pdfBackground.pageNumber,
          }
        : null;
      const thumbnailDataUrl =
        idx === 0 && !mappedPdfBg
          ? generatePageThumbnail(paper, strokes, 240, textboxes, images, undefined, isImportedWhiteboard)
          : undefined;
      return {
        id: createId(),
        notebookId,
        paper,
        strokes,
        ...(srcPage.layers ? { layers: srcPage.layers } : {}),
        textboxes,
        images,
        ...(srcPage.noteData ? { noteData: srcPage.noteData } : {}),
        ...(srcPage.slideData ? { slideData: srcPage.slideData } : {}),
        pdfBackground: mappedPdfBg,
        encryptedStrokes: null,
        thumbnailDataUrl,
        createdAt: now,
        updatedAt: now,
      };
    });

    const notebook: Notebook = {
      id: notebookId,
      title: archive.notebook.title.trim() || 'Imported Notebook',
      mode: importedMode,
      ...(archive.notebook.slideSizePreset
        ? { slideSizePreset: archive.notebook.slideSizePreset }
        : {}),
      folderId: targetFolderId,
      cover: { ...archive.notebook.cover },
      defaultPaper: clonePaper(archive.notebook.defaultPaper ?? pages[0]?.paper ?? DEFAULT_PAPER_CONFIG),
      pageOrder: pages.map((p) => p.id),
      lastOpenedPageId: pages[0]?.id ?? null,
      isLocked: false,
      createdAt: now,
      updatedAt: now,
    };

    await this.database.transaction(
      'rw',
      this.database.notebooks,
      this.database.pages,
      this.database.pdfAssets,
      async () => {
        await this.database.notebooks.add(notebook);
        await this.database.pages.bulkAdd(pages);
        if (assetsToInsert.length > 0) {
          await this.database.pdfAssets.bulkAdd(assetsToInsert);
        }
      },
    );

    return { notebook, pages };
  }

  async exportWorkspaceBackup(): Promise<FolioWorkspaceBackup> {
    const [allFolders, allNotebooks, allPages, allTemplates, allPdfAssets] = await Promise.all([
      this.database.folders.toArray(),
      this.database.notebooks.toArray(),
      this.database.pages.toArray(),
      this.database.templates.toArray(),
      this.database.pdfAssets.toArray(),
    ]);

    const pagesByNotebook = new Map<string, Page[]>();
    for (const p of allPages) {
      const list = pagesByNotebook.get(p.notebookId) ?? [];
      list.push(p);
      pagesByNotebook.set(p.notebookId, list);
    }

    const lockedNotebookIds = new Set(
      allNotebooks.filter((n) => n.isLocked).map((n) => n.id),
    );
    const unlockedEntries: Array<{ notebook: Notebook; pages: Page[] }> = [];
    const skippedLockedTitles: string[] = [];

    for (const nb of allNotebooks) {
      if (nb.isLocked) {
        skippedLockedTitles.push(nb.title);
        continue;
      }
      const raw = pagesByNotebook.get(nb.id) ?? [];
      const byId = new Map(raw.map((p) => [p.id, p]));
      const ordered: Page[] = [];
      for (const pid of nb.pageOrder) {
        const found = byId.get(pid);
        if (found) ordered.push(found);
      }
      for (const p of raw) {
        if (!nb.pageOrder.includes(p.id)) ordered.push(p);
      }

      unlockedEntries.push({
        notebook: { ...nb, isLocked: false },
        pages: ordered.map((p) => ({
          ...p,
          strokes: p.strokes ?? [],
          textboxes: p.textboxes ?? [],
          images: p.images ?? [],
          pdfBackground: p.pdfBackground ?? null,
          encryptedStrokes: null,
        })),
      });
    }

    const exportedPdfAssets: Array<SerializedPdfAsset & { notebookId: string }> = [];
    for (const asset of allPdfAssets) {
      if (lockedNotebookIds.has(asset.notebookId) || !asset.data) continue;
      const buf = await readBinaryData(asset.data);
      exportedPdfAssets.push({
        id: asset.id,
        notebookId: asset.notebookId,
        name: asset.name,
        pageCount: asset.pageCount,
        base64Data: arrayBufferToBase64(buf),
        createdAt: asset.createdAt,
      });
    }

    return {
      format: 'folio-workspace',
      version: 1,
      exportedAt: Date.now(),
      folders: allFolders.map((f) => ({ ...f })),
      notebooks: unlockedEntries,
      templates: allTemplates.map((t) => ({ ...t })),
      ...(exportedPdfAssets.length > 0 ? { pdfAssets: exportedPdfAssets } : {}),
      skippedLockedTitles: skippedLockedTitles.length > 0 ? skippedLockedTitles : undefined,
    };
  }

  async importWorkspaceBackup(backup: FolioWorkspaceBackup): Promise<{
    importedFolders: number;
    importedNotebooks: number;
    importedTemplates: number;
  }> {
    const now = Date.now();
    const folderIdMap = new Map<string, string>();
    for (const f of backup.folders) {
      folderIdMap.set(f.id, createId());
    }

    const foldersToInsert: Folder[] = backup.folders.map((f) => ({
      id: folderIdMap.get(f.id)!,
      name: f.name.trim() || 'Untitled Folder',
      parentId: f.parentId ? folderIdMap.get(f.parentId) ?? null : null,
      color: f.color,
      createdAt: f.createdAt ?? now,
      updatedAt: now,
    }));

    const notebooksToInsert: Notebook[] = [];
    const pagesToInsert: Page[] = [];
    const assetsToInsert: PdfAsset[] = [];
    const assetIdMap = new Map<string, string>();
    const notebookIdMap = new Map<string, string>();

    for (const entry of backup.notebooks) {
      notebookIdMap.set(entry.notebook.id, createId());
    }

    for (const srcAsset of backup.pdfAssets ?? []) {
      const mappedNotebookId = notebookIdMap.get(srcAsset.notebookId);
      if (!mappedNotebookId) continue;
      const newAssetId = createId();
      assetIdMap.set(srcAsset.id, newAssetId);
      assetsToInsert.push({
        id: newAssetId,
        notebookId: mappedNotebookId,
        name: srcAsset.name || 'Imported Document.pdf',
        data: base64ToArrayBuffer(srcAsset.base64Data),
        encryptedData: null,
        pageCount: srcAsset.pageCount,
        createdAt: srcAsset.createdAt ?? now,
      });
    }

    for (const entry of backup.notebooks) {
      const nb = entry.notebook;
      const nbId = notebookIdMap.get(nb.id) ?? createId();
      if (entry.pages[0]?.images && entry.pages[0].images.length > 0) {
        await ensurePageImagesDecoded(entry.pages[0].images);
      }

      const clonedPages: Page[] = entry.pages.map((p, idx) => {
        const paper = clonePaper(p.paper ?? nb.defaultPaper ?? DEFAULT_PAPER_CONFIG);
        const { strokes, textboxes, images } = clonePageAnnotations(
          p.strokes,
          p.textboxes,
          p.images,
        );
        const mappedPdfBg = p.pdfBackground
          ? {
              assetId: assetIdMap.get(p.pdfBackground.assetId) ?? p.pdfBackground.assetId,
              pageNumber: p.pdfBackground.pageNumber,
            }
          : null;
        return {
          id: createId(),
          notebookId: nbId,
          paper,
          strokes,
          ...(p.layers ? { layers: p.layers } : {}),
          textboxes,
          images,
          ...(p.noteData ? { noteData: p.noteData } : {}),
          ...(p.slideData ? { slideData: p.slideData } : {}),
          pdfBackground: mappedPdfBg,
          encryptedStrokes: null,
          thumbnailDataUrl:
            idx === 0 && !mappedPdfBg
              ? p.thumbnailDataUrl || generatePageThumbnail(paper, strokes, 240, textboxes, images)
              : p.thumbnailDataUrl,
          createdAt: p.createdAt ?? now,
          updatedAt: now,
        };
      });

      const pageOrder = clonedPages.map((p) => p.id);
      notebooksToInsert.push({
        id: nbId,
        title: nb.title.trim() || 'Untitled Notebook',
        ...(nb.mode ? { mode: nb.mode } : {}),
        ...(nb.slideSizePreset ? { slideSizePreset: nb.slideSizePreset } : {}),
        folderId: nb.folderId ? folderIdMap.get(nb.folderId) ?? null : null,
        cover: { ...nb.cover },
        defaultPaper: clonePaper(nb.defaultPaper ?? DEFAULT_PAPER_CONFIG),
        pageOrder,
        lastOpenedPageId: pageOrder[0] ?? null,
        isLocked: false,
        createdAt: nb.createdAt ?? now,
        updatedAt: now,
      });
      pagesToInsert.push(...clonedPages);
    }

    const templatesToInsert: PaperTemplate[] = [];
    for (const tpl of backup.templates) {
      if (tpl.images && tpl.images.length > 0) {
        await ensurePageImagesDecoded(tpl.images);
      }
      const paper = clonePaper(tpl.paper ?? DEFAULT_PAPER_CONFIG);
      const { strokes, textboxes, images } = clonePageAnnotations(
        tpl.strokes,
        tpl.textboxes,
        tpl.images,
      );
      templatesToInsert.push({
        id: createId(),
        name: tpl.name.trim() || 'Untitled Template',
        category: tpl.category,
        paper,
        strokes,
        textboxes,
        images,
        thumbnailDataUrl:
          tpl.thumbnailDataUrl || generatePageThumbnail(paper, strokes, 240, textboxes, images),
        createdAt: tpl.createdAt ?? now,
        updatedAt: now,
      });
    }

    await this.database.transaction(
      'rw',
      this.database.folders,
      this.database.notebooks,
      this.database.pages,
      this.database.templates,
      this.database.pdfAssets,
      async () => {
        if (foldersToInsert.length > 0) await this.database.folders.bulkAdd(foldersToInsert);
        if (notebooksToInsert.length > 0) await this.database.notebooks.bulkAdd(notebooksToInsert);
        if (pagesToInsert.length > 0) await this.database.pages.bulkAdd(pagesToInsert);
        if (templatesToInsert.length > 0) await this.database.templates.bulkAdd(templatesToInsert);
        if (assetsToInsert.length > 0) await this.database.pdfAssets.bulkAdd(assetsToInsert);
      },
    );

    return {
      importedFolders: foldersToInsert.length,
      importedNotebooks: notebooksToInsert.length,
      importedTemplates: templatesToInsert.length,
    };
  }

  async getStorageSummary(): Promise<LocalStorageSummary> {
    await this.purgeExpiredTrashedNotebooks();
    const [
      folderCount,
      notebookCount,
      pageCount,
      templateCount,
      pdfAssetCount,
      trashedNotebookCount,
    ] = await Promise.all([
      this.database.folders.count(),
      this.database.notebooks.count(),
      this.database.pages.count(),
      this.database.templates.count(),
      this.database.pdfAssets.count(),
      this.database.trashedNotebooks.count(),
    ]);

    let estimatedBytes: number | null = null;
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        if (typeof est.usage === 'number' && Number.isFinite(est.usage)) {
          estimatedBytes = est.usage;
        }
      }
    } catch {
      estimatedBytes = null;
    }

    return {
      folderCount,
      notebookCount,
      pageCount,
      templateCount,
      pdfAssetCount,
      trashedNotebookCount,
      estimatedBytes,
    };
  }
}

export const repository = new NotesRepository(db);
