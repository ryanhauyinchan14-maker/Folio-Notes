import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { X } from 'lucide-react';
import {
  clampNotebookZoom,
  getNotebookMinZoom,
  NOTEBOOK_MAX_ZOOM,
  stepCanvasZoom,
  WHITEBOARD_MAX_ZOOM,
  WHITEBOARD_MIN_ZOOM,
} from '../../canvas/whiteboard';
import { MAX_TEXTBOX_FONT_SIZE, MIN_TEXTBOX_FONT_SIZE } from '../../canvas/textLayout';
import { DEFAULT_PAPER_CONFIG } from '../../constants/papers';
import { useAppStore } from '../../store/useAppStore';
import type { Notebook, Page, PageImage } from '../../types/notes';
import {
  buildPlacedPageImage,
  processUploadedImage,
} from '../../utils/imageImport';
import { isPdfFile } from '../../utils/pdfEngine';
import { CustomizePaperModal } from '../modals/CustomizePaperModal';
import { ExportModal } from '../modals/ExportModal';
import { KeyboardShortcutsModal } from '../modals/KeyboardShortcutsModal';
import { PrintPreviewModal } from '../modals/PrintPreviewModal';
import { SaveTemplateModal } from '../modals/SaveTemplateModal';
import { SettingsModal, type SettingsTabId } from '../modals/SettingsModal';
import { TemplatePickerModal } from '../modals/TemplatePickerModal';
import type { SnapshotCropRect } from '../../ai/pageSnapshot';
import { classifyAiError } from '../../ai/aiClient';
import { cleanHandwritingStrokesWithAi } from '../../ai/handwritingAi';
import { resolveActiveAiConfig } from '../../utils/settings';
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  formatShortcutDisplay,
  matchesShortcutEvent,
  parseShortcutCombo,
  type ShortcutActionId,
} from '../../utils/shortcuts';
import { AiSidebar, type PendingLassoAiAction } from './AiSidebar';
import { BottomDocks } from './BottomDocks';
import {
  CanvasContextMenu,
  type CanvasContextMenuState,
} from './CanvasContextMenu';
import { ContextualSubBar } from './ContextualSubBar';
import { PageCanvas } from './PageCanvas';
import { PagesDrawer } from './PagesDrawer';
import { TopHeaderBar } from './TopHeaderBar';
import { WhiteboardCanvas, type WhiteboardCanvasHandle } from './WhiteboardCanvas';

