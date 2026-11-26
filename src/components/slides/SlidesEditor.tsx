import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Maximize2,
  Play,
  Presentation,
  Redo2,
  Settings,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { exportSlidesAsPdf, exportSlidesAsPngZip } from '../../slides/slideExport';
import {
  createSlideImageElement,
  createSlideLayout,
  createSlideShapeElement,
  createSlideTextElement,
  type SlideLayoutId,
} from '../../slides/slideLayouts';
import { useAppStore } from '../../store/useAppStore';
import type {
  SlideBackground,
  SlideData,
  SlideElement,
  SlideShapeKind,
} from '../../types/notes';
import {
  buildFolioNotebookExport,
  sanitizeExportFilename,
  triggerBlobDownload,
} from '../../utils/exportNotebook';
import { createId } from '../../utils/id';
import { isSupportedImageFile, processUploadedImage } from '../../utils/imageImport';
import { resolveDeskBackdropProps } from '../../utils/settings';
import { SettingsModal } from '../modals/SettingsModal';
import { NotesAiPanel } from '../notes/NotesAiPanel';
import { SlideFilmstrip } from './SlideFilmstrip';
import { SlidePresentMode } from './SlidePresentMode';
import { SlideSizeModal } from './SlideSizeModal';
import { SlidesLeftRail, type SlidesRailTab } from './SlidesLeftRail';
import { SlidesPropertyBar } from './SlidesPropertyBar';
import { SlideStageCanvas } from './SlideStageCanvas';

const EMPTY_SLIDE_DATA: SlideData = {
  background: { kind: 'solid', color: '#FFFFFF' },
  speakerNotes: '',
  transition: 'fade',
  elements: [],
  inkStrokes: [],
};

