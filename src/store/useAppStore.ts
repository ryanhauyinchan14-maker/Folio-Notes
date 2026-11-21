import { create } from 'zustand';
import {
  cloneStrokeWithNewId,
  scaleStroke,
  translateStroke,
} from '../canvas/geometry';
import {
  computeAlignedElements,
  type ElementAlignment,
  expandSelectionWithGroups,
  getSelectionSummary,
  type PageElementSelection,
  remapGroupIdsForClones,
} from '../canvas/selection';
import {
  generatePageThumbnail,
  generatePdfAwarePageThumbnail,
} from '../canvas/thumbnail';
import {
  COVER_PRESETS,
  HIGHLIGHTER_DEFAULT_SWATCHES,
  HIGHLIGHTER_THICKNESS_PRESETS,
  PEN_DEFAULT_SWATCHES,
  PEN_THICKNESS_PRESETS,
} from '../constants/covers';
import { db } from '../db/database';
import { repository } from '../db/repository';
import type {
  BoundingBox,
  CoverConfig,
  Folder,
  Notebook,
  Page,
  PageImage,
  PaperConfig,
  PaperPattern,
  PaperTemplate,
  PdfPageBackground,
  Stroke,
  Textbox,
  ToolType,
} from '../types/notes';
import {
  type FolioWorkspaceBackup,
  parseFolioNotebookExport,
  parseFolioWorkspaceBackup,
} from '../utils/exportNotebook';
import { createId } from '../utils/id';
import {
  clearPdfDocumentCache,
  extractPdfForImport,
  type PdfImportProgress,
} from '../utils/pdfEngine';
import {
  clearGeminiApiKey,
  DEFAULT_HERO_HEADLINE,
  DEFAULT_PEN_SLOTS,
  type DefaultToolPreference,
  type DefaultZoomMode,
  type DeskBackdropPresetId,
  type DockPosition,
  type GeminiModelPresetId,
  getGeminiApiKey,
  getHandwritingCorrectionEnabled,
  getWorkspacePreferences,
  type PenFavoriteSlot,
  saveGeminiApiKey,
  saveHandwritingCorrectionEnabled,
  saveWorkspacePreferences,
} from '../utils/settings';
import {
  initializeVault,
  resetVaultPasswordWithRecoveryKey,
  unlockMasterKeyWithPassword,
} from '../utils/vaultCrypto';

export type HistoryCommand =
  | {
      type: 'strokes';
      pageId: string;
      prevStrokes: Stroke[];
      nextStrokes: Stroke[];
    }
  | {
      type: 'textboxes';
      pageId: string;
      prevTextboxes: Textbox[];
      nextTextboxes: Textbox[];
    }
  | {
      type: 'images';
      pageId: string;
      prevImages: PageImage[];
      nextImages: PageImage[];
    }
  | {
      type: 'page-content';
      pageId: string;
      prevStrokes: Stroke[];
      nextStrokes: Stroke[];
      prevTextboxes: Textbox[];
      nextTextboxes: Textbox[];
      prevImages: PageImage[];
      nextImages: PageImage[];
    }
  | {
      type: 'paper';
      pageId: string;
      prevPaper: PaperConfig;
      nextPaper: PaperConfig;
    };

export type TextboxStyleSnapshot = Pick<
  Textbox,
  'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'color'
>;

export interface CanvasClipboard {
  strokes: Stroke[];
  textboxes: Textbox[];
  images: PageImage[];
}

export interface LassoSelection {
  pageId: string;
  strokeIds: string[];
}

const thumbnailTimers = new Map<string, number>();
let tidyToastTimer: number | null = null;
let activePdfImportAbort: AbortController | null = null;

function schedulePageThumbnailUpdate(
  pageId: string,
  paper: PaperConfig,
  strokes: Stroke[],
  textboxes: Textbox[] = [],
  images: PageImage[] = [],
  pdfBackground?: PdfPageBackground | null,
): void {
  if (typeof window === 'undefined') return;
  const existing = thumbnailTimers.get(pageId);
  if (existing !== undefined) {
    window.clearTimeout(existing);
  }
  const timer = window.setTimeout(() => {
    thumbnailTimers.delete(pageId);
    void (async () => {
      const dbPage = pdfBackground === undefined ? await db.pages.get(pageId) : undefined;
      const effectivePdfBg = pdfBackground ?? dbPage?.pdfBackground ?? null;
      const thumbnailDataUrl = effectivePdfBg
        ? await generatePdfAwarePageThumbnail(
            {
              id: pageId,
              notebookId: '',
              paper,
              strokes,
              textboxes,
              images,
              pdfBackground: effectivePdfBg,
              createdAt: 0,
              updatedAt: 0,
            },
            240,
          )
        : generatePageThumbnail(paper, strokes, 240, textboxes, images);
      if (thumbnailDataUrl) {
        await db.pages.update(pageId, { thumbnailDataUrl });
        useAppStore.setState((s) => ({
          pages: s.pages.map((p) => (p.id === pageId ? { ...p, thumbnailDataUrl } : p)),
        }));
      }
    })();
  }, 250);
  thumbnailTimers.set(pageId, timer);
}

function persistPageContentChange(
  notebook: Notebook,
  pageId: string,
  paper: PaperConfig,
  strokes: Stroke[],
  textboxes: Textbox[],
  images: PageImage[],
  unlockedMasterKey: CryptoKey | null,
  onSaveState?: (status: 'saving' | 'saved') => void,
): void {
  onSaveState?.('saving');
  void repository
    .savePageStrokes(
      notebook.id,
      pageId,
      strokes,
      undefined,
      unlockedMasterKey,
      textboxes,
      images,
    )
    .finally(() => {
      onSaveState?.('saved');
    });
  if (!notebook.isLocked) {
    schedulePageThumbnailUpdate(pageId, paper, strokes, textboxes, images);
  }
}

interface AppState {
  // Shelf state
  currentFolderId: string | null;
  folders: Folder[];
  notebooks: Notebook[];
  breadcrumbs: Folder[];
  coverThumbnails: Record<string, string | undefined>;
  customTemplates: PaperTemplate[];
  lockedNotebookCount: number;
  shelfLoading: boolean;

  // Vault runtime state (ONLY kept in memory while unlocked; never persisted to disk)
  unlockedMasterKey: CryptoKey | null;

  // Editor state
  activeNotebook: Notebook | null;
  pages: Page[];
  activePageId: string | null;
  undoStack: HistoryCommand[];
  redoStack: HistoryCommand[];
  saveStatus: 'saved' | 'saving';

  // Tool & Canvas settings
  activeTool: ToolType;
  penColor: string;
  penSize: number;
  penSwatches: string[];
  highlighterColor: string;
  highlighterSize: number;
  highlighterSwatches: string[];
  eraserSize: number;
  holdToSnapEnabled: boolean;
  handwritingCorrectionEnabled: boolean;
  handwritingTidyToast: string | null;
  zoom: number;

  // Workspace Customizability & Power Options
  penSlots: PenFavoriteSlot[];
  activePenSlotIndex: number | null;
  deskBackdrop: DeskBackdropPresetId;
  deskCustomColor: string;
  darkPaperView: boolean;
  highContrastUi: boolean;
  dockPosition: DockPosition;
  heroHeadline: string;
  defaultZoomMode: DefaultZoomMode;
  defaultTool: DefaultToolPreference;
  defaultPaperPattern: PaperPattern;
  geminiApiKey: string;
  geminiModelPreset: GeminiModelPresetId;
  geminiCustomModelId: string;
  blockAiOnVaultLocked: boolean;

  // Lasso state
  lassoSelection: LassoSelection | null;
  isDraggingLasso: boolean;

  // Textbox, Image & Selection Clipboard state
  activeTextboxId: string | null;
  selectedTextboxId: string | null;
  selectedTextboxIds: string[];
  textboxSessionBaseline: { pageId: string; prevTextboxes: Textbox[] } | null;
  selectedImageIds: string[];
  croppingImageId: string | null;
  clipboard: CanvasClipboard | null;
  pasteOffsetStep: number;
  copiedTextboxStyle: TextboxStyleSnapshot | null;

  // Actions — Initialization & Shelf
  initApp: () => Promise<void>;
  refreshShelf: () => Promise<void>;
  refreshTemplates: () => Promise<void>;
  navigateToFolder: (folderId: string | null) => Promise<void>;
  createFolder: (name: string, color: string) => Promise<void>;
  renameFolder: (id: string, name: string, color?: string) => Promise<void>;
  moveFolder: (id: string, targetParentId: string | null) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  createNotebook: (params: {
    title: string;
    folderId: string | null;
    cover: CoverConfig;
    paper: PaperConfig;
    initialStrokes?: Stroke[];
    initialTextboxes?: Textbox[];
    initialImages?: PageImage[];
    openImmediately?: boolean;
  }) => Promise<Notebook>;
  updateNotebookMeta: (
    id: string,
    patch: Partial<Pick<Notebook, 'title' | 'folderId' | 'cover' | 'defaultPaper'>>,
  ) => Promise<void>;
  duplicateNotebook: (id: string) => Promise<void>;
  deleteNotebook: (id: string) => Promise<void>;

  // Actions — Vault Lock
  setupVaultAndMaybeLockNotebook: (
    password: string,
    recoveryKey: string,
    notebookIdToLock?: string | null,
  ) => Promise<void>;
  lockNotebookWithPassword: (notebookId: string, password: string) => Promise<void>;
  unlockNotebookWithPassword: (
    notebookId: string,
    password: string,
    mode: 'open' | 'remove-lock',
  ) => Promise<void>;
  resetPasswordAndUnlock: (
    notebookId: string | null,
    recoveryKey: string,
    newPassword: string,
    mode: 'open' | 'remove-lock',
  ) => Promise<void>;
  lockNow: () => Promise<void>;
  lockAllNotebooksNow: () => Promise<void>;

  // Actions — Editor & Pages
  openNotebook: (notebookId: string, masterKey?: CryptoKey | null) => Promise<void>;
  closeNotebook: () => Promise<void>;
  setActivePageId: (pageId: string) => void;
  addPageFromTemplate: (
    paper: PaperConfig,
    initialStrokes?: Stroke[],
    afterPageId?: string,
    initialTextboxes?: Textbox[],
    initialImages?: PageImage[],
  ) => Promise<Page | null>;
  duplicatePage: (pageId: string) => Promise<void>;
  deletePage: (pageId: string) => Promise<void>;
  reorderPages: (newOrder: string[]) => Promise<void>;

  // Actions — Tools & View
  setActiveTool: (tool: ToolType) => void;
  setActiveColor: (color: string) => void;
  replaceToolSwatch: (index: number, color: string) => void;
  setActiveSize: (size: number) => void;
  setEraserSize: (size: number) => void;
  setHoldToSnapEnabled: (enabled: boolean) => void;
  setHandwritingCorrectionEnabled: (enabled: boolean) => void;
  setZoom: (zoom: number) => void;
  activatePenSlot: (index: number) => void;
  saveCurrentToolToSlot: (index: number, customName?: string) => void;
  resetPenSlots: () => void;
  setDeskBackdrop: (preset: DeskBackdropPresetId, customColor?: string) => void;
  setDarkPaperView: (enabled: boolean) => void;
  setHighContrastUi: (enabled: boolean) => void;
  setDockPosition: (pos: DockPosition) => void;
  setHeroHeadline: (headline: string) => void;
  setDefaultZoomMode: (mode: DefaultZoomMode) => void;
  setDefaultTool: (tool: DefaultToolPreference) => void;
  setDefaultPaperPattern: (pattern: PaperPattern) => void;
  setGeminiApiKey: (apiKey: string) => void;
  clearStoredGeminiApiKey: () => void;
  setGeminiModelConfig: (preset: GeminiModelPresetId, customModelId?: string) => void;
  setBlockAiOnVaultLocked: (enabled: boolean) => void;

  // Actions — Strokes, Handwriting Correction, Textboxes, Paper, Lasso, Undo/Redo
  commitNewStroke: (pageId: string, stroke: Stroke) => void;
  commitEraseStrokes: (pageId: string, strokeIdsToDelete: string[]) => void;
  commitHandwritingCorrection: (
    pageId: string,
    rawStrokeIds: string[],
    tidiedStrokes: Stroke[],
  ) => void;
  applyPaperToPage: (pageId: string, paper: PaperConfig) => Promise<void>;
  setLassoSelection: (selection: LassoSelection | null) => void;
  setIsDraggingLasso: (dragging: boolean) => void;
  commitLassoMove: (pageId: string, strokeIds: string[], dx: number, dy: number) => void;
  commitLassoRecolor: (pageId: string, strokeIds: string[], color: string) => void;
  commitLassoDelete: (pageId: string, strokeIds: string[]) => void;
  commitLassoDuplicate: (pageId: string, strokeIds: string[]) => void;

