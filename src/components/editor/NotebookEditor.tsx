import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PAPER_CONFIG } from '../../constants/papers';
import { useAppStore } from '../../store/useAppStore';
import type { Page, PageImage } from '../../types/notes';
import {
  buildPlacedPageImage,
  processUploadedImage,
} from '../../utils/imageImport';
import { isPdfFile } from '../../utils/pdfEngine';
import { CustomizePaperModal } from '../modals/CustomizePaperModal';
import { ExportModal } from '../modals/ExportModal';
import { KeyboardShortcutsModal } from '../modals/KeyboardShortcutsModal';
import { SaveTemplateModal } from '../modals/SaveTemplateModal';
import { SettingsModal, type SettingsTabId } from '../modals/SettingsModal';
import { TemplatePickerModal } from '../modals/TemplatePickerModal';
import type { SnapshotCropRect } from '../../ai/pageSnapshot';
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

export const NotebookEditor: React.FC = () => {
  const activeNotebook = useAppStore((s) => s.activeNotebook);
  const pages = useAppStore((s) => s.pages);
  const activePageId = useAppStore((s) => s.activePageId);
  const unlockedMasterKey = useAppStore((s) => s.unlockedMasterKey);
  const activeTool = useAppStore((s) => s.activeTool);
  const zoom = useAppStore((s) => s.zoom);
  const handwritingTidyToast = useAppStore((s) => s.handwritingTidyToast);
  const activeTextboxId = useAppStore((s) => s.activeTextboxId);
  const selectedTextboxIds = useAppStore((s) => s.selectedTextboxIds);
  const selectedImageIds = useAppStore((s) => s.selectedImageIds);
  const croppingImageId = useAppStore((s) => s.croppingImageId);
  const lassoSelection = useAppStore((s) => s.lassoSelection);

  const setActivePageId = useAppStore((s) => s.setActivePageId);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('general');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [pdfErrorToast, setPdfErrorToast] = useState<string | null>(null);
  const [aiSidebarOpen, setAiSidebarOpen] = useState(false);
  const [pendingLassoAiAction, setPendingLassoAiAction] =
    useState<PendingLassoAiAction | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const pdfFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastCursorPointRef = useRef<{ pageId: string; x: number; y: number } | null>(null);
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
      const container = viewportRef.current;
      if (!container) return;
      const el = container.querySelector<HTMLElement>(`[data-page-id="${pageId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [setActivePageId],
  );

  const handleFitWidth = useCallback(() => {
    const container = viewportRef.current;
    if (!container || !activePage) return;
    const available = Math.max(300, container.clientWidth - 64);
    setZoom(available / activePage.paper.width);
  }, [activePage, setZoom]);

  // Apply preferred default zoom mode when opening a notebook
  const appliedInitialZoomForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeNotebook) {
      appliedInitialZoomForRef.current = null;
      return;
    }
    if (appliedInitialZoomForRef.current === activeNotebook.id) return;
    appliedInitialZoomForRef.current = activeNotebook.id;
    if (defaultZoomMode === 'fit-width') {
      requestAnimationFrame(() => handleFitWidth());
    } else {
      setZoom(1);
    }
  }, [activeNotebook?.id, defaultZoomMode, handleFitWidth, setZoom]);

  const handleQuickAddPage = useCallback(async () => {
    const basePaper =
      activePage?.paper ?? activeNotebook?.defaultPaper ?? DEFAULT_PAPER_CONFIG;
    const created = await addPageFromTemplate(basePaper, [], activePage?.id);
    if (created) {
      requestAnimationFrame(() => scrollToPage(created.id));
    }
  }, [activeNotebook?.defaultPaper, activePage?.id, activePage?.paper, addPageFromTemplate, scrollToPage]);

  const getVisiblePageCenter = useCallback((targetPage: Page) => {
    let centerX = targetPage.paper.width / 2;
    let centerY = targetPage.paper.height / 2;
    const container = viewportRef.current;
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
  }, []);

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
    [activePage, addPageImages, getVisiblePageCenter],
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

  const handleInsertAiTextbox = useCallback(
    (text: string, nearRect?: SnapshotCropRect) => {
      if (!activePage || !text.trim()) return;
      const { centerX, centerY } = getVisiblePageCenter(activePage);
      const wrapWidth = Math.min(480, Math.max(220, Math.round(activePage.paper.width * 0.62)));
      const x = nearRect
        ? Math.max(24, Math.min(activePage.paper.width - wrapWidth - 20, nearRect.x))
        : Math.max(24, Math.min(activePage.paper.width - wrapWidth - 20, centerX - wrapWidth / 2));
      const y = nearRect
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
    [activePage, commitTextboxSession, getVisiblePageCenter, spawnTextbox],
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
        });
        addPageImages(activePage.id, [placed]);
      } catch {
        // Ignore malformed/aborted generated image blobs
      }
    },
    [activePage, addPageImages, getVisiblePageCenter],
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
      settingsOpen ||
      shortcutsOpen;

    const onKeyDown = (e: KeyboardEvent) => {
      if (anyModalOpen) {
        if (e.key === 'Escape' && shortcutsOpen) {
          setShortcutsOpen(false);
        }
        return;
      }

      if (isEditableElement(e.target)) return;

      const mod = e.ctrlKey || e.metaKey;
      const keyLower = e.key.toLowerCase();

      // Progressive Escape: Context Menu -> Exit Text Edit -> Exit Image Crop -> Deselect
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
        return;
      }

      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && croppingImageId) {
        e.preventDefault();
        setCroppingImageId(null);
        return;
      }

      // Navigation & View shortcuts
      if (mod && keyLower === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && keyLower === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key === '/') {
        e.preventDefault();
        setDrawerOpen((o) => !o);
        return;
      }
      if (mod && keyLower === 'e') {
        e.preventDefault();
        setExportOpen(true);
        return;
      }
      if (mod && keyLower === 'p') {
        e.preventDefault();
        window.print();
        return;
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        void handleQuickAddPage();
        return;
      }
      if (mod && e.altKey && e.key === '0') {
        e.preventDefault();
        handleFitWidth();
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        setZoom(1);
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setZoom(zoom + 0.15);
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        setZoom(zoom - 0.15);
        return;
      }

      // Gemini AI Sidebar toggle (Ctrl/Cmd + Shift + A) before Select All
      if (mod && e.shiftKey && keyLower === 'a') {
        e.preventDefault();
        setAiSidebarOpen((o) => !o);
        return;
      }

      // Selection & Clipboard shortcuts (when activePage exists)
      if (activePage) {
        if (mod && !e.shiftKey && keyLower === 'g') {
          e.preventDefault();
          groupSelection(activePage.id);
          return;
        }
        if (mod && e.shiftKey && keyLower === 'g') {
          e.preventDefault();
          ungroupSelection(activePage.id);
          return;
        }
        if (mod && !e.shiftKey && keyLower === 'a') {
          e.preventDefault();
          selectAllOnPage(activePage.id);
          return;
        }
        if (mod && keyLower === 'd') {
          e.preventDefault();
          duplicateSelection(activePage.id);
          return;
        }
        if (mod && e.altKey && keyLower === 'c' && selectedTextboxIds.length > 0) {
          e.preventDefault();
          copyTextboxStyle(activePage.id, selectedTextboxIds[0]);
          return;
        }
        if (mod && e.altKey && keyLower === 'v' && selectedTextboxIds.length > 0) {
          e.preventDefault();
          pasteTextboxStyle(activePage.id, selectedTextboxIds);
          return;
        }
        if (mod && keyLower === 'c') {
          e.preventDefault();
          copySelection(activePage.id);
          return;
        }
        if (mod && keyLower === 'x') {
          e.preventDefault();
          cutSelection(activePage.id);
          return;
        }

        // Formatting shortcuts when a textbox is selected (not actively editing)
        if (selectedTextboxIds.length > 0) {
          const primaryId = selectedTextboxIds[0];
          const primaryTb = (activePage.textboxes ?? []).find((t) => t.id === primaryId);
          if (primaryTb) {
            if (mod && keyLower === 'b') {
              e.preventDefault();
              commitTextboxMutation(activePage.id, primaryId, { bold: !primaryTb.bold });
              return;
            }
            if (mod && keyLower === 'i') {
              e.preventDefault();
              commitTextboxMutation(activePage.id, primaryId, {
                italic: !primaryTb.italic,
              });
              return;
            }
            if (mod && e.shiftKey && (e.key === '>' || e.key === '.')) {
              e.preventDefault();
              commitTextboxMutation(activePage.id, primaryId, {
                fontSize: Math.min(96, primaryTb.fontSize + 1),
              });
              return;
            }
            if (mod && e.shiftKey && (e.key === '<' || e.key === ',')) {
              e.preventDefault();
              commitTextboxMutation(activePage.id, primaryId, {
                fontSize: Math.max(10, primaryTb.fontSize - 1),
              });
              return;
            }
          }
        }

        // Tab toggles Zen Mode (Shift+Tab cycles textboxes)
        if (e.key === 'Tab' && !mod && !e.altKey) {
          if (e.shiftKey && (activePage.textboxes?.length ?? 0) > 0) {
            e.preventDefault();
            cycleTextboxSelection(activePage.id, true);
            return;
          }
          if (!e.shiftKey && !activeTextboxId) {
            e.preventDefault();
            setZenMode((z) => !z);
            return;
          }
        }

        // Arrow Nudging (1px / Shift+Arrow = 10px)
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
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            deleteActiveSelection(activePage.id);
            return;
          }
        }
      }

      // Avoid triggering canvas single-key shortcuts / printable auto-textbox when interacting inside AI sidebar
      if (isInsideAiSidebar(e.target)) return;

      // Hold Spacebar -> temporary Pan
      if (e.code === 'Space') {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }

      // Keyboard Shortcuts modal (?)
      if (!mod && !e.altKey && e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      // Single-key tool switches (V, P, H, E, L, T) & Favorite Ink Slots (1–5) when no modifiers
      if (!mod && !e.altKey && !e.shiftKey) {
        if (!activeTextboxId && ['1', '2', '3', '4', '5'].includes(e.key)) {
          e.preventDefault();
          activatePenSlot(Number(e.key) - 1);
          return;
        }
        if (keyLower === 'v') {
          e.preventDefault();
          setActiveTool('pan');
          return;
        }
        if (keyLower === 'p') {
          e.preventDefault();
          setActiveTool('pen');
          return;
        }
        if (keyLower === 'h') {
          e.preventDefault();
          setActiveTool('highlighter');
          return;
        }
        if (keyLower === 'e') {
          e.preventDefault();
          setActiveTool('eraser');
          return;
        }
        if (keyLower === 'l') {
          e.preventDefault();
          setActiveTool('lasso');
          return;
        }
        if (keyLower === 't') {
          e.preventDefault();
          setActiveTool('text');
          return;
        }
        if (keyLower === 'i') {
          e.preventDefault();
          openImagePicker();
          return;
        }
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
        e.preventDefault();
        void insertImageBlobs(imageBlobs);
        return;
      }

      if (useAppStore.getState().clipboard) {
        e.preventDefault();
        pasteSelection(activePage.id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('paste', onPaste);
    };
  }, [
    activePage,
    activeTextboxId,
    activatePenSlot,
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
    lassoSelection,
    nudgeSelection,
    openImagePicker,
    pages,
    pasteSelection,
    pasteTextboxStyle,
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
    zoom,
  ]);

  // Ctrl+Wheel / Trackpad pinch zoom
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.0025;
        setZoom(zoom + delta);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom, zoom]);

  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (document.activeElement instanceof HTMLButtonElement) {
      document.activeElement.blur();
    }
    // Space+Drag or Middle-Mouse pans; clicking directly on the desk outside a page deselects
    const shouldPan = spacePressed || e.button === 1;
    if (!shouldPan) {
      if (e.button === 0 && !(e.target as HTMLElement)?.closest?.('[data-page-id]')) {
        clearSelection();
      }
      return;
    }

    const container = viewportRef.current;
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
    const container = viewportRef.current;
    if (!drag || !container || drag.pointerId !== e.pointerId) return;

    container.scrollLeft = drag.scrollLeft - (e.clientX - drag.startX);
    container.scrollTop = drag.scrollTop - (e.clientY - drag.startY);
  };

  const handleViewportPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (panDragRef.current?.pointerId === e.pointerId) {
      panDragRef.current = null;
    }
  };

  const handleViewportScroll = useCallback(() => {
    const container = viewportRef.current;
    if (!container || pages.length <= 1) return;
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

    if (closestId && closestId !== activePageId) {
      setActivePageId(closestId);
    }
  }, [activePageId, pages.length, setActivePageId]);

  if (!activeNotebook) return null;

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
      className={`flex h-screen flex-col overflow-hidden transition-colors duration-200 ${deskClass}`}
    >
      {/* Zone 1: Slim Top Header Bar (48px) */}
      {!zenMode && (
        <TopHeaderBar
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerOpen((o) => !o)}
          aiSidebarOpen={aiSidebarOpen}
          onToggleAiSidebar={() => setAiSidebarOpen((o) => !o)}
          onQuickAddPage={() => void handleQuickAddPage()}
          onOpenTemplatePicker={() => setTemplatePickerOpen(true)}
          onImportPdfPages={() => pdfFileInputRef.current?.click()}
          onOpenCustomizePaper={() => setCustomizeOpen(true)}
          onOpenSaveTemplate={() => setSaveTemplateOpen(true)}
          onOpenExport={() => setExportOpen(true)}
          onPrint={() => window.print()}
          onOpenSettings={() => {
            setSettingsTab('general');
            setSettingsOpen(true);
          }}
          onOpenShortcuts={() => setShortcutsOpen(true)}
        />
      )}

      {/* Zone 2: Dynamic Contextual Sub-Bar (44px) */}
      {!zenMode && (
        <ContextualSubBar
          activePage={activePage}
          onLassoAiAction={handleLassoAiAction}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        {!zenMode && (
          <PagesDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            onSelectPage={(pageId) => scrollToPage(pageId)}
            onOpenTemplatePicker={() => setTemplatePickerOpen(true)}
            onImportPdfFiles={(files) => void handleImportPdfFiles(files)}
            onImportPdfClick={() => pdfFileInputRef.current?.click()}
          />
        )}

        {/* Scrollable Multi-Page Canvas Workspace */}
        <main
          ref={viewportRef}
          onScroll={handleViewportScroll}
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
          className={`custom-scrollbar relative flex-1 overflow-auto p-6 sm:p-10 ${
            !zenMode && dockPosition === 'top' ? 'pt-20 sm:pt-20' : ''
          } ${spacePressed ? 'cursor-grab active:cursor-grabbing' : ''}`}
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
                onFocusPage={setActivePageId}
                onRecordCursorPoint={(pageId, x, y) => {
                  lastCursorPointRef.current = { pageId, x, y };
                }}
                onContextMenuRequest={setContextMenu}
              />
            ))}
          </div>
        </main>

        {!zenMode && (
          <AiSidebar
            open={aiSidebarOpen}
            activePage={activePage}
            activePageIndex={activePageIndex}
            pages={pages}
            pendingLassoAction={pendingLassoAiAction}
            onConsumePendingLassoAction={() => setPendingLassoAiAction(null)}
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
          pageIndex={activePageIndex}
          totalPages={pages.length}
          spacePressed={spacePressed}
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
          onInsertImage={openImagePicker}
        />
      )}

      {/* Subtle Zen Mode Exit Pill */}
      {zenMode && (
        <button
          type="button"
          data-testid="zen-mode-pill"
          onClick={() => setZenMode(false)}
          className="folio-mono fixed bottom-4 right-4 z-40 rounded-full border border-[#072D59]/18 bg-white/90 px-3.5 py-1.5 text-xs font-semibold text-[#072D59] shadow-lg backdrop-blur-md transition duration-150 hover:bg-[#DBF2FC]"
        >
          Press <kbd className="mx-0.5 rounded bg-[#072D59] px-1.5 py-0.5 text-[10px] text-white">Tab</kbd> to exit Zen Mode
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
          className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-[#FD6E88]/40 bg-white px-4 py-1.5 text-xs font-semibold text-[#F95573] shadow-lg"
        >
          <span>{pdfErrorToast}</span>
          <button
            type="button"
            aria-label="Dismiss PDF error"
            onClick={() => setPdfErrorToast(null)}
            className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-[#072D59]/60 hover:bg-[#DBF2FC]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Right-Click Context Menu */}
      <CanvasContextMenu
        menu={contextMenu}
        onLassoAiAction={handleLassoAiAction}
        onClose={() => setContextMenu(null)}
      />

      {/* Subtle Handwriting Tidied Pill */}
      {handwritingTidyToast && (
        <div
          data-testid="handwriting-tidied-toast"
          className="pointer-events-none fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full bg-[#072D59]/92 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur"
        >
          {handwritingTidyToast}
        </div>
      )}

      {/* Modals */}
      <CustomizePaperModal
        open={customizeOpen}
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
        masterKey={unlockedMasterKey}
        onClose={() => setExportOpen(false)}
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