export const NotebookEditor: React.FC = () => {
  const activeNotebook = useAppStore((s) => s.activeNotebook);
  const pages = useAppStore((s) => s.pages);
  const activePageId = useAppStore((s) => s.activePageId);
  const unlockedMasterKey = useAppStore((s) => s.unlockedMasterKey);
  const splitPane = useAppStore((s) => s.splitPane);
  const activePaneSide = useAppStore((s) => s.activePaneSide);
  const activeTool = useAppStore((s) => s.activeTool);
  const zoom = useAppStore((s) => s.zoom);
  const ctrlScrollBehavior = useAppStore((s) => s.ctrlScrollBehavior);
  const keyboardShortcuts = useAppStore((s) => s.keyboardShortcuts);
  const handwritingTidyToast = useAppStore((s) => s.handwritingTidyToast);
  const editorToast = useAppStore((s) => s.editorToast);
  const activeTextboxId = useAppStore((s) => s.activeTextboxId);
  const selectedTextboxIds = useAppStore((s) => s.selectedTextboxIds);
  const selectedImageIds = useAppStore((s) => s.selectedImageIds);
  const croppingImageId = useAppStore((s) => s.croppingImageId);
  const lassoSelection = useAppStore((s) => s.lassoSelection);

  const setActivePageId = useAppStore((s) => s.setActivePageId);
  const focusSplitPane = useAppStore((s) => s.focusSplitPane);
  const closeSplitPane = useAppStore((s) => s.closeSplitPane);
  const setSplitPaneActivePageId = useAppStore((s) => s.setSplitPaneActivePageId);
  const closeNotebook = useAppStore((s) => s.closeNotebook);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const setZoom = useAppStore((s) => s.setZoom);
  const addPageFromTemplate = useAppStore((s) => s.addPageFromTemplate);
  const importPdfPagesIntoActiveNotebook = useAppStore((s) => s.importPdfPagesIntoActiveNotebook);
  const spawnTextbox = useAppStore((s) => s.spawnTextbox);
  const updateTextboxLive = useAppStore((s) => s.updateTextboxLive);
  const commitTextboxSession = useAppStore((s) => s.commitTextboxSession);
  const commitTextboxMutation = useAppStore((s) => s.commitTextboxMutation);
  const selectTextbox = useAppStore((s) => s.selectTextbox);
  const selectImage = useAppStore((s) => s.selectImage);
  const setCroppingImageId = useAppStore((s) => s.setCroppingImageId);
  const addPageImages = useAppStore((s) => s.addPageImages);
  const setLassoSelection = useAppStore((s) => s.setLassoSelection);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const groupSelection = useAppStore((s) => s.groupSelection);
  const ungroupSelection = useAppStore((s) => s.ungroupSelection);
  const undoStackLen = useAppStore((s) => s.undoStack.length);
  const redoStackLen = useAppStore((s) => s.redoStack.length);
  const nudgeSelection = useAppStore((s) => s.nudgeSelection);
  const duplicateSelection = useAppStore((s) => s.duplicateSelection);
  const copySelection = useAppStore((s) => s.copySelection);
  const cutSelection = useAppStore((s) => s.cutSelection);
  const pasteSelection = useAppStore((s) => s.pasteSelection);
  const selectAllOnPage = useAppStore((s) => s.selectAllOnPage);
  const cycleTextboxSelection = useAppStore((s) => s.cycleTextboxSelection);
  const deleteActiveSelection = useAppStore((s) => s.deleteActiveSelection);
  const copyTextboxStyle = useAppStore((s) => s.copyTextboxStyle);
  const pasteTextboxStyle = useAppStore((s) => s.pasteTextboxStyle);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const commitAiHandwritingReplacement = useAppStore((s) => s.commitAiHandwritingReplacement);
  const showEditorToast = useAppStore((s) => s.showEditorToast);
  const deskBackdrop = useAppStore((s) => s.deskBackdrop);
  const deskCustomColor = useAppStore((s) => s.deskCustomColor);
  const dockPosition = useAppStore((s) => s.dockPosition);
  const defaultZoomMode = useAppStore((s) => s.defaultZoomMode);
  const activatePenSlot = useAppStore((s) => s.activatePenSlot);

  const [zenMode, setZenMode] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [exportVisibleRegion, setExportVisibleRegion] = useState<SnapshotCropRect | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('general');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [rightClickLassoActive, setRightClickLassoActive] = useState(false);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [pdfErrorToast, setPdfErrorToast] = useState<string | null>(null);
  const [aiSidebarOpen, setAiSidebarOpen] = useState(false);
  const [tidyingHandwriting, setTidyingHandwriting] = useState(false);
  const [isMiddlePanning, setIsMiddlePanning] = useState(false);
  const [pendingLassoAiAction, setPendingLassoAiAction] =
    useState<PendingLassoAiAction | null>(null);

  const isWhiteboard = activeNotebook?.mode === 'whiteboard';
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const leftViewportRef = useRef<HTMLDivElement | null>(null);
  const rightViewportRef = useRef<HTMLDivElement | null>(null);
  const whiteboardRef = useRef<WhiteboardCanvasHandle | null>(null);
  const companionWhiteboardRef = useRef<WhiteboardCanvasHandle | null>(null);
  const getActiveViewportEl = useCallback((): HTMLDivElement | null => {
    if (splitPane) {
      return activePaneSide === 'left' ? leftViewportRef.current : rightViewportRef.current;
    }
    return viewportRef.current;
  }, [splitPane, activePaneSide]);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const pdfFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastCursorPointRef = useRef<{ pageId: string; x: number; y: number } | null>(null);
  const internalClipboardFreshRef = useRef(false);
  const lastHandledPasteAtRef = useRef(0);
  const pasteFallbackTimerRef = useRef<number | null>(null);
  const lastTextPastePosRef = useRef<{ pageId: string; x: number; y: number } | null>(null);
  const closingViaEscRef = useRef(false);
  const pendingZoomAnchorRef = useRef<{
    pageId: string;
    relX: number;
    relY: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const middlePanCleanupRef = useRef<(() => void) | null>(null);
  const panDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  const activePageIndex = useMemo(() => {
    const idx = pages.findIndex((p) => p.id === activePageId);
    return idx >= 0 ? idx : 0;
  }, [pages, activePageId]);

  const activePage = pages[activePageIndex] ?? pages[0] ?? null;

  const scrollToPage = useCallback(
    (pageId: string) => {
      setActivePageId(pageId);
      const container = getActiveViewportEl();
      if (!container) return;
      const el = container.querySelector<HTMLElement>(`[data-page-id="${pageId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [getActiveViewportEl, setActivePageId],
  );

  const handleFitWidth = useCallback(() => {
    const container = getActiveViewportEl();
    if (!container || !activePage) return;
    const available = Math.max(300, container.clientWidth - 64);
    setZoom(available / activePage.paper.width);
  }, [activePage, getActiveViewportEl, setZoom]);

  // Apply preferred default zoom mode when opening a standard notebook (whiteboard owns its own initial camera)
  const appliedInitialZoomForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeNotebook) {
      appliedInitialZoomForRef.current = null;
      return;
    }
    if (appliedInitialZoomForRef.current === activeNotebook.id) return;
    appliedInitialZoomForRef.current = activeNotebook.id;
    if (useAppStore.getState().splitPane) {
      return;
    }
    if (activeNotebook.mode === 'whiteboard') {
      setDrawerOpen(false);
      return;
    }
    if (defaultZoomMode === 'fit-width') {
      requestAnimationFrame(() => handleFitWidth());
    } else {
      setZoom(1);
    }
  }, [activeNotebook?.id, activeNotebook?.mode, defaultZoomMode, handleFitWidth, setZoom]);

  // Comfortably fit standard notebooks to half-width when first entering Split View
  const fittedSplitPairRef = useRef<string | null>(null);
  useEffect(() => {
    if (!splitPane || !activeNotebook) {
      fittedSplitPairRef.current = null;
      return;
    }
    const pairKey = [activeNotebook.id, splitPane.notebook.id].sort().join(':');
    if (fittedSplitPairRef.current === pairKey) return;
    fittedSplitPairRef.current = pairKey;

    requestAnimationFrame(() => {
      const container = leftViewportRef.current ?? rightViewportRef.current;
      const vw = container?.clientWidth ?? 0;
      if (vw <= 120) return;
      const st = useAppStore.getState();
      if (st.activeNotebook && st.activeNotebook.mode !== 'whiteboard' && st.pages[0]) {
        const fitW = Math.max(0.35, (vw - 48) / st.pages[0].paper.width);
        if (fitW < st.zoom) st.setZoom(fitW);
      }
      if (st.splitPane && st.splitPane.notebook.mode !== 'whiteboard' && st.splitPane.pages[0]) {
        const fitW = Math.max(0.35, (vw - 48) / st.splitPane.pages[0].paper.width);
        if (fitW < st.splitPane.zoom) st.setSplitPaneZoom(fitW);
      }
    });
  }, [splitPane?.notebook.id, activeNotebook?.id]);

  const handleQuickAddPage = useCallback(async () => {
    const basePaper =
      activePage?.paper ?? activeNotebook?.defaultPaper ?? DEFAULT_PAPER_CONFIG;
    const created = await addPageFromTemplate(basePaper, [], activePage?.id);
    if (created) {
      requestAnimationFrame(() => scrollToPage(created.id));
    }
  }, [activeNotebook?.defaultPaper, activePage?.id, activePage?.paper, addPageFromTemplate, scrollToPage]);

  const getVisiblePageRect = useCallback(
    (targetPage: Page): SnapshotCropRect | null => {
      if (isWhiteboard && whiteboardRef.current) {
        return whiteboardRef.current.getVisibleWorldRect();
      }
      const container = getActiveViewportEl();
      if (!container) return null;
      const pageEl = container.querySelector<HTMLElement>(
        `[data-page-id="${targetPage.id}"]`,
      );
      if (!pageEl) return null;

      const vpRect = container.getBoundingClientRect();
      const pRect = pageEl.getBoundingClientRect();
      if (vpRect.width <= 0 || vpRect.height <= 0 || pRect.width <= 0 || pRect.height <= 0) {
        return null;
      }

      const interLeft = Math.max(vpRect.left, pRect.left);
      const interTop = Math.max(vpRect.top, pRect.top);
      const interRight = Math.min(vpRect.right, pRect.right);
      const interBottom = Math.min(vpRect.bottom, pRect.bottom);
      if (interRight <= interLeft || interBottom <= interTop) {
        return null;
      }

      const scaleX = targetPage.paper.width / pRect.width;
      const scaleY = targetPage.paper.height / pRect.height;
      const x1 = Math.max(0, Math.floor((interLeft - pRect.left) * scaleX));
      const y1 = Math.max(0, Math.floor((interTop - pRect.top) * scaleY));
      const x2 = Math.min(targetPage.paper.width, Math.ceil((interRight - pRect.left) * scaleX));
      const y2 = Math.min(targetPage.paper.height, Math.ceil((interBottom - pRect.top) * scaleY));

      const width = Math.max(Math.min(32, targetPage.paper.width), x2 - x1);
      const height = Math.max(Math.min(32, targetPage.paper.height), y2 - y1);
      const x = Math.min(x1, Math.max(0, targetPage.paper.width - width));
      const y = Math.min(y1, Math.max(0, targetPage.paper.height - height));
      return { x, y, width, height };
    },
    [isWhiteboard],
  );

  const openExportModal = useCallback(() => {
    setExportVisibleRegion(activePage ? getVisiblePageRect(activePage) : null);
    setExportOpen(true);
  }, [activePage, getVisiblePageRect]);

  const getVisiblePageCenter = useCallback(
    (targetPage: Page) => {
      if (isWhiteboard && whiteboardRef.current) {
        const c = whiteboardRef.current.getVisibleWorldCenter();
        return { centerX: Math.round(c.x), centerY: Math.round(c.y) };
      }
      let centerX = targetPage.paper.width / 2;
      let centerY = targetPage.paper.height / 2;
      const container = getActiveViewportEl();
      if (container) {
        const vpRect = container.getBoundingClientRect();
        const pageEl = container.querySelector<HTMLElement>(
          `[data-page-id="${targetPage.id}"]`,
        );
        if (pageEl) {
          const pRect = pageEl.getBoundingClientRect();
          const visibleCenterX = vpRect.left + vpRect.width / 2;
          const visibleCenterY = vpRect.top + vpRect.height / 2;
          centerX = Math.max(
            48,
            Math.min(
              targetPage.paper.width - 48,
              ((visibleCenterX - pRect.left) / Math.max(1, pRect.width)) *
                targetPage.paper.width,
            ),
          );
          centerY = Math.max(
            48,
            Math.min(
              targetPage.paper.height - 48,
              ((visibleCenterY - pRect.top) / Math.max(1, pRect.height)) *
                targetPage.paper.height,
            ),
          );
        }
      }
      return { centerX, centerY };
    },
    [isWhiteboard],
  );

  const insertImageBlobs = useCallback(
    async (blobs: Blob[]) => {
      if (!activePage || blobs.length === 0) return;
      const { centerX, centerY } = getVisiblePageCenter(activePage);
      const baseMaxZ = (activePage.images ?? []).reduce(
        (m, im) => Math.max(m, im.zIndex),
        0,
      );
      const placed: PageImage[] = [];

      for (let i = 0; i < blobs.length; i++) {
        try {
          const processed = await processUploadedImage(blobs[i]);
          placed.push(
            buildPlacedPageImage({
              dataUrl: processed.dataUrl,
              naturalWidth: processed.naturalWidth,
              naturalHeight: processed.naturalHeight,
              paper: activePage.paper,
              centerX: centerX + i * 24,
              centerY: centerY + i * 24,
              zIndex: baseMaxZ + i + 1,
              unbounded: isWhiteboard,
            }),
          );
        } catch {
          // Ignore invalid/corrupt image files
        }
      }

      if (placed.length > 0) {
        addPageImages(activePage.id, placed);
      }
    },
    [activePage, addPageImages, getVisiblePageCenter, isWhiteboard],
  );

  const openImagePicker = useCallback(() => {
    imageFileInputRef.current?.click();
  }, []);

  const handleImportPdfFiles = useCallback(
    async (files: File[]) => {
      const pdfs = files.filter(isPdfFile);
      if (pdfs.length === 0) return;
      setPdfErrorToast(null);
      let firstInsertedId: string | null = null;
      try {
        let insertAfterId = activePage?.id;
        for (const pdf of pdfs) {
          const added = await importPdfPagesIntoActiveNotebook(pdf, insertAfterId);
          if (added.length > 0) {
            if (!firstInsertedId) firstInsertedId = added[0].id;
            insertAfterId = added[added.length - 1].id;
          }
        }
        if (firstInsertedId) {
          const targetId = firstInsertedId;
          requestAnimationFrame(() => scrollToPage(targetId));
        }
      } catch (err) {
        setPdfErrorToast(
          err instanceof Error ? err.message : 'Failed to import PDF pages.',
        );
      }
    },
    [activePage?.id, importPdfPagesIntoActiveNotebook, scrollToPage],
  );

  const handleLassoAiAction = useCallback(
    (action: 'ask' | 'math-hint' | 'transcribe') => {
      const lasso = useAppStore.getState().lassoSelection;
      if (!activePage || !lasso || lasso.pageId !== activePage.id || lasso.strokeIds.length === 0) {
        setAiSidebarOpen(true);
        return;
      }
      setAiSidebarOpen(true);
      setPendingLassoAiAction({
        id: Date.now() + Math.random(),
        action,
        pageId: activePage.id,
        strokeIds: [...lasso.strokeIds],
      });
    },
    [activePage],
  );

  const handleTidySelectedHandwriting = useCallback(async () => {
    const state = useAppStore.getState();
    const lasso = state.lassoSelection;
    if (!activePage || !lasso || lasso.pageId !== activePage.id || lasso.strokeIds.length === 0) {
      return;
    }

    const idSet = new Set(lasso.strokeIds);
    const penStrokes = activePage.strokes.filter(
      (s) => idSet.has(s.id) && s.tool === 'pen' && !s.locked,
    );
    if (penStrokes.length === 0) return;

    const isVaultBlocked = Boolean(
      state.activeNotebook?.isLocked && state.blockAiOnVaultLocked,
    );
    if (isVaultBlocked) {
      showEditorToast(
        {
          message: 'AI Handwriting Cleanup is blocked because this notebook is Vault locked.',
          tone: 'crimson',
          actionLabel: 'Settings',
          actionTab: 'ai',
        },
        4000,
      );
      return;
    }

    const activeAi = resolveActiveAiConfig(state);
    if (!activeAi.configured) {
      return;
    }

    setTidyingHandwriting(true);
    try {
      const result = await cleanHandwritingStrokesWithAi({
        strokes: penStrokes,
        config: activeAi,
        guard: {
          isVaultLocked: Boolean(state.activeNotebook?.isLocked),
          blockAiOnVaultLocked: state.blockAiOnVaultLocked,
        },
      });
      if (!result) {
        showEditorToast(
          {
            message: 'Selection looks like a drawing — strokes left untouched.',
            tone: 'navy',
          },
          2600,
        );
        return;
      }
      commitAiHandwritingReplacement(
        activePage.id,
        penStrokes.map((s) => s.id),
        result.strokes,
        { selectResult: true, toastMessage: 'Handwriting cleaned by AI' },
      );
    } catch (err) {
      showEditorToast(
        {
          message: classifyAiError(err, activeAi.label).message,
          tone: 'crimson',
        },
        3600,
      );
    } finally {
      setTidyingHandwriting(false);
    }
  }, [activePage, commitAiHandwritingReplacement, showEditorToast]);

  const handleInsertAiTextbox = useCallback(
    (text: string, nearRect?: SnapshotCropRect) => {
      if (!activePage || !text.trim()) return;
      const { centerX, centerY } = getVisiblePageCenter(activePage);
      const wrapWidth = isWhiteboard
        ? nearRect
          ? Math.max(220, Math.min(480, Math.round(nearRect.width)))
          : 360
        : Math.min(480, Math.max(220, Math.round(activePage.paper.width * 0.62)));
      const x = isWhiteboard
        ? nearRect
          ? nearRect.x
          : Math.round(centerX - wrapWidth / 2)
        : nearRect
          ? Math.max(24, Math.min(activePage.paper.width - wrapWidth - 20, nearRect.x))
          : Math.max(
              24,
              Math.min(activePage.paper.width - wrapWidth - 20, centerX - wrapWidth / 2),
            );
      const y = isWhiteboard
        ? nearRect
          ? nearRect.y + nearRect.height + 16
          : Math.round(centerY - 40)
        : nearRect
          ? nearRect.y + nearRect.height + 16 < activePage.paper.height - 90
            ? nearRect.y + nearRect.height + 16
            : Math.max(24, nearRect.y - 60)
          : Math.max(24, Math.min(activePage.paper.height - 90, centerY - 40));

      const tb = spawnTextbox({
        pageId: activePage.id,
        x,
        y,
        initialText: text,
        fontSize: 18,
        wrapWidth,
      });
      if (tb) {
        commitTextboxSession(activePage.id, tb.id, true);
      }
    },
    [activePage, commitTextboxSession, getVisiblePageCenter, isWhiteboard, spawnTextbox],
  );

  const pastePlainTextToCanvas = useCallback(
    (rawText: string) => {
      const normalized = rawText.replace(/\r\n?/g, '\n');
      if (normalized.trim().length === 0) return;

      const cursor = lastCursorPointRef.current;
      const targetPage =
        (cursor && pages.find((p) => p.id === cursor.pageId)) ?? activePage;
      if (!targetPage) return;

      const isShortSingleLine = !normalized.includes('\n') && normalized.length < 48;
      const wrapWidth = isShortSingleLine
        ? undefined
        : isWhiteboard
          ? 420
          : Math.min(480, Math.max(240, Math.round(targetPage.paper.width * 0.62)));

      let x: number;
      let y: number;
      if (cursor && cursor.pageId === targetPage.id) {
        x = cursor.x;
        y = cursor.y;
      } else {
        const { centerX, centerY } = getVisiblePageCenter(targetPage);
        x = Math.round(centerX - (wrapWidth ?? 160) / 2);
        y = Math.round(centerY - 24);
      }

      const prevPos = lastTextPastePosRef.current;
      if (
        prevPos &&
        prevPos.pageId === targetPage.id &&
        Math.abs(prevPos.x - x) <= 4 &&
        Math.abs(prevPos.y - y) <= 4
      ) {
        x += 18;
        y += 18;
      }

      if (!isWhiteboard) {
        const maxX = Math.max(24, targetPage.paper.width - (wrapWidth ?? 160) - 20);
        const maxY = Math.max(24, targetPage.paper.height - 60);
        x = Math.max(24, Math.min(maxX, x));
        y = Math.max(24, Math.min(maxY, y));
      }

      lastTextPastePosRef.current = { pageId: targetPage.id, x, y };

      const tb = spawnTextbox({
        pageId: targetPage.id,
        x,
        y,
        initialText: normalized,
        wrapWidth,
      });
      if (tb) {
        commitTextboxSession(targetPage.id, tb.id, true);
      }
    },
    [activePage, commitTextboxSession, getVisiblePageCenter, isWhiteboard, pages, spawnTextbox],
  );

  const handleInsertAiImageDataUrl = useCallback(
    async (dataUrl: string) => {
      if (!activePage) return;
      try {
        const { centerX, centerY } = getVisiblePageCenter(activePage);
        const baseMaxZ = (activePage.images ?? []).reduce(
          (m, im) => Math.max(m, im.zIndex),
          0,
        );
        const blob = await (await fetch(dataUrl)).blob();
        const processed = await processUploadedImage(blob);
        const placed = buildPlacedPageImage({
          dataUrl: processed.dataUrl,
          naturalWidth: processed.naturalWidth,
          naturalHeight: processed.naturalHeight,
          paper: activePage.paper,
          centerX,
          centerY,
          zIndex: baseMaxZ + 1,
          unbounded: isWhiteboard,
        });
        addPageImages(activePage.id, [placed]);
      } catch {
        // Ignore malformed/aborted generated image blobs
      }
    },
    [activePage, addPageImages, getVisiblePageCenter, isWhiteboard],
  );

  // Dismiss open context menu whenever page, tool, or undo/redo history changes
  useEffect(() => {
    setContextMenu(null);
  }, [activePageId, activeTool, undoStackLen, redoStackLen]);

  // Canva-style Keyboard Shortcuts & Instant Auto-Textbox Trigger
  useEffect(() => {
    const isEditableElement = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.closest('[role="dialog"]')) return true;
      const tag = target.tagName.toLowerCase();
      if (tag === 'input') {
        const type = (target as HTMLInputElement).type?.toLowerCase();
        return (
          type !== 'range' &&
          type !== 'color' &&
          type !== 'checkbox' &&
          type !== 'radio' &&
          type !== 'button' &&
          type !== 'file'
        );
      }
      return tag === 'textarea' || tag === 'select' || target.isContentEditable;
    };

    const isInsideAiSidebar = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement && Boolean(target.closest('[data-testid="ai-sidebar"]'));

    const anyModalOpen =
      customizeOpen ||
      saveTemplateOpen ||
      templatePickerOpen ||
      exportOpen ||
      printPreviewOpen ||
      settingsOpen ||
      shortcutsOpen;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      if (anyModalOpen) {
        if (e.key === 'Escape' && shortcutsOpen) {
          setShortcutsOpen(false);
        }
        return;
      }

      if (isEditableElement(e.target)) return;

      const mod = e.ctrlKey || e.metaKey;
      const sc = keyboardShortcuts;
      const canMatchKey = (combo: string): boolean => {
        if (!matchesShortcutEvent(e, combo)) return false;
        const parsed = parseShortcutCombo(combo);
        if (!parsed) return false;
        if (!parsed.mod && !parsed.alt && !/^F([1-9]|1[0-2])$/.test(parsed.key) && activeTextboxId) {
          return false;
        }
        return true;
      };

      // Progressive Escape: Context Menu -> Exit Text Edit -> Exit Image Crop -> Deselect -> Exit Zen -> Back to Home Shelf
      if (e.key === 'Escape') {
        if (contextMenu) {
          e.preventDefault();
          setContextMenu(null);
          return;
        }
        if (activeTextboxId && activePage) {
          e.preventDefault();
          commitTextboxSession(activePage.id, activeTextboxId, true);
          return;
        }
        if (croppingImageId) {
          e.preventDefault();
          setCroppingImageId(null);
          return;
        }
        if (
          selectedTextboxIds.length > 0 ||
          selectedImageIds.length > 0 ||
          lassoSelection
        ) {
          e.preventDefault();
          selectTextbox(null);
          selectImage(null);
          setLassoSelection(null);
          return;
        }
        if (zenMode) {
          e.preventDefault();
          setZenMode(false);
          return;
        }
        if (!closingViaEscRef.current) {
          e.preventDefault();
          closingViaEscRef.current = true;
          void closeNotebook().finally(() => {
            closingViaEscRef.current = false;
          });
        }
        return;
      }

      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && croppingImageId) {
        e.preventDefault();
        setCroppingImageId(null);
        return;
      }

      // Navigation & View shortcuts
      if (canMatchKey(sc.undo)) {
        e.preventDefault();
        undo();
        return;
      }
      if (
        canMatchKey(sc.redo) ||
        (sc.redo === DEFAULT_KEYBOARD_SHORTCUTS.redo &&
          !Object.values(sc).includes('Mod+Shift+z') &&
          matchesShortcutEvent(e, 'Mod+Shift+z'))
      ) {
        e.preventDefault();
        redo();
        return;
      }
      if (canMatchKey(sc.togglePagesDrawer)) {
        e.preventDefault();
        if (!isWhiteboard || useAppStore.getState().splitPane) {
          setDrawerOpen((o) => !o);
        }
        return;
      }
      if (canMatchKey(sc.exportNotebook)) {
        e.preventDefault();
        openExportModal();
        return;
      }
      if (canMatchKey(sc.printNotebook)) {
        e.preventDefault();
        setPrintPreviewOpen(true);
        return;
      }
      if (canMatchKey(sc.addPage)) {
        e.preventDefault();
        if (!isWhiteboard) {
          void handleQuickAddPage();
        }
        return;
      }
      if (canMatchKey(sc.fitView)) {
        e.preventDefault();
        if (isWhiteboard) {
          whiteboardRef.current?.fitContent();
        } else {
          handleFitWidth();
        }
        return;
      }
      if (canMatchKey(sc.canvasZoomReset)) {
        e.preventDefault();
        setZoom(1);
        return;
      }
      if (canMatchKey(sc.canvasZoomIn)) {
        e.preventDefault();
        const minZoom = isWhiteboard ? WHITEBOARD_MIN_ZOOM : getNotebookMinZoom(pages);
        const maxZoom = isWhiteboard ? WHITEBOARD_MAX_ZOOM : NOTEBOOK_MAX_ZOOM;
        setZoom(stepCanvasZoom(zoom, 1, minZoom, maxZoom));
        return;
      }
      if (canMatchKey(sc.canvasZoomOut)) {
        e.preventDefault();
        const minZoom = isWhiteboard ? WHITEBOARD_MIN_ZOOM : getNotebookMinZoom(pages);
        const maxZoom = isWhiteboard ? WHITEBOARD_MAX_ZOOM : NOTEBOOK_MAX_ZOOM;
        setZoom(stepCanvasZoom(zoom, -1, minZoom, maxZoom));
        return;
      }
      if (canMatchKey(sc.toggleAiSidebar)) {
        e.preventDefault();
        setAiSidebarOpen((o) => !o);
        return;
      }

      // Selection & Clipboard shortcuts (when activePage exists)
      if (activePage) {
        if (canMatchKey(sc.group)) {
          e.preventDefault();
          groupSelection(activePage.id);
          return;
        }
        if (canMatchKey(sc.ungroup)) {
          e.preventDefault();
          ungroupSelection(activePage.id);
          return;
        }
        if (canMatchKey(sc.selectAll)) {
          e.preventDefault();
          selectAllOnPage(activePage.id);
          return;
        }
        if (canMatchKey(sc.duplicate)) {
          e.preventDefault();
          duplicateSelection(activePage.id);
          return;
        }
        if (selectedTextboxIds.length > 0 && canMatchKey(sc.copyStyle)) {
          e.preventDefault();
          copyTextboxStyle(activePage.id, selectedTextboxIds[0]);
          return;
        }
        if (selectedTextboxIds.length > 0 && canMatchKey(sc.pasteStyle)) {
          e.preventDefault();
          pasteTextboxStyle(activePage.id, selectedTextboxIds);
          return;
        }
        if (canMatchKey(sc.copy)) {
          const domSelectedText = window.getSelection()?.toString() ?? '';
          const hasCanvasSel =
            selectedTextboxIds.length > 0 ||
            selectedImageIds.length > 0 ||
            (lassoSelection?.pageId === activePage.id && lassoSelection.strokeIds.length > 0);
          if (domSelectedText) {
            internalClipboardFreshRef.current = false;
            return;
          }
          if (hasCanvasSel) {
            e.preventDefault();
            copySelection(activePage.id);
            internalClipboardFreshRef.current = true;
            if (selectedTextboxIds.length > 0 && typeof navigator !== 'undefined') {
              const selectedTexts = (activePage.textboxes ?? [])
                .filter((t) => selectedTextboxIds.includes(t.id))
                .map((t) => t.text)
                .filter(Boolean)
                .join('\n');
              if (selectedTexts) {
                void navigator.clipboard?.writeText(selectedTexts)?.catch(() => {});
              }
            }
          }
          return;
        }
        if (canMatchKey(sc.cut)) {
          const domSelectedText = window.getSelection()?.toString() ?? '';
          const hasCanvasSel =
            selectedTextboxIds.length > 0 ||
            selectedImageIds.length > 0 ||
            (lassoSelection?.pageId === activePage.id && lassoSelection.strokeIds.length > 0);
          if (!domSelectedText && hasCanvasSel) {
            e.preventDefault();
            cutSelection(activePage.id);
            internalClipboardFreshRef.current = true;
          }
          return;
        }
        if (canMatchKey(sc.paste)) {
          const targetPageId = activePage.id;
          if (pasteFallbackTimerRef.current !== null) {
            window.clearTimeout(pasteFallbackTimerRef.current);
          }
          pasteFallbackTimerRef.current = window.setTimeout(() => {
            pasteFallbackTimerRef.current = null;
            if (performance.now() - lastHandledPasteAtRef.current < 80) return;
            if (internalClipboardFreshRef.current && useAppStore.getState().clipboard) {
              lastHandledPasteAtRef.current = performance.now();
              pasteSelection(targetPageId);
              return;
            }
            if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
              void navigator.clipboard
                .readText()
                .then((clipText) => {
                  if (performance.now() - lastHandledPasteAtRef.current < 80) return;
                  if (clipText && clipText.trim().length > 0) {
                    lastHandledPasteAtRef.current = performance.now();
                    pastePlainTextToCanvas(clipText);
                  } else if (useAppStore.getState().clipboard) {
                    lastHandledPasteAtRef.current = performance.now();
                    pasteSelection(targetPageId);
                  }
                })
                .catch(() => {});
            } else if (useAppStore.getState().clipboard) {
              lastHandledPasteAtRef.current = performance.now();
              pasteSelection(targetPageId);
            }
          }, 0);
          return;
        }

        // Formatting shortcuts when a textbox is selected (not actively editing)
        if (selectedTextboxIds.length > 0) {
          const primaryId = selectedTextboxIds[0];
          const primaryTb = (activePage.textboxes ?? []).find((t) => t.id === primaryId);
          if (primaryTb) {
            if (canMatchKey(sc.textBold)) {
              e.preventDefault();
              commitTextboxMutation(activePage.id, primaryId, { bold: !primaryTb.bold });
              return;
            }
            if (canMatchKey(sc.textItalic)) {
              e.preventDefault();
              commitTextboxMutation(activePage.id, primaryId, {
                italic: !primaryTb.italic,
              });
              return;
            }
            if (canMatchKey(sc.fontIncrease)) {
              e.preventDefault();
              commitTextboxMutation(activePage.id, primaryId, {
                fontSize: Math.min(MAX_TEXTBOX_FONT_SIZE, primaryTb.fontSize + 1),
              });
              return;
            }
            if (canMatchKey(sc.fontDecrease)) {
              e.preventDefault();
              commitTextboxMutation(activePage.id, primaryId, {
                fontSize: Math.max(MIN_TEXTBOX_FONT_SIZE, primaryTb.fontSize - 1),
              });
              return;
            }
          }
        }

        // Cycle textboxes (default Shift+Tab)
        if (
          (activePage.textboxes?.length ?? 0) > 0 &&
          canMatchKey(sc.cycleTextboxes)
        ) {
          e.preventDefault();
          cycleTextboxSelection(activePage.id, true);
          return;
        }

        // Arrow Nudging (1px / Shift+Arrow = 10px) & Delete Selection
        const hasSelection =
          selectedTextboxIds.length > 0 ||
          selectedImageIds.length > 0 ||
          (lassoSelection?.pageId === activePage.id &&
            lassoSelection.strokeIds.length > 0);
        if (hasSelection && !mod) {
          const step = e.shiftKey ? 10 : 1;
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            nudgeSelection(activePage.id, -step, 0);
            return;
          }
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            nudgeSelection(activePage.id, step, 0);
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            nudgeSelection(activePage.id, 0, -step);
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            nudgeSelection(activePage.id, 0, step);
            return;
          }
        }
        if (
          hasSelection &&
          (canMatchKey(sc.deleteSelection) ||
            (sc.deleteSelection === DEFAULT_KEYBOARD_SHORTCUTS.deleteSelection &&
              !Object.values(sc).includes('Backspace') &&
              matchesShortcutEvent(e, 'Backspace')))
        ) {
          e.preventDefault();
          deleteActiveSelection(activePage.id);
          return;
        }
      }

      // Avoid triggering canvas single-key shortcuts / printable auto-textbox when interacting inside AI sidebar
      if (isInsideAiSidebar(e.target)) return;

      // Toggle Zen Mode
      if (canMatchKey(sc.toggleZenMode)) {
        e.preventDefault();
        setZenMode((z) => !z);
        return;
      }

      // Keyboard Shortcuts modal
      if (canMatchKey(sc.showShortcuts)) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      // Favorite Ink Slots 1–5
      const inkSlotActions: ShortcutActionId[] = [
        'inkSlot1',
        'inkSlot2',
        'inkSlot3',
        'inkSlot4',
        'inkSlot5',
      ];
      for (let slotIdx = 0; slotIdx < inkSlotActions.length; slotIdx++) {
        if (canMatchKey(sc[inkSlotActions[slotIdx]])) {
          e.preventDefault();
          activatePenSlot(slotIdx);
          return;
        }
      }

      // Tool switches
      if (canMatchKey(sc.toolSelect)) {
        e.preventDefault();
        setActiveTool('pan');
        return;
      }
      if (canMatchKey(sc.toolPen)) {
        e.preventDefault();
        setActiveTool('pen');
        return;
      }
      if (canMatchKey(sc.toolHighlighter)) {
        e.preventDefault();
        setActiveTool('highlighter');
        return;
      }
      if (canMatchKey(sc.toolEraser)) {
        e.preventDefault();
        setActiveTool('eraser');
        return;
      }
      if (canMatchKey(sc.toolLasso)) {
        e.preventDefault();
        setActiveTool('lasso');
        return;
      }
      if (canMatchKey(sc.toolText)) {
        e.preventDefault();
        setActiveTool('text');
        return;
      }
      if (canMatchKey(sc.insertImage)) {
        e.preventDefault();
        openImagePicker();
        return;
      }

      // Hold Spacebar -> temporary Pan
      if (e.code === 'Space' && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }

      // Instant Auto-Textbox creation on any other printable character key
      if (!mod && !e.altKey && e.key.length === 1 && e.key !== ' ') {
        if (activeTextboxId) {
          const editingPage = pages.find((p) =>
            (p.textboxes ?? []).some((tb) => tb.id === activeTextboxId),
          );
          const activeTb = editingPage?.textboxes?.find((tb) => tb.id === activeTextboxId);
          if (editingPage && activeTb) {
            e.preventDefault();
            updateTextboxLive(editingPage.id, activeTb.id, {
              text: activeTb.text + e.key,
            });
            return;
          }
        }

        const cursor = lastCursorPointRef.current;
        const targetPage =
          (cursor && pages.find((p) => p.id === cursor.pageId)) ?? activePage;
        if (!targetPage) return;

        e.preventDefault();
        let spawnX = Math.round(targetPage.paper.width * 0.25);
        let spawnY = Math.round(targetPage.paper.height * 0.28);

        if (cursor && cursor.pageId === targetPage.id) {
          spawnX = cursor.x;
          spawnY = cursor.y;
        } else if (isWhiteboard && whiteboardRef.current) {
          const c = whiteboardRef.current.getVisibleWorldCenter();
          spawnX = Math.round(c.x);
          spawnY = Math.round(c.y);
        } else if (viewportRef.current) {
          const vpRect = viewportRef.current.getBoundingClientRect();
          const pageEl = viewportRef.current.querySelector<HTMLElement>(
            `[data-page-id="${targetPage.id}"]`,
          );
          if (pageEl) {
            const pRect = pageEl.getBoundingClientRect();
            const visibleCenterX = vpRect.left + vpRect.width / 2;
            const visibleCenterY = vpRect.top + vpRect.height / 2;
            spawnX = Math.max(
              24,
              Math.min(
                targetPage.paper.width - 120,
                ((visibleCenterX - pRect.left) / Math.max(1, pRect.width)) *
                  targetPage.paper.width,
              ),
            );
            spawnY = Math.max(
              24,
              Math.min(
                targetPage.paper.height - 60,
                ((visibleCenterY - pRect.top) / Math.max(1, pRect.height)) *
                  targetPage.paper.height,
              ),
            );
          }
        }

        spawnTextbox({
          pageId: targetPage.id,
          x: spawnX,
          y: spawnY,
          initialText: e.key,
        });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };

    const onWindowBlur = () => {
      setSpacePressed(false);
      internalClipboardFreshRef.current = false;
    };

    const onNativeCopy = () => {
      const domSelected = window.getSelection()?.toString() ?? '';
      if (domSelected) {
        internalClipboardFreshRef.current = false;
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      if (anyModalOpen || isEditableElement(e.target) || !activePage) return;

      const items = Array.from(e.clipboardData?.items ?? []);
      const imageBlobs: Blob[] = [];
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) imageBlobs.push(blob);
        }
      }
      if (imageBlobs.length === 0 && e.clipboardData?.files) {
        for (const f of Array.from(e.clipboardData.files)) {
          if (f.type.startsWith('image/')) imageBlobs.push(f);
        }
      }

      if (imageBlobs.length > 0) {
        lastHandledPasteAtRef.current = performance.now();
        e.preventDefault();
        void insertImageBlobs(imageBlobs);
        return;
      }

      if (internalClipboardFreshRef.current && useAppStore.getState().clipboard) {
        lastHandledPasteAtRef.current = performance.now();
        e.preventDefault();
        pasteSelection(activePage.id);
        return;
      }

      const rawText = e.clipboardData?.getData?.('text/plain') ?? '';
      if (rawText.trim().length > 0) {
        lastHandledPasteAtRef.current = performance.now();
        e.preventDefault();
        pastePlainTextToCanvas(rawText);
        return;
      }

      if (useAppStore.getState().clipboard) {
        lastHandledPasteAtRef.current = performance.now();
        e.preventDefault();
        pasteSelection(activePage.id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('copy', onNativeCopy);
    window.addEventListener('paste', onPaste);
    return () => {
      if (pasteFallbackTimerRef.current !== null) {
        window.clearTimeout(pasteFallbackTimerRef.current);
        pasteFallbackTimerRef.current = null;
      }
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('copy', onNativeCopy);
      window.removeEventListener('paste', onPaste);
    };
  }, [
    activePage,
    activeTextboxId,
    activatePenSlot,
    closeNotebook,
    commitTextboxMutation,
    commitTextboxSession,
    contextMenu,
    copySelection,
    copyTextboxStyle,
    croppingImageId,
    customizeOpen,
    cutSelection,
    cycleTextboxSelection,
    deleteActiveSelection,
    duplicateSelection,
    exportOpen,
    groupSelection,
    handleFitWidth,
    handleQuickAddPage,
    insertImageBlobs,
    isWhiteboard,
    keyboardShortcuts,
    lassoSelection,
    nudgeSelection,
    openImagePicker,
    pages,
    pastePlainTextToCanvas,
    pasteSelection,
    pasteTextboxStyle,
    printPreviewOpen,
    redo,
    saveTemplateOpen,
    selectAllOnPage,
    selectImage,
    selectTextbox,
    selectedImageIds,
    selectedTextboxIds,
    setActiveTool,
    setCroppingImageId,
    setLassoSelection,
    setZoom,
    settingsOpen,
    shortcutsOpen,
    spawnTextbox,
    templatePickerOpen,
    undo,
    ungroupSelection,
    updateTextboxLive,
    zenMode,
    zoom,
  ]);

  // Cursor-anchored Alt+Wheel, Trackpad pinch, and Smart / Canvas-Only Ctrl+Wheel zoom (standard notebook)
  const splitNotebookId = splitPane?.notebook.id ?? null;
  useEffect(() => {
    const attachWheel = (
      el: HTMLDivElement | null,
      paneSide: 'single' | 'left' | 'right',
    ): (() => void) | null => {
      if (!el) return null;
      const onWheel = (e: WheelEvent) => {
        const isAltScroll = e.altKey && !e.ctrlKey && !e.metaKey;
        const isCtrlOrMeta = e.ctrlKey || e.metaKey;
        const isTrackpadPinch =
          e.ctrlKey &&
          !e.metaKey &&
          e.deltaMode === 0 &&
          Math.abs(e.deltaY) > 0 &&
          Math.abs(e.deltaY) < 25;

        const shouldZoomCanvas =
          isAltScroll ||
          isTrackpadPinch ||
          (isCtrlOrMeta &&
            (ctrlScrollBehavior === 'smart' || ctrlScrollBehavior === 'paper-zoom'));

        if (!shouldZoomCanvas) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        if (e.deltaY === 0) return;

        const st = useAppStore.getState();
        if (paneSide !== 'single' && st.activePaneSide !== paneSide) {
          st.focusSplitPane(paneSide);
        }
        const postSt = useAppStore.getState();
        if (postSt.activeNotebook?.mode === 'whiteboard') return;

        const sensitivity = isTrackpadPinch ? 0.01 : 0.0018;
        const nextZoom = clampNotebookZoom(
          postSt.zoom * Math.exp(-e.deltaY * sensitivity),
          getNotebookMinZoom(postSt.pages),
        );

        const targetPageEl =
          (e.target instanceof HTMLElement
            ? e.target.closest<HTMLElement>('[data-page-id]')
            : null) ??
          (postSt.activePageId
            ? el.querySelector<HTMLElement>(`[data-page-id="${postSt.activePageId}"]`)
            : null);

        if (targetPageEl?.dataset.pageId) {
          const pRect = targetPageEl.getBoundingClientRect();
          if (pRect.width > 0 && pRect.height > 0) {
            pendingZoomAnchorRef.current = {
              pageId: targetPageEl.dataset.pageId,
              relX: (e.clientX - pRect.left) / pRect.width,
              relY: (e.clientY - pRect.top) / pRect.height,
              clientX: e.clientX,
              clientY: e.clientY,
            };
          }
        }

        setZoom(nextZoom);
      };

      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    };

    const cleanups: Array<() => void> = [];
    if (splitNotebookId) {
      const cL = attachWheel(leftViewportRef.current, 'left');
      const cR = attachWheel(rightViewportRef.current, 'right');
      if (cL) cleanups.push(cL);
      if (cR) cleanups.push(cR);
    } else if (!isWhiteboard) {
      const cS = attachWheel(viewportRef.current, 'single');
      if (cS) cleanups.push(cS);
    }
    return () => {
      for (const fn of cleanups) fn();
    };
  }, [ctrlScrollBehavior, isWhiteboard, setZoom, splitNotebookId]);

  // Synchronously preserve cursor point under zoomed page in standard notebooks
  useLayoutEffect(() => {
    if (isWhiteboard) {
      pendingZoomAnchorRef.current = null;
      return;
    }
    const anchor = pendingZoomAnchorRef.current;
    const container = getActiveViewportEl();
    if (!anchor || !container) return;
    pendingZoomAnchorRef.current = null;

    const pageEl = container.querySelector<HTMLElement>(
      `[data-page-id="${anchor.pageId}"]`,
    );
    if (!pageEl) return;
    const newRect = pageEl.getBoundingClientRect();
    if (newRect.width <= 0 || newRect.height <= 0) return;

    const targetClientX = newRect.left + anchor.relX * newRect.width;
    const targetClientY = newRect.top + anchor.relY * newRect.height;
    container.scrollLeft += targetClientX - anchor.clientX;
    container.scrollTop += targetClientY - anchor.clientY;
  }, [getActiveViewportEl, zoom, isWhiteboard]);

  useEffect(() => {
    return () => {
      middlePanCleanupRef.current?.();
    };
  }, []);

  const startMiddleButtonScrollPan = useCallback(
    (container: HTMLElement | null, pointerId: number, startX: number, startY: number) => {
      if (!container) return;
      middlePanCleanupRef.current?.();
      setIsMiddlePanning(true);

      const startScrollLeft = container.scrollLeft;
      const startScrollTop = container.scrollTop;

      const onWindowMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        container.scrollLeft = startScrollLeft - (ev.clientX - startX);
        container.scrollTop = startScrollTop - (ev.clientY - startY);
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onWindowMove);
        window.removeEventListener('pointerup', onWindowEnd);
        window.removeEventListener('pointercancel', onWindowEnd);
        window.removeEventListener('blur', onWindowBlur);
        middlePanCleanupRef.current = null;
        setIsMiddlePanning(false);
      };

      const onWindowEnd = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanup();
      };

      const onWindowBlur = () => {
        cleanup();
      };

      middlePanCleanupRef.current = cleanup;
      window.addEventListener('pointermove', onWindowMove);
      window.addEventListener('pointerup', onWindowEnd);
      window.addEventListener('pointercancel', onWindowEnd);
      window.addEventListener('blur', onWindowBlur);
    },
    [],
  );

  const handleViewportMouseDownCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  };

  const handleViewportAuxClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  };

  const handleViewportPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 1) return;
    if (document.activeElement instanceof HTMLButtonElement) {
      document.activeElement.blur();
    }
    e.preventDefault();
    e.stopPropagation();
    startMiddleButtonScrollPan(e.currentTarget, e.pointerId, e.clientX, e.clientY);
  };

  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (document.activeElement instanceof HTMLButtonElement) {
      document.activeElement.blur();
    }
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      startMiddleButtonScrollPan(e.currentTarget, e.pointerId, e.clientX, e.clientY);
      return;
    }
    // Space+Drag pans; clicking directly on the desk outside a page deselects
    if (!spacePressed) {
      if (e.button === 0 && !(e.target as HTMLElement)?.closest?.('[data-page-id]')) {
        clearSelection();
      }
      return;
    }

    const container = e.currentTarget;
    if (!container) return;

    e.preventDefault();
    container.setPointerCapture(e.pointerId);
    panDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    };
  };

  const handleViewportPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current;
    const container = e.currentTarget;
    if (!drag || !container || drag.pointerId !== e.pointerId) return;

    container.scrollLeft = drag.scrollLeft - (e.clientX - drag.startX);
    container.scrollTop = drag.scrollTop - (e.clientY - drag.startY);
  };

  const handleViewportPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (panDragRef.current?.pointerId === e.pointerId) {
      panDragRef.current = null;
    }
  };

  const handleViewportScrollFor = useCallback(
    (
      container: HTMLElement | null,
      panePages: Page[],
      currentPageId: string | null,
      onChangePageId: (pageId: string) => void,
    ) => {
      if (!container || panePages.length <= 1) return;
      const containerRect = container.getBoundingClientRect();
      const midY = containerRect.top + containerRect.height * 0.45;

      let closestId: string | null = null;
      let closestDist = Infinity;
      const pageEls = container.querySelectorAll<HTMLElement>('[data-page-id]');
      pageEls.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const dist = Math.abs(center - midY);
        if (dist < closestDist) {
          closestDist = dist;
          closestId = el.dataset.pageId ?? null;
        }
      });

      if (closestId && closestId !== currentPageId) {
        onChangePageId(closestId);
      }
    },
    [],
  );

  if (!activeNotebook) return null;

  interface EditorPaneDescriptor {
    side: 'left' | 'right';
    isFocused: boolean;
    notebook: Notebook;
    pages: Page[];
    activePageId: string | null;
    zoom: number;
    masterKey: CryptoKey | null;
    vpRef: React.RefObject<HTMLDivElement | null>;
  }

  const splitPanesList: EditorPaneDescriptor[] | null = splitPane
    ? (['left', 'right'] as const).map((side) => {
        const isFocused = activePaneSide === side;
        return isFocused
          ? {
              side,
              isFocused: true,
              notebook: activeNotebook,
              pages,
              activePageId,
              zoom,
              masterKey: unlockedMasterKey,
              vpRef: side === 'left' ? leftViewportRef : rightViewportRef,
            }
          : {
              side,
              isFocused: false,
              notebook: splitPane.notebook,
              pages: splitPane.pages,
              activePageId: splitPane.activePageId,
              zoom: splitPane.zoom,
              masterKey: splitPane.unlockedMasterKey,
              vpRef: side === 'left' ? leftViewportRef : rightViewportRef,
            };
      })
    : null;

  const renderSplitPane = (pane: EditorPaneDescriptor) => {
    const paneIsWb = pane.notebook.mode === 'whiteboard';
    const panePageIdx = Math.max(
      0,
      pane.pages.findIndex((p) => p.id === pane.activePageId),
    );
    const paneActivePage = pane.pages[panePageIdx] ?? pane.pages[0] ?? null;

    return (
      <div
        key={pane.notebook.id}
        data-testid={`split-pane-${pane.side}`}
        data-focused={pane.isFocused ? 'true' : 'false'}
        data-notebook-id={pane.notebook.id}
        onPointerDownCapture={() => {
          if (useAppStore.getState().activePaneSide !== pane.side) {
            focusSplitPane(pane.side);
          }
        }}
        className={`relative flex min-w-0 flex-1 flex-col overflow-hidden ${
          pane.side === 'left' ? 'border-r border-[var(--border-strong)]/40' : ''
        }`}
      >
        {!zenMode && (
          <div
            className={`pointer-events-none absolute inset-x-3 z-20 flex justify-center ${
              dockPosition === 'top' ? 'top-[164px]' : 'top-[110px]'
            }`}
          >
            <div
              data-testid={`split-pane-badge-${pane.side}`}
              className={`folio-glass-island pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                pane.isFocused
                  ? 'ring-1.5 ring-[var(--crimson-500)]/65 text-[var(--navy-900)]'
                  : 'opacity-85 text-[var(--navy-700)] hover:opacity-100'
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${
                  pane.isFocused ? 'bg-[var(--crimson-500)]' : 'bg-[var(--navy-400)]'
                }`}
              />
              <span className="max-w-[160px] truncate font-bold">{pane.notebook.title}</span>
              <span className="text-[11px] font-medium text-[var(--navy-600)] tabular-nums">
                {paneIsWb ? 'Board' : `Page ${panePageIdx + 1}/${pane.pages.length}`}
              </span>
              <button
                type="button"
                data-testid={`split-pane-close-${pane.side}`}
                aria-label={`Close ${pane.notebook.title} from split view`}
                title="Close split pane"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeSplitPane(pane.side);
                }}
                className="folio-press ml-0.5 rounded-full p-0.5 text-[var(--navy-600)] hover:bg-[var(--state-danger-bg)] hover:text-[var(--state-danger-text)]"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {paneIsWb && paneActivePage ? (
          <WhiteboardCanvas
            ref={pane.isFocused ? whiteboardRef : companionWhiteboardRef}
            page={paneActivePage}
            spacePressed={spacePressed}
            zoomOverride={pane.zoom}
            masterKeyOverride={pane.masterKey}
            isFocusedPane={pane.isFocused}
            viewportTestId={
              pane.isFocused ? 'editor-canvas-viewport' : `split-pane-viewport-${pane.side}`
            }
            onFocusPage={(pageId) =>
              pane.isFocused ? setActivePageId(pageId) : setSplitPaneActivePageId(pageId)
            }
            onRecordCursorPoint={(pageId, x, y) => {
              lastCursorPointRef.current = { pageId, x, y };
            }}
            onContextMenuRequest={setContextMenu}
            onRightClickLassoChange={setRightClickLassoActive}
          />
        ) : (
          <main
            ref={pane.vpRef}
            data-testid={
              pane.isFocused ? 'editor-canvas-viewport' : `split-pane-viewport-${pane.side}`
            }
            data-panning={isMiddlePanning ? 'true' : 'false'}
            onScroll={(e) =>
              handleViewportScrollFor(
                e.currentTarget,
                pane.pages,
                pane.activePageId,
                pane.isFocused ? setActivePageId : setSplitPaneActivePageId,
              )
            }
            onMouseDownCapture={handleViewportMouseDownCapture}
            onAuxClickCapture={handleViewportAuxClickCapture}
            onAuxClick={handleViewportAuxClickCapture}
            onPointerDownCapture={handleViewportPointerDownCapture}
            onPointerDown={handleViewportPointerDown}
            onPointerMove={handleViewportPointerMove}
            onPointerUp={handleViewportPointerUp}
            onPointerCancel={handleViewportPointerUp}
            onDragOver={(e) => {
              if (e.dataTransfer?.types?.includes('Files')) {
                e.preventDefault();
              }
            }}
            onDrop={(e) => {
              if (e.dataTransfer?.types?.includes('Files')) {
                e.preventDefault();
                if (!pane.isFocused) {
                  focusSplitPane(pane.side);
                }
                const pdfs = Array.from(e.dataTransfer.files ?? []).filter(isPdfFile);
                if (pdfs.length > 0) {
                  void handleImportPdfFiles(pdfs);
                }
              }
            }}
            className={`custom-scrollbar relative flex-1 overflow-auto px-4 pb-24 sm:px-6 ${
              zenMode
                ? 'pt-6 sm:pt-10'
                : dockPosition === 'top'
                  ? 'pt-[204px] sm:pt-[208px]'
                  : 'pt-[148px] sm:pt-[152px]'
            } ${
              isMiddlePanning
                ? 'cursor-grabbing'
                : spacePressed
                  ? 'cursor-grab active:cursor-grabbing'
                  : ''
            }`}
          >
            <div className="mx-auto flex w-fit min-w-full flex-col items-center gap-8 pb-24">
              {pane.pages.map((page, index) => (
                <PageCanvas
                  key={page.id}
                  page={page}
                  pageNumber={index + 1}
                  totalPages={pane.pages.length}
                  zoom={pane.zoom}
                  spacePressed={spacePressed}
                  isPanning={isMiddlePanning}
                  masterKeyOverride={pane.masterKey}
                  onFocusPage={(pageId) =>
                    pane.isFocused ? setActivePageId(pageId) : setSplitPaneActivePageId(pageId)
                  }
                  onRecordCursorPoint={(pageId, x, y) => {
                    lastCursorPointRef.current = { pageId, x, y };
                  }}
                  onContextMenuRequest={setContextMenu}
                  onRightClickLassoChange={setRightClickLassoActive}
                />
              ))}
            </div>
          </main>
        )}
      </div>
    );
  };

  const deskClass =
    deskBackdrop === 'cool-gray'
      ? 'bg-slate-200/80'
      : deskBackdrop === 'dot-mat'
        ? 'folio-desk-dotmat'
        : '';

  const deskStyle: React.CSSProperties | undefined =
    deskBackdrop === 'seal-mist'
      ? { backgroundColor: '#EBF4FA' }
      : deskBackdrop === 'midnight-navy'
        ? { backgroundColor: '#0F1D32' }
        : deskBackdrop === 'warm-linen'
          ? { backgroundColor: '#F4EFE6' }
          : deskBackdrop === 'custom'
            ? { backgroundColor: deskCustomColor }
            : undefined;

  return (
    <div
      data-testid="notebook-editor-root"
      data-desk-backdrop={deskBackdrop}
      data-zen-mode={zenMode ? 'true' : 'false'}
      style={deskStyle}
      className={`relative flex h-full flex-col overflow-hidden transition-colors duration-200 ${deskClass}`}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!zenMode && (!isWhiteboard || Boolean(splitPane)) && (
          <PagesDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            onSelectPage={(pageId) => scrollToPage(pageId)}
            onOpenTemplatePicker={() => setTemplatePickerOpen(true)}
            onImportPdfFiles={(files) => void handleImportPdfFiles(files)}
            onImportPdfClick={() => pdfFileInputRef.current?.click()}
          />
        )}

        {/* Canvas Workspace + Detached Floating Glass Top Islands */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {!zenMode && (
            <div
              data-testid="editor-floating-chrome"
              className="pointer-events-none absolute inset-x-2.5 top-3 z-30 flex flex-col items-center gap-2 sm:inset-x-4"
            >
              <TopHeaderBar
                isWhiteboard={isWhiteboard}
                drawerOpen={drawerOpen}
                onToggleDrawer={() => setDrawerOpen((o) => !o)}
                aiSidebarOpen={aiSidebarOpen}
                onToggleAiSidebar={() => setAiSidebarOpen((o) => !o)}
                onQuickAddPage={() => void handleQuickAddPage()}
                onOpenTemplatePicker={() => setTemplatePickerOpen(true)}
                onImportPdfPages={() => pdfFileInputRef.current?.click()}
                onOpenCustomizePaper={() => setCustomizeOpen(true)}
                onOpenSaveTemplate={() => setSaveTemplateOpen(true)}
                onOpenExport={openExportModal}
                onPrint={() => setPrintPreviewOpen(true)}
                onOpenSettings={() => {
                  setSettingsTab('general');
                  setSettingsOpen(true);
                }}
                onOpenShortcuts={() => setShortcutsOpen(true)}
              />

              <ContextualSubBar
                activePage={activePage}
                onLassoAiAction={handleLassoAiAction}
                onTidyHandwritingAi={() => void handleTidySelectedHandwriting()}
                tidyingHandwriting={tidyingHandwriting}
              />
            </div>
          )}

          {/* Split-Screen Side-by-Side Workspace OR Infinite Whiteboard OR Scrollable Single Notebook */}
          {splitPanesList ? (
            <div
              data-testid="split-editor-container"
              className="flex min-h-0 flex-1 overflow-hidden"
            >
              {splitPanesList.map((pane) => renderSplitPane(pane))}
            </div>
          ) : isWhiteboard && activePage ? (
            <WhiteboardCanvas
              ref={whiteboardRef}
              page={activePage}
              spacePressed={spacePressed}
              onFocusPage={setActivePageId}
              onRecordCursorPoint={(pageId, x, y) => {
                lastCursorPointRef.current = { pageId, x, y };
              }}
              onContextMenuRequest={setContextMenu}
              onRightClickLassoChange={setRightClickLassoActive}
            />
          ) : (
            <main
              ref={viewportRef}
              data-testid="editor-canvas-viewport"
              data-panning={isMiddlePanning ? 'true' : 'false'}
              onScroll={(e) =>
                handleViewportScrollFor(
                  e.currentTarget,
                  pages,
                  activePageId,
                  setActivePageId,
                )
              }
              onMouseDownCapture={handleViewportMouseDownCapture}
              onAuxClickCapture={handleViewportAuxClickCapture}
              onAuxClick={handleViewportAuxClickCapture}
              onPointerDownCapture={handleViewportPointerDownCapture}
              onPointerDown={handleViewportPointerDown}
              onPointerMove={handleViewportPointerMove}
              onPointerUp={handleViewportPointerUp}
              onPointerCancel={handleViewportPointerUp}
              onDragOver={(e) => {
                if (e.dataTransfer?.types?.includes('Files')) {
                  e.preventDefault();
                }
              }}
              onDrop={(e) => {
                if (e.dataTransfer?.types?.includes('Files')) {
                  e.preventDefault();
                  const pdfs = Array.from(e.dataTransfer.files ?? []).filter(isPdfFile);
                  if (pdfs.length > 0) {
                    void handleImportPdfFiles(pdfs);
                  }
                }
              }}
              className={`custom-scrollbar relative flex-1 overflow-auto px-6 pb-24 sm:px-10 ${
                zenMode
                  ? 'pt-6 sm:pt-10'
                  : dockPosition === 'top'
                    ? 'pt-[176px] sm:pt-[180px]'
                    : 'pt-[118px] sm:pt-[124px]'
              } ${
                isMiddlePanning
                  ? 'cursor-grabbing'
                  : spacePressed
                    ? 'cursor-grab active:cursor-grabbing'
                    : ''
              }`}
            >
              <div className="mx-auto flex w-fit min-w-full flex-col items-center gap-8 pb-24">
                {pages.map((page, index) => (
                  <PageCanvas
                    key={page.id}
                    page={page}
                    pageNumber={index + 1}
                    totalPages={pages.length}
                    zoom={zoom}
                    spacePressed={spacePressed}
                    isPanning={isMiddlePanning}
                    onFocusPage={setActivePageId}
                    onRecordCursorPoint={(pageId, x, y) => {
                      lastCursorPointRef.current = { pageId, x, y };
                    }}
                    onContextMenuRequest={setContextMenu}
                    onRightClickLassoChange={setRightClickLassoActive}
                  />
                ))}
              </div>
            </main>
          )}
        </div>

        {!zenMode && (
          <AiSidebar
            open={aiSidebarOpen}
            activePage={activePage}
            activePageIndex={activePageIndex}
            pages={pages}
            getVisibleRect={() => (activePage ? getVisiblePageRect(activePage) : null)}
            pendingLassoAction={pendingLassoAiAction}
            onConsumePendingLassoAction={() => setPendingLassoAiAction(null)}
            onTidyHandwritingAi={() => void handleTidySelectedHandwriting()}
            tidyingHandwriting={tidyingHandwriting}
            onInsertTextbox={handleInsertAiTextbox}
            onInsertImageDataUrl={handleInsertAiImageDataUrl}
            onOpenSettings={() => {
              setSettingsTab('ai');
              setSettingsOpen(true);
            }}
            onClose={() => setAiSidebarOpen(false)}
          />
        )}
      </div>

      {/* Zone 3: Floating Movable Tool Dock & Bottom-Right Zoom Pill */}
      {!zenMode && (
        <BottomDocks
          isWhiteboard={isWhiteboard}
          pageIndex={activePageIndex}
          totalPages={pages.length}
          spacePressed={spacePressed}
          rightClickLassoActive={rightClickLassoActive}
          drawerOpen={drawerOpen}
          aiSidebarOpen={aiSidebarOpen}
          onPrevPage={() => {
            const prev = pages[activePageIndex - 1];
            if (prev) scrollToPage(prev.id);
          }}
          onNextPage={() => {
            const next = pages[activePageIndex + 1];
            if (next) scrollToPage(next.id);
          }}
          onFitWidth={handleFitWidth}
          onFitContent={() => whiteboardRef.current?.fitContent()}
          onResetView={() => whiteboardRef.current?.resetView()}
          onInsertImage={openImagePicker}
        />
      )}

      {/* Subtle Zen Mode Exit Pill */}
      {zenMode && (
        <button
          type="button"
          data-testid="zen-mode-pill"
          onClick={() => setZenMode(false)}
          className="folio-mono folio-glass-surface folio-press fixed bottom-4 right-4 z-40 rounded-full px-3.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-seal)]"
        >
          Press <kbd className="folio-glass-badge mx-0.5 rounded px-1.5 py-0.5 text-[10px]">{formatShortcutDisplay(keyboardShortcuts.toggleZenMode)}</kbd> to exit Zen Mode
        </button>
      )}

      {/* Hidden Multi-File Photo Input */}
      <input
        ref={imageFileInputRef}
        data-testid="image-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) {
            void insertImageBlobs(files);
          }
        }}
        className="hidden"
      />

      {/* Hidden Multi-File PDF Input */}
      <input
        ref={pdfFileInputRef}
        data-testid="editor-pdf-file-input"
        type="file"
        accept=".pdf,application/pdf"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) {
            void handleImportPdfFiles(files);
          }
        }}
        className="hidden"
      />

      {/* PDF Error Toast */}
      {pdfErrorToast && (
        <div
          data-testid="pdf-import-error-toast"
          className="folio-badge-danger fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-[var(--surface-elevated)] px-4 py-1.5 text-xs font-semibold shadow-[var(--shadow-floating)] backdrop-blur-md"
        >
          <span>{pdfErrorToast}</span>
          <button
            type="button"
            aria-label="Dismiss PDF error"
            onClick={() => setPdfErrorToast(null)}
            className="folio-press rounded-full px-1.5 py-0.5 text-[10px] font-bold text-[var(--navy-600)] hover:bg-[var(--surface-tint)]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Right-Click Context Menu */}
      <CanvasContextMenu
        menu={contextMenu}
        onLassoAiAction={handleLassoAiAction}
        onTidyHandwritingAi={() => void handleTidySelectedHandwriting()}
        onClose={() => setContextMenu(null)}
      />

      {/* Editor Action / Delete Undo Toast */}
      {editorToast && (
        <div
          data-testid="editor-toast"
          className={`fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-full px-4 py-1.5 text-xs font-semibold shadow-[var(--shadow-floating)] backdrop-blur-md ${
            editorToast.tone === 'crimson'
              ? 'border border-[var(--crimson-border)] bg-[var(--surface-elevated)] text-[var(--crimson-600)]'
              : 'folio-glass-badge'
          }`}
        >
          <span>{editorToast.message}</span>
          {editorToast.actionLabel && editorToast.actionTab && (
            <button
              type="button"
              data-testid="editor-toast-action-btn"
              onClick={() => {
                setSettingsTab(editorToast.actionTab!);
                setSettingsOpen(true);
                showEditorToast(null);
              }}
              className="folio-btn-crimson rounded-full px-2.5 py-0.5 text-[11px] font-bold"
            >
              {editorToast.actionLabel}
            </button>
          )}
        </div>
      )}

      {/* Subtle Handwriting Tidied Pill */}
      {handwritingTidyToast && (
        <div
          data-testid="handwriting-tidied-toast"
          className={`pointer-events-none fixed ${
            editorToast ? 'bottom-32' : 'bottom-20'
          } folio-glass-badge left-1/2 z-40 -translate-x-1/2 rounded-full px-3.5 py-1.5 text-xs font-semibold`}
        >
          {handwritingTidyToast}
        </div>
      )}

      {/* Modals */}
      <CustomizePaperModal
        open={customizeOpen}
        isWhiteboard={isWhiteboard}
        pageId={activePage?.id ?? null}
        initialPaper={activePage?.paper ?? activeNotebook.defaultPaper}
        onClose={() => setCustomizeOpen(false)}
      />

      <SaveTemplateModal
        open={saveTemplateOpen}
        page={activePage}
        onClose={() => setSaveTemplateOpen(false)}
      />

      <TemplatePickerModal
        open={templatePickerOpen}
        currentPaper={activePage?.paper ?? activeNotebook.defaultPaper}
        onSelect={async (paper, strokes, textboxes, images) => {
          const created = await addPageFromTemplate(
            paper,
            strokes,
            activePage?.id,
            textboxes,
            images,
          );
          if (created) {
            requestAnimationFrame(() => scrollToPage(created.id));
          }
        }}
        onClose={() => setTemplatePickerOpen(false)}
      />

      <ExportModal
        open={exportOpen}
        notebook={activeNotebook}
        pages={pages}
        currentPageIndex={activePageIndex}
        visibleRegion={exportVisibleRegion}
        masterKey={unlockedMasterKey}
        onClose={() => setExportOpen(false)}
      />

      <PrintPreviewModal
        open={printPreviewOpen}
        notebook={activeNotebook}
        pages={pages}
        currentPageIndex={activePageIndex}
        masterKey={unlockedMasterKey}
        onClose={() => setPrintPreviewOpen(false)}
      />

      <SettingsModal
        open={settingsOpen}
        initialTab={settingsTab}
        onClose={() => setSettingsOpen(false)}
      />

      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
};
