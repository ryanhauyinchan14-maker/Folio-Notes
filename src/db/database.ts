import Dexie, { type EntityTable } from 'dexie';
import { COVER_PRESETS } from '../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../constants/papers';
import type {
  CustomFontRecord,
  Folder,
  Notebook,
  Page,
  PaperTemplate,
  PdfAsset,
  TrashedNotebookRecord,
} from '../types/notes';
import { createId } from '../utils/id';

export class GoodNotesDatabase extends Dexie {
  folders!: EntityTable<Folder, 'id'>;
  notebooks!: EntityTable<Notebook, 'id'>;
  pages!: EntityTable<Page, 'id'>;
  templates!: EntityTable<PaperTemplate, 'id'>;
  pdfAssets!: EntityTable<PdfAsset, 'id'>;
  trashedNotebooks!: EntityTable<TrashedNotebookRecord, 'id'>;
  customFonts!: EntityTable<CustomFontRecord, 'id'>;

  constructor(dbName = 'goodnotes-local-db') {
    super(dbName);

    this.version(1).stores({
      folders: 'id, parentId, name, updatedAt',
      notebooks: 'id, folderId, title, updatedAt',
      pages: 'id, notebookId, updatedAt',
      templates: 'id, category, name, updatedAt',
    });

    this.version(2).stores({
      folders: 'id, parentId, name, updatedAt',
      notebooks: 'id, folderId, title, updatedAt',
      pages: 'id, notebookId, updatedAt',
      templates: 'id, category, name, updatedAt',
      pdfAssets: 'id, notebookId, createdAt',
    });

    this.version(3).stores({
      folders: 'id, parentId, name, updatedAt',
      notebooks: 'id, folderId, title, updatedAt',
      pages: 'id, notebookId, updatedAt',
      templates: 'id, category, name, updatedAt',
      pdfAssets: 'id, notebookId, createdAt',
      trashedNotebooks: 'id, deletedAt, expiresAt',
    });

    this.version(4).stores({
      folders: 'id, parentId, name, updatedAt',
      notebooks: 'id, folderId, title, updatedAt',
      pages: 'id, notebookId, updatedAt',
      templates: 'id, category, name, updatedAt',
      pdfAssets: 'id, notebookId, createdAt',
      trashedNotebooks: 'id, deletedAt, expiresAt',
      customFonts: 'id, name, createdAt',
    });

    // Runs strictly once on initial database creation.
    // Deleting the starter notebook keeps it deleted across reloads.
    this.on('populate', async (tx) => {
      const now = Date.now();
      const starterNotebookId = createId();
      const starterPageId = createId();

      const starterPage: Page = {
        id: starterPageId,
        notebookId: starterNotebookId,
        paper: { ...DEFAULT_PAPER_CONFIG },
        strokes: [],
        createdAt: now,
        updatedAt: now,
      };

      const starterNotebook: Notebook = {
        id: starterNotebookId,
        title: 'Quick Notes',
        folderId: null,
        cover: { ...COVER_PRESETS[0].cover },
        defaultPaper: { ...DEFAULT_PAPER_CONFIG },
        pageOrder: [starterPageId],
        lastOpenedPageId: starterPageId,
        createdAt: now,
        updatedAt: now,
      };

      await tx.table('pages').add(starterPage);
      await tx.table('notebooks').add(starterNotebook);
    });
  }
}

export const db = new GoodNotesDatabase();
