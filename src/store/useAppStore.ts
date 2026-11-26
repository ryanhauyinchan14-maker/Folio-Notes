import { create } from 'zustand';
import {
  clearImageElementCache,
} from '../canvas/imageRenderer';
import { getBrushPreset } from '../canvas/brushEngine';
import { type ColorPalettePreset, DEFAULT_COLOR_PALETTES, normalizeHex } from '../canvas/colorMath';
import {
  cloneStrokeWithNewId,
  flipStroke,
  getCombinedBounds,
  rotateStroke,
  scaleStroke,
  translateStroke,
} from '../canvas/geometry';
import { type SymmetryMode } from '../canvas/symmetry';
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
  clampNotebookZoom,
  clampWhiteboardZoom,
  getNotebookMinZoom,
} from '../canvas/whiteboard';
import {
  COVER_PRESETS,
  DEFAULT_ERASER_SIZE,
  HIGHLIGHTER_THICKNESS_PRESETS,
  PEN_THICKNESS_PRESETS,
  UNIFIED_INK_SWATCHES,
} from '../constants/covers';
import { db } from '../db/database';
import { NOTEBOOK_UNDO_WINDOW_MS, repository } from '../db/repository';
import type {
  BoundingBox,
  BrushPresetId,
  CoverConfig,
  CustomFontRecord,
  DrawingLayer,
  Folder,
  Notebook,
  NotebookMode,
  NoteDocumentData,
  Page,
  PageImage,
  PaperConfig,
  PaperPattern,
  PaperTemplate,
  PdfPageBackground,
  SlideData,
  SlideSizePresetId,
  Stroke,
  Textbox,
  ToolType,
  TrashedNotebookRecord,
  UploadedInterfaceFontMeta,
  WorkspaceCategory,
} from '../types/notes';
import { getWorkspaceCategory } from '../types/notes';
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
  type AiProviderId,
  clearAiProviderKey,
  clearGeminiApiKey,
  type CtrlScrollBehavior,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_HERO_HEADLINE,
  DEFAULT_PEN_SLOTS,
  type DefaultToolPreference,
  type DefaultZoomMode,
  type DeskBackdropPresetId,
  type DockPosition,
  type EraserMode,
  FAST_GEMINI_MODEL,
  type GeminiModelPresetId,
  getAllAiProviderKeys,
  getGeminiApiKey,
  getHandwritingCorrectionEnabled,
  getWorkspacePreferences,
  type PenFavoriteSlot,
  resolveActiveGeminiModel,
  saveAiProviderKey,
  saveGeminiApiKey,
  saveHandwritingCorrectionEnabled,
  saveWorkspacePreferences,
} from '../utils/settings';
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  type KeyboardShortcutsMap,
  normalizeShortcutCombo,
  type ShortcutActionId,
} from '../utils/shortcuts';
import { playUiSound, setUiSoundEnabled } from '../utils/uiSound';
import {
  DEFAULT_INTERFACE_FONT_ID,
  deriveFontDisplayNameFromFile,
  isSupportedFontFile,
  isValidInterfaceFontId,
  registerUploadedFontFace,
  sanitizeCustomFontName,
} from '../utils/uiFonts';
import { applyUiScaleToRuntime, clampUiScale } from '../utils/uiZoom';
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
      prevLayers?: DrawingLayer[];
      nextLayers?: DrawingLayer[];
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

export interface EditorToast {
  message: string;
  tone?: 'navy' | 'crimson';
  actionLabel?: string;
  actionTab?: 'ai' | 'general' | 'appearance';
}

const thumbnailTimers = new Map<string, number>();
let tidyToastTimer: number | null = null;
let editorToastTimer: number | null = null;
let activePdfImportAbort: AbortController | null = null;