  spawnTextbox: (params: {
    pageId: string;
    x: number;
    y: number;
    initialText?: string;
    fontSize?: number;
    color?: string;
    wrapWidth?: number;
  }) => Textbox | null;
  beginEditTextbox: (pageId: string, textboxId: string) => void;
  selectTextbox: (textboxId: string | null) => void;
  updateTextboxLive: (pageId: string, textboxId: string, patch: Partial<Textbox>) => void;
  commitTextboxSession: (pageId: string, textboxId: string, keepSelected?: boolean) => void;
  commitTextboxMutation: (
    pageId: string,
    textboxId: string,
    patch: Partial<Textbox>,
  ) => void;
  altCloneTextbox: (pageId: string, textboxId: string) => Textbox | null;
  commitAltTextboxDrag: (
    pageId: string,
    prevTextboxes: Textbox[],
    textboxId: string,
    patch: Partial<Textbox>,
  ) => void;
  altCloneLassoStrokes: (pageId: string, strokeIds: string[]) => string[];
  commitAltLassoMove: (
    pageId: string,
    prevStrokes: Stroke[],
    strokeIds: string[],
    dx: number,
    dy: number,
  ) => void;
  deleteTextbox: (pageId: string, textboxId: string) => void;
  addPageImages: (pageId: string, newImages: PageImage[]) => void;
  selectImage: (imageId: string | null) => void;
  setCroppingImageId: (imageId: string | null) => void;
  updateImageLive: (
    pageId: string,
    imageId: string,
    patch: Partial<PageImage>,
  ) => void;
  commitImageHistorySnapshot: (
    pageId: string,
    prevImages: PageImage[],
  ) => void;
  commitImageMutation: (
    pageId: string,
    imageId: string,
    patch: Partial<PageImage>,
  ) => void;
  altCloneImage: (pageId: string, imageId: string) => PageImage | null;
  commitAltImageDrag: (
    pageId: string,
    prevImages: PageImage[],
    imageId: string,
    patch: Partial<PageImage>,
  ) => void;
  reorderImageLayer: (
    pageId: string,
    imageId: string,
    direction: 'forward' | 'backward',
  ) => void;
  deleteImage: (pageId: string, imageId: string) => void;
  clearPageAnnotations: (pageId: string) => void;
  nudgeSelection: (pageId: string, dx: number, dy: number) => void;
  duplicateSelection: (pageId: string) => void;
  copySelection: (pageId: string) => void;
  cutSelection: (pageId: string) => void;
  pasteSelection: (targetPageId: string) => void;
  selectAllOnPage: (pageId: string) => void;
  cycleTextboxSelection: (pageId: string, reverse?: boolean) => void;
  deleteActiveSelection: (pageId: string) => void;
  copyTextboxStyle: (pageId: string, textboxId: string) => void;
  pasteTextboxStyle: (pageId: string, textboxIds: string[]) => void;

  // Actions — Unified Selection, Grouping, Locking, Alignment & Stroke Scale
  setUnifiedSelection: (
    pageId: string,
    sel: PageElementSelection,
    opts?: { expandGroups?: boolean },
  ) => void;
  toggleElementInSelection: (
    pageId: string,
    ref: { kind: 'stroke' | 'textbox' | 'image'; id: string },
  ) => void;
  clearSelection: () => void;
  groupSelection: (pageId: string) => void;
  ungroupSelection: (pageId: string) => void;
  toggleLockSelection: (pageId: string, forceLocked?: boolean) => void;
  alignSelection: (pageId: string, alignment: ElementAlignment) => void;
  commitMultiElementMove: (
    pageId: string,
    sel: PageElementSelection,
    dx: number,
    dy: number,
  ) => void;
  altCloneMultiSelection: (
    pageId: string,
    sel: PageElementSelection,
  ) => PageElementSelection | null;
  commitAltMultiMove: (
    pageId: string,
    prev: { strokes: Stroke[]; textboxes: Textbox[]; images: PageImage[] },
    sel: PageElementSelection,
    dx: number,
    dy: number,
  ) => void;
  commitStrokeScale: (
    pageId: string,
    strokeIds: string[],
    originBounds: BoundingBox,
    targetBounds: BoundingBox,
  ) => void;

  undo: () => void;
  redo: () => void;

  // Actions — Templates
  savePresetTemplate: (name: string, paper: PaperConfig) => Promise<PaperTemplate>;
  saveCurrentPageAsTemplate: (pageId: string, name: string) => Promise<PaperTemplate | null>;
  deleteCustomTemplate: (id: string) => Promise<void>;

  // Actions — Import / Export Backups & Offline PDF Import
  pdfImportProgress: PdfImportProgress | null;
  importPdfAsNotebook: (file: File, openImmediately?: boolean) => Promise<Notebook | null>;
  importPdfPagesIntoActiveNotebook: (file: File, afterPageId?: string) => Promise<Page[]>;
  cancelPdfImport: () => void;
  importFolioNotebook: (rawJson: string, openImmediately?: boolean) => Promise<Notebook>;
  exportWorkspaceBackup: () => Promise<FolioWorkspaceBackup>;
  importWorkspaceBackup: (rawJson: string) => Promise<{
    importedFolders: number;
    importedNotebooks: number;
    importedTemplates: number;
  }>;
}

const MAX_HISTORY = 60;
const initialPrefs = getWorkspacePreferences();

function persistWorkspacePrefsSnapshot(state: AppState): void {
  saveWorkspacePreferences({
    penSlots: state.penSlots,
    deskBackdrop: state.deskBackdrop,
    deskCustomColor: state.deskCustomColor,
    darkPaperView: state.darkPaperView,
    highContrastUi: state.highContrastUi,
    dockPosition: state.dockPosition,
    heroHeadline: state.heroHeadline,
    defaultZoomMode: state.defaultZoomMode,
    defaultTool: state.defaultTool,
    defaultPaperPattern: state.defaultPaperPattern,
    geminiModelPreset: state.geminiModelPreset,
    geminiCustomModelId: state.geminiCustomModelId,
    blockAiOnVaultLocked: state.blockAiOnVaultLocked,
  });
}

function getPageSelectionFromState(state: AppState, pageId: string): PageElementSelection {
  return {
    strokeIds:
      state.lassoSelection?.pageId === pageId ? [...state.lassoSelection.strokeIds] : [],
    textboxIds: state.activePageId === pageId ? [...state.selectedTextboxIds] : [],
    imageIds: state.activePageId === pageId ? [...state.selectedImageIds] : [],
  };
}

function applyPageContentMutation(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
  pageId: string,
  prev: { strokes: Stroke[]; textboxes: Textbox[]; images: PageImage[] },
  next: { strokes: Stroke[]; textboxes: Textbox[]; images: PageImage[] },
  extraPatch: Partial<AppState> = {},
): void {
  const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
  const targetPage = pages.find((p) => p.id === pageId);
  if (!targetPage || !activeNotebook) return;

  const cmd: HistoryCommand = {
    type: 'page-content',
    pageId,
    prevStrokes: prev.strokes,
    nextStrokes: next.strokes,
    prevTextboxes: prev.textboxes,
    nextTextboxes: next.textboxes,
    prevImages: prev.images,
    nextImages: next.images,
  };

  const now = Date.now();
  set({
    pages: pages.map((p) =>
      p.id === pageId
        ? {
            ...p,
            strokes: next.strokes,
            textboxes: next.textboxes,
            images: next.images,
            updatedAt: now,
          }
        : p,
    ),
    undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
    redoStack: [],
    ...extraPatch,
  });

  persistPageContentChange(
    activeNotebook,
    pageId,
    targetPage.paper,
    next.strokes,
    next.textboxes,
    next.images,
    unlockedMasterKey,
    (status) => set({ saveStatus: status }),
  );
}