export const SlidesEditor: React.FC = () => {
  const activeNotebook = useAppStore((s) => s.activeNotebook);
  const pages = useAppStore((s) => s.pages);
  const activePageId = useAppStore((s) => s.activePageId);
  const saveStatus = useAppStore((s) => s.saveStatus);
  const deskBackdrop = useAppStore((s) => s.deskBackdrop);
  const deskCustomColor = useAppStore((s) => s.deskCustomColor);
  const closeNotebook = useAppStore((s) => s.closeNotebook);
  const updateNotebookMeta = useAppStore((s) => s.updateNotebookMeta);
  const setActivePageId = useAppStore((s) => s.setActivePageId);
  const saveSlidePageData = useAppStore((s) => s.saveSlidePageData);
  const addSlidePage = useAppStore((s) => s.addSlidePage);
  const duplicatePage = useAppStore((s) => s.duplicatePage);
  const deletePage = useAppStore((s) => s.deletePage);
  const reorderPages = useAppStore((s) => s.reorderPages);
  const resizeActiveSlideDeck = useAppStore((s) => s.resizeActiveSlideDeck);

  const activeIndex = useMemo(() => {
    const idx = pages.findIndex((p) => p.id === activePageId);
    return idx >= 0 ? idx : 0;
  }, [pages, activePageId]);
  const activeSlide = pages[activeIndex] ?? pages[0] ?? null;
  const slideW = activeSlide?.paper.width ?? 1920;
  const slideH = activeSlide?.paper.height ?? 1080;
  const currentSlideData = activeSlide?.slideData ?? EMPTY_SLIDE_DATA;

  const [railTab, setRailTab] = useState<SlidesRailTab>('layouts');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(activeNotebook?.title ?? '');
  const [sizeModalOpen, setSizeModalOpen] = useState(false);
  const [presentOpen, setPresentOpen] = useState(false);
  const [speakerNotesOpen, setSpeakerNotesOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState('#FD6E88');
  const [drawSize, setDrawSize] = useState(6);

  const [undoHistory, setUndoHistory] = useState<Array<{ pageId: string; data: SlideData }>>([]);
  const [redoHistory, setRedoHistory] = useState<Array<{ pageId: string; data: SlideData }>>([]);

  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const uploadImgInputRef = useRef<HTMLInputElement | null>(null);
  const uploadBgInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSelectedIds([]);
    setEditingTextId(null);
  }, [activeSlide?.id]);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [exportOpen]);

  const applySlideDataChange = useCallback(
    (nextData: SlideData, commitHistory = true) => {
      if (!activeSlide) return;
      if (commitHistory) {
        setUndoHistory((prev) => [
          ...prev.slice(-24),
          { pageId: activeSlide.id, data: structuredClone(currentSlideData) },
        ]);
        setRedoHistory([]);
      }
      saveSlidePageData(activeSlide.id, nextData);
    },
    [activeSlide, currentSlideData, saveSlidePageData],
  );

  const handleUndo = useCallback(() => {
    const last = undoHistory[undoHistory.length - 1];
    if (!last) return;
    const targetPage = pages.find((p) => p.id === last.pageId);
    if (targetPage?.slideData) {
      setRedoHistory((prev) => [...prev, { pageId: last.pageId, data: targetPage.slideData! }]);
    }
    setUndoHistory((prev) => prev.slice(0, -1));
    saveSlidePageData(last.pageId, last.data);
  }, [pages, saveSlidePageData, undoHistory]);

  const handleRedo = useCallback(() => {
    const next = redoHistory[redoHistory.length - 1];
    if (!next) return;
    const targetPage = pages.find((p) => p.id === next.pageId);
    if (targetPage?.slideData) {
      setUndoHistory((prev) => [...prev, { pageId: next.pageId, data: targetPage.slideData! }]);
    }
    setRedoHistory((prev) => prev.slice(0, -1));
    saveSlidePageData(next.pageId, next.data);
  }, [pages, redoHistory, saveSlidePageData]);

  const deleteSelectedElements = useCallback(() => {
    if (selectedIds.length === 0) return;
    const idSet = new Set(selectedIds);
    applySlideDataChange(
      {
        ...currentSlideData,
        elements: currentSlideData.elements.filter((el) => !idSet.has(el.id) || el.locked),
      },
      true,
    );
    setSelectedIds([]);
  }, [applySlideDataChange, currentSlideData, selectedIds]);

  const duplicateSelectedElements = useCallback(() => {
    if (selectedIds.length === 0) return;
    const maxZ = currentSlideData.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
    const clones = currentSlideData.elements
      .filter((el) => selectedIds.includes(el.id))
      .map((el, i) => ({
        ...el,
        id: createId(),
        x: el.x + 28,
        y: el.y + 28,
        zIndex: maxZ + i + 1,
      }));
    applySlideDataChange(
      { ...currentSlideData, elements: [...currentSlideData.elements, ...clones] },
      true,
    );
    setSelectedIds(clones.map((c) => c.id));
  }, [applySlideDataChange, currentSlideData, selectedIds]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (presentOpen || sizeModalOpen || settingsOpen) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (['input', 'textarea', 'select'].includes(target.tagName.toLowerCase()) ||
          target.isContentEditable)
      ) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        handleRedo();
      } else if (mod && e.key.toLowerCase() === 'd' && selectedIds.length > 0) {
        e.preventDefault();
        duplicateSelectedElements();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        e.preventDefault();
        deleteSelectedElements();
      } else if (e.key === 'F5') {
        e.preventDefault();
        setPresentOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    deleteSelectedElements,
    duplicateSelectedElements,
    handleRedo,
    handleUndo,
    presentOpen,
    selectedIds.length,
    settingsOpen,
    sizeModalOpen,
  ]);

  const singleSelected =
    selectedIds.length === 1
      ? currentSlideData.elements.find((e) => e.id === selectedIds[0]) ?? null
      : null;

  const nextZ = () => currentSlideData.elements.reduce((m, e) => Math.max(m, e.zIndex), 0) + 1;

  const handleAddText = (variant: 'heading' | 'subheading' | 'body' | 'badge') => {
    const base = createSlideTextElement(variant, slideW, slideH, nextZ());
    const step = (currentSlideData.elements.length % 5) * 32;
    const created = {
      ...base,
      x: Math.min(slideW - base.width - 24, base.x + step),
      y: Math.min(slideH - base.height - 24, base.y + Math.round(slideH * 0.28) + step),
    };
    applySlideDataChange(
      { ...currentSlideData, elements: [...currentSlideData.elements, created] },
      true,
    );
    setSelectedIds([created.id]);
    setEditingTextId(created.id);
  };

  const handleAddShape = (shape: SlideShapeKind) => {
    const base = createSlideShapeElement(shape, slideW, slideH, nextZ());
    const idxOffset = (currentSlideData.elements.length % 4) * 44;
    const created = {
      ...base,
      x: Math.min(slideW - base.width - 40, Math.round(slideW * 0.56) + idxOffset),
      y: Math.min(slideH - base.height - 40, Math.round(slideH * 0.32) + idxOffset),
    };
    applySlideDataChange(
      { ...currentSlideData, elements: [...currentSlideData.elements, created] },
      true,
    );
    setSelectedIds([created.id]);
  };

  const handleApplyLayout = (layoutId: SlideLayoutId) => {
    const layout = createSlideLayout(layoutId, slideW, slideH);
    applySlideDataChange(
      {
        ...currentSlideData,
        background: layout.background,
        elements: layout.elements,
      },
      true,
    );
    setSelectedIds([]);
  };

  const handleUploadSlideImages = async (files: File[]) => {
    const added: SlideElement[] = [];
    let z = nextZ();
    for (const file of files) {
      if (!isSupportedImageFile(file)) continue;
      const processed = await processUploadedImage(file);
      added.push(createSlideImageElement(processed, slideW, slideH, z++));
    }
    if (added.length > 0) {
      applySlideDataChange(
        { ...currentSlideData, elements: [...currentSlideData.elements, ...added] },
        true,
      );
      setSelectedIds(added.map((a) => a.id));
    }
  };

  const handleUploadBackgroundImage = async (file: File) => {
    if (!isSupportedImageFile(file)) return;
    const processed = await processUploadedImage(file);
    applySlideDataChange(
      {
        ...currentSlideData,
        background: { kind: 'image', imageDataUrl: processed.dataUrl },
      },
      true,
    );
  };

  const handleMoveSlide = (idx: number, delta: -1 | 1) => {
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= pages.length) return;
    const order = pages.map((p) => p.id);
    const [moved] = order.splice(idx, 1);
    order.splice(targetIdx, 0, moved);
    void reorderPages(order);
  };

  const commitTitle = () => {
    setEditingTitle(false);
    if (!activeNotebook) return;
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== activeNotebook.title) {
      void updateNotebookMeta(activeNotebook.id, { title: trimmed });
    }
  };

  const handleExportPdf = async () => {
    setExportOpen(false);
    const bytes = await exportSlidesAsPdf(activeNotebook?.title ?? 'Presentation', pages);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    triggerBlobDownload(
      new Blob([ab], { type: 'application/pdf' }),
      `${sanitizeExportFilename(activeNotebook?.title ?? 'Presentation')}.pdf`,
    );
  };

  const handleExportPngZip = async () => {
    setExportOpen(false);
    await exportSlidesAsPngZip(activeNotebook?.title ?? 'Presentation', pages);
  };

  const handleExportFolio = () => {
    setExportOpen(false);
    if (!activeNotebook) return;
    const archive = buildFolioNotebookExport(activeNotebook, pages);
    triggerBlobDownload(
      new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }),
      `${sanitizeExportFilename(activeNotebook.title)}.folio.json`,
    );
  };

  const slideDeckPlainText = pages
    .map((p, i) => {
      const texts = (p.slideData?.elements ?? [])
        .filter((el) => el.kind === 'text')
        .map((el) => (el.kind === 'text' ? el.text : ''))
        .join('\n');
      return `Slide ${i + 1}:\n${texts}`;
    })
    .join('\n\n');

  const deskAppearance = resolveDeskBackdropProps(deskBackdrop, deskCustomColor);

  return (
    <div
      data-testid="slides-editor-shell"
      style={deskAppearance.style}
      className={`flex h-full flex-col overflow-hidden text-[var(--navy-900)] ${deskAppearance.className}`}
    >
      {/* Top Canva-Style Floating Glass Header */}
      <header className="z-30 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-glass)] px-3 py-2 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            data-testid="slides-back-to-shelf-btn"
            onClick={() => void closeNotebook()}
            className="folio-press inline-flex h-8 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-semibold hover:bg-[var(--surface-tint)]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Shelf</span>
          </button>
          <div className="h-4 w-px bg-[var(--border-subtle)]" />
          {editingTitle ? (
            <input
              type="text"
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle();
                else if (e.key === 'Escape') setEditingTitle(false);
              }}
              className="folio-input h-7 w-44 rounded-xl px-2 text-xs font-bold"
            />
          ) : (
            <button
              type="button"
              data-testid="slides-inline-title"
              onClick={() => {
                setTitleDraft(activeNotebook?.title ?? '');
                setEditingTitle(true);
              }}
              className="folio-press max-w-[180px] truncate rounded-xl px-2 py-1 text-xs font-bold hover:bg-[var(--surface-tint)] sm:text-sm"
            >
              {activeNotebook?.title ?? 'Untitled Presentation'}
            </button>
          )}
          <span
            data-testid="editor-mode-badge"
            className="folio-glass-badge hidden items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold sm:inline-flex"
          >
            <Presentation className="h-3 w-3 text-[var(--crimson-500)]" />
            Slides
          </span>
          <button
            type="button"
            data-testid="slides-custom-size-btn"
            onClick={() => setSizeModalOpen(true)}
            className="folio-btn-secondary folio-press inline-flex h-7 items-center gap-1 rounded-xl px-2.5 text-[11px] font-bold"
          >
            <Maximize2 className="h-3 w-3 text-[var(--crimson-500)]" />
            <span>
              {activeNotebook?.slideSizePreset ?? '16:9'} · {slideW}×{slideH}
            </span>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label="Undo"
            disabled={undoHistory.length === 0}
            onClick={handleUndo}
            className="folio-press hidden h-8 w-8 items-center justify-center rounded-xl hover:bg-[var(--surface-tint)] disabled:opacity-35 sm:inline-flex"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Redo"
            disabled={redoHistory.length === 0}
            onClick={handleRedo}
            className="folio-press hidden h-8 w-8 items-center justify-center rounded-xl hover:bg-[var(--surface-tint)] disabled:opacity-35 sm:inline-flex"
          >
            <Redo2 className="h-4 w-4" />
          </button>
          <span className="hidden items-center gap-1 px-1.5 text-[11px] font-medium text-[var(--navy-600)] md:inline-flex">
            {saveStatus === 'saving' ? (
              'Saving…'
            ) : (
              <>
                <Check className="h-3 w-3 text-[var(--state-success)]" />
                Saved
              </>
            )}
          </span>
          <button
            type="button"
            data-testid="slides-toggle-ai-btn"
            onClick={() => setAiOpen((o) => !o)}
            className={`folio-press inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-bold ${
              aiOpen
                ? 'folio-glass-active'
                : 'border border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-tint)]'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
            <span className="hidden sm:inline">AI</span>
          </button>
          <div ref={exportMenuRef} className="relative">
            <button
              type="button"
              data-testid="slides-export-btn"
              onClick={() => setExportOpen((o) => !o)}
              className="folio-btn-secondary folio-press inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-bold"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {exportOpen && (
              <div className="folio-popover absolute right-0 top-full z-40 mt-2 w-48 rounded-2xl p-1.5 text-xs font-semibold">
                <button
                  type="button"
                  data-testid="slides-export-pdf"
                  onClick={() => void handleExportPdf()}
                  className="folio-press block w-full rounded-xl px-3 py-2 text-left hover:bg-[var(--surface-tint)]"
                >
                  PDF Presentation (.pdf)
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportPngZip()}
                  className="folio-press block w-full rounded-xl px-3 py-2 text-left hover:bg-[var(--surface-tint)]"
                >
                  PNG Slide Pack (.zip)
                </button>
                <div className="my-1 h-px bg-[var(--border-subtle)]" />
                <button
                  type="button"
                  onClick={handleExportFolio}
                  className="folio-press block w-full rounded-xl px-3 py-2 text-left hover:bg-[var(--surface-tint)]"
                >
                  Folio Backup (.folio.json)
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            data-testid="slides-present-btn"
            onClick={() => setPresentOpen(true)}
            className="folio-btn-crimson inline-flex h-8 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>Present</span>
          </button>
          <button
            type="button"
            aria-label="Open Settings"
            onClick={() => setSettingsOpen(true)}
            className="folio-press inline-flex h-8 w-8 items-center justify-center rounded-xl text-[var(--navy-600)] hover:bg-[var(--surface-tint)]"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Contextual Properties Ribbon */}
      <SlidesPropertyBar
        selectedElement={singleSelected}
        selectedCount={selectedIds.length}
        transition={currentSlideData.transition}
        onChangeTransition={(t) =>
          applySlideDataChange({ ...currentSlideData, transition: t }, true)
        }
        onOpenResize={() => setSizeModalOpen(true)}
        onUpdateElement={(patch) => {
          if (!singleSelected) return;
          applySlideDataChange(
            {
              ...currentSlideData,
              elements: currentSlideData.elements.map((el) =>
                el.id === singleSelected.id ? ({ ...el, ...patch } as SlideElement) : el,
              ),
            },
            true,
          );
        }}
        onBringForward={() => {
          if (!singleSelected) return;
          applySlideDataChange(
            {
              ...currentSlideData,
              elements: currentSlideData.elements.map((el) =>
                el.id === singleSelected.id ? { ...el, zIndex: el.zIndex + 1 } : el,
              ),
            },
            true,
          );
        }}
        onSendBackward={() => {
          if (!singleSelected) return;
          applySlideDataChange(
            {
              ...currentSlideData,
              elements: currentSlideData.elements.map((el) =>
                el.id === singleSelected.id
                  ? { ...el, zIndex: Math.max(1, el.zIndex - 1) }
                  : el,
              ),
            },
            true,
          );
        }}
        onDuplicateSelected={duplicateSelectedElements}
        onToggleLock={() => {
          if (!singleSelected) return;
          applySlideDataChange(
            {
              ...currentSlideData,
              elements: currentSlideData.elements.map((el) =>
                el.id === singleSelected.id ? { ...el, locked: !el.locked } : el,
              ),
            },
            true,
          );
        }}
        onDeleteSelected={deleteSelectedElements}
      />

      {/* Main Studio Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SlidesLeftRail
          activeTab={railTab}
          onChangeTab={setRailTab}
          drawMode={drawMode}
          drawColor={drawColor}
          drawSize={drawSize}
          onToggleDrawMode={setDrawMode}
          onChangeDrawColor={setDrawColor}
          onChangeDrawSize={setDrawSize}
          onClearInk={() =>
            applySlideDataChange({ ...currentSlideData, inkStrokes: [] }, true)
          }
          onApplyLayout={handleApplyLayout}
          onAddShape={handleAddShape}
          onAddText={handleAddText}
          onTriggerUploadImage={() => uploadImgInputRef.current?.click()}
          onChangeBackground={(bg: SlideBackground) =>
            applySlideDataChange({ ...currentSlideData, background: bg }, true)
          }
          onTriggerBackgroundImage={() => uploadBgInputRef.current?.click()}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <SlideStageCanvas
            slideWidth={slideW}
            slideHeight={slideH}
            slideData={currentSlideData}
            selectedIds={selectedIds}
            editingTextId={editingTextId}
            drawMode={drawMode}
            drawColor={drawColor}
            drawSize={drawSize}
            onSelectIds={setSelectedIds}
            onStartEditText={setEditingTextId}
            onChangeSlideData={applySlideDataChange}
          />

          <SlideFilmstrip
            pages={pages}
            activePageId={activeSlide?.id ?? null}
            speakerNotesOpen={speakerNotesOpen}
            speakerNotes={currentSlideData.speakerNotes}
            onToggleSpeakerNotes={() => setSpeakerNotesOpen((o) => !o)}
            onChangeSpeakerNotes={(notes) =>
              applySlideDataChange({ ...currentSlideData, speakerNotes: notes }, false)
            }
            onSelectSlide={setActivePageId}
            onAddSlide={() =>
              void addSlidePage(
                {
                  ...createSlideLayout('bullets', slideW, slideH),
                  speakerNotes: '',
                  transition: currentSlideData.transition,
                  inkStrokes: [],
                },
                activeSlide?.id,
              )
            }
            onDuplicateSlide={(id) => void duplicatePage(id)}
            onMoveSlide={handleMoveSlide}
            onDeleteSlide={(id) => void deletePage(id)}
          />
        </div>

        <NotesAiPanel
          open={aiOpen}
          documentText={slideDeckPlainText}
          getSelectedText={() =>
            singleSelected?.kind === 'text' ? singleSelected.text : ''
          }
          onInsertAtCursor={(text) => {
            const box = createSlideTextElement('body', slideW, slideH, nextZ());
            box.text = text;
            applySlideDataChange(
              { ...currentSlideData, elements: [...currentSlideData.elements, box] },
              true,
            );
            setSelectedIds([box.id]);
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onClose={() => setAiOpen(false)}
        />
      </div>

      <SlideSizeModal
        open={sizeModalOpen}
        currentPreset={activeNotebook?.slideSizePreset ?? '16:9'}
        currentWidth={slideW}
        currentHeight={slideH}
        onApply={(params) => void resizeActiveSlideDeck(params)}
        onClose={() => setSizeModalOpen(false)}
      />

      <SlidePresentMode
        open={presentOpen}
        pages={pages}
        startIndex={activeIndex}
        onClose={() => setPresentOpen(false)}
      />

      <input
        ref={uploadImgInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) void handleUploadSlideImages(files);
        }}
        className="hidden"
      />
      <input
        ref={uploadBgInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handleUploadBackgroundImage(f);
        }}
        className="hidden"
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};

export default SlidesEditor;