function schedulePageThumbnailUpdate(
  pageId: string,
  paper: PaperConfig,
  strokes: Stroke[],
  textboxes: Textbox[] = [],
  images: PageImage[] = [],
  pdfBackground?: PdfPageBackground | null,
  isWhiteboard = false,
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
            undefined,
            isWhiteboard,
          )
        : generatePageThumbnail(
            paper,
            strokes,
            240,
            textboxes,
            images,
            undefined,
            isWhiteboard,
          );
      if (thumbnailDataUrl) {
        await db.pages.update(pageId, { thumbnailDataUrl });
        useAppStore.setState((s) => ({
          pages: s.pages.map((p) => (p.id === pageId ? { ...p, thumbnailDataUrl } : p)),
          ...(s.splitPane && s.splitPane.pages.some((p) => p.id === pageId)
            ? {
                splitPane: {
                  ...s.splitPane,
                  pages: s.splitPane.pages.map((p) =>
                    p.id === pageId ? { ...p, thumbnailDataUrl } : p,
                  ),
                },
              }
            : {}),
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
    schedulePageThumbnailUpdate(
      pageId,
      paper,
      strokes,
      textboxes,
      images,
      undefined,
      notebook.mode === 'whiteboard',
    );
  }
}

export interface RecentDeletedNotebookUndo {
  notebookId: string;
  title: string;
  deletedAt: number;
  expiresAt: number;
}

export interface SplitPaneSnapshot {
  notebook: Notebook;
  pages: Page[];
  activePageId: string | null;
  undoStack: HistoryCommand[];
  redoStack: HistoryCommand[];
  zoom: number;
  unlockedMasterKey: CryptoKey | null;
}

async function persistNotebookLastPageAndThumbnail(
  notebook: Notebook,
  pages: Page[],
  activePageId: string | null,
  masterKey: CryptoKey | null,
): Promise<void> {
  if (activePageId) {
    await repository.updateNotebook(notebook.id, {
      lastOpenedPageId: activePageId,
    });
  }
  if (!notebook.isLocked) {
    const firstPage = pages[0];
    if (firstPage && typeof document !== 'undefined') {
      const thumb = firstPage.pdfBackground
        ? await generatePdfAwarePageThumbnail(firstPage, 240, masterKey)
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

interface AppState {
  // Shelf state
  currentFolderId: string | null;
  activeWorkspaceFilter: 'all' | WorkspaceCategory;
  folders: Folder[];
  notebooks: Notebook[];
  breadcrumbs: Folder[];
  coverThumbnails: Record<string, string | undefined>;
  customTemplates: PaperTemplate[];
  trashedNotebooks: TrashedNotebookRecord[];
  recentDeletedNotebooks: RecentDeletedNotebookUndo[];
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
  splitPane: SplitPaneSnapshot | null;
  activePaneSide: 'left' | 'right';

  // Tool & Canvas settings
  activeTool: ToolType;
  activeBrushId: BrushPresetId;
  brushOpacity: number;
  brushStreamline: number;
  symmetryMode: SymmetryMode;
  activeLayerIdByPage: Record<string, string>;
  savedColorPalettes: ColorPalettePreset[];
  inkColor: string;
  inkSwatches: string[];
  penColor: string;
  penSize: number;
  penSwatches: string[];
  highlighterColor: string;
  highlighterSize: number;
  highlighterSwatches: string[];
  eraserMode: EraserMode;
  eraserSize: number;
  holdToSnapEnabled: boolean;
  handwritingCorrectionEnabled: boolean;
  handwritingTidyToast: string | null;
  editorToast: EditorToast | null;
  zoom: number;
  uiScale: number;
  ctrlScrollBehavior: CtrlScrollBehavior;

  // Workspace Customizability & Power Options
  penSlots: PenFavoriteSlot[];
  activePenSlotIndex: number | null;
  deskBackdrop: DeskBackdropPresetId;
  deskCustomColor: string;
  darkPaperView: boolean;
  highContrastUi: boolean;
  uiSoundsEnabled: boolean;
  dockPosition: DockPosition;
  heroHeadline: string;
  interfaceFontId: string;
  interfaceCustomFont: string;
  uploadedFonts: UploadedInterfaceFontMeta[];
  defaultZoomMode: DefaultZoomMode;
  defaultTool: DefaultToolPreference;
  defaultPaperPattern: PaperPattern;
  activeAiProvider: AiProviderId;
  aiProviderKeys: Record<AiProviderId, string>;
  aiProviderModels: Record<AiProviderId, string>;
  aiCustomBaseUrl: string;
  geminiApiKey: string;
  geminiModelPreset: GeminiModelPresetId;
  geminiCustomModelId: string;
  blockAiOnVaultLocked: boolean;
  keyboardShortcuts: KeyboardShortcutsMap;

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
  setActiveWorkspaceFilter: (filter: 'all' | WorkspaceCategory) => void;
  navigateToFolder: (folderId: string | null) => Promise<void>;
  createFolder: (name: string, color: string) => Promise<void>;
  renameFolder: (id: string, name: string, color?: string) => Promise<void>;
  moveFolder: (id: string, targetParentId: string | null) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  createNotebook: (params: {
    title: string;
    mode?: NotebookMode;
    slideSizePreset?: SlideSizePresetId;
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
    patch: Partial<Pick<Notebook, 'title' | 'folderId' | 'cover' | 'defaultPaper' | 'slideSizePreset'>>,
  ) => Promise<void>;
  duplicateNotebook: (id: string) => Promise<void>;
  deleteNotebook: (id: string) => Promise<void>;
  refreshTrash: () => Promise<void>;
  restoreTrashedNotebook: (notebookId: string) => Promise<Notebook | null>;
  undoLastNotebookDelete: () => Promise<Notebook | null>;
  dismissNotebookDeleteUndo: (notebookId?: string) => void;
  permanentlyDeleteTrashedNotebook: (notebookId: string) => Promise<void>;
  emptyTrash: () => Promise<void>;

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
  deleteLockedNotebookWithPassword: (notebookId: string, password: string) => Promise<void>;
  deleteLockedNotebookWithRecoveryKey: (
    notebookId: string,
    recoveryKey: string,
    newPassword: string,
  ) => Promise<void>;
  deleteFolderWithPassword: (folderId: string, password: string) => Promise<void>;
  deleteFolderWithRecoveryKey: (
    folderId: string,
    recoveryKey: string,
    newPassword: string,
  ) => Promise<void>;
  lockNow: () => Promise<void>;
  lockAllNotebooksNow: () => Promise<void>;

  // Actions — Editor & Pages
  openNotebook: (notebookId: string, masterKey?: CryptoKey | null) => Promise<void>;
  closeNotebook: () => Promise<void>;
  setActivePageId: (pageId: string) => void;
  openSplitNotebook: (notebookId: string, masterKey?: CryptoKey | null) => Promise<void>;
  focusSplitPane: (side: 'left' | 'right') => void;
  swapSplitPanes: () => void;
  closeSplitPane: (sideToClose?: 'left' | 'right') => Promise<void>;
  setSplitPaneActivePageId: (pageId: string) => void;
  setSplitPaneZoom: (zoom: number) => void;
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
  saveNotePageData: (pageId: string, noteData: NoteDocumentData) => void;
  saveSlidePageData: (pageId: string, slideData: SlideData, paper?: PaperConfig) => void;
  addSlidePage: (slideData?: SlideData, afterPageId?: string) => Promise<Page | null>;
  resizeActiveSlideDeck: (params: {
    preset: SlideSizePresetId;
    width: number;
    height: number;
    scaleElements: boolean;
  }) => Promise<void>;

  // Actions — Tools & View
  setActiveTool: (tool: ToolType) => void;
  setActiveBrushId: (brushId: BrushPresetId) => void;
  setBrushOpacity: (opacity: number) => void;
  setBrushStreamline: (streamline: number) => void;
  setSymmetryMode: (mode: SymmetryMode) => void;
  setActiveLayerForPage: (pageId: string, layerId: string) => void;
  addDrawingLayer: (pageId: string) => void;
  updateDrawingLayer: (pageId: string, layerId: string, patch: Partial<DrawingLayer>) => void;
  duplicateDrawingLayer: (pageId: string, layerId: string) => void;
  reorderDrawingLayer: (pageId: string, layerId: string, direction: 'up' | 'down') => void;
  mergeDrawingLayerDown: (pageId: string, layerId: string) => void;
  clearDrawingLayer: (pageId: string, layerId: string) => void;
  deleteDrawingLayer: (pageId: string, layerId: string) => void;
  addColorToPalette: (paletteId: string, hex: string) => void;
  removeColorFromPalette: (paletteId: string, hex: string) => void;
  setActiveColor: (color: string) => void;
  replaceToolSwatch: (index: number, color: string) => void;
  setActiveSize: (size: number) => void;
  setEraserMode: (mode: EraserMode) => void;
  setEraserSize: (size: number) => void;
  setHoldToSnapEnabled: (enabled: boolean) => void;
  setHandwritingCorrectionEnabled: (enabled: boolean) => void;
  showEditorToast: (toast: EditorToast | null, durationMs?: number) => void;
  setZoom: (zoom: number) => void;
  setUiScale: (scale: number) => void;
  setCtrlScrollBehavior: (behavior: CtrlScrollBehavior) => void;
  activatePenSlot: (index: number) => void;
  saveCurrentToolToSlot: (index: number, customName?: string) => void;
  resetPenSlots: () => void;
  setDeskBackdrop: (preset: DeskBackdropPresetId, customColor?: string) => void;
  setDarkPaperView: (enabled: boolean) => void;
  setHighContrastUi: (enabled: boolean) => void;
  setUiSoundsEnabled: (enabled: boolean) => void;
  setDockPosition: (pos: DockPosition) => void;
  setHeroHeadline: (headline: string) => void;
  setInterfaceFont: (fontId: string, customFontName?: string) => void;
  importCustomInterfaceFont: (
    file: File,
  ) => Promise<{ ok: boolean; fontId?: string; name?: string; error?: string }>;
  deleteCustomInterfaceFont: (id: string) => Promise<void>;
  setDefaultZoomMode: (mode: DefaultZoomMode) => void;
  setDefaultTool: (tool: DefaultToolPreference) => void;
  setDefaultPaperPattern: (pattern: PaperPattern) => void;
  setActiveAiProvider: (provider: AiProviderId) => void;
  setAiProviderKey: (provider: AiProviderId, apiKey: string) => void;
  clearAiProviderKey: (provider: AiProviderId) => void;
  setAiProviderModel: (provider: AiProviderId, model: string) => void;
  setAiCustomBaseUrl: (url: string) => void;
  setGeminiApiKey: (apiKey: string) => void;
  clearStoredGeminiApiKey: () => void;
  setGeminiModelConfig: (preset: GeminiModelPresetId, customModelId?: string) => void;
  setBlockAiOnVaultLocked: (enabled: boolean) => void;
  setKeyboardShortcut: (
    id: ShortcutActionId,
    rawCombo: string,
  ) => {
    ok: boolean;
    combo?: string;
    swappedWith?: ShortcutActionId;
    swappedCombo?: string;
  };
  resetKeyboardShortcut: (id: ShortcutActionId) => {
    swappedWith?: ShortcutActionId;
    swappedCombo?: string;
  };
  resetAllKeyboardShortcuts: () => void;

  // Actions — Strokes, Handwriting Correction, Textboxes, Paper, Lasso, Undo/Redo
  commitNewStroke: (pageId: string, stroke: Stroke) => void;
  commitNewStrokesBatch: (pageId: string, strokes: Stroke[]) => void;
  commitStrokeTransform: (
    pageId: string,
    strokeIds: string[],
    kind: 'rotate90' | 'flipX' | 'flipY',
  ) => void;
  discardRecentPenStrokes: (pageId: string, strokeIds: string[]) => void;
  commitEraseStrokes: (pageId: string, strokeIdsToDelete: string[]) => void;
  commitPrecisionErase: (pageId: string, prevStrokes: Stroke[], nextStrokes: Stroke[]) => void;
  applyPaperToPage: (pageId: string, paper: PaperConfig) => Promise<void>;
  setLassoSelection: (selection: LassoSelection | null) => void;
  setIsDraggingLasso: (dragging: boolean) => void;
  commitLassoMove: (pageId: string, strokeIds: string[], dx: number, dy: number) => void;
  updateLassoRecolorLive: (pageId: string, strokeIds: string[], color: string) => void;
  commitStrokeHistorySnapshot: (pageId: string, prevStrokes: Stroke[]) => void;
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
  updateTextboxesLive: (pageId: string, textboxIds: string[], patch: Partial<Textbox>) => void;
  commitTextboxHistorySnapshot: (pageId: string, prevTextboxes: Textbox[]) => void;
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
  deleteElementsOffPage: (pageId: string, sel: PageElementSelection) => void;
  revertAltCloneSnapshot: (
    pageId: string,
    prev: { strokes?: Stroke[]; textboxes?: Textbox[]; images?: PageImage[] },
  ) => void;
  commitAiHandwritingReplacement: (
    pageId: string,
    rawStrokeIds: string[],
    replacementStrokes: Stroke[],
    opts?: {
      selectResult?: boolean;
      requireAllPresent?: boolean;
      toastMessage?: string | null;
      alignWithAdjacentLine?: boolean;
      sourceBounds?: BoundingBox;
    },
  ) => Stroke[] | null;

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
setUiSoundEnabled(initialPrefs.uiSoundsEnabled);

const PALETTES_STORAGE_KEY = 'folio-studio-color-palettes-v1';

function loadSavedColorPalettes(): ColorPalettePreset[] {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(PALETTES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ColorPalettePreset[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    }
  } catch {
    // Fallback to curated default palettes
  }
  return DEFAULT_COLOR_PALETTES.map((p) => ({ ...p, colors: [...p.colors] }));
}

function persistColorPalettes(palettes: ColorPalettePreset[]): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PALETTES_STORAGE_KEY, JSON.stringify(palettes));
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function ensurePageLayers(page: Pick<Page, 'layers'>): DrawingLayer[] {
  if (page.layers && page.layers.length > 0) {
    return page.layers;
  }
  return [
    {
      id: 'layer-default',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      alphaLock: false,
    },
  ];
}

function applyShortcutBinding(
  current: KeyboardShortcutsMap,
  id: ShortcutActionId,
  normalized: string,
): {
  next: KeyboardShortcutsMap;
  swappedWith?: ShortcutActionId;
  swappedCombo?: string;
} {
  const prevCombo = current[id];
  const next: KeyboardShortcutsMap = { ...current };
  if (normalized === prevCombo) {
    return { next };
  }
  const conflictId = (Object.keys(next) as ShortcutActionId[]).find(
    (k) => k !== id && next[k] === normalized,
  );
  if (conflictId) {
    next[conflictId] = prevCombo;
  }
  next[id] = normalized;
  return {
    next,
    ...(conflictId ? { swappedWith: conflictId, swappedCombo: prevCombo } : {}),
  };
}

function persistWorkspacePrefsSnapshot(state: AppState): void {
  saveWorkspacePreferences({
    penSlots: state.penSlots,
    deskBackdrop: state.deskBackdrop,
    deskCustomColor: state.deskCustomColor,
    darkPaperView: state.darkPaperView,
    highContrastUi: state.highContrastUi,
    uiSoundsEnabled: state.uiSoundsEnabled,
    dockPosition: state.dockPosition,
    heroHeadline: state.heroHeadline,
    interfaceFontId: state.interfaceFontId,
    interfaceCustomFont: state.interfaceCustomFont,
    defaultZoomMode: state.defaultZoomMode,
    defaultTool: state.defaultTool,
    defaultPaperPattern: state.defaultPaperPattern,
    uiScale: state.uiScale,
    ctrlScrollBehavior: state.ctrlScrollBehavior,
    eraserMode: state.eraserMode,
    activeAiProvider: state.activeAiProvider,
    aiProviderModels: state.aiProviderModels,
    aiCustomBaseUrl: state.aiCustomBaseUrl,
    geminiModelPreset: state.geminiModelPreset,
    geminiCustomModelId: state.geminiCustomModelId,
    blockAiOnVaultLocked: state.blockAiOnVaultLocked,
    keyboardShortcuts: state.keyboardShortcuts,
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

let recentDeleteExpiryTimer: ReturnType<typeof setTimeout> | null = null;

function clearRecentDeleteExpiryTimer(): void {
  if (recentDeleteExpiryTimer !== null) {
    clearTimeout(recentDeleteExpiryTimer);
    recentDeleteExpiryTimer = null;
  }
}

function scheduleRecentDeleteCleanup(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
): void {
  clearRecentDeleteExpiryTimer();
  const now = Date.now();
  const active = get().recentDeletedNotebooks.filter((entry) => entry.expiresAt > now);
  if (active.length !== get().recentDeletedNotebooks.length) {
    set({ recentDeletedNotebooks: active });
  }
  if (active.length === 0) return;

  const earliestExpiry = Math.min(...active.map((entry) => entry.expiresAt));
  const delayMs = Math.max(0, earliestExpiry - now + 15);
  recentDeleteExpiryTimer = setTimeout(() => {
    recentDeleteExpiryTimer = null;
    const cutoff = Date.now();
    const remaining = get().recentDeletedNotebooks.filter((entry) => entry.expiresAt > cutoff);
    if (remaining.length !== get().recentDeletedNotebooks.length) {
      set({ recentDeletedNotebooks: remaining });
    }
    if (remaining.length > 0) {
      scheduleRecentDeleteCleanup(get, set);
    }
  }, delayMs);
}

function recordDeletedNotebooksForUndo(
  records: TrashedNotebookRecord[],
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
): void {
  if (records.length === 0) return;
  const now = Date.now();
  const existing = get().recentDeletedNotebooks.filter((entry) => entry.expiresAt > now);
  const additions: RecentDeletedNotebookUndo[] = records.map((r) => ({
    notebookId: r.id,
    title: r.notebook.title,
    deletedAt: r.deletedAt,
    expiresAt: r.deletedAt + NOTEBOOK_UNDO_WINDOW_MS,
  }));
  set({ recentDeletedNotebooks: [...existing, ...additions] });
  scheduleRecentDeleteCleanup(get, set);
}

const CLEARED_EDITOR_RUNTIME_STATE = {
  activeNotebook: null,
  pages: [] as Page[],
  activePageId: null,
  undoStack: [] as HistoryCommand[],
  redoStack: [] as HistoryCommand[],
  lassoSelection: null,
  isDraggingLasso: false,
  activeTextboxId: null,
  selectedTextboxId: null,
  selectedTextboxIds: [] as string[],
  textboxSessionBaseline: null,
  selectedImageIds: [] as string[],
  croppingImageId: null,
  unlockedMasterKey: null,
  splitPane: null as SplitPaneSnapshot | null,
  activePaneSide: 'left' as const,
};

async function finalizeDeletedFolderState(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
): Promise<void> {
  clearPdfDocumentCache();
  clearImageElementCache();
  const { currentFolderId, activeNotebook } = get();
  const currentFolderStillExists = currentFolderId
    ? Boolean(await db.folders.get(currentFolderId))
    : true;
  const activeNotebookStillExists = activeNotebook
    ? Boolean(await db.notebooks.get(activeNotebook.id))
    : true;
  set({
    unlockedMasterKey: null,
    ...(currentFolderStillExists ? {} : { currentFolderId: null }),
    ...(activeNotebookStillExists ? {} : CLEARED_EDITOR_RUNTIME_STATE),
  });
  await get().refreshShelf();
}

async function finalizeDeletedNotebookState(
  notebookId: string,
  clearMasterKey: boolean,
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
): Promise<void> {
  clearPdfDocumentCache();
  clearImageElementCache();
  if (get().activeNotebook?.id === notebookId) {
    set(CLEARED_EDITOR_RUNTIME_STATE);
  } else if (clearMasterKey) {
    set({ unlockedMasterKey: null });
  }
  await get().refreshShelf();
}

export const useAppStore = create<AppState>((set, get) => ({
  currentFolderId: null,
  activeWorkspaceFilter: 'all',
  folders: [],
  notebooks: [],
  breadcrumbs: [],
  coverThumbnails: {},
  customTemplates: [],
  trashedNotebooks: [],
  recentDeletedNotebooks: [],
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
  splitPane: null,
  activePaneSide: 'left',

  activeTool: initialPrefs.defaultTool,
  activeBrushId: 'technical',
  brushOpacity: 1,
  brushStreamline: 0.45,
  symmetryMode: 'off',
  activeLayerIdByPage: {},
  savedColorPalettes: loadSavedColorPalettes(),
  inkColor: UNIFIED_INK_SWATCHES[0],
  inkSwatches: [...UNIFIED_INK_SWATCHES],
  penColor: UNIFIED_INK_SWATCHES[0],
  penSize: PEN_THICKNESS_PRESETS[1],
  penSwatches: [...UNIFIED_INK_SWATCHES],
  highlighterColor: UNIFIED_INK_SWATCHES[0],
  highlighterSize: HIGHLIGHTER_THICKNESS_PRESETS[1],
  highlighterSwatches: [...UNIFIED_INK_SWATCHES],
  eraserMode: initialPrefs.eraserMode,
  eraserSize: DEFAULT_ERASER_SIZE,
  holdToSnapEnabled: true,
  handwritingCorrectionEnabled: getHandwritingCorrectionEnabled(),
  handwritingTidyToast: null,
  editorToast: null,
  zoom: 1,
  uiScale: initialPrefs.uiScale,
  ctrlScrollBehavior: initialPrefs.ctrlScrollBehavior,

  penSlots: initialPrefs.penSlots,
  activePenSlotIndex: null,
  deskBackdrop: initialPrefs.deskBackdrop,
  deskCustomColor: initialPrefs.deskCustomColor,
  darkPaperView: initialPrefs.darkPaperView,
  highContrastUi: initialPrefs.highContrastUi,
  uiSoundsEnabled: initialPrefs.uiSoundsEnabled,
  dockPosition: initialPrefs.dockPosition,
  heroHeadline: initialPrefs.heroHeadline,
  interfaceFontId: initialPrefs.interfaceFontId,
  interfaceCustomFont: initialPrefs.interfaceCustomFont,
  uploadedFonts: [],
  defaultZoomMode: initialPrefs.defaultZoomMode,
  defaultTool: initialPrefs.defaultTool,
  defaultPaperPattern: initialPrefs.defaultPaperPattern,
  activeAiProvider: initialPrefs.activeAiProvider,
  aiProviderKeys: getAllAiProviderKeys(),
  aiProviderModels: initialPrefs.aiProviderModels,
  aiCustomBaseUrl: initialPrefs.aiCustomBaseUrl,
  geminiApiKey: getGeminiApiKey(),
  geminiModelPreset: initialPrefs.geminiModelPreset,
  geminiCustomModelId: initialPrefs.geminiCustomModelId,
  blockAiOnVaultLocked: initialPrefs.blockAiOnVaultLocked,
  keyboardShortcuts: initialPrefs.keyboardShortcuts,

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
    const [, , , storedFonts] = await Promise.all([
      get().refreshShelf(),
      get().refreshTemplates(),
      get().refreshTrash(),
      db.customFonts.orderBy('createdAt').toArray().catch(() => [] as CustomFontRecord[]),
    ]);
    set({
      uploadedFonts: storedFonts.map((f) => ({
        id: f.id,
        name: f.name,
        fileName: f.fileName,
        createdAt: f.createdAt,
      })),
    });
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
    const trashedRecords = await repository.deleteFolderRecursive(id);
    recordDeletedNotebooksForUndo(trashedRecords, get, set);
    if (get().currentFolderId === id) {
      set({ currentFolderId: null });
    }
    await Promise.all([get().refreshShelf(), get().refreshTrash()]);
    playUiSound('delete');
  },

  deleteFolderWithPassword: async (folderId, password) => {
    const masterKey = await unlockMasterKeyWithPassword(password, false);
    const trashedRecords = await repository.deleteFolderRecursive(folderId, masterKey);
    recordDeletedNotebooksForUndo(trashedRecords, get, set);
    await finalizeDeletedFolderState(get, set);
    await get().refreshTrash();
  },

  deleteFolderWithRecoveryKey: async (folderId, recoveryKey, newPassword) => {
    const masterKey = await resetVaultPasswordWithRecoveryKey(recoveryKey, newPassword);
    const trashedRecords = await repository.deleteFolderRecursive(folderId, masterKey);
    recordDeletedNotebooksForUndo(trashedRecords, get, set);
    await finalizeDeletedFolderState(get, set);
    await get().refreshTrash();
  },

  setActiveWorkspaceFilter: (filter) => {
    set({ activeWorkspaceFilter: filter });
  },

  createNotebook: async ({
    title,
    mode = 'notebook',
    slideSizePreset,
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
      mode,
      slideSizePreset,
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
    const split = get().splitPane;
    const now = Date.now();
    if (active && active.id === id) {
      set({
        activeNotebook: {
          ...active,
          ...patch,
          updatedAt: now,
        },
      });
    } else if (split && split.notebook.id === id) {
      set({
        splitPane: {
          ...split,
          notebook: {
            ...split.notebook,
            ...patch,
            updatedAt: now,
          },
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
    const trashedRecord = await repository.deleteNotebook(id);
    if (trashedRecord) {
      recordDeletedNotebooksForUndo([trashedRecord], get, set);
    }
    await finalizeDeletedNotebookState(id, false, get, set);
    await get().refreshTrash();
    playUiSound('delete');
  },

  refreshTrash: async () => {
    const trashedNotebooks = await repository.getTrashedNotebooks();
    set({ trashedNotebooks });
  },

  restoreTrashedNotebook: async (notebookId) => {
    const restored = await repository.restoreTrashedNotebook(notebookId);
    const remaining = get().recentDeletedNotebooks.filter(
      (entry) => entry.notebookId !== notebookId,
    );
    set({
      recentDeletedNotebooks: remaining,
      trashedNotebooks: get().trashedNotebooks.filter((t) => t.id !== notebookId),
    });
    scheduleRecentDeleteCleanup(get, set);
    await Promise.all([get().refreshShelf(), get().refreshTrash()]);
    return restored;
  },

  undoLastNotebookDelete: async () => {
    const now = Date.now();
    const valid = get().recentDeletedNotebooks.filter((entry) => entry.expiresAt >= now);
    if (valid.length === 0) {
      set({ recentDeletedNotebooks: [] });
      clearRecentDeleteExpiryTimer();
      return null;
    }
    const target = valid[valid.length - 1];
    set({ recentDeletedNotebooks: valid.slice(0, -1) });
    scheduleRecentDeleteCleanup(get, set);
    const restored = await repository.restoreTrashedNotebook(target.notebookId, now);
    if (restored) {
      set({
        trashedNotebooks: get().trashedNotebooks.filter((t) => t.id !== target.notebookId),
      });
    }
    await Promise.all([get().refreshShelf(), get().refreshTrash()]);
    return restored;
  },

  dismissNotebookDeleteUndo: (notebookId) => {
    if (!notebookId) {
      set({ recentDeletedNotebooks: [] });
      clearRecentDeleteExpiryTimer();
      return;
    }
    const remaining = get().recentDeletedNotebooks.filter(
      (entry) => entry.notebookId !== notebookId,
    );
    set({ recentDeletedNotebooks: remaining });
    scheduleRecentDeleteCleanup(get, set);
  },

  permanentlyDeleteTrashedNotebook: async (notebookId) => {
    await repository.permanentlyDeleteTrashedNotebook(notebookId);
    const remaining = get().recentDeletedNotebooks.filter(
      (entry) => entry.notebookId !== notebookId,
    );
    set({ recentDeletedNotebooks: remaining });
    scheduleRecentDeleteCleanup(get, set);
    await get().refreshTrash();
  },

  emptyTrash: async () => {
    await repository.emptyTrash();
    set({ recentDeletedNotebooks: [] });
    clearRecentDeleteExpiryTimer();
    await get().refreshTrash();
  },

  deleteLockedNotebookWithPassword: async (notebookId, password) => {
    const masterKey = await unlockMasterKeyWithPassword(password, false);
    const trashedRecord = await repository.deleteNotebook(notebookId, masterKey);
    if (trashedRecord) {
      recordDeletedNotebooksForUndo([trashedRecord], get, set);
    }
    await finalizeDeletedNotebookState(notebookId, true, get, set);
    await get().refreshTrash();
  },

  deleteLockedNotebookWithRecoveryKey: async (notebookId, recoveryKey, newPassword) => {
    const masterKey = await resetVaultPasswordWithRecoveryKey(recoveryKey, newPassword);
    const trashedRecord = await repository.deleteNotebook(notebookId, masterKey);
    if (trashedRecord) {
      recordDeletedNotebooksForUndo([trashedRecord], get, set);
    }
    await finalizeDeletedNotebookState(notebookId, true, get, set);
    await get().refreshTrash();
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
    clearImageElementCache();
    await get().closeNotebook();
  },

  lockAllNotebooksNow: async () => {
    clearPdfDocumentCache();
    clearImageElementCache();
    const { activeNotebook, splitPane } = get();
    if (activeNotebook?.isLocked) {
      await get().closeNotebook();
      return;
    }
    if (splitPane?.notebook.isLocked) {
      await get().closeSplitPane();
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

    if (typeof window !== 'undefined' && tidyToastTimer !== null) {
      window.clearTimeout(tidyToastTimer);
      tidyToastTimer = null;
    }

    const { defaultTool, defaultZoomMode } = get();
    const resolvedDefaultTool: ToolType =
      (defaultTool as ToolType) === 'text' && getWorkspaceCategory(notebook.mode) === 'drawing'
        ? 'pen'
        : defaultTool;
    set({
      activeNotebook: notebook,
      pages,
      activePageId: targetPageId,
      activeTool: resolvedDefaultTool,
      zoom: defaultZoomMode === '100' ? 1 : get().zoom,
      undoStack: [],
      redoStack: [],
      saveStatus: 'saved',
      handwritingTidyToast: null,
      lassoSelection: null,
      isDraggingLasso: false,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      textboxSessionBaseline: null,
      selectedImageIds: [],
      croppingImageId: null,
      unlockedMasterKey: notebook.isLocked ? effectiveKey ?? null : null,
      splitPane: null,
      activePaneSide: 'left',
    });
  },

  closeNotebook: async () => {
    if (typeof window !== 'undefined') {
      for (const t of thumbnailTimers.values()) {
        window.clearTimeout(t);
      }
      thumbnailTimers.clear();
      if (tidyToastTimer !== null) {
        window.clearTimeout(tidyToastTimer);
        tidyToastTimer = null;
      }
    }

    const { activeNotebook, pages, activePageId, unlockedMasterKey, splitPane } = get();
    if (activeNotebook) {
      await persistNotebookLastPageAndThumbnail(
        activeNotebook,
        pages,
        activePageId,
        unlockedMasterKey,
      );
    }
    if (splitPane) {
      await persistNotebookLastPageAndThumbnail(
        splitPane.notebook,
        splitPane.pages,
        splitPane.activePageId,
        splitPane.unlockedMasterKey,
      );
    }

    clearPdfDocumentCache();
    clearImageElementCache();
    set({
      ...CLEARED_EDITOR_RUNTIME_STATE,
      handwritingTidyToast: null,
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

  openSplitNotebook: async (notebookId, masterKey) => {
    const state = get();
    if (!state.activeNotebook) return;
    if (state.activeNotebook.id === notebookId || state.splitPane?.notebook.id === notebookId) {
      return;
    }

    const effectiveKey = masterKey ?? state.unlockedMasterKey;
    const result = await repository.getNotebookWithPages(notebookId, effectiveKey);
    if (!result) return;

    const prevSplit = get().splitPane;
    if (prevSplit) {
      await persistNotebookLastPageAndThumbnail(
        prevSplit.notebook,
        prevSplit.pages,
        prevSplit.activePageId,
        prevSplit.unlockedMasterKey,
      );
    }

    const { notebook, pages } = result;
    const targetPageId =
      notebook.lastOpenedPageId && pages.some((p) => p.id === notebook.lastOpenedPageId)
        ? notebook.lastOpenedPageId
        : pages[0]?.id ?? null;

    set({
      splitPane: {
        notebook,
        pages,
        activePageId: targetPageId,
        undoStack: [],
        redoStack: [],
        zoom: get().zoom,
        unlockedMasterKey: notebook.isLocked ? effectiveKey ?? null : null,
      },
    });
  },

  focusSplitPane: (side) => {
    const state = get();
    if (!state.splitPane || !state.activeNotebook || state.activePaneSide === side) {
      return;
    }
    if (state.activeTextboxId && state.activePageId) {
      get().commitTextboxSession(state.activePageId, state.activeTextboxId, false);
    }
    const latest = get();
    if (!latest.splitPane || !latest.activeNotebook || latest.activePaneSide === side) {
      return;
    }
    const outgoing: SplitPaneSnapshot = {
      notebook: latest.activeNotebook,
      pages: latest.pages,
      activePageId: latest.activePageId,
      undoStack: latest.undoStack,
      redoStack: latest.redoStack,
      zoom: latest.zoom,
      unlockedMasterKey: latest.unlockedMasterKey,
    };
    const incoming = latest.splitPane;
    set({
      activeNotebook: incoming.notebook,
      pages: incoming.pages,
      activePageId: incoming.activePageId,
      undoStack: incoming.undoStack,
      redoStack: incoming.redoStack,
      zoom: incoming.zoom,
      unlockedMasterKey: incoming.unlockedMasterKey,
      splitPane: outgoing,
      activePaneSide: side,
      lassoSelection: null,
      isDraggingLasso: false,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      textboxSessionBaseline: null,
      selectedImageIds: [],
      croppingImageId: null,
    });
  },

  swapSplitPanes: () => {
    const { splitPane, activePaneSide } = get();
    if (!splitPane) return;
    set({ activePaneSide: activePaneSide === 'left' ? 'right' : 'left' });
  },

  closeSplitPane: async (sideToClose) => {
    if (!get().splitPane) return;
    if (sideToClose && sideToClose === get().activePaneSide) {
      get().focusSplitPane(sideToClose === 'left' ? 'right' : 'left');
    }
    const closing = get().splitPane;
    if (closing) {
      await persistNotebookLastPageAndThumbnail(
        closing.notebook,
        closing.pages,
        closing.activePageId,
        closing.unlockedMasterKey,
      );
    }
    set({ splitPane: null, activePaneSide: 'left' });
  },

  setSplitPaneActivePageId: (pageId) => {
    const split = get().splitPane;
    if (!split || split.activePageId === pageId) return;
    set({
      splitPane: {
        ...split,
        activePageId: pageId,
      },
    });
    void db.notebooks.update(split.notebook.id, { lastOpenedPageId: pageId });
  },

  setSplitPaneZoom: (zoom) => {
    const split = get().splitPane;
    if (!split) return;
    const isWb = split.notebook.mode === 'whiteboard';
    const clamped = isWb
      ? clampWhiteboardZoom(zoom)
      : clampNotebookZoom(zoom, getNotebookMinZoom(split.pages));
    set({
      splitPane: {
        ...split,
        zoom: clamped,
      },
    });
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
    playUiSound('paper');
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
    playUiSound('paper');
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
    playUiSound('delete');
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
    const prevTool = get().activeTool;
    const resolvedTool: ToolType =
      tool === 'text' && getWorkspaceCategory(get().activeNotebook?.mode) === 'drawing'
        ? 'pan'
        : tool;
    const keepText = resolvedTool === 'text' || resolvedTool === 'pan';
    const keepImages = resolvedTool === 'pan';
    const keepStrokes = resolvedTool === 'lasso' || resolvedTool === 'pan';
    set({
      activeTool: resolvedTool,
      lassoSelection: keepStrokes ? get().lassoSelection : null,
      isDraggingLasso: false,
      activeTextboxId: null,
      selectedTextboxId: keepText ? get().selectedTextboxId : null,
      selectedTextboxIds: keepText ? get().selectedTextboxIds : [],
      selectedImageIds: keepImages ? get().selectedImageIds : [],
      croppingImageId: null,
    });
    if (prevTool !== resolvedTool) {
      playUiSound('switch');
    }
  },

  saveNotePageData: (pageId, noteData) => {
    const { activeNotebook, pages, unlockedMasterKey } = get();
    if (!activeNotebook) return;
    const now = Date.now();
    set({
      saveStatus: 'saving',
      pages: pages.map((p) => (p.id === pageId ? { ...p, noteData, updatedAt: now } : p)),
    });
    void repository
      .saveNoteDocument(activeNotebook.id, pageId, noteData, unlockedMasterKey)
      .finally(() => {
        set({ saveStatus: 'saved' });
      });
  },

  saveSlidePageData: (pageId, slideData, paper) => {
    const { activeNotebook, pages, unlockedMasterKey } = get();
    if (!activeNotebook) return;
    const now = Date.now();
    set({
      saveStatus: 'saving',
      pages: pages.map((p) =>
        p.id === pageId
          ? { ...p, slideData, ...(paper ? { paper } : {}), updatedAt: now }
          : p,
      ),
    });
    void repository
      .saveSlidePage(activeNotebook.id, pageId, slideData, paper, unlockedMasterKey)
      .finally(() => {
        set({ saveStatus: 'saved' });
      });
  },

  addSlidePage: async (slideData, afterPageId) => {
    const { activeNotebook, activePageId, pages, unlockedMasterKey } = get();
    if (!activeNotebook) return null;
    const basePaper = pages[0]?.paper ?? activeNotebook.defaultPaper;
    const initialSlideData: SlideData = slideData ?? {
      background: { kind: 'solid', color: '#FFFFFF' },
      speakerNotes: '',
      transition: 'fade',
      elements: [],
      inkStrokes: [],
    };
    const created = await repository.addPageToNotebook({
      notebookId: activeNotebook.id,
      paper: { ...basePaper },
      initialSlideData,
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
      });
    }
    return created;
  },

  resizeActiveSlideDeck: async ({ preset, width, height, scaleElements }) => {
    const { activeNotebook, pages, unlockedMasterKey } = get();
    if (!activeNotebook) return;
    const nextWidth = Math.max(320, Math.min(4096, Math.round(width)));
    const nextHeight = Math.max(320, Math.min(4096, Math.round(height)));
    const nextDefaultPaper: PaperConfig = {
      ...activeNotebook.defaultPaper,
      sizePreset: 'custom',
      orientation: nextWidth >= nextHeight ? 'landscape' : 'portrait',
      width: nextWidth,
      height: nextHeight,
    };

    const updatedPages: Page[] = pages.map((p) => {
      const oldW = Math.max(1, p.paper.width);
      const oldH = Math.max(1, p.paper.height);
      const sx = nextWidth / oldW;
      const sy = nextHeight / oldH;
      const fontScale = Math.min(sx, sy);
      const nextPaper: PaperConfig = {
        ...p.paper,
        sizePreset: 'custom',
        orientation: nextWidth >= nextHeight ? 'landscape' : 'portrait',
        width: nextWidth,
        height: nextHeight,
      };
      if (!p.slideData || !scaleElements) {
        return { ...p, paper: nextPaper, updatedAt: Date.now() };
      }
      const scaledElements = p.slideData.elements.map((el) => {
        const baseScaled = {
          ...el,
          x: Math.round(el.x * sx),
          y: Math.round(el.y * sy),
          width: Math.max(12, Math.round(el.width * sx)),
          height: Math.max(6, Math.round(el.height * sy)),
        };
        if (baseScaled.kind === 'text') {
          return {
            ...baseScaled,
            fontSize: Math.max(10, Math.round(baseScaled.fontSize * fontScale)),
          };
        }
        return baseScaled;
      });
      return {
        ...p,
        paper: nextPaper,
        slideData: {
          ...p.slideData,
          elements: scaledElements,
        },
        updatedAt: Date.now(),
      };
    });

    set({
      activeNotebook: {
        ...activeNotebook,
        slideSizePreset: preset,
        defaultPaper: nextDefaultPaper,
        updatedAt: Date.now(),
      },
      pages: updatedPages,
      saveStatus: 'saving',
    });

    await repository.updateNotebook(activeNotebook.id, {
      slideSizePreset: preset,
      defaultPaper: nextDefaultPaper,
    });
    for (const p of updatedPages) {
      if (p.slideData) {
        await repository.saveSlidePage(
          activeNotebook.id,
          p.id,
          p.slideData,
          p.paper,
          unlockedMasterKey,
        );
      }
    }
    set({ saveStatus: 'saved' });
  },

  setActiveBrushId: (brushId) => {
    const preset = getBrushPreset(brushId);
    const nextTool: ToolType = brushId === 'highlighter' ? 'highlighter' : 'pen';
    set({
      activeBrushId: brushId,
      activeTool: nextTool,
      brushStreamline: preset.streamline,
      penSize: brushId === 'highlighter' ? get().penSize : preset.defaultSize,
      highlighterSize: brushId === 'highlighter' ? preset.defaultSize : get().highlighterSize,
    });
    playUiSound('switch');
  },

  setBrushOpacity: (opacity) => {
    const clamped = Math.max(0.1, Math.min(1, Number(opacity.toFixed(2))));
    set({ brushOpacity: clamped });
  },

  setBrushStreamline: (streamline) => {
    const clamped = Math.max(0, Math.min(1, Number(streamline.toFixed(2))));
    set({ brushStreamline: clamped });
  },

  setSymmetryMode: (mode) => set({ symmetryMode: mode }),

  setActiveLayerForPage: (pageId, layerId) =>
    set((s) => ({
      activeLayerIdByPage: { ...s.activeLayerIdByPage, [pageId]: layerId },
    })),

  addDrawingLayer: (pageId) => {
    const { activeNotebook, pages, unlockedMasterKey, activeLayerIdByPage } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const currentLayers = ensurePageLayers(targetPage);
    const newLayer: DrawingLayer = {
      id: `layer-${createId()}`,
      name: `Layer ${currentLayers.length + 1}`,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      alphaLock: false,
    };
    const nextLayers = [...currentLayers, newLayer];
    const now = Date.now();
    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, layers: nextLayers, updatedAt: now } : p,
      ),
      activeLayerIdByPage: { ...activeLayerIdByPage, [pageId]: newLayer.id },
      saveStatus: 'saving',
    });
    void repository
      .savePageLayers(activeNotebook.id, pageId, nextLayers, undefined, unlockedMasterKey)
      .finally(() => set({ saveStatus: 'saved' }));
  },

  updateDrawingLayer: (pageId, layerId, patch) => {
    const { activeNotebook, pages, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const currentLayers = ensurePageLayers(targetPage);
    const nextLayers = currentLayers.map((layer) =>
      layer.id === layerId ? { ...layer, ...patch } : layer,
    );
    const now = Date.now();
    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, layers: nextLayers, updatedAt: now } : p,
      ),
      saveStatus: 'saving',
    });
    void repository
      .savePageLayers(activeNotebook.id, pageId, nextLayers, undefined, unlockedMasterKey)
      .finally(() => set({ saveStatus: 'saved' }));
  },

  duplicateDrawingLayer: (pageId, layerId) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey, activeLayerIdByPage } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const currentLayers = ensurePageLayers(targetPage);
    const srcIdx = currentLayers.findIndex((l) => l.id === layerId);
    if (srcIdx === -1) return;
    const srcLayer = currentLayers[srcIdx];
    const clonedLayer: DrawingLayer = {
      ...srcLayer,
      id: `layer-${createId()}`,
      name: `${srcLayer.name} Copy`,
    };
    const nextLayers = [
      ...currentLayers.slice(0, srcIdx + 1),
      clonedLayer,
      ...currentLayers.slice(srcIdx + 1),
    ];

    const fallbackId = currentLayers[0]?.id;
    const prevStrokes = targetPage.strokes;
    const clonedStrokes = prevStrokes
      .filter((s) => (s.layerId ?? fallbackId) === layerId)
      .map((s) => ({
        ...cloneStrokeWithNewId(s),
        layerId: clonedLayer.id,
      }));
    const nextStrokes = [...prevStrokes, ...clonedStrokes];

    const cmd: HistoryCommand = {
      type: 'strokes',
      pageId,
      prevStrokes,
      nextStrokes,
      prevLayers: currentLayers,
      nextLayers,
    };

    const now = Date.now();
    set({
      pages: pages.map((p) =>
        p.id === pageId
          ? { ...p, layers: nextLayers, strokes: nextStrokes, updatedAt: now }
          : p,
      ),
      activeLayerIdByPage: { ...activeLayerIdByPage, [pageId]: clonedLayer.id },
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
      saveStatus: 'saving',
    });
    void repository
      .savePageLayers(activeNotebook.id, pageId, nextLayers, nextStrokes, unlockedMasterKey)
      .finally(() => set({ saveStatus: 'saved' }));
  },

  reorderDrawingLayer: (pageId, layerId, direction) => {
    const { activeNotebook, pages, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const currentLayers = [...ensurePageLayers(targetPage)];
    const idx = currentLayers.findIndex((l) => l.id === layerId);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx + 1 : idx - 1;
    if (swapIdx < 0 || swapIdx >= currentLayers.length) return;

    const temp = currentLayers[idx];
    currentLayers[idx] = currentLayers[swapIdx];
    currentLayers[swapIdx] = temp;

    const now = Date.now();
    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, layers: currentLayers, updatedAt: now } : p,
      ),
      saveStatus: 'saving',
    });
    void repository
      .savePageLayers(activeNotebook.id, pageId, currentLayers, undefined, unlockedMasterKey)
      .finally(() => set({ saveStatus: 'saved' }));
  },

  mergeDrawingLayerDown: (pageId, layerId) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey, activeLayerIdByPage } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const currentLayers = ensurePageLayers(targetPage);
    const idx = currentLayers.findIndex((l) => l.id === layerId);
    if (idx <= 0) return;
    const targetLayer = currentLayers[idx - 1];
    const nextLayers = currentLayers.filter((l) => l.id !== layerId);
    const prevStrokes = targetPage.strokes;
    const nextStrokes = prevStrokes.map((s) =>
      s.layerId === layerId ? { ...s, layerId: targetLayer.id } : s,
    );

    const cmd: HistoryCommand = {
      type: 'strokes',
      pageId,
      prevStrokes,
      nextStrokes,
      prevLayers: currentLayers,
      nextLayers,
    };

    const now = Date.now();
    set({
      pages: pages.map((p) =>
        p.id === pageId
          ? { ...p, layers: nextLayers, strokes: nextStrokes, updatedAt: now }
          : p,
      ),
      activeLayerIdByPage: { ...activeLayerIdByPage, [pageId]: targetLayer.id },
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
      saveStatus: 'saving',
    });
    void repository
      .savePageLayers(activeNotebook.id, pageId, nextLayers, nextStrokes, unlockedMasterKey)
      .finally(() => set({ saveStatus: 'saved' }));
  },

  clearDrawingLayer: (pageId, layerId) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const currentLayers = ensurePageLayers(targetPage);
    const fallbackId = currentLayers[0]?.id;
    const prevStrokes = targetPage.strokes;
    const nextStrokes = prevStrokes.filter(
      (s) => s.locked || (s.layerId ?? fallbackId) !== layerId,
    );
    if (nextStrokes.length === prevStrokes.length) return;

    const cmd: HistoryCommand = {
      type: 'strokes',
      pageId,
      prevStrokes,
      nextStrokes,
    };
    const now = Date.now();
    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, strokes: nextStrokes, updatedAt: now } : p,
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

  deleteDrawingLayer: (pageId, layerId) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey, activeLayerIdByPage } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const currentLayers = ensurePageLayers(targetPage);
    if (currentLayers.length <= 1) return;
    const idx = currentLayers.findIndex((l) => l.id === layerId);
    if (idx === -1) return;

    const nextLayers = currentLayers.filter((l) => l.id !== layerId);
    const nextActiveId = nextLayers[Math.max(0, idx - 1)].id;
    const fallbackId = currentLayers[0]?.id;
    const prevStrokes = targetPage.strokes;
    const nextStrokes = prevStrokes.filter((s) => (s.layerId ?? fallbackId) !== layerId);

    const cmd: HistoryCommand = {
      type: 'strokes',
      pageId,
      prevStrokes,
      nextStrokes,
      prevLayers: currentLayers,
      nextLayers,
    };

    const now = Date.now();
    set({
      pages: pages.map((p) =>
        p.id === pageId
          ? { ...p, layers: nextLayers, strokes: nextStrokes, updatedAt: now }
          : p,
      ),
      activeLayerIdByPage: { ...activeLayerIdByPage, [pageId]: nextActiveId },
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), cmd],
      redoStack: [],
      saveStatus: 'saving',
    });
    void repository
      .savePageLayers(activeNotebook.id, pageId, nextLayers, nextStrokes, unlockedMasterKey)
      .finally(() => set({ saveStatus: 'saved' }));
  },

  addColorToPalette: (paletteId, hex) => {
    const normalized = normalizeHex(hex);
    const next = get().savedColorPalettes.map((pal) =>
      pal.id === paletteId &&
      !pal.colors.some((c) => c.toUpperCase() === normalized)
        ? { ...pal, colors: [...pal.colors, normalized] }
        : pal,
    );
    set({ savedColorPalettes: next });
    persistColorPalettes(next);
  },

  removeColorFromPalette: (paletteId, hex) => {
    const normalized = normalizeHex(hex);
    const next = get().savedColorPalettes.map((pal) =>
      pal.id === paletteId
        ? { ...pal, colors: pal.colors.filter((c) => c.toUpperCase() !== normalized) }
        : pal,
    );
    set({ savedColorPalettes: next });
    persistColorPalettes(next);
  },

  setActiveColor: (color) => {
    const { activeTool, lassoSelection } = get();
    if (activeTool === 'lasso' && lassoSelection && lassoSelection.strokeIds.length > 0) {
      get().commitLassoRecolor(lassoSelection.pageId, lassoSelection.strokeIds, color);
    }
    set({
      inkColor: color,
      penColor: color,
      highlighterColor: color,
    });
  },

  replaceToolSwatch: (index, color) => {
    const next = [...get().inkSwatches];
    next[index] = color;
    set({
      inkSwatches: next,
      penSwatches: next,
      highlighterSwatches: next,
      inkColor: color,
      penColor: color,
      highlighterColor: color,
    });
  },

  setActiveSize: (size) => {
    if (get().activeTool === 'highlighter') {
      set({ highlighterSize: size });
    } else {
      set({ penSize: size });
    }
  },

  setEraserMode: (mode) => {
    set({ eraserMode: mode });
    persistWorkspacePrefsSnapshot(get());
  },

  setEraserSize: (size) => set({ eraserSize: size }),

  setHoldToSnapEnabled: (enabled) => set({ holdToSnapEnabled: enabled }),

  setHandwritingCorrectionEnabled: (enabled) => {
    saveHandwritingCorrectionEnabled(enabled);
    set({ handwritingCorrectionEnabled: enabled });
  },

  showEditorToast: (toast, durationMs = 2800) => {
    if (typeof window !== 'undefined' && editorToastTimer !== null) {
      window.clearTimeout(editorToastTimer);
      editorToastTimer = null;
    }
    set({ editorToast: toast });
    if (toast && typeof window !== 'undefined' && durationMs > 0) {
      editorToastTimer = window.setTimeout(() => {
        editorToastTimer = null;
        set({ editorToast: null });
      }, durationMs);
    }
  },

  setZoom: (zoom) => {
    const { activeNotebook, pages } = get();
    const isWhiteboard = activeNotebook?.mode === 'whiteboard';
    const clamped = isWhiteboard
      ? clampWhiteboardZoom(zoom)
      : clampNotebookZoom(zoom, getNotebookMinZoom(pages));
    set({ zoom: clamped });
  },

  setUiScale: (scale) => {
    const clamped = applyUiScaleToRuntime(clampUiScale(scale));
    set({ uiScale: clamped });
    persistWorkspacePrefsSnapshot(get());
  },

  setCtrlScrollBehavior: (behavior) => {
    set({ ctrlScrollBehavior: behavior });
    persistWorkspacePrefsSnapshot(get());
  },

  activatePenSlot: (index) => {
    const slot = get().penSlots[index];
    if (!slot) return;
    set({
      activeTool: slot.tool,
      activePenSlotIndex: index,
      inkColor: slot.color,
      penColor: slot.color,
      highlighterColor: slot.color,
      ...(slot.tool === 'highlighter'
        ? { highlighterSize: slot.size }
        : { penSize: slot.size }),
      lassoSelection: null,
      isDraggingLasso: false,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      selectedImageIds: [],
      croppingImageId: null,
    });
    playUiSound('switch');
  },

  saveCurrentToolToSlot: (index, customName) => {
    const state = get();
    if (index < 0 || index >= state.penSlots.length) return;
    const isHighlighter = state.activeTool === 'highlighter';
    const tool: 'pen' | 'highlighter' = isHighlighter ? 'highlighter' : 'pen';
    const color = state.inkColor;
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

  setUiSoundsEnabled: (enabled) => {
    setUiSoundEnabled(enabled);
    set({ uiSoundsEnabled: enabled });
    persistWorkspacePrefsSnapshot(get());
    if (enabled) {
      playUiSound('switch', true);
    }
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

  setInterfaceFont: (fontId, customFontName) => {
    const cleanCustom =
      customFontName !== undefined
        ? sanitizeCustomFontName(customFontName)
        : get().interfaceCustomFont;
    let nextId = isValidInterfaceFontId(fontId) ? fontId : DEFAULT_INTERFACE_FONT_ID;
    if (nextId === 'custom' && !cleanCustom) {
      nextId = DEFAULT_INTERFACE_FONT_ID;
    }
    set({
      interfaceFontId: nextId,
      interfaceCustomFont: nextId === 'custom' ? cleanCustom : customFontName !== undefined ? cleanCustom : get().interfaceCustomFont,
    });
    persistWorkspacePrefsSnapshot(get());
  },

  importCustomInterfaceFont: async (file) => {
    const check = isSupportedFontFile(file);
    if (!check.ok) {
      return { ok: false, error: check.error };
    }
    try {
      const data = await file.arrayBuffer();
      const id = createId();
      const name = deriveFontDisplayNameFromFile(file.name);
      const record: CustomFontRecord = {
        id,
        name,
        fileName: file.name,
        mimeType: file.type || 'font/ttf',
        data,
        createdAt: Date.now(),
      };
      await db.customFonts.put(record);
      await registerUploadedFontFace(record);
      const fontId = `uploaded:${id}`;
      set((state) => ({
        uploadedFonts: [
          ...state.uploadedFonts,
          { id, name, fileName: file.name, createdAt: record.createdAt },
        ],
        interfaceFontId: fontId,
        interfaceCustomFont: name,
      }));
      persistWorkspacePrefsSnapshot(get());
      return { ok: true, fontId, name };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to import font file.',
      };
    }
  },

  deleteCustomInterfaceFont: async (id) => {
    try {
      await db.customFonts.delete(id);
    } catch {
      // Ignore deletion errors if missing
    }
    set((state) => {
      const removingActive = state.interfaceFontId === `uploaded:${id}`;
      return {
        uploadedFonts: state.uploadedFonts.filter((f) => f.id !== id),
        ...(removingActive
          ? {
              interfaceFontId: DEFAULT_INTERFACE_FONT_ID,
              interfaceCustomFont: '',
            }
          : {}),
      };
    });
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

  setKeyboardShortcut: (id, rawCombo) => {
    const normalized = normalizeShortcutCombo(rawCombo);
    if (!normalized) {
      return { ok: false };
    }
    const { next, swappedWith, swappedCombo } = applyShortcutBinding(
      get().keyboardShortcuts,
      id,
      normalized,
    );
    set({ keyboardShortcuts: next });
    persistWorkspacePrefsSnapshot(get());
    return {
      ok: true,
      combo: normalized,
      ...(swappedWith ? { swappedWith, swappedCombo } : {}),
    };
  },

  resetKeyboardShortcut: (id) => {
    const { next, swappedWith, swappedCombo } = applyShortcutBinding(
      get().keyboardShortcuts,
      id,
      DEFAULT_KEYBOARD_SHORTCUTS[id],
    );
    set({ keyboardShortcuts: next });
    persistWorkspacePrefsSnapshot(get());
    return swappedWith ? { swappedWith, swappedCombo } : {};
  },

  resetAllKeyboardShortcuts: () => {
    set({ keyboardShortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS } });
    persistWorkspacePrefsSnapshot(get());
  },

  setActiveAiProvider: (provider) => {
    set({ activeAiProvider: provider });
    persistWorkspacePrefsSnapshot(get());
  },

  setAiProviderKey: (provider, apiKey) => {
    const trimmed = apiKey.trim();
    saveAiProviderKey(provider, trimmed);
    set((state) => ({
      aiProviderKeys: {
        ...state.aiProviderKeys,
        [provider]: trimmed,
      },
      ...(provider === 'gemini' ? { geminiApiKey: trimmed } : {}),
    }));
  },

  clearAiProviderKey: (provider) => {
    clearAiProviderKey(provider);
    set((state) => ({
      aiProviderKeys: {
        ...state.aiProviderKeys,
        [provider]: '',
      },
      ...(provider === 'gemini' ? { geminiApiKey: '' } : {}),
    }));
  },

  setAiProviderModel: (provider, model) => {
    const trimmed = model.trim().slice(0, 120);
    set((state) => {
      const nextModels = {
        ...state.aiProviderModels,
        [provider]: trimmed,
      };
      if (provider !== 'gemini') {
        return { aiProviderModels: nextModels };
      }
      const preset: GeminiModelPresetId =
        trimmed === DEFAULT_GEMINI_MODEL || trimmed === ''
          ? DEFAULT_GEMINI_MODEL
          : trimmed === FAST_GEMINI_MODEL
            ? FAST_GEMINI_MODEL
            : 'custom';
      return {
        aiProviderModels: nextModels,
        geminiModelPreset: preset,
        geminiCustomModelId: preset === 'custom' ? trimmed : state.geminiCustomModelId,
      };
    });
    persistWorkspacePrefsSnapshot(get());
  },

  setAiCustomBaseUrl: (url) => {
    const trimmed = url.trim().slice(0, 300);
    set({ aiCustomBaseUrl: trimmed });
    persistWorkspacePrefsSnapshot(get());
  },

  setGeminiApiKey: (apiKey) => {
    const trimmed = apiKey.trim();
    saveGeminiApiKey(trimmed);
    set((state) => ({
      geminiApiKey: trimmed,
      aiProviderKeys: {
        ...state.aiProviderKeys,
        gemini: trimmed,
      },
    }));
  },

  clearStoredGeminiApiKey: () => {
    clearGeminiApiKey();
    set((state) => ({
      geminiApiKey: '',
      aiProviderKeys: {
        ...state.aiProviderKeys,
        gemini: '',
      },
    }));
  },

  setGeminiModelConfig: (preset, customModelId) => {
    set((state) => {
      const nextCustom =
        customModelId !== undefined
          ? customModelId.trim().slice(0, 100)
          : state.geminiCustomModelId;
      const resolved = resolveActiveGeminiModel({
        geminiModelPreset: preset,
        geminiCustomModelId: nextCustom,
      });
      return {
        geminiModelPreset: preset,
        geminiCustomModelId: nextCustom,
        aiProviderModels: {
          ...state.aiProviderModels,
          gemini: resolved,
        },
      };
    });
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

  commitNewStrokesBatch: (pageId, strokes) => {
    if (strokes.length === 0) return;
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const prevStrokes = targetPage.strokes;
    const nextStrokes = [...prevStrokes, ...strokes];

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

  commitStrokeTransform: (pageId, strokeIds, kind) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook || strokeIds.length === 0) return;

    const idSet = new Set(strokeIds);
    const unlockedSelected = targetPage.strokes.filter(
      (s) => idSet.has(s.id) && !s.locked,
    );
    if (unlockedSelected.length === 0) return;

    const combined = getCombinedBounds(unlockedSelected);
    if (!combined) return;
    const cx = (combined.minX + combined.maxX) / 2;
    const cy = (combined.minY + combined.maxY) / 2;

    const prevStrokes = targetPage.strokes;
    const nextStrokes = prevStrokes.map((s) => {
      if (!idSet.has(s.id) || s.locked) return s;
      if (kind === 'rotate90') return rotateStroke(s, Math.PI / 2, cx, cy);
      if (kind === 'flipX') return flipStroke(s, 'x', cx, cy);
      return flipStroke(s, 'y', cx, cy);
    });

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

  discardRecentPenStrokes: (pageId, strokeIds) => {
    if (strokeIds.length === 0) return;
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const idSet = new Set(strokeIds);
    const nextStrokes = targetPage.strokes.filter((s) => !idSet.has(s.id));
    if (nextStrokes.length === targetPage.strokes.length) return;

    const nextUndoStack = [...undoStack];
    while (nextUndoStack.length > 0) {
      const top = nextUndoStack[nextUndoStack.length - 1];
      if (
        top.type === 'strokes' &&
        top.pageId === pageId &&
        top.nextStrokes.length === top.prevStrokes.length + 1 &&
        idSet.has(top.nextStrokes[top.nextStrokes.length - 1].id) &&
        top.prevStrokes.every((s, idx) => s.id === top.nextStrokes[idx]?.id)
      ) {
        nextUndoStack.pop();
      } else {
        break;
      }
    }

    const nextPages = pages.map((p) =>
      p.id === pageId ? { ...p, strokes: nextStrokes, updatedAt: Date.now() } : p,
    );

    set({
      pages: nextPages,
      undoStack: nextUndoStack,
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

  commitPrecisionErase: (pageId, prevStrokes, nextStrokes) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;
    if (
      prevStrokes.length === nextStrokes.length &&
      prevStrokes.every((s, idx) => s === nextStrokes[idx])
    ) {
      return;
    }

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
    const nextZoom =
      activeNotebook.mode === 'whiteboard'
        ? get().zoom
        : clampNotebookZoom(get().zoom, getNotebookMinZoom(nextPages));

    set({
      pages: nextPages,
      zoom: nextZoom,
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

  updateLassoRecolorLive: (pageId, strokeIds, color) => {
    const { pages } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const idSet = new Set(strokeIds);
    let changed = false;
    const nextStrokes = targetPage.strokes.map((s) => {
      if (idSet.has(s.id) && !s.locked && s.color !== color) {
        changed = true;
        return { ...s, color };
      }
      return s;
    });
    if (!changed) return;

    const now = Date.now();
    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, strokes: nextStrokes, updatedAt: now } : p,
      ),
    });
  },

  commitStrokeHistorySnapshot: (pageId, prevStrokes) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const nextStrokes = targetPage.strokes;
    const unchanged =
      prevStrokes.length === nextStrokes.length &&
      prevStrokes.every((prev, idx) => {
        const next = nextStrokes[idx];
        return (
          prev === next ||
          (prev.id === next.id &&
            prev.color === next.color &&
            prev.size === next.size &&
            prev.opacity === next.opacity &&
            prev.points === next.points)
        );
      });
    if (unchanged) return;

    const cmd: HistoryCommand = {
      type: 'strokes',
      pageId,
      prevStrokes,
      nextStrokes,
    };

    set({
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
    const isWhiteboard = activeNotebook.mode === 'whiteboard';
    const clampedX = isWhiteboard ? x : Math.max(8, Math.min(targetPage.paper.width - 40, x));
    const clampedY = isWhiteboard ? y : Math.max(8, Math.min(targetPage.paper.height - 30, y));

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

  updateTextboxesLive: (pageId, textboxIds, patch) => {
    const { pages } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const idSet = new Set(textboxIds);
    const prevTextboxes = targetPage.textboxes ?? [];
    const now = Date.now();
    let changed = false;
    const nextTextboxes = prevTextboxes.map((tb) => {
      if (!idSet.has(tb.id) || tb.locked) return tb;
      changed = true;
      return { ...tb, ...patch, updatedAt: now };
    });
    if (!changed) return;

    set({
      pages: pages.map((p) =>
        p.id === pageId ? { ...p, textboxes: nextTextboxes, updatedAt: now } : p,
      ),
    });
  },

  commitTextboxHistorySnapshot: (pageId, prevTextboxes) => {
    const { activeNotebook, pages, undoStack, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const nextTextboxes = targetPage.textboxes ?? [];
    const unchanged =
      prevTextboxes.length === nextTextboxes.length &&
      prevTextboxes.every((prev, idx) => {
        const next = nextTextboxes[idx];
        return (
          prev === next ||
          (prev.id === next.id &&
            prev.color === next.color &&
            prev.text === next.text &&
            prev.fontSize === next.fontSize &&
            prev.fontFamily === next.fontFamily &&
            prev.bold === next.bold &&
            prev.italic === next.italic)
        );
      });
    if (unchanged) return;

    const cmd: HistoryCommand = {
      type: 'textboxes',
      pageId,
      prevTextboxes,
      nextTextboxes,
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

    const isWhiteboard = activeNotebook.mode === 'whiteboard';
    const now = Date.now();
    const nextTextboxes =
      tbSet.size > 0
        ? prevTextboxes.map((tb) => {
            if (tbSet.has(tb.id) && !tb.locked) {
              movedAny = true;
              return {
                ...tb,
                x: isWhiteboard
                  ? tb.x + dx
                  : Math.max(4, Math.min(targetPage.paper.width - 20, tb.x + dx)),
                y: isWhiteboard
                  ? tb.y + dy
                  : Math.max(4, Math.min(targetPage.paper.height - 16, tb.y + dy)),
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
                x: isWhiteboard
                  ? im.x + dx
                  : Math.max(-im.width + 20, Math.min(targetPage.paper.width - 20, im.x + dx)),
                y: isWhiteboard
                  ? im.y + dy
                  : Math.max(-im.height + 20, Math.min(targetPage.paper.height - 20, im.y + dy)),
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
    const isWhiteboard = activeNotebook.mode === 'whiteboard';

    const remappedClones = remapGroupIdsForClones(
      prevStrokes
        .filter((s) => strokeSet.has(s.id))
        .map((s) => cloneStrokeWithNewId(s, 16, 16)),
      prevTextboxes
        .filter((tb) => tbSet.has(tb.id))
        .map((tb) => ({
          ...tb,
          id: createId(),
          x: isWhiteboard ? tb.x + 16 : Math.min(targetPage.paper.width - 40, tb.x + 16),
          y: isWhiteboard ? tb.y + 16 : Math.min(targetPage.paper.height - 24, tb.y + 16),
          createdAt: now,
          updatedAt: now,
        })),
      prevImages
        .filter((im) => imgSet.has(im.id))
        .map((im, idx) => ({
          ...im,
          crop: { ...im.crop },
          id: createId(),
          x: isWhiteboard ? im.x + 16 : Math.min(targetPage.paper.width - 40, im.x + 16),
          y: isWhiteboard ? im.y + 16 : Math.min(targetPage.paper.height - 40, im.y + 16),
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
    const isWhiteboard = activeNotebook.mode === 'whiteboard';

    const remappedPasted = remapGroupIdsForClones(
      clipboard.strokes.map((s) => cloneStrokeWithNewId(s, offset, offset)),
      clipboard.textboxes.map((tb) => ({
        ...tb,
        id: createId(),
        x: isWhiteboard
          ? tb.x + offset
          : Math.max(8, Math.min(targetPage.paper.width - 40, tb.x + offset)),
        y: isWhiteboard
          ? tb.y + offset
          : Math.max(8, Math.min(targetPage.paper.height - 24, tb.y + offset)),
        createdAt: now,
        updatedAt: now,
      })),
      clipboard.images.map((im, idx) => ({
        ...im,
        crop: { ...im.crop },
        id: createId(),
        x: isWhiteboard
          ? im.x + offset
          : Math.max(8, Math.min(targetPage.paper.width - 40, im.x + offset)),
        y: isWhiteboard
          ? im.y + offset
          : Math.max(8, Math.min(targetPage.paper.height - 40, im.y + offset)),
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
    playUiSound('delete');
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
    const { pages, activeNotebook } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const isWhiteboard = activeNotebook?.mode === 'whiteboard';
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
          x: isWhiteboard
            ? tb.x + dx
            : Math.max(4, Math.min(targetPage.paper.width - 20, tb.x + dx)),
          y: isWhiteboard
            ? tb.y + dy
            : Math.max(4, Math.min(targetPage.paper.height - 16, tb.y + dy)),
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
          x: isWhiteboard
            ? im.x + dx
            : Math.max(-im.width + 20, Math.min(targetPage.paper.width - 20, im.x + dx)),
          y: isWhiteboard
            ? im.y + dy
            : Math.max(-im.height + 20, Math.min(targetPage.paper.height - 20, im.y + dy)),
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
    const { pages, activeNotebook } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage) return;

    const isWhiteboard = activeNotebook?.mode === 'whiteboard';
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
            x: isWhiteboard
              ? tb.x + dx
              : Math.max(4, Math.min(targetPage.paper.width - 20, tb.x + dx)),
            y: isWhiteboard
              ? tb.y + dy
              : Math.max(4, Math.min(targetPage.paper.height - 16, tb.y + dy)),
            updatedAt: now,
          }
        : tb,
    );
    const nextImages = (targetPage.images ?? []).map((im) =>
      imgSet.has(im.id)
        ? {
            ...im,
            x: isWhiteboard
              ? im.x + dx
              : Math.max(-im.width + 20, Math.min(targetPage.paper.width - 20, im.x + dx)),
            y: isWhiteboard
              ? im.y + dy
              : Math.max(-im.height + 20, Math.min(targetPage.paper.height - 20, im.y + dy)),
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

  deleteElementsOffPage: (pageId, sel) => {
    const { activeNotebook, pages } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const strokeSet = new Set(sel.strokeIds);
    const tbSet = new Set(sel.textboxIds);
    const imgSet = new Set(sel.imageIds);
    if (strokeSet.size === 0 && tbSet.size === 0 && imgSet.size === 0) return;

    const prevStrokes = targetPage.strokes;
    const prevTextboxes = targetPage.textboxes ?? [];
    const prevImages = targetPage.images ?? [];
    const nextStrokes = prevStrokes.filter((s) => !strokeSet.has(s.id) || s.locked);
    const nextTextboxes = prevTextboxes.filter((tb) => !tbSet.has(tb.id) || tb.locked);
    const nextImages = prevImages.filter((im) => !imgSet.has(im.id) || im.locked);

    const removedCount =
      (prevStrokes.length - nextStrokes.length) +
      (prevTextboxes.length - nextTextboxes.length) +
      (prevImages.length - nextImages.length);
    if (removedCount === 0) return;

    applyPageContentMutation(
      get,
      set,
      pageId,
      { strokes: prevStrokes, textboxes: prevTextboxes, images: prevImages },
      { strokes: nextStrokes, textboxes: nextTextboxes, images: nextImages },
      {
        lassoSelection: null,
        isDraggingLasso: false,
        activeTextboxId: null,
        selectedTextboxId: null,
        selectedTextboxIds: [],
        textboxSessionBaseline: null,
        selectedImageIds: [],
        croppingImageId: null,
      },
    );

    get().showEditorToast(
      {
        message:
          removedCount > 1
            ? `Deleted ${removedCount} off-page items · Ctrl+Z to undo`
            : 'Deleted off-page item · Ctrl+Z to undo',
        tone: 'navy',
      },
      2600,
    );
  },

  revertAltCloneSnapshot: (pageId, prev) => {
    const { activeNotebook, pages, unlockedMasterKey } = get();
    const targetPage = pages.find((p) => p.id === pageId);
    if (!targetPage || !activeNotebook) return;

    const nextStrokes = prev.strokes ?? targetPage.strokes;
    const nextTextboxes = prev.textboxes ?? (targetPage.textboxes ?? []);
    const nextImages = prev.images ?? (targetPage.images ?? []);
    const now = Date.now();

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
      lassoSelection: null,
      isDraggingLasso: false,
      activeTextboxId: null,
      selectedTextboxId: null,
      selectedTextboxIds: [],
      textboxSessionBaseline: null,
      selectedImageIds: [],
      croppingImageId: null,
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

  commitAiHandwritingReplacement: (pageId, rawStrokeIds, replacementStrokes, opts) => {
    const { activeNotebook, pages, splitPane } = get();
    const inPrimary = pages.some((p) => p.id === pageId);
    const targetPage = inPrimary
      ? pages.find((p) => p.id === pageId)
      : splitPane?.pages.find((p) => p.id === pageId);
    const targetNotebook = inPrimary ? activeNotebook : splitPane?.notebook ?? null;
    if (
      !targetPage ||
      !targetNotebook ||
      rawStrokeIds.length === 0 ||
      replacementStrokes.length === 0
    ) {
      return null;
    }

    const rawSet = new Set(rawStrokeIds);
    const prevStrokes = targetPage.strokes;
    if (opts?.requireAllPresent) {
      const existingIds = new Set(prevStrokes.map((s) => s.id));
      for (const id of rawStrokeIds) {
        if (!existingIds.has(id)) return null;
      }
    }

    const remainingStrokes = prevStrokes.filter((s) => !rawSet.has(s.id) || s.locked);
    if (remainingStrokes.length === prevStrokes.length) return null;

    const prevTextboxes = targetPage.textboxes ?? [];
    const prevImages = targetPage.images ?? [];
    let finalStrokes = replacementStrokes;

    if (opts?.alignWithAdjacentLine) {
      const newBounds = getCombinedBounds(replacementStrokes);
      if (newBounds) {
        const newCenterY = (newBounds.minY + newBounds.maxY) / 2;
        const groups = new Map<string, Stroke[]>();
        for (const s of remainingStrokes) {
          if (s.locked || !s.isTidied || s.tool !== 'pen') continue;
          const key = s.groupId ?? s.id;
          const list = groups.get(key);
          if (list) list.push(s);
          else groups.set(key, [s]);
        }

        const dominantColor = replacementStrokes[0]?.color;
        let leftNeighbor: { bounds: BoundingBox; dist: number } | null = null;

        for (const groupStrokes of groups.values()) {
          if (dominantColor && groupStrokes[0]?.color !== dominantColor) continue;
          const gBounds = getCombinedBounds(groupStrokes);
          if (!gBounds) continue;
          const gHeight = Math.max(16, gBounds.maxY - gBounds.minY);
          const gCenterY = (gBounds.minY + gBounds.maxY) / 2;
          if (Math.abs(gCenterY - newCenterY) > Math.max(24, gHeight * 0.75)) continue;

          const maxGap = Math.max(85, gHeight * 2.5);
          if (newBounds.minX >= gBounds.maxX - 24 && newBounds.minX <= gBounds.maxX + maxGap) {
            const dist = Math.abs(newBounds.minX - gBounds.maxX);
            if (!leftNeighbor || dist < leftNeighbor.dist) {
              leftNeighbor = { bounds: gBounds, dist };
            }
          }
        }

        if (leftNeighbor) {
          const gBounds = leftNeighbor.bounds;
          const gHeight = Math.max(16, gBounds.maxY - gBounds.minY);
          const rawDy = Number((gBounds.maxY - newBounds.maxY).toFixed(2));
          const dy = Math.abs(rawDy) <= Math.max(16, gHeight * 0.35) ? rawDy : 0;
          const minGap = Math.max(10, gHeight * 0.35);
          const dx =
            newBounds.minX < gBounds.maxX + minGap
              ? Number((gBounds.maxX + minGap - newBounds.minX).toFixed(2))
              : 0;
          if (dx !== 0 || dy !== 0) {
            finalStrokes = replacementStrokes.map((s) => translateStroke(s, dx, dy));
          }
        }
      }
    }

    const nextStrokes = [...remainingStrokes, ...finalStrokes];

    const showToast = opts?.toastMessage !== null;
    const toastText = opts?.toastMessage ?? 'Handwriting cleaned by AI';

    if (showToast && typeof window !== 'undefined') {
      if (tidyToastTimer !== null) window.clearTimeout(tidyToastTimer);
      tidyToastTimer = window.setTimeout(() => {
        set({ handwritingTidyToast: null });
        tidyToastTimer = null;
      }, 2200);
    }

    const extraPatch: Partial<AppState> = {
      ...(showToast ? { handwritingTidyToast: toastText } : {}),
      ...(opts?.selectResult
        ? {
            lassoSelection: { pageId, strokeIds: finalStrokes.map((s) => s.id) },
            isDraggingLasso: false,
            activeTextboxId: null,
            selectedTextboxId: null,
            selectedTextboxIds: [],
            selectedImageIds: [],
            croppingImageId: null,
          }
        : {}),
    };

    if (inPrimary) {
      applyPageContentMutation(
        get,
        set,
        pageId,
        { strokes: prevStrokes, textboxes: prevTextboxes, images: prevImages },
        { strokes: nextStrokes, textboxes: prevTextboxes, images: prevImages },
        extraPatch,
      );
    } else if (splitPane) {
      const cmd: HistoryCommand = {
        type: 'page-content',
        pageId,
        prevStrokes,
        nextStrokes,
        prevTextboxes,
        nextTextboxes: prevTextboxes,
        prevImages,
        nextImages: prevImages,
      };
      const now = Date.now();
      set({
        splitPane: {
          ...splitPane,
          pages: splitPane.pages.map((p) =>
            p.id === pageId
              ? {
                  ...p,
                  strokes: nextStrokes,
                  textboxes: prevTextboxes,
                  images: prevImages,
                  updatedAt: now,
                }
              : p,
          ),
          undoStack: [...splitPane.undoStack.slice(-(MAX_HISTORY - 1)), cmd],
          redoStack: [],
        },
        ...extraPatch,
      });

      persistPageContentChange(
        splitPane.notebook,
        pageId,
        targetPage.paper,
        nextStrokes,
        prevTextboxes,
        prevImages,
        splitPane.unlockedMasterKey,
        (status) => set({ saveStatus: status }),
      );
    }

    return finalStrokes;
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
        return {
          ...p,
          strokes: cmd.prevStrokes,
          ...(cmd.prevLayers !== undefined ? { layers: cmd.prevLayers } : {}),
          updatedAt: Date.now(),
        };
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
      if (cmd.type === 'strokes' && (cmd.prevLayers !== undefined || cmd.nextLayers !== undefined) && updatedPage.layers) {
        void repository.savePageLayers(
          activeNotebook.id,
          cmd.pageId,
          updatedPage.layers,
          updatedPage.strokes,
          unlockedMasterKey,
        );
      } else {
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
      }
    } else {
      void repository.savePagePaper(activeNotebook.id, cmd.pageId, updatedPage.paper);
      if (!activeNotebook.isLocked) {
        schedulePageThumbnailUpdate(
          cmd.pageId,
          updatedPage.paper,
          updatedPage.strokes,
          updatedPage.textboxes ?? [],
          updatedPage.images ?? [],
          undefined,
          activeNotebook.mode === 'whiteboard',
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
        return {
          ...p,
          strokes: cmd.nextStrokes,
          ...(cmd.nextLayers !== undefined ? { layers: cmd.nextLayers } : {}),
          updatedAt: Date.now(),
        };
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
      if (cmd.type === 'strokes' && (cmd.prevLayers !== undefined || cmd.nextLayers !== undefined) && updatedPage.layers) {
        void repository.savePageLayers(
          activeNotebook.id,
          cmd.pageId,
          updatedPage.layers,
          updatedPage.strokes,
          unlockedMasterKey,
        );
      } else {
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
      }
    } else {
      void repository.savePagePaper(activeNotebook.id, cmd.pageId, updatedPage.paper);
      if (!activeNotebook.isLocked) {
        schedulePageThumbnailUpdate(
          cmd.pageId,
          updatedPage.paper,
          updatedPage.strokes,
          updatedPage.textboxes ?? [],
          updatedPage.images ?? [],
          undefined,
          activeNotebook.mode === 'whiteboard',
        );
      }
    }
  },

  savePresetTemplate: async (name, paper) => {
    const isWhiteboard = get().activeNotebook?.mode === 'whiteboard';
    const thumbnailDataUrl = generatePageThumbnail(
      paper,
      [],
      240,
      [],
      [],
      null,
      isWhiteboard,
    );
    const created = await repository.saveCustomTemplate({
      name,
      mode: isWhiteboard ? 'whiteboard' : 'notebook',
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
    const isWhiteboard = get().activeNotebook?.mode === 'whiteboard';
    const textboxes = page.textboxes ?? [];
    const images = page.images ?? [];
    const thumbnailDataUrl = generatePageThumbnail(
      page.paper,
      page.strokes,
      240,
      textboxes,
      images,
      null,
      isWhiteboard,
    );
    const created = await repository.saveCustomTemplate({
      name,
      mode: isWhiteboard ? 'whiteboard' : 'notebook',
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