export const useAppStore = create<AppState>((set, get) => ({
  currentFolderId: null,
  folders: [],
  notebooks: [],
  breadcrumbs: [],
  coverThumbnails: {},
  customTemplates: [],
  lockedNotebookCount: 0,
  shelfLoading: true,
  pdfImportProgress: null,

  unlockedMasterKey: null,

  activeNotebook: null,
  pages: [],
  activePageId: null,
  undoStack: [],
  redoStack: [],
  saveStatus: 'saved',

  activeTool: initialPrefs.defaultTool,
  penColor: PEN_DEFAULT_SWATCHES[0],
  penSize: PEN_THICKNESS_PRESETS[1],
  penSwatches: [...PEN_DEFAULT_SWATCHES],
  highlighterColor: HIGHLIGHTER_DEFAULT_SWATCHES[0],
  highlighterSize: HIGHLIGHTER_THICKNESS_PRESETS[1],
  highlighterSwatches: [...HIGHLIGHTER_DEFAULT_SWATCHES],
  eraserSize: 16,
  holdToSnapEnabled: true,
  handwritingCorrectionEnabled: getHandwritingCorrectionEnabled(),
  handwritingTidyToast: null,
  zoom: 1,

  penSlots: initialPrefs.penSlots,
  activePenSlotIndex: null,
  deskBackdrop: initialPrefs.deskBackdrop,
  deskCustomColor: initialPrefs.deskCustomColor,
  darkPaperView: initialPrefs.darkPaperView,
  highContrastUi: initialPrefs.highContrastUi,
  dockPosition: initialPrefs.dockPosition,
  heroHeadline: initialPrefs.heroHeadline,
  defaultZoomMode: initialPrefs.defaultZoomMode,
  defaultTool: initialPrefs.defaultTool,
  defaultPaperPattern: initialPrefs.defaultPaperPattern,
  geminiApiKey: getGeminiApiKey(),
  geminiModelPreset: initialPrefs.geminiModelPreset,
  geminiCustomModelId: initialPrefs.geminiCustomModelId,
  blockAiOnVaultLocked: initialPrefs.blockAiOnVaultLocked,

  lassoSelection: null,
  isDraggingLasso: false,

  activeTextboxId: null,
  selectedTextboxId: null,
  selectedTextboxIds: [],
  textboxSessionBaseline: null,
  selectedImageIds: [],
  croppingImageId: null,
  clipboard: null,
  pasteOffsetStep: 0,
  copiedTextboxStyle: null,

  initApp: async () => {
    await Promise.all([get().refreshShelf(), get().refreshTemplates()]);
  },

  refreshShelf: async () => {
    set({ shelfLoading: true });
    const [{ folders, notebooks, breadcrumbs, coverThumbnails }, lockedNotebookCount] =
      await Promise.all([
        repository.getShelfItems(get().currentFolderId),
        repository.getLockedNotebookCount(),
      ]);
    set({
      folders,
      notebooks,
      breadcrumbs,
      coverThumbnails,
      lockedNotebookCount,
      shelfLoading: false,
    });
  },

  refreshTemplates: async () => {
    const customTemplates = await repository.getCustomTemplates();
    set({ customTemplates });
  },

  navigateToFolder: async (folderId) => {
    set({ currentFolderId: folderId });
    await get().refreshShelf();
  },

  createFolder: async (name, color) => {
    await repository.createFolder(name, get().currentFolderId, color);
    await get().refreshShelf();
  },

  renameFolder: async (id, name, color) => {
    await repository.renameFolder(id, name, color);
    await get().refreshShelf();
  },

  moveFolder: async (id, targetParentId) => {
    await repository.moveFolder(id, targetParentId);
    await get().refreshShelf();
  },

  deleteFolder: async (id) => {
    await repository.deleteFolderRecursive(id);
    if (get().currentFolderId === id) {
      set({ currentFolderId: null });
    }
    await get().refreshShelf();
  },

  createNotebook: async ({
    title,
    folderId,
    cover,
    paper,
    initialStrokes,
    initialTextboxes,
    initialImages,
    openImmediately = true,
  }) => {
    const { notebook } = await repository.createNotebook({
      title,
      folderId,
      cover,
      paper,
      initialStrokes,
      initialTextboxes,
      initialImages,
    });
    await get().refreshShelf();
    if (openImmediately) {
      await get().openNotebook(notebook.id);
    }
    return notebook;
  },

  updateNotebookMeta: async (id, patch) => {
    await repository.updateNotebook(id, patch);
    const active = get().activeNotebook;
    if (active && active.id === id) {
      set({
        activeNotebook: {
          ...active,
          ...patch,
          updatedAt: Date.now(),
        },
      });
    }
    await get().refreshShelf();
  },

  duplicateNotebook: async (id) => {
    await repository.duplicateNotebook(id);
    await get().refreshShelf();
  },

  deleteNotebook: async (id) => {
    await repository.deleteNotebook(id);
    clearPdfDocumentCache();
    if (get().activeNotebook?.id === id) {
      set({
        activeNotebook: null,
        pages: [],
        activePageId: null,
        undoStack: [],
        redoStack: [],
        lassoSelection: null,
        isDraggingLasso: false,
        activeTextboxId: null,
        selectedTextboxId: null,
        selectedTextboxIds: [],
        textboxSessionBaseline: null,
        selectedImageIds: [],
        croppingImageId: null,
        unlockedMasterKey: null,
      });
    }
    await get().refreshShelf();
  },

  setupVaultAndMaybeLockNotebook: async (password, recoveryKey, notebookIdToLock) => {
    const { masterKey } = await initializeVault(password, recoveryKey);
    if (notebookIdToLock) {
      await repository.lockNotebook(notebookIdToLock, masterKey);
    }
    set({ unlockedMasterKey: null });
    await get().refreshShelf();
  },

  lockNotebookWithPassword: async (notebookId, password) => {
    const masterKey = await unlockMasterKeyWithPassword(password, false);
    await repository.lockNotebook(notebookId, masterKey);
    set({ unlockedMasterKey: null });
    await get().refreshShelf();
  },

  unlockNotebookWithPassword: async (notebookId, password, mode) => {
    const masterKey = await unlockMasterKeyWithPassword(password, false);
    if (mode === 'remove-lock') {
      await repository.removeNotebookLock(notebookId, masterKey);
      set({ unlockedMasterKey: null });
      await get().refreshShelf();
      return;
    }
    await get().openNotebook(notebookId, masterKey);
  },

  resetPasswordAndUnlock: async (notebookId, recoveryKey, newPassword, mode) => {
    const masterKey = await resetVaultPasswordWithRecoveryKey(recoveryKey, newPassword);
    if (notebookId) {
      if (mode === 'remove-lock') {
        await repository.removeNotebookLock(notebookId, masterKey);
        set({ unlockedMasterKey: null });
        await get().refreshShelf();
        return;
      }
      await get().openNotebook(notebookId, masterKey);
      return;
    }
    set({ unlockedMasterKey: null });
    await get().refreshShelf();
  },

  lockNow: async () => {
    clearPdfDocumentCache();
    await get().closeNotebook();
  },

  lockAllNotebooksNow: async () => {
    clearPdfDocumentCache();
    const { activeNotebook } = get();
    if (activeNotebook?.isLocked) {
      await get().closeNotebook();
      return;
    }
    set({ unlockedMasterKey: null });
    await get().refreshShelf();
  },

  openNotebook: async (notebookId, masterKey) => {
    const effectiveKey = masterKey ?? get().unlockedMasterKey;
    const result = await repository.getNotebookWithPages(notebookId, effectiveKey);
    if (!result) return;
    const { notebook, pages } = result;
    const targetPageId =
      notebook.lastOpenedPageId && pages.some((p) => p.id === notebook.lastOpenedPageId)
        ? notebook.lastOpenedPageId
        : pages[0]?.id ?? null;

    const { defaultTool, defaultZoomMode } = get();
    set({
      activeNotebook: notebook,
      pages,
      activePageId: targetPageId,
      activeTool: defaultTool,
      zoom: defaultZoomMode === '100' ? 1 : get().zoom,
      undoStack: [],
      redoStack: [],
      saveStatus: 'saved',
      lassoSelection: null,
      isDraggingLasso: false,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      textboxSessionBaseline: null,
      selectedImageIds: [],
      croppingImageId: null,
      unlockedMasterKey: notebook.isLocked ? effectiveKey ?? null : null,
    });
  },

  closeNotebook: async () => {
    const { activeNotebook, pages, activePageId, unlockedMasterKey } = get();
    if (activeNotebook) {
      if (activePageId) {
        await repository.updateNotebook(activeNotebook.id, {
          lastOpenedPageId: activePageId,
        });
      }
      if (!activeNotebook.isLocked) {
        const firstPage = pages[0];
        if (firstPage && typeof document !== 'undefined') {
          const thumb = firstPage.pdfBackground
            ? await generatePdfAwarePageThumbnail(firstPage, 240, unlockedMasterKey)
            : generatePageThumbnail(
                firstPage.paper,
                firstPage.strokes,
                240,
                firstPage.textboxes ?? [],
                firstPage.images ?? [],
              );
          if (thumb) {
            await db.pages.update(firstPage.id, { thumbnailDataUrl: thumb });
          }
        }
      }
    }

    clearPdfDocumentCache();
    set({
      activeNotebook: null,
      pages: [],
      activePageId: null,
      undoStack: [],
      redoStack: [],
      lassoSelection: null,
      isDraggingLasso: false,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      textboxSessionBaseline: null,
      selectedImageIds: [],
      croppingImageId: null,
      unlockedMasterKey: null,
    });
    await get().refreshShelf();
  },

  setActivePageId: (pageId) => {
    const { activeNotebook, activePageId } = get();
    if (activePageId === pageId) return;
    set({
      activePageId: pageId,
      lassoSelection: null,
      isDraggingLasso: false,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      textboxSessionBaseline: null,
      selectedImageIds: [],
      croppingImageId: null,
    });
    if (activeNotebook) {
      void db.notebooks.update(activeNotebook.id, { lastOpenedPageId: pageId });
    }
  },

  addPageFromTemplate: async (
    paper,
    initialStrokes,
    afterPageId,
    initialTextboxes,
    initialImages,
  ) => {
    const { activeNotebook, activePageId, unlockedMasterKey } = get();
    if (!activeNotebook) return null;

    const created = await repository.addPageToNotebook({
      notebookId: activeNotebook.id,
      paper,
      initialStrokes,
      initialTextboxes,
      initialImages,
      afterPageId: afterPageId ?? activePageId ?? undefined,
      masterKey: unlockedMasterKey,
    });
    if (!created) return null;

    const refreshed = await repository.getNotebookWithPages(
      activeNotebook.id,
      unlockedMasterKey,
    );
    if (refreshed) {
      set({
        activeNotebook: refreshed.notebook,
        pages: refreshed.pages,
        activePageId: created.id,
        lassoSelection: null,
        activeTextboxId: null,
        selectedTextboxId: null,
        selectedTextboxIds: [],
        selectedImageIds: [],
        croppingImageId: null,
      });
    }
    return created;
  },

  duplicatePage: async (pageId) => {
    const { activeNotebook, unlockedMasterKey } = get();
    if (!activeNotebook) return;
    const created = await repository.duplicatePage(
      activeNotebook.id,
      pageId,
      unlockedMasterKey,
    );
    if (!created) return;
    const refreshed = await repository.getNotebookWithPages(
      activeNotebook.id,
      unlockedMasterKey,
    );
    if (refreshed) {
      set({
        activeNotebook: refreshed.notebook,
        pages: refreshed.pages,
        activePageId: created.id,
        lassoSelection: null,
        activeTextboxId: null,
        selectedTextboxId: null,
        selectedTextboxIds: [],
        selectedImageIds: [],
        croppingImageId: null,
      });
    }
  },

  deletePage: async (pageId) => {
    const { activeNotebook, pages, activePageId } = get();
    if (!activeNotebook || pages.length <= 1) return;

    const nextOrder = await repository.deletePageFromNotebook(activeNotebook.id, pageId);
    if (!nextOrder) return;

    const nextPages = pages.filter((p) => p.id !== pageId);
    const nextActiveId =
      activePageId === pageId ? nextPages[0]?.id ?? null : activePageId;

    set({
      activeNotebook: {
        ...activeNotebook,
        pageOrder: nextOrder,
        lastOpenedPageId: nextActiveId,
      },
      pages: nextPages,
      activePageId: nextActiveId,
      undoStack: get().undoStack.filter((cmd) => cmd.pageId !== pageId),
      redoStack: get().redoStack.filter((cmd) => cmd.pageId !== pageId),
      lassoSelection:
        get().lassoSelection?.pageId === pageId ? null : get().lassoSelection,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      selectedImageIds: [],
      croppingImageId: null,
    });
  },

  reorderPages: async (newOrder) => {
    const { activeNotebook, pages } = get();
    if (!activeNotebook) return;
    await repository.reorderNotebookPages(activeNotebook.id, newOrder);
    const byId = new Map(pages.map((p) => [p.id, p]));
    const orderedPages = newOrder
      .map((id) => byId.get(id))
      .filter((p): p is Page => Boolean(p));

    set({
      activeNotebook: { ...activeNotebook, pageOrder: newOrder },
      pages: orderedPages,
    });
  },

  setActiveTool: (tool) => {
    const keepText = tool === 'text' || tool === 'pan';
    const keepImages = tool === 'pan';
    const keepStrokes = tool === 'lasso' || tool === 'pan';
    set({
      activeTool: tool,
      lassoSelection: keepStrokes ? get().lassoSelection : null,
      isDraggingLasso: false,
      activeTextboxId: null,
      selectedTextboxId: keepText ? get().selectedTextboxId : null,
      selectedTextboxIds: keepText ? get().selectedTextboxIds : [],
      selectedImageIds: keepImages ? get().selectedImageIds : [],
      croppingImageId: null,
    });
  },

  setActiveColor: (color) => {
    const { activeTool, lassoSelection } = get();
    if (activeTool === 'highlighter') {
      set({ highlighterColor: color });
    } else if (activeTool === 'lasso' && lassoSelection && lassoSelection.strokeIds.length > 0) {
      get().commitLassoRecolor(lassoSelection.pageId, lassoSelection.strokeIds, color);
      set({ penColor: color });
    } else {
      set({ penColor: color });
    }
  },

  replaceToolSwatch: (index, color) => {
    const { activeTool, penSwatches, highlighterSwatches } = get();
    if (activeTool === 'highlighter') {
      const next = [...highlighterSwatches];
      next[index] = color;
      set({ highlighterSwatches: next, highlighterColor: color });
    } else {
      const next = [...penSwatches];
      next[index] = color;
      set({ penSwatches: next, penColor: color });
    }
  },

  setActiveSize: (size) => {
    if (get().activeTool === 'highlighter') {
      set({ highlighterSize: size });
    } else {
      set({ penSize: size });
    }
  },

  setEraserSize: (size) => set({ eraserSize: size }),

  setHoldToSnapEnabled: (enabled) => set({ holdToSnapEnabled: enabled }),

  setHandwritingCorrectionEnabled: (enabled) => {
    saveHandwritingCorrectionEnabled(enabled);
    set({ handwritingCorrectionEnabled: enabled });
  },

  setZoom: (zoom) => {
    const clamped = Math.max(0.35, Math.min(3.5, Number(zoom.toFixed(2))));
    set({ zoom: clamped });
  },

  activatePenSlot: (index) => {
    const slot = get().penSlots[index];
    if (!slot) return;
    set({
      activeTool: slot.tool,
      activePenSlotIndex: index,
      ...(slot.tool === 'highlighter'
        ? { highlighterColor: slot.color, highlighterSize: slot.size }
        : { penColor: slot.color, penSize: slot.size }),
      lassoSelection: null,
      isDraggingLasso: false,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      selectedImageIds: [],
      croppingImageId: null,
    });
  },

  saveCurrentToolToSlot: (index, customName) => {
    const state = get();
    if (index < 0 || index >= state.penSlots.length) return;
    const isHighlighter = state.activeTool === 'highlighter';
    const tool: 'pen' | 'highlighter' = isHighlighter ? 'highlighter' : 'pen';
    const color = isHighlighter ? state.highlighterColor : state.penColor;
    const size = isHighlighter ? state.highlighterSize : state.penSize;
    const existing = state.penSlots[index];
    const nextSlots = state.penSlots.map((s, i) =>
      i === index
        ? {
            ...s,
            name:
              customName?.trim() ||
              `${tool === 'highlighter' ? 'Highlighter' : 'Pen'} ${size}px`,
            tool,
            color,
            size,
          }
        : s,
    );
    set({ penSlots: nextSlots, activePenSlotIndex: existing ? index : null });
    persistWorkspacePrefsSnapshot(get());
  },

  resetPenSlots: () => {
    set({ penSlots: DEFAULT_PEN_SLOTS.map((s) => ({ ...s })), activePenSlotIndex: null });
    persistWorkspacePrefsSnapshot(get());
  },

  setDeskBackdrop: (preset, customColor) => {
    set((state) => ({
      deskBackdrop: preset,
      deskCustomColor: customColor ?? state.deskCustomColor,
    }));
    persistWorkspacePrefsSnapshot(get());
  },

  setDarkPaperView: (enabled) => {
    set({ darkPaperView: enabled });
    persistWorkspacePrefsSnapshot(get());
  },

  setHighContrastUi: (enabled) => {
    set({ highContrastUi: enabled });
    persistWorkspacePrefsSnapshot(get());
  },

  setDockPosition: (pos) => {
    set({ dockPosition: pos });
    persistWorkspacePrefsSnapshot(get());
  },

  setHeroHeadline: (headline) => {
    const cleaned = headline.trim().slice(0, 80) || DEFAULT_HERO_HEADLINE;
    set({ heroHeadline: cleaned });
    persistWorkspacePrefsSnapshot(get());
  },

  setDefaultZoomMode: (mode) => {
    set({ defaultZoomMode: mode });
    persistWorkspacePrefsSnapshot(get());
  },

  setDefaultTool: (tool) => {
    set({ defaultTool: tool });
    persistWorkspacePrefsSnapshot(get());
  },

  setDefaultPaperPattern: (pattern) => {
    set({ defaultPaperPattern: pattern });
    persistWorkspacePrefsSnapshot(get());
  },

  setGeminiApiKey: (apiKey) => {
    saveGeminiApiKey(apiKey);
    set({ geminiApiKey: apiKey.trim() });
  },

  clearStoredGeminiApiKey: () => {
    clearGeminiApiKey();
    set({ geminiApiKey: '' });
  },

  setGeminiModelConfig: (preset, customModelId) => {
    set((state) => ({
      geminiModelPreset: preset,
      geminiCustomModelId:
        customModelId !== undefined
          ? customModelId.trim().slice(0, 100)
          : state.geminiCustomModelId,
    }));
    persistWorkspacePrefsSnapshot(get());
  },

  setBlockAiOnVaultLocked: (enabled) => {
    set({ blockAiOnVaultLocked: enabled });
    persistWorkspacePrefsSnapshot(get());
  },

  commitNewStroke: (pageId, stroke) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const prevStrokes = targetPage.strokes;
    const nextStrokes = [...prevStrokes, stroke];

    const cmd: HistoryCommand = {
      type: 'strokes',
      pageId,
      prevStrokes,
      nextStrokes,
    };

    const nextPages = pages.map((p) =>
      p.id === pageId ? { ...p, strokes: nextStrokes, updatedAt: Date.now() } : p,
    );

    set({
      pages: nextPages,
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      nextStrokes,
      targetPage.textboxes ?? [],
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  commitEraseStrokes: (pageId, strokeIdsToDelete) => {
    if (strokeIdsToDelete.length === 0) return;
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const deleteSet = new Set(strokeIdsToDelete);
    const prevStrokes = targetPage.strokes;
    const nextStrokes = prevStrokes.filter((s) => !deleteSet.has(s.id) || s.locked);
    if (nextStrokes.length === prevStrokes.length) return;

    const cmd: HistoryCommand = {
      type: 'strokes',
      pageId,
      prevStrokes,
      nextStrokes,
    };

    const nextPages = pages.map((p) =>
      p.id === pageId ? { ...p, strokes: nextStrokes, updatedAt: Date.now() } : p,
    );

    set({
      pages: nextPages,
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      nextStrokes,
      targetPage.textboxes ?? [],
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  commitHandwritingCorrection: (pageId, rawStrokeIds, tidiedStrokes) => {
    if (rawStrokeIds.length === 0 || tidiedStrokes.length === 0) return;
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const replaceSet = new Set(rawStrokeIds);
    const prevStrokes = targetPage.strokes;
    const firstIdx = prevStrokes.findIndex((s) => replaceSet.has(s.id));
    if (firstIdx === -1) return;

    const nextStrokes: Stroke[] = [];
    let inserted = false;
    for (const s of prevStrokes) {
      if (replaceSet.has(s.id)) {
        if (!inserted) {
          nextStrokes.push(...tidiedStrokes);
          inserted = true;
        }
      } else {
        nextStrokes.push(s);
      }
    }

    const cmd: HistoryCommand = {
      type: 'strokes',
      pageId,
      prevStrokes,
      nextStrokes,
    };

    if (typeof window !== 'undefined') {
      if (tidyToastTimer !== null) window.clearTimeout(tidyToastTimer);
      tidyToastTimer = window.setTimeout(() => {
        set({ handwritingTidyToast: null });
        tidyToastTimer = null;
      }, 1800);
    }

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, strokes: nextStrokes, updatedAt: Date.now() } : p,
      ),
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
      handwritingTidyToast: 'Handwriting tidied',
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      nextStrokes,
      targetPage.textboxes ?? [],
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  applyPaperToPage: async (pageId, paper) => {
    const { activeNotebook, pages, undoStack } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const prevPaper = targetPage.paper;
    const nextPaper = { ...paper };

    const cmd: HistoryCommand = {
      type: 'paper',
      pageId,
      prevPaper,
      nextPaper,
    };

    const thumbnailDataUrl = activeNotebook.isLocked
      ? undefined
      : generatePageThumbnail(
          nextPaper,
          targetPage.strokes,
          240,
          targetPage.textboxes ?? [],
          targetPage.images ?? [],
        );

    const nextPages = pages.map((p) =>
      p.id === pageId
        ? { ...p, paper: nextPaper, thumbnailDataUrl, updatedAt: Date.now() }
        : p,
    );

    set({
      pages: nextPages,
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    await repository.savePagePaper(activeNotebook.id, pageId, nextPaper, thumbnailDataUrl);
  },

  setLassoSelection: (selection) => set({ lassoSelection: selection }),

  setIsDraggingLasso: (dragging) => set({ isDraggingLasso: dragging }),

  commitLassoMove: (pageId, strokeIds, dx, dy) => {
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const idSet = new Set(strokeIds);
    const prevStrokes = targetPage.strokes;
    let movedAny = false;
    const nextStrokes = prevStrokes.map((s) => {
      if (idSet.has(s.id) && !s.locked) {
        movedAny = true;
        return translateStroke(s, dx, dy);
      }
      return s;
    });
    if (!movedAny) return;

    const cmd: HistoryCommand = {
      type: 'strokes',
      pageId,
      prevStrokes,
      nextStrokes,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, strokes: nextStrokes, updatedAt: Date.now() } : p,
      ),
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      nextStrokes,
      targetPage.textboxes ?? [],
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  commitLassoRecolor: (pageId, strokeIds, color) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const idSet = new Set(strokeIds);
    const prevStrokes = targetPage.strokes;
    let changed = false;
    const nextStrokes = prevStrokes.map((s) => {
      if (idSet.has(s.id) && !s.locked && s.color !== color) {
        changed = true;
        return { ...s, color };
      }
      return s;
    });
    if (!changed) return;

    const cmd: HistoryCommand = {
      type: 'strokes',
      pageId,
      prevStrokes,
      nextStrokes,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, strokes: nextStrokes, updatedAt: Date.now() } : p,
      ),
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      nextStrokes,
      targetPage.textboxes ?? [],
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  commitLassoDelete: (pageId, strokeIds) => {
    get().commitEraseStrokes(pageId, strokeIds);
    set({ lassoSelection: null, isDraggingLasso: false });
  },

  commitLassoDuplicate: (pageId, strokeIds) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const idSet = new Set(strokeIds);
    const clones = targetPage.strokes
      .filter((s) => idSet.has(s.id))
      .map((s) => ({ ...cloneStrokeWithNewId(s, 24, 24), groupId: undefined, locked: undefined }));
    if (clones.length === 0) return;

    const prevStrokes = targetPage.strokes;
    const nextStrokes = [...prevStrokes, ...clones];

    const cmd: HistoryCommand = {
      type: 'strokes',
      pageId,
      prevStrokes,
      nextStrokes,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, strokes: nextStrokes, updatedAt: Date.now() } : p,
      ),
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
      lassoSelection: {
        pageId,
        strokeIds: clones.map((c) => c.id),
      },
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      nextStrokes,
      targetPage.textboxes ?? [],
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  spawnTextbox: ({ pageId, x, y, initialText = '', fontSize = 22, color, wrapWidth }) => {
    const { activeNotebook, pages, penColor, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return null;

    const prevTextboxes = targetPage.textboxes ?? [];
    const now = Date.now();
    const clampedX = Math.max(8, Math.min(targetPage.paper.width - 40, x));
    const clampedY = Math.max(8, Math.min(targetPage.paper.height - 30, y));

    const tb: Textbox = {
      id: createId(),
      x: clampedX,
      y: clampedY,
      text: initialText,
      fontFamily: 'sans',
      fontSize,
      bold: false,
      italic: false,
      color: color ?? penColor,
      ...(wrapWidth ? { wrapWidth } : {}),
      createdAt: now,
      updatedAt: now,
    };

    const nextTextboxes = [...prevTextboxes, tb];

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, textboxes: nextTextboxes, updatedAt: now } : p,
      ),
      activeTextboxId: tb.id,
      selectedTextboxId: tb.id,
      selectedTextboxIds: [tb.id],
      selectedImageIds: [],
      croppingImageId: null,
      textboxSessionBaseline: { pageId, prevTextboxes },
      lassoSelection: null,
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      targetPage.strokes,
      nextTextboxes,
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );

    return tb;
  },

  beginEditTextbox: (pageId, textboxId) => {
    const page = get().pages.find((p) => p.id === pageId);
    if (!page) return;
    const prevTextboxes = page.textboxes ?? [];
    const targetTb = prevTextboxes.find((tb) => tb.id === textboxId);
    if (!targetTb || targetTb.locked) return;
    set({
      activeTextboxId: textboxId,
      selectedTextboxId: textboxId,
      selectedTextboxIds: [textboxId],
      selectedImageIds: [],
      croppingImageId: null,
      textboxSessionBaseline: { pageId, prevTextboxes },
      lassoSelection: null,
    });
  },

  selectTextbox: (textboxId) => {
    if (!textboxId) {
      set({
        selectedTextboxId: null,
        selectedTextboxIds: [],
        activeTextboxId: null,
      });
      return;
    }
    const { pages, activePageId } = get();
    const activePage = pages.find((p) => p.id === activePageId);
    const tb = (activePage?.textboxes ?? []).find((t) => t.id === textboxId);
    if (activePage && tb?.groupId) {
      get().setUnifiedSelection(
        activePage.id,
        { strokeIds: [], textboxIds: [textboxId], imageIds: [] },
        { expandGroups: true },
      );
      return;
    }
    set({
      selectedTextboxId: textboxId,
      selectedTextboxIds: [textboxId],
      activeTextboxId: null,
      selectedImageIds: [],
      lassoSelection: null,
      croppingImageId: null,
    });
  },

  updateTextboxLive: (pageId, textboxId, patch) => {
    const { activeNotebook, pages, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const now = Date.now();
    const nextTextboxes = (targetPage.textboxes ?? []).map((tb) =>
      tb.id === textboxId ? { ...tb, ...patch, updatedAt: now } : tb,
    );

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, textboxes: nextTextboxes, updatedAt: now } : p,
      ),
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      targetPage.strokes,
      nextTextboxes,
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  commitTextboxSession: (pageId, textboxId, keepSelected = false) => {
    const {
      activeNotebook,
      pages,
      undoStack,
      textboxSessionBaseline,
      unlockedMasterKey,
    } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const currentTextboxes = targetPage.textboxes ?? [];
    const targetTb = currentTextboxes.find((tb) => tb.id === textboxId);
    const baseline =
      textboxSessionBaseline?.pageId === pageId
        ? textboxSessionBaseline.prevTextboxes
        : currentTextboxes;

    if (!targetTb || targetTb.text.trim() === '') {
      // Remove empty textbox without creating a dummy undo entry
      const cleaned = currentTextboxes.filter((tb) => tb.id !== textboxId);
      set({
        pages: pages.map((p) =>
          p.id === pageId ? { ...p, textboxes: cleaned, updatedAt: Date.now() } : p,
        ),
        activeTextboxId: null,
        selectedTextboxId: null,
        selectedTextboxIds: [],
        textboxSessionBaseline: null,
      });
      persistPageContentChange(
        activeNotebook,
        pageId,
        targetPage.paper,
        targetPage.strokes,
        cleaned,
        targetPage.images ?? [],
        unlockedMasterKey,
        (status) => set({ saveStatus: status }),
      );
      return;
    }

    const changed = JSON.stringify(baseline) !== JSON.stringify(currentTextboxes);
    const nextUndo = changed
      ? [
          ...undoStack.slice(-(MAX_HISTORY - 1)),
          {
            type: 'textboxes' as const,
            pageId,
            prevTextboxes: baseline,
            nextTextboxes: currentTextboxes,
          },
        ]
      : undoStack;

    set({
      activeTextboxId: null,
      selectedTextboxId: keepSelected ? textboxId : null,
      selectedTextboxIds: keepSelected ? [textboxId] : [],
      textboxSessionBaseline: null,
      undoStack: nextUndo,
      redoStack: changed ? [] : get().redoStack,
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      targetPage.strokes,
      currentTextboxes,
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  commitTextboxMutation: (pageId, textboxId, patch) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const prevTextboxes = targetPage.textboxes ?? [];
    const now = Date.now();
    const nextTextboxes = prevTextboxes.map((tb) =>
      tb.id === textboxId ? { ...tb, ...patch, updatedAt: now } : tb,
    );

    const cmd: HistoryCommand = {
      type: 'textboxes',
      pageId,
      prevTextboxes,
      nextTextboxes,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, textboxes: nextTextboxes, updatedAt: now } : p,
      ),
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      targetPage.strokes,
      nextTextboxes,
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  altCloneTextbox: (pageId, textboxId) => {
    const { pages } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage) return null;
    const prevTextboxes = targetPage.textboxes ?? [];
    const src = prevTextboxes.find((tb) => tb.id === textboxId);
    if (!src) return null;

    const now = Date.now();
    const cloned: Textbox = {
      ...src,
      id: createId(),
      createdAt: now,
      updatedAt: now,
    };
    const nextTextboxes = [...prevTextboxes, cloned];

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, textboxes: nextTextboxes, updatedAt: now } : p,
      ),
      selectedTextboxId: cloned.id,
      selectedTextboxIds: [cloned.id],
      activeTextboxId: null,
    });

    return cloned;
  },

  commitAltTextboxDrag: (pageId, prevTextboxes, textboxId, patch) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const now = Date.now();
    const nextTextboxes = (targetPage.textboxes ?? []).map((tb) =>
      tb.id === textboxId ? { ...tb, ...patch, updatedAt: now } : tb,
    );

    const cmd: HistoryCommand = {
      type: 'textboxes',
      pageId,
      prevTextboxes,
      nextTextboxes,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, textboxes: nextTextboxes, updatedAt: now } : p,
      ),
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      targetPage.strokes,
      nextTextboxes,
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  altCloneLassoStrokes: (pageId, strokeIds) => {
    const { pages } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage) return [];
    const idSet = new Set(strokeIds);
    const clones = targetPage.strokes
      .filter((s) => idSet.has(s.id))
      .map((s) => cloneStrokeWithNewId(s, 0, 0));
    if (clones.length === 0) return [];

    const nextStrokes = [...targetPage.strokes, ...clones];
    const clonedIds = clones.map((c) => c.id);

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, strokes: nextStrokes, updatedAt: Date.now() } : p,
      ),
      lassoSelection: { pageId, strokeIds: clonedIds },
    });

    return clonedIds;
  },

  commitAltLassoMove: (pageId, prevStrokes, strokeIds, dx, dy) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const idSet = new Set(strokeIds);
    const nextStrokes = targetPage.strokes.map((s) =>
      idSet.has(s.id) ? translateStroke(s, dx, dy) : s,
    );

    const cmd: HistoryCommand = {
      type: 'strokes',
      pageId,
      prevStrokes,
      nextStrokes,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, strokes: nextStrokes, updatedAt: Date.now() } : p,
      ),
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      nextStrokes,
      targetPage.textboxes ?? [],
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  deleteTextbox: (pageId, textboxId) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const prevTextboxes = targetPage.textboxes ?? [];
    const targetTb = prevTextboxes.find((tb) => tb.id === textboxId);
    if (!targetTb || targetTb.locked) return;
    const nextTextboxes = prevTextboxes.filter((tb) => tb.id !== textboxId);
    if (nextTextboxes.length === prevTextboxes.length) return;

    const cmd: HistoryCommand = {
      type: 'textboxes',
      pageId,
      prevTextboxes,
      nextTextboxes,
    };

    const remainingSelected = get().selectedTextboxIds.filter((id) => id !== textboxId);
    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, textboxes: nextTextboxes, updatedAt: Date.now() } : p,
      ),
      activeTextboxId: get().activeTextboxId === textboxId ? null : get().activeTextboxId,
      selectedTextboxId: remainingSelected[0] ?? null,
      selectedTextboxIds: remainingSelected,
      textboxSessionBaseline: null,
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      targetPage.strokes,
      nextTextboxes,
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  addPageImages: (pageId, newImages) => {
    if (newImages.length === 0) return;
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const prevImages = targetPage.images ?? [];
    const nextImages = [...prevImages, ...newImages];

    const cmd: HistoryCommand = {
      type: 'images',
      pageId,
      prevImages,
      nextImages,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, images: nextImages, updatedAt: Date.now() } : p,
      ),
      activeTool: 'pan',
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      lassoSelection: null,
      croppingImageId: null,
      selectedImageIds: [newImages[newImages.length - 1].id],
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      targetPage.strokes,
      targetPage.textboxes ?? [],
      nextImages,
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  selectImage: (imageId) => {
    if (!imageId) {
      set({
        selectedImageIds: [],
        croppingImageId: null,
        activeTextboxId: null,
      });
      return;
    }
    const { pages, activePageId } = get();
    const activePage = pages.find((p) => p.id === activePageId);
    const img = (activePage?.images ?? []).find((im) => im.id === imageId);
    if (activePage && img?.groupId) {
      get().setUnifiedSelection(
        activePage.id,
        { strokeIds: [], textboxIds: [], imageIds: [imageId] },
        { expandGroups: true },
      );
      return;
    }
    set({
      selectedImageIds: [imageId],
      croppingImageId: null,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      lassoSelection: null,
    });
  },

  setCroppingImageId: (imageId) => {
    if (imageId) {
      const { pages, activePageId } = get();
      const activePage = pages.find((p) => p.id === activePageId);
      const img = (activePage?.images ?? []).find((im) => im.id === imageId);
      if (img?.locked) return;
    }
    set({
      croppingImageId: imageId,
      selectedImageIds: imageId ? [imageId] : get().selectedImageIds,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
    });
  },

  updateImageLive: (pageId, imageId, patch) => {
    const { pages } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const now = Date.now();
    const nextImages = (targetPage.images ?? []).map((img) =>
      img.id === imageId ? { ...img, ...patch, updatedAt: now } : img,
    );

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, images: nextImages, updatedAt: now } : p,
      ),
    });
  },

  commitImageHistorySnapshot: (pageId, prevImages) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const nextImages = targetPage.images ?? [];
    if (JSON.stringify(prevImages) === JSON.stringify(nextImages)) return;

    const cmd: HistoryCommand = {
      type: 'images',
      pageId,
      prevImages,
      nextImages,
    };

    set({
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      targetPage.strokes,
      targetPage.textboxes ?? [],
      nextImages,
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  commitImageMutation: (pageId, imageId, patch) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const prevImages = targetPage.images ?? [];
    const now = Date.now();
    const nextImages = prevImages.map((img) =>
      img.id === imageId ? { ...img, ...patch, updatedAt: now } : img,
    );

    const cmd: HistoryCommand = {
      type: 'images',
      pageId,
      prevImages,
      nextImages,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, images: nextImages, updatedAt: now } : p,
      ),
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      targetPage.strokes,
      targetPage.textboxes ?? [],
      nextImages,
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  altCloneImage: (pageId, imageId) => {
    const { pages } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage) return null;
    const prevImages = targetPage.images ?? [];
    const src = prevImages.find((im) => im.id === imageId);
    if (!src) return null;

    const now = Date.now();
    const maxZ = prevImages.reduce((m, im) => Math.max(m, im.zIndex), 0);
    const cloned: PageImage = {
      ...src,
      crop: { ...src.crop },
      id: createId(),
      zIndex: maxZ + 1,
      createdAt: now,
      updatedAt: now,
    };
    const nextImages = [...prevImages, cloned];

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, images: nextImages, updatedAt: now } : p,
      ),
      selectedImageIds: [cloned.id],
      croppingImageId: null,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
    });

    return cloned;
  },

  commitAltImageDrag: (pageId, prevImages, imageId, patch) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const now = Date.now();
    const nextImages = (targetPage.images ?? []).map((img) =>
      img.id === imageId ? { ...img, ...patch, updatedAt: now } : img,
    );

    const cmd: HistoryCommand = {
      type: 'images',
      pageId,
      prevImages,
      nextImages,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, images: nextImages, updatedAt: now } : p,
      ),
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      targetPage.strokes,
      targetPage.textboxes ?? [],
      nextImages,
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  reorderImageLayer: (pageId, imageId, direction) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const prevImages = targetPage.images ?? [];
    if (prevImages.length <= 1) return;

    const sorted = [...prevImages].sort((a, b) => a.zIndex - b.zIndex);
    const idx = sorted.findIndex((im) => im.id === imageId);
    if (idx === -1) return;

    const targetIdx = direction === 'forward' ? idx + 1 : idx - 1;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;

    const reordered = [...sorted];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(targetIdx, 0, moved);

    const now = Date.now();
    const zById = new Map(reordered.map((im, i) => [im.id, i + 1]));
    const nextImages = prevImages.map((im) => ({
      ...im,
      zIndex: zById.get(im.id) ?? im.zIndex,
      updatedAt: im.id === imageId ? now : im.updatedAt,
    }));

    const cmd: HistoryCommand = {
      type: 'images',
      pageId,
      prevImages,
      nextImages,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, images: nextImages, updatedAt: now } : p,
      ),
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      targetPage.strokes,
      targetPage.textboxes ?? [],
      nextImages,
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  deleteImage: (pageId, imageId) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const prevImages = targetPage.images ?? [];
    const targetImg = prevImages.find((im) => im.id === imageId);
    if (!targetImg || targetImg.locked) return;
    const nextImages = prevImages.filter((im) => im.id !== imageId);
    if (nextImages.length === prevImages.length) return;

    const cmd: HistoryCommand = {
      type: 'images',
      pageId,
      prevImages,
      nextImages,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, images: nextImages, updatedAt: Date.now() } : p,
      ),
      selectedImageIds: get().selectedImageIds.filter((id) => id !== imageId),
      croppingImageId: get().croppingImageId === imageId ? null : get().croppingImageId,
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      targetPage.strokes,
      targetPage.textboxes ?? [],
      nextImages,
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  clearPageAnnotations: (pageId) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const prevStrokes = targetPage.strokes;
    const prevTextboxes = targetPage.textboxes ?? [];
    const prevImages = targetPage.images ?? [];
    const nextStrokes = prevStrokes.filter((s) => s.locked);
    const nextTextboxes = prevTextboxes.filter((tb) => tb.locked);
    const nextImages = prevImages.filter((im) => im.locked);

    if (
      nextStrokes.length === prevStrokes.length &&
      nextTextboxes.length === prevTextboxes.length &&
      nextImages.length === prevImages.length
    ) {
      return;
    }

    const cmd: HistoryCommand = {
      type: 'page-content',
      pageId,
      prevStrokes,
      nextStrokes,
      prevTextboxes,
      nextTextboxes,
      prevImages,
      nextImages,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId
          ? {
              ...p,
              strokes: nextStrokes,
              textboxes: nextTextboxes,
              images: nextImages,
              updatedAt: Date.now(),
            }
          : p,
      ),
      lassoSelection: null,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      selectedImageIds: [],
      croppingImageId: null,
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      nextStrokes,
      nextTextboxes,
      nextImages,
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  nudgeSelection: (pageId, dx, dy) => {
    const {
      activeNotebook,
      pages,
      undoStack,
      lassoSelection,
      selectedTextboxIds,
      selectedImageIds,
      unlockedMasterKey,
    } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const strokeSet =
      lassoSelection?.pageId === pageId ? new Set(lassoSelection.strokeIds) : new Set<string>();
    const tbSet = new Set(selectedTextboxIds);
    const imgSet = new Set(selectedImageIds);
    if (strokeSet.size === 0 && tbSet.size === 0 && imgSet.size === 0) return;

    const prevStrokes = targetPage.strokes;
    const prevTextboxes = targetPage.textboxes ?? [];
    const prevImages = targetPage.images ?? [];
    let movedAny = false;

    const nextStrokes =
      strokeSet.size > 0
        ? prevStrokes.map((s) => {
            if (strokeSet.has(s.id) && !s.locked) {
              movedAny = true;
              return translateStroke(s, dx, dy);
            }
            return s;
          })
        : prevStrokes;

    const now = Date.now();
    const nextTextboxes =
      tbSet.size > 0
        ? prevTextboxes.map((tb) => {
            if (tbSet.has(tb.id) && !tb.locked) {
              movedAny = true;
              return {
                ...tb,
                x: Math.max(4, Math.min(targetPage.paper.width - 20, tb.x + dx)),
                y: Math.max(4, Math.min(targetPage.paper.height - 16, tb.y + dy)),
                updatedAt: now,
              };
            }
            return tb;
          })
        : prevTextboxes;

    const nextImages =
      imgSet.size > 0
        ? prevImages.map((im) => {
            if (imgSet.has(im.id) && !im.locked) {
              movedAny = true;
              return {
                ...im,
                x: Math.max(-im.width + 20, Math.min(targetPage.paper.width - 20, im.x + dx)),
                y: Math.max(-im.height + 20, Math.min(targetPage.paper.height - 20, im.y + dy)),
                updatedAt: now,
              };
            }
            return im;
          })
        : prevImages;

    if (!movedAny) return;

    const cmd: HistoryCommand = {
      type: 'page-content',
      pageId,
      prevStrokes,
      nextStrokes,
      prevTextboxes,
      nextTextboxes,
      prevImages,
      nextImages,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId
          ? {
              ...p,
              strokes: nextStrokes,
              textboxes: nextTextboxes,
              images: nextImages,
              updatedAt: now,
            }
          : p,
      ),
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      nextStrokes,
      nextTextboxes,
      nextImages,
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  duplicateSelection: (pageId) => {
    const {
      activeNotebook,
      pages,
      undoStack,
      lassoSelection,
      selectedTextboxIds,
      selectedImageIds,
      unlockedMasterKey,
    } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const strokeSet =
      lassoSelection?.pageId === pageId ? new Set(lassoSelection.strokeIds) : new Set<string>();
    const tbSet = new Set(selectedTextboxIds);
    const imgSet = new Set(selectedImageIds);
    if (strokeSet.size === 0 && tbSet.size === 0 && imgSet.size === 0) return;

    const prevStrokes = targetPage.strokes;
    const prevTextboxes = targetPage.textboxes ?? [];
    const prevImages = targetPage.images ?? [];
    const now = Date.now();
    const maxZ = prevImages.reduce((m, im) => Math.max(m, im.zIndex), 0);

    const remappedClones = remapGroupIdsForClones(
      prevStrokes
        .filter((s) => strokeSet.has(s.id))
        .map((s) => cloneStrokeWithNewId(s, 16, 16)),
      prevTextboxes
        .filter((tb) => tbSet.has(tb.id))
        .map((tb) => ({
          ...tb,
          id: createId(),
          x: Math.min(targetPage.paper.width - 40, tb.x + 16),
          y: Math.min(targetPage.paper.height - 24, tb.y + 16),
          createdAt: now,
          updatedAt: now,
        })),
      prevImages
        .filter((im) => imgSet.has(im.id))
        .map((im, idx) => ({
          ...im,
          crop: { ...im.crop },
          id: createId(),
          x: Math.min(targetPage.paper.width - 40, im.x + 16),
          y: Math.min(targetPage.paper.height - 40, im.y + 16),
          zIndex: maxZ + idx + 1,
          createdAt: now,
          updatedAt: now,
        })),
      true,
    );
    const clonedStrokes = remappedClones.strokes;
    const clonedTextboxes = remappedClones.textboxes;
    const clonedImages = remappedClones.images;

    const nextStrokes = [...prevStrokes, ...clonedStrokes];
    const nextTextboxes = [...prevTextboxes, ...clonedTextboxes];
    const nextImages = [...prevImages, ...clonedImages];

    const cmd: HistoryCommand = {
      type: 'page-content',
      pageId,
      prevStrokes,
      nextStrokes,
      prevTextboxes,
      nextTextboxes,
      prevImages,
      nextImages,
    };

    const newTbIds = clonedTextboxes.map((t) => t.id);
    const newImgIds = clonedImages.map((im) => im.id);
    set({
      pages: pages.map((p) =>
        p.id === pageId
          ? {
              ...p,
              strokes: nextStrokes,
              textboxes: nextTextboxes,
              images: nextImages,
              updatedAt: now,
            }
          : p,
      ),
      lassoSelection:
        clonedStrokes.length > 0
          ? { pageId, strokeIds: clonedStrokes.map((s) => s.id) }
          : null,
      selectedTextboxId: newTbIds[0] ?? null,
      selectedTextboxIds: newTbIds,
      selectedImageIds: newImgIds,
      croppingImageId: null,
      activeTextboxId: null,
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      nextStrokes,
      nextTextboxes,
      nextImages,
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  copySelection: (pageId) => {
    const { pages, lassoSelection, selectedTextboxIds, selectedImageIds } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const strokeSet =
      lassoSelection?.pageId === pageId ? new Set(lassoSelection.strokeIds) : new Set<string>();
    const tbSet = new Set(selectedTextboxIds);
    const imgSet = new Set(selectedImageIds);
    const strokes = targetPage.strokes
      .filter((s) => strokeSet.has(s.id))
      .map((s) => cloneStrokeWithNewId(s));
    const textboxes = (targetPage.textboxes ?? [])
      .filter((tb) => tbSet.has(tb.id))
      .map((tb) => ({ ...tb }));
    const images = (targetPage.images ?? [])
      .filter((im) => imgSet.has(im.id))
      .map((im) => ({ ...im, crop: { ...im.crop } }));

    if (strokes.length === 0 && textboxes.length === 0 && images.length === 0) return;

    set({
      clipboard: { strokes, textboxes, images },
      pasteOffsetStep: 0,
    });
  },

  cutSelection: (pageId) => {
    get().copySelection(pageId);
    get().deleteActiveSelection(pageId);
  },

  pasteSelection: (targetPageId) => {
    const {
      activeNotebook,
      pages,
      clipboard,
      pasteOffsetStep,
      undoStack,
      unlockedMasterKey,
    } = get();
    const targetPage = pages.find((p) => p.id === targetPageId);
    if (!targetPage || !activeNotebook || !clipboard) return;

    const nextStep = pasteOffsetStep + 1;
    const offset = nextStep * 16;
    const now = Date.now();

    const prevStrokes = targetPage.strokes;
    const prevTextboxes = targetPage.textboxes ?? [];
    const prevImages = targetPage.images ?? [];
    const maxZ = prevImages.reduce((m, im) => Math.max(m, im.zIndex), 0);

    const remappedPasted = remapGroupIdsForClones(
      clipboard.strokes.map((s) => cloneStrokeWithNewId(s, offset, offset)),
      clipboard.textboxes.map((tb) => ({
        ...tb,
        id: createId(),
        x: Math.max(8, Math.min(targetPage.paper.width - 40, tb.x + offset)),
        y: Math.max(8, Math.min(targetPage.paper.height - 24, tb.y + offset)),
        createdAt: now,
        updatedAt: now,
      })),
      clipboard.images.map((im, idx) => ({
        ...im,
        crop: { ...im.crop },
        id: createId(),
        x: Math.max(8, Math.min(targetPage.paper.width - 40, im.x + offset)),
        y: Math.max(8, Math.min(targetPage.paper.height - 40, im.y + offset)),
        zIndex: maxZ + idx + 1,
        createdAt: now,
        updatedAt: now,
      })),
      true,
    );
    const pastedStrokes = remappedPasted.strokes;
    const pastedTextboxes = remappedPasted.textboxes;
    const pastedImages = remappedPasted.images;

    const nextStrokes = [...prevStrokes, ...pastedStrokes];
    const nextTextboxes = [...prevTextboxes, ...pastedTextboxes];
    const nextImages = [...prevImages, ...pastedImages];

    const cmd: HistoryCommand = {
      type: 'page-content',
      pageId: targetPageId,
      prevStrokes,
      nextStrokes,
      prevTextboxes,
      nextTextboxes,
      prevImages,
      nextImages,
    };

    const pastedTbIds = pastedTextboxes.map((t) => t.id);
    const pastedImgIds = pastedImages.map((im) => im.id);
    set({
      pages: pages.map((p) =>
        p.id === targetPageId
          ? {
              ...p,
              strokes: nextStrokes,
              textboxes: nextTextboxes,
              images: nextImages,
              updatedAt: now,
            }
          : p,
      ),
      pasteOffsetStep: nextStep,
      lassoSelection:
        pastedStrokes.length > 0
          ? { pageId: targetPageId, strokeIds: pastedStrokes.map((s) => s.id) }
          : null,
      selectedTextboxId: pastedTbIds[0] ?? null,
      selectedTextboxIds: pastedTbIds,
      selectedImageIds: pastedImgIds,
      croppingImageId: null,
      activeTextboxId: null,
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      targetPageId,
      targetPage.paper,
      nextStrokes,
      nextTextboxes,
      nextImages,
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  selectAllOnPage: (pageId) => {
    const targetPage = get().pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const strokeIds = targetPage.strokes.map((s) => s.id);
    const tbIds = (targetPage.textboxes ?? []).map((tb) => tb.id);
    const imgIds = (targetPage.images ?? []).map((im) => im.id);
    set({
      lassoSelection: strokeIds.length > 0 ? { pageId, strokeIds } : null,
      selectedTextboxIds: tbIds,
      selectedTextboxId: tbIds[0] ?? null,
      selectedImageIds: imgIds,
      croppingImageId: null,
      activeTextboxId: null,
    });
  },

  cycleTextboxSelection: (pageId, reverse = false) => {
    const targetPage = get().pages.find((p) => p.id === pageId);
    const list = targetPage?.textboxes ?? [];
    if (list.length === 0) return;

    const currentId = get().selectedTextboxId;
    const idx = currentId ? list.findIndex((t) => t.id === currentId) : -1;
    let nextIdx: number;
    if (idx === -1) {
      nextIdx = reverse ? list.length - 1 : 0;
    } else {
      nextIdx = (idx + (reverse ? -1 : 1) + list.length) % list.length;
    }
    const nextId = list[nextIdx].id;
    get().setUnifiedSelection(
      pageId,
      { strokeIds: [], textboxIds: [nextId], imageIds: [] },
      { expandGroups: true },
    );
  },

  deleteActiveSelection: (pageId) => {
    const {
      activeNotebook,
      pages,
      undoStack,
      lassoSelection,
      selectedTextboxIds,
      selectedImageIds,
      unlockedMasterKey,
    } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const strokeSet =
      lassoSelection?.pageId === pageId ? new Set(lassoSelection.strokeIds) : new Set<string>();
    const tbSet = new Set(selectedTextboxIds);
    const imgSet = new Set(selectedImageIds);
    if (strokeSet.size === 0 && tbSet.size === 0 && imgSet.size === 0) return;

    const prevStrokes = targetPage.strokes;
    const prevTextboxes = targetPage.textboxes ?? [];
    const prevImages = targetPage.images ?? [];
    const nextStrokes = prevStrokes.filter((s) => !strokeSet.has(s.id) || s.locked);
    const nextTextboxes = prevTextboxes.filter((tb) => !tbSet.has(tb.id) || tb.locked);
    const nextImages = prevImages.filter((im) => !imgSet.has(im.id) || im.locked);

    if (
      nextStrokes.length === prevStrokes.length &&
      nextTextboxes.length === prevTextboxes.length &&
      nextImages.length === prevImages.length
    ) {
      return;
    }

    const remainingLockedStrokeIds = nextStrokes
      .filter((s) => strokeSet.has(s.id))
      .map((s) => s.id);
    const remainingLockedTbIds = nextTextboxes
      .filter((tb) => tbSet.has(tb.id))
      .map((tb) => tb.id);
    const remainingLockedImgIds = nextImages
      .filter((im) => imgSet.has(im.id))
      .map((im) => im.id);

    const cmd: HistoryCommand = {
      type: 'page-content',
      pageId,
      prevStrokes,
      nextStrokes,
      prevTextboxes,
      nextTextboxes,
      prevImages,
      nextImages,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId
          ? {
              ...p,
              strokes: nextStrokes,
              textboxes: nextTextboxes,
              images: nextImages,
              updatedAt: Date.now(),
            }
          : p,
      ),
      lassoSelection:
        remainingLockedStrokeIds.length > 0
          ? { pageId, strokeIds: remainingLockedStrokeIds }
          : null,
      isDraggingLasso: false,
      activeTextboxId: null,
      selectedTextboxId: remainingLockedTbIds[0] ?? null,
      selectedTextboxIds: remainingLockedTbIds,
      selectedImageIds: remainingLockedImgIds,
      croppingImageId: null,
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      nextStrokes,
      nextTextboxes,
      nextImages,
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  copyTextboxStyle: (pageId, textboxId) => {
    const page = get().pages.find((p) => p.id === pageId);
    const tb = (page?.textboxes ?? []).find((t) => t.id === textboxId);
    if (!tb) return;
    set({
      copiedTextboxStyle: {
        fontFamily: tb.fontFamily,
        fontSize: tb.fontSize,
        bold: tb.bold,
        italic: tb.italic,
        color: tb.color,
      },
    });
  },

  pasteTextboxStyle: (pageId, textboxIds) => {
    const { activeNotebook, pages, undoStack, copiedTextboxStyle, unlockedMasterKey } = get();
    if (!copiedTextboxStyle || textboxIds.length === 0 || !activeNotebook) return;
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const idSet = new Set(textboxIds);
    const prevTextboxes = targetPage.textboxes ?? [];
    const now = Date.now();
    const nextTextboxes = prevTextboxes.map((tb) =>
      idSet.has(tb.id) && !tb.locked ? { ...tb, ...copiedTextboxStyle, updatedAt: now } : tb,
    );

    const cmd: HistoryCommand = {
      type: 'textboxes',
      pageId,
      prevTextboxes,
      nextTextboxes,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, textboxes: nextTextboxes, updatedAt: now } : p,
      ),
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      targetPage.strokes,
      nextTextboxes,
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  setUnifiedSelection: (pageId, sel, opts) => {
    const targetPage = get().pages.find((p) => p.id === pageId);
    if (!targetPage) return;
    const finalSel =
      opts?.expandGroups !== false ? expandSelectionWithGroups(targetPage, sel) : sel;
    set({
      lassoSelection:
        finalSel.strokeIds.length > 0
          ? { pageId, strokeIds: finalSel.strokeIds }
          : null,
      selectedTextboxIds: finalSel.textboxIds,
      selectedTextboxId: finalSel.textboxIds[0] ?? null,
      selectedImageIds: finalSel.imageIds,
      activeTextboxId: null,
      croppingImageId: null,
      isDraggingLasso: false,
    });
  },

  toggleElementInSelection: (pageId, ref) => {
    const state = get();
    const targetPage = state.pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const cur = getPageSelectionFromState(state, pageId);
    const strokeSet = new Set(cur.strokeIds);
    const tbSet = new Set(cur.textboxIds);
    const imgSet = new Set(cur.imageIds);

    let groupId: string | undefined;
    let isCurrentlySelected = false;
    if (ref.kind === 'stroke') {
      groupId = targetPage.strokes.find((s) => s.id === ref.id)?.groupId;
      isCurrentlySelected = strokeSet.has(ref.id);
    } else if (ref.kind === 'textbox') {
      groupId = (targetPage.textboxes ?? []).find((t) => t.id === ref.id)?.groupId;
      isCurrentlySelected = tbSet.has(ref.id);
    } else {
      groupId = (targetPage.images ?? []).find((im) => im.id === ref.id)?.groupId;
      isCurrentlySelected = imgSet.has(ref.id);
    }

    const applyToggle = (setObj: Set<string>, id: string, add: boolean) => {
      if (add) setObj.add(id);
      else setObj.delete(id);
    };

    const add = !isCurrentlySelected;
    if (groupId) {
      for (const s of targetPage.strokes) {
        if (s.groupId === groupId) applyToggle(strokeSet, s.id, add);
      }
      for (const tb of targetPage.textboxes ?? []) {
        if (tb.groupId === groupId) applyToggle(tbSet, tb.id, add);
      }
      for (const im of targetPage.images ?? []) {
        if (im.groupId === groupId) applyToggle(imgSet, im.id, add);
      }
    } else if (ref.kind === 'stroke') {
      applyToggle(strokeSet, ref.id, add);
    } else if (ref.kind === 'textbox') {
      applyToggle(tbSet, ref.id, add);
    } else {
      applyToggle(imgSet, ref.id, add);
    }

    get().setUnifiedSelection(
      pageId,
      {
        strokeIds: Array.from(strokeSet),
        textboxIds: Array.from(tbSet),
        imageIds: Array.from(imgSet),
      },
      { expandGroups: false },
    );
  },

  clearSelection: () => {
    set({
      lassoSelection: null,
      isDraggingLasso: false,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      selectedImageIds: [],
      croppingImageId: null,
    });
  },

  groupSelection: (pageId) => {
    const state = get();
    const targetPage = state.pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const sel = getPageSelectionFromState(state, pageId);
    const summary = getSelectionSummary(targetPage, sel);
    if (summary.totalCount < 2 || !summary.canGroup) return;

    const strokeSet = new Set(sel.strokeIds);
    const tbSet = new Set(sel.textboxIds);
    const imgSet = new Set(sel.imageIds);
    const gid = createId();
    const now = Date.now();

    const prevStrokes = targetPage.strokes;
    const prevTextboxes = targetPage.textboxes ?? [];
    const prevImages = targetPage.images ?? [];

    applyPageContentMutation(
      get,
      set,
      pageId,
      { strokes: prevStrokes, textboxes: prevTextboxes, images: prevImages },
      {
        strokes: prevStrokes.map((s) =>
          strokeSet.has(s.id) ? { ...s, groupId: gid } : s,
        ),
        textboxes: prevTextboxes.map((tb) =>
          tbSet.has(tb.id) ? { ...tb, groupId: gid, updatedAt: now } : tb,
        ),
        images: prevImages.map((im) =>
          imgSet.has(im.id) ? { ...im, groupId: gid, updatedAt: now } : im,
        ),
      },
    );
  },

  ungroupSelection: (pageId) => {
    const state = get();
    const targetPage = state.pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const sel = getPageSelectionFromState(state, pageId);
    const summary = getSelectionSummary(targetPage, sel);
    if (!summary.canUngroup) return;

    const gidSet = new Set(summary.groupIds);
    const now = Date.now();
    const prevStrokes = targetPage.strokes;
    const prevTextboxes = targetPage.textboxes ?? [];
    const prevImages = targetPage.images ?? [];

    applyPageContentMutation(
      get,
      set,
      pageId,
      { strokes: prevStrokes, textboxes: prevTextboxes, images: prevImages },
      {
        strokes: prevStrokes.map((s) =>
          s.groupId && gidSet.has(s.groupId) ? { ...s, groupId: undefined } : s,
        ),
        textboxes: prevTextboxes.map((tb) =>
          tb.groupId && gidSet.has(tb.groupId)
            ? { ...tb, groupId: undefined, updatedAt: now }
            : tb,
        ),
        images: prevImages.map((im) =>
          im.groupId && gidSet.has(im.groupId)
            ? { ...im, groupId: undefined, updatedAt: now }
            : im,
        ),
      },
    );
  },

  toggleLockSelection: (pageId, forceLocked) => {
    const state = get();
    const targetPage = state.pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const sel = getPageSelectionFromState(state, pageId);
    const summary = getSelectionSummary(targetPage, sel);
    if (summary.totalCount === 0) return;

    const nextLocked = forceLocked !== undefined ? forceLocked : !summary.allLocked;
    const lockVal = nextLocked ? true : undefined;
    const strokeSet = new Set(sel.strokeIds);
    const tbSet = new Set(sel.textboxIds);
    const imgSet = new Set(sel.imageIds);
    const now = Date.now();

    const prevStrokes = targetPage.strokes;
    const prevTextboxes = targetPage.textboxes ?? [];
    const prevImages = targetPage.images ?? [];

    applyPageContentMutation(
      get,
      set,
      pageId,
      { strokes: prevStrokes, textboxes: prevTextboxes, images: prevImages },
      {
        strokes: prevStrokes.map((s) =>
          strokeSet.has(s.id) ? { ...s, locked: lockVal } : s,
        ),
        textboxes: prevTextboxes.map((tb) =>
          tbSet.has(tb.id) ? { ...tb, locked: lockVal, updatedAt: now } : tb,
        ),
        images: prevImages.map((im) =>
          imgSet.has(im.id) ? { ...im, locked: lockVal, updatedAt: now } : im,
        ),
      },
      nextLocked ? { activeTextboxId: null, croppingImageId: null } : {},
    );
  },

  alignSelection: (pageId, alignment) => {
    const state = get();
    const targetPage = state.pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const sel = getPageSelectionFromState(state, pageId);
    const prevStrokes = targetPage.strokes;
    const prevTextboxes = targetPage.textboxes ?? [];
    const prevImages = targetPage.images ?? [];

    const aligned = computeAlignedElements(targetPage, sel, alignment);
    if (!aligned.changed) return;

    applyPageContentMutation(
      get,
      set,
      pageId,
      { strokes: prevStrokes, textboxes: prevTextboxes, images: prevImages },
      {
        strokes: aligned.strokes,
        textboxes: aligned.textboxes,
        images: aligned.images,
      },
    );
  },

  commitMultiElementMove: (pageId, sel, dx, dy) => {
    if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return;
    const targetPage = get().pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const strokeSet = new Set(sel.strokeIds);
    const tbSet = new Set(sel.textboxIds);
    const imgSet = new Set(sel.imageIds);
    const prevStrokes = targetPage.strokes;
    const prevTextboxes = targetPage.textboxes ?? [];
    const prevImages = targetPage.images ?? [];
    const now = Date.now();
    let movedAny = false;

    const nextStrokes = prevStrokes.map((s) => {
      if (strokeSet.has(s.id) && !s.locked) {
        movedAny = true;
        return translateStroke(s, dx, dy);
      }
      return s;
    });
    const nextTextboxes = prevTextboxes.map((tb) => {
      if (tbSet.has(tb.id) && !tb.locked) {
        movedAny = true;
        return {
          ...tb,
          x: Math.max(4, Math.min(targetPage.paper.width - 20, tb.x + dx)),
          y: Math.max(4, Math.min(targetPage.paper.height - 16, tb.y + dy)),
          updatedAt: now,
        };
      }
      return tb;
    });
    const nextImages = prevImages.map((im) => {
      if (imgSet.has(im.id) && !im.locked) {
        movedAny = true;
        return {
          ...im,
          x: Math.max(-im.width + 20, Math.min(targetPage.paper.width - 20, im.x + dx)),
          y: Math.max(-im.height + 20, Math.min(targetPage.paper.height - 20, im.y + dy)),
          updatedAt: now,
        };
      }
      return im;
    });

    if (!movedAny) return;
    applyPageContentMutation(
      get,
      set,
      pageId,
      { strokes: prevStrokes, textboxes: prevTextboxes, images: prevImages },
      { strokes: nextStrokes, textboxes: nextTextboxes, images: nextImages },
    );
  },

  altCloneMultiSelection: (pageId, sel) => {
    const targetPage = get().pages.find((p) => p.id === pageId);
    if (!targetPage) return null;

    const strokeSet = new Set(sel.strokeIds);
    const tbSet = new Set(sel.textboxIds);
    const imgSet = new Set(sel.imageIds);
    const prevTextboxes = targetPage.textboxes ?? [];
    const prevImages = targetPage.images ?? [];
    const maxZ = prevImages.reduce((m, im) => Math.max(m, im.zIndex), 0);
    const now = Date.now();

    const remapped = remapGroupIdsForClones(
      targetPage.strokes
        .filter((s) => strokeSet.has(s.id))
        .map((s) => cloneStrokeWithNewId(s, 0, 0)),
      prevTextboxes
        .filter((tb) => tbSet.has(tb.id))
        .map((tb) => ({ ...tb, id: createId(), createdAt: now, updatedAt: now })),
      prevImages
        .filter((im) => imgSet.has(im.id))
        .map((im, idx) => ({
          ...im,
          crop: { ...im.crop },
          id: createId(),
          zIndex: maxZ + idx + 1,
          createdAt: now,
          updatedAt: now,
        })),
      true,
    );

    if (
      remapped.strokes.length === 0 &&
      remapped.textboxes.length === 0 &&
      remapped.images.length === 0
    ) {
      return null;
    }

    const clonedSel: PageElementSelection = {
      strokeIds: remapped.strokes.map((s) => s.id),
      textboxIds: remapped.textboxes.map((t) => t.id),
      imageIds: remapped.images.map((im) => im.id),
    };

    set({
      pages: get().pages.map((p) =>
        p.id === pageId
          ? {
              ...p,
              strokes: [...p.strokes, ...remapped.strokes],
              textboxes: [...(p.textboxes ?? []), ...remapped.textboxes],
              images: [...(p.images ?? []), ...remapped.images],
              updatedAt: now,
            }
          : p,
      ),
      lassoSelection:
        clonedSel.strokeIds.length > 0
          ? { pageId, strokeIds: clonedSel.strokeIds }
          : null,
      selectedTextboxIds: clonedSel.textboxIds,
      selectedTextboxId: clonedSel.textboxIds[0] ?? null,
      selectedImageIds: clonedSel.imageIds,
      activeTextboxId: null,
      croppingImageId: null,
    });

    return clonedSel;
  },

  commitAltMultiMove: (pageId, prev, sel, dx, dy) => {
    const targetPage = get().pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const strokeSet = new Set(sel.strokeIds);
    const tbSet = new Set(sel.textboxIds);
    const imgSet = new Set(sel.imageIds);
    const now = Date.now();

    const nextStrokes = targetPage.strokes.map((s) =>
      strokeSet.has(s.id) ? translateStroke(s, dx, dy) : s,
    );
    const nextTextboxes = (targetPage.textboxes ?? []).map((tb) =>
      tbSet.has(tb.id)
        ? {
            ...tb,
            x: Math.max(4, Math.min(targetPage.paper.width - 20, tb.x + dx)),
            y: Math.max(4, Math.min(targetPage.paper.height - 16, tb.y + dy)),
            updatedAt: now,
          }
        : tb,
    );
    const nextImages = (targetPage.images ?? []).map((im) =>
      imgSet.has(im.id)
        ? {
            ...im,
            x: Math.max(-im.width + 20, Math.min(targetPage.paper.width - 20, im.x + dx)),
            y: Math.max(-im.height + 20, Math.min(targetPage.paper.height - 20, im.y + dy)),
            updatedAt: now,
          }
        : im,
    );

    applyPageContentMutation(
      get,
      set,
      pageId,
      prev,
      { strokes: nextStrokes, textboxes: nextTextboxes, images: nextImages },
    );
  },

  commitStrokeScale: (pageId, strokeIds, originBounds, targetBounds) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook || strokeIds.length === 0) return;

    const idSet = new Set(strokeIds);
    const prevStrokes = targetPage.strokes;
    let scaledAny = false;
    const nextStrokes = prevStrokes.map((s) => {
      if (idSet.has(s.id) && !s.locked) {
        scaledAny = true;
        return scaleStroke(s, originBounds, targetBounds);
      }
      return s;
    });
    if (!scaledAny) return;

    const cmd: HistoryCommand = {
      type: 'strokes',
      pageId,
      prevStrokes,
      nextStrokes,
    };

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, strokes: nextStrokes, updatedAt: Date.now() } : p,
      ),
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
    });

    persistPageContentChange(
      activeNotebook,
      pageId,
      targetPage.paper,
      nextStrokes,
      targetPage.textboxes ?? [],
      targetPage.images ?? [],
      unlockedMasterKey,
      (status) => set({ saveStatus: status }),
    );
  },

  undo: () => {
    const { undoStack, redoStack, pages, activeNotebook, unlockedMasterKey } = get();
    if (undoStack.length === 0 || !activeNotebook) return;

    const cmd = undoStack[undoStack.length - 1];
    const targetPage = pages.find((p) => p.id === cmd.pageId);
    if (!targetPage) return;

    const nextPages = pages.map((p) => {
      if (p.id !== cmd.pageId) return p;
      if (cmd.type === 'strokes') {
        return { ...p, strokes: cmd.prevStrokes, updatedAt: Date.now() };
      }
      if (cmd.type === 'textboxes') {
        return { ...p, textboxes: cmd.prevTextboxes, updatedAt: Date.now() };
      }
      if (cmd.type === 'images') {
        return { ...p, images: cmd.prevImages, updatedAt: Date.now() };
      }
      if (cmd.type === 'page-content') {
        return {
          ...p,
          strokes: cmd.prevStrokes,
          textboxes: cmd.prevTextboxes,
          images: cmd.prevImages,
          updatedAt: Date.now(),
        };
      }
      return { ...p, paper: cmd.prevPaper, updatedAt: Date.now() };
    });

    set({
      pages: nextPages,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, cmd],
      lassoSelection: null,
      isDraggingLasso: false,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      selectedImageIds: [],
      croppingImageId: null,
      textboxSessionBaseline: null,
      activePageId: cmd.pageId,
    });

    const updatedPage = nextPages.find((p) => p.id === cmd.pageId)!;
    if (
      cmd.type === 'strokes' ||
      cmd.type === 'textboxes' ||
      cmd.type === 'images' ||
      cmd.type === 'page-content'
    ) {
      persistPageContentChange(
        activeNotebook,
        cmd.pageId,
        updatedPage.paper,
        updatedPage.strokes,
        updatedPage.textboxes ?? [],
        updatedPage.images ?? [],
        unlockedMasterKey,
        (status) => set({ saveStatus: status }),
      );
    } else {
      void repository.savePagePaper(activeNotebook.id, cmd.pageId, updatedPage.paper);
      if (!activeNotebook.isLocked) {
        schedulePageThumbnailUpdate(
          cmd.pageId,
          updatedPage.paper,
          updatedPage.strokes,
          updatedPage.textboxes ?? [],
          updatedPage.images ?? [],
        );
      }
    }
  },

  redo: () => {
    const { undoStack, redoStack, pages, activeNotebook, unlockedMasterKey } = get();
    if (redoStack.length === 0 || !activeNotebook) return;

    const cmd = redoStack[redoStack.length - 1];
    const targetPage = pages.find((p) => p.id === cmd.pageId);
    if (!targetPage) return;

    const nextPages = pages.map((p) => {
      if (p.id !== cmd.pageId) return p;
      if (cmd.type === 'strokes') {
        return { ...p, strokes: cmd.nextStrokes, updatedAt: Date.now() };
      }
      if (cmd.type === 'textboxes') {
        return { ...p, textboxes: cmd.nextTextboxes, updatedAt: Date.now() };
      }
      if (cmd.type === 'images') {
        return { ...p, images: cmd.nextImages, updatedAt: Date.now() };
      }
      if (cmd.type === 'page-content') {
        return {
          ...p,
          strokes: cmd.nextStrokes,
          textboxes: cmd.nextTextboxes,
          images: cmd.nextImages,
          updatedAt: Date.now(),
        };
      }
      return { ...p, paper: cmd.nextPaper, updatedAt: Date.now() };
    });

    set({
      pages: nextPages,
      undoStack: [...undoStack, cmd],
      redoStack: redoStack.slice(0, -1),
      lassoSelection: null,
      isDraggingLasso: false,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      selectedImageIds: [],
      croppingImageId: null,
      textboxSessionBaseline: null,
      activePageId: cmd.pageId,
    });

    const updatedPage = nextPages.find((p) => p.id === cmd.pageId)!;
    if (
      cmd.type === 'strokes' ||
      cmd.type === 'textboxes' ||
      cmd.type === 'images' ||
      cmd.type === 'page-content'
    ) {
      persistPageContentChange(
        activeNotebook,
        cmd.pageId,
        updatedPage.paper,
        updatedPage.strokes,
        updatedPage.textboxes ?? [],
        updatedPage.images ?? [],
        unlockedMasterKey,
        (status) => set({ saveStatus: status }),
      );
    } else {
      void repository.savePagePaper(activeNotebook.id, cmd.pageId, updatedPage.paper);
      if (!activeNotebook.isLocked) {
        schedulePageThumbnailUpdate(
          cmd.pageId,
          updatedPage.paper,
          updatedPage.strokes,
          updatedPage.textboxes ?? [],
          updatedPage.images ?? [],
        );
      }
    }
  },

  savePresetTemplate: async (name, paper) => {
    const thumbnailDataUrl = generatePageThumbnail(paper, []);
    const created = await repository.saveCustomTemplate({
      name,
      category: 'paper-preset',
      paper,
      strokes: [],
      textboxes: [],
      images: [],
      thumbnailDataUrl,
    });
    await get().refreshTemplates();
    return created;
  },

  saveCurrentPageAsTemplate: async (pageId, name) => {
    const page = get().pages.find((p) => p.id === pageId);
    if (!page) return null;
    const textboxes = page.textboxes ?? [];
    const images = page.images ?? [];
    const thumbnailDataUrl = generatePageThumbnail(
      page.paper,
      page.strokes,
      240,
      textboxes,
      images,
    );
    const created = await repository.saveCustomTemplate({
      name,
      category: 'page-template',
      paper: page.paper,
      strokes: page.strokes,
      textboxes,
      images,
      thumbnailDataUrl,
    });
    await get().refreshTemplates();
    return created;
  },

  deleteCustomTemplate: async (id) => {
    await repository.deleteCustomTemplate(id);
    await get().refreshTemplates();
  },

  cancelPdfImport: () => {
    activePdfImportAbort?.abort();
    activePdfImportAbort = null;
    set({ pdfImportProgress: null });
  },

  importPdfAsNotebook: async (file, openImmediately = true) => {
    activePdfImportAbort?.abort();
    const controller = new AbortController();
    activePdfImportAbort = controller;

    set({
      pdfImportProgress: {
        fileName: file.name,
        current: 0,
        total: 1,
        phase: 'reading',
      },
    });

    try {
      const extracted = await extractPdfForImport(
        file,
        file.name,
        (progress) => {
          if (!controller.signal.aborted) {
            set({ pdfImportProgress: progress });
          }
        },
        controller.signal,
      );
      if (controller.signal.aborted) return null;

      set({
        pdfImportProgress: {
          fileName: file.name,
          current: extracted.pageCount,
          total: extracted.pageCount,
          phase: 'saving',
        },
      });

      const baseCover = COVER_PRESETS[0]?.cover ?? {
        styleId: 'classic-navy',
        primaryColor: '#072D59',
        accentColor: '#DBF2FC',
        pattern: 'solid' as const,
      };
      const cover: CoverConfig = extracted.coverDataUrl
        ? {
            styleId: 'custom-image',
            primaryColor: '#072D59',
            accentColor: '#DBF2FC',
            pattern: 'solid',
            customImageDataUrl: extracted.coverDataUrl,
          }
        : { ...baseCover };

      const title = file.name.replace(/\.pdf$/i, '').trim() || 'Imported PDF';
      const { notebook } = await repository.createPdfNotebook({
        title,
        folderId: get().currentFolderId,
        cover,
        fileName: file.name,
        pdfBytes: extracted.pdfBytes,
        pageSpecs: extracted.pageSpecs,
      });

      await get().refreshShelf();
      if (openImmediately) {
        await get().openNotebook(notebook.id);
      }
      return notebook;
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        return null;
      }
      throw err;
    } finally {
      if (activePdfImportAbort === controller) {
        activePdfImportAbort = null;
        set({ pdfImportProgress: null });
      }
    }
  },

  importPdfPagesIntoActiveNotebook: async (file, afterPageId) => {
    const { activeNotebook, activePageId, unlockedMasterKey } = get();
    if (!activeNotebook) return [];

    activePdfImportAbort?.abort();
    const controller = new AbortController();
    activePdfImportAbort = controller;

    set({
      pdfImportProgress: {
        fileName: file.name,
        current: 0,
        total: 1,
        phase: 'reading',
      },
    });

    try {
      const extracted = await extractPdfForImport(
        file,
        file.name,
        (progress) => {
          if (!controller.signal.aborted) {
            set({ pdfImportProgress: progress });
          }
        },
        controller.signal,
      );
      if (controller.signal.aborted) return [];

      set({
        pdfImportProgress: {
          fileName: file.name,
          current: extracted.pageCount,
          total: extracted.pageCount,
          phase: 'saving',
        },
      });

      const appended = await repository.appendPdfPagesToNotebook({
        notebookId: activeNotebook.id,
        fileName: file.name,
        pdfBytes: extracted.pdfBytes,
        pageSpecs: extracted.pageSpecs,
        afterPageId: afterPageId ?? activePageId ?? undefined,
        masterKey: unlockedMasterKey,
      });
      if (!appended) return [];

      const refreshed = await repository.getNotebookWithPages(
        activeNotebook.id,
        unlockedMasterKey,
      );
      if (refreshed) {
        set({
          activeNotebook: refreshed.notebook,
          pages: refreshed.pages,
          activePageId: appended.pages[0]?.id ?? get().activePageId,
          lassoSelection: null,
          activeTextboxId: null,
          selectedTextboxId: null,
          selectedTextboxIds: [],
          selectedImageIds: [],
          croppingImageId: null,
        });
      }

      return appended.pages;
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        return [];
      }
      throw err;
    } finally {
      if (activePdfImportAbort === controller) {
        activePdfImportAbort = null;
        set({ pdfImportProgress: null });
      }
    }
  },

  importFolioNotebook: async (rawJson, openImmediately = true) => {
    const parsed = parseFolioNotebookExport(rawJson);
    const { notebook } = await repository.importFolioNotebook(parsed, get().currentFolderId);
    await get().refreshShelf();
    if (openImmediately) {
      await get().openNotebook(notebook.id);
    }
    return notebook;
  },

  exportWorkspaceBackup: async () => {
    return repository.exportWorkspaceBackup();
  },

  importWorkspaceBackup: async (rawJson) => {
    const parsed = parseFolioWorkspaceBackup(rawJson);
    const summary = await repository.importWorkspaceBackup(parsed);
    await Promise.all([get().refreshShelf(), get().refreshTemplates()]);
    return summary;
  },
}));
