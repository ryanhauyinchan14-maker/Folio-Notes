import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookmarkPlus,
  Check,
  ChevronDown,
  Download,
  FilePlus,
  FilePlus2,
  FileUp,
  FlipHorizontal2,
  HelpCircle,
  Layers,
  LayoutGrid,
  Lock,
  Paintbrush,
  PanelLeft,
  Printer,
  Redo2,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { getBrushPreset } from '../../canvas/brushEngine';
import type { SymmetryMode } from '../../canvas/symmetry';
import { useAppStore } from '../../store/useAppStore';
import { formatShortcutCompact } from '../../utils/shortcuts';
import { UpdateHeaderButton } from '../common/UpdatePill';

export type StudioPopoverId = 'brush' | 'symmetry' | 'layers' | 'color' | null;

interface TopHeaderBarProps {
  isWhiteboard?: boolean;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  aiSidebarOpen?: boolean;
  onToggleAiSidebar?: () => void;
  activeStudioPopover?: StudioPopoverId;
  onToggleStudioPopover?: (id: Exclude<StudioPopoverId, null>) => void;
  layerCount?: number;
  onQuickAddPage: () => void;
  onOpenTemplatePicker: () => void;
  onImportPdfPages: () => void;
  onOpenCustomizePaper: () => void;
  onOpenSaveTemplate: () => void;
  onOpenExport: () => void;
  onPrint: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
}

export const TopHeaderBar: React.FC<TopHeaderBarProps> = ({
  isWhiteboard = false,
  drawerOpen,
  onToggleDrawer,
  aiSidebarOpen = false,
  onToggleAiSidebar,
  activeStudioPopover = null,
  onToggleStudioPopover,
  layerCount = 1,
  onQuickAddPage,
  onOpenTemplatePicker,
  onImportPdfPages,
  onOpenCustomizePaper,
  onOpenSaveTemplate,
  onOpenExport,
  onPrint,
  onOpenSettings,
  onOpenShortcuts,
}) => {
  const activeNotebook = useAppStore((s) => s.activeNotebook);
  const hasSplitPane = useAppStore((s) => Boolean(s.splitPane));
  const closeNotebook = useAppStore((s) => s.closeNotebook);
  const lockNow = useAppStore((s) => s.lockNow);
  const updateNotebookMeta = useAppStore((s) => s.updateNotebookMeta);
  const undoStack = useAppStore((s) => s.undoStack);
  const redoStack = useAppStore((s) => s.redoStack);
  const saveStatus = useAppStore((s) => s.saveStatus);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const keyboardShortcuts = useAppStore((s) => s.keyboardShortcuts);
  const activeBrushId = useAppStore((s) => s.activeBrushId);
  const symmetryMode: SymmetryMode = useAppStore((s) => s.symmetryMode);
  const inkColor = useAppStore((s) => s.inkColor);
  const activeBrush = getBrushPreset(activeBrushId);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [pageMenuOpen, setPageMenuOpen] = useState(false);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const pageMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    if (!pageMenuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (pageMenuRef.current && !pageMenuRef.current.contains(e.target as Node)) {
        setPageMenuOpen(false);
      }
    };
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setPageMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('keydown', onKeyDownCapture, { capture: true });
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('keydown', onKeyDownCapture, { capture: true });
    };
  }, [pageMenuOpen]);

  const startEditingTitle = () => {
    setTitleDraft(activeNotebook?.title ?? '');
    setEditingTitle(true);
  };

  const commitTitle = () => {
    setEditingTitle(false);
    if (!activeNotebook) return;
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== activeNotebook.title) {
      void updateNotebookMeta(activeNotebook.id, { title: trimmed });
    }
  };

  return (
    <header
      data-testid="top-header-bar"
      className="pointer-events-none flex w-full flex-wrap items-center justify-between gap-1.5 text-[var(--navy-900)] min-[540px]:flex-nowrap min-[540px]:gap-2"
    >
      {/* Top-Left Detached Glass Island: Shelf Back + Inline Title + Page Menu + Pages Drawer */}
      <div
        data-testid="editor-top-left-island"
        className="folio-glass-island pointer-events-auto flex min-w-0 max-w-full items-center gap-1 rounded-2xl px-1.5 py-1 sm:gap-1.5"
      >
        <button
          type="button"
          title="Back to Home Shelf"
          aria-label="Back to Home Shelf"
          onClick={() => void closeNotebook()}
          className="folio-press inline-flex h-8 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-[var(--navy-900)]/85 hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Shelf</span>
        </button>

        <div className="h-4 w-px shrink-0 bg-[var(--border-subtle)]" />

        {editingTitle ? (
          <input
            ref={titleInputRef}
            data-testid="inline-notebook-title-input"
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitTitle();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setEditingTitle(false);
              }
            }}
            className="folio-input h-7 w-28 rounded-xl px-2 text-xs font-bold sm:w-44 sm:text-sm"
          />
        ) : (
          <button
            type="button"
            data-testid="inline-notebook-title"
            title="Click to rename notebook"
            onClick={startEditingTitle}
            className="folio-press max-w-[64px] truncate rounded-xl px-1.5 py-1 text-left text-xs font-bold tracking-[-0.02em] text-[var(--navy-900)] hover:bg-[var(--surface-tint)] sm:max-w-[200px] sm:px-2 sm:text-sm"
          >
            {activeNotebook?.title ?? 'Notebook'}
          </button>
        )}

        <span
          data-testid="editor-mode-badge"
          className="folio-glass-badge hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-tight md:inline-flex"
        >
          {isWhiteboard ? 'Infinite Board' : 'Drawing Board'}
        </span>

        {/* Single Page / Board Dropdown */}
        <div ref={pageMenuRef} className="relative shrink-0">
          <button
            type="button"
            data-testid="page-menu-button"
            aria-expanded={pageMenuOpen}
            onClick={() => setPageMenuOpen((o) => !o)}
            className={`folio-press inline-flex h-8 items-center gap-1 rounded-xl border px-2 text-xs font-semibold sm:px-2.5 ${
              pageMenuOpen
                ? 'folio-glass-active'
                : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)]/90 text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
            }`}
          >
            <span>{isWhiteboard ? 'Board' : 'Page'}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 ${pageMenuOpen ? 'text-white/85' : 'text-[var(--navy-600)]'}`}
            />
          </button>

          {pageMenuOpen && (
            <div
              data-testid="page-dropdown-menu"
              className="folio-popover absolute left-0 top-full z-40 mt-2 w-64 rounded-xl p-1.5"
            >
              <button
                type="button"
                onClick={() => {
                  setPageMenuOpen(false);
                  onOpenCustomizePaper();
                }}
                className="folio-press flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--navy-900)]" />
                <span>{isWhiteboard ? 'Customize Board…' : 'Customize Paper…'}</span>
              </button>
              {!isWhiteboard && (
                <button
                  type="button"
                  onClick={() => {
                    setPageMenuOpen(false);
                    onOpenSaveTemplate();
                  }}
                  className="folio-press flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
                >
                  <BookmarkPlus className="h-3.5 w-3.5 text-[var(--state-warning)]" />
                  <span>Save Page as Template…</span>
                </button>
              )}
              {!isWhiteboard && (
                <>
                  <div className="my-1 h-px bg-[var(--border-subtle)]" />
                  <button
                    type="button"
                    onClick={() => {
                      setPageMenuOpen(false);
                      onQuickAddPage();
                    }}
                    className="folio-press flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
                  >
                    <span className="flex items-center gap-2.5">
                      <FilePlus className="h-3.5 w-3.5 text-[var(--navy-600)]" />
                      Add Page
                    </span>
                    <kbd className="rounded bg-[var(--surface-tint)] px-1.5 py-0.5 text-[10px] text-[var(--navy-600)]">
                      {formatShortcutCompact(keyboardShortcuts.addPage)}
                    </kbd>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPageMenuOpen(false);
                      onOpenTemplatePicker();
                    }}
                    className="folio-press flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
                  >
                    <FilePlus2 className="h-3.5 w-3.5 text-[var(--navy-900)]" />
                    <span>Add from Template…</span>
                  </button>
                  <button
                    type="button"
                    data-testid="page-menu-import-pdf-btn"
                    onClick={() => {
                      setPageMenuOpen(false);
                      onImportPdfPages();
                    }}
                    className="folio-press flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
                  >
                    <FileUp className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
                    <span>Import PDF Pages…</span>
                  </button>
                </>
              )}
              <div className="my-1 h-px bg-[var(--border-subtle)]" />
              <button
                type="button"
                data-testid="page-menu-print-btn"
                onClick={() => {
                  setPageMenuOpen(false);
                  onPrint();
                }}
                className="folio-press flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
              >
                <span className="flex items-center gap-2.5">
                  <Printer className="h-3.5 w-3.5 text-[var(--navy-600)]" />
                  Print
                </span>
                <kbd className="rounded bg-[var(--surface-tint)] px-1.5 py-0.5 text-[10px] text-[var(--navy-600)]">
                  {formatShortcutCompact(keyboardShortcuts.printNotebook)}
                </kbd>
              </button>
              <div className="my-1 h-px bg-[var(--border-subtle)]" />
              <button
                type="button"
                onClick={() => {
                  setPageMenuOpen(false);
                  onOpenSettings();
                }}
                className="folio-press flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
              >
                <Settings className="h-3.5 w-3.5 text-[var(--navy-600)]" />
                <span>Settings…</span>
              </button>
            </div>
          )}
        </div>

        {(!isWhiteboard || hasSplitPane) && (
          <button
            type="button"
            data-testid="pages-drawer-toggle"
            title={`Pages Drawer (${formatShortcutCompact(keyboardShortcuts.togglePagesDrawer)})`}
            aria-label="Toggle Pages Drawer"
            aria-pressed={drawerOpen}
            onClick={onToggleDrawer}
            className={`folio-press relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-2 text-xs font-semibold ${
              drawerOpen
                ? 'folio-glass-active'
                : 'text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]'
            }`}
          >
            {drawerOpen ? <PanelLeft className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
            <span className="hidden md:inline">Pages</span>
            {hasSplitPane && (
              <span
                data-testid="pages-drawer-split-dot"
                className="h-1.5 w-1.5 rounded-full bg-[var(--crimson-500)]"
              />
            )}
          </button>
        )}
      </div>

      {/* Top-Right Detached Glass Island: Undo/Redo, Saved Status, Lock, AI Study, Export, Shortcuts */}
      <div
        data-testid="editor-top-right-island"
        className="folio-glass-island pointer-events-auto ml-auto flex shrink-0 items-center gap-1 rounded-2xl px-1.5 py-1 sm:gap-1.5"
      >
        <div className="flex items-center gap-0.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/90 p-0.5">
          <button
            type="button"
            title={`Undo (${formatShortcutCompact(keyboardShortcuts.undo)})`}
            aria-label="Undo"
            disabled={undoStack.length === 0}
            onClick={undo}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-900)] hover:bg-[var(--surface-tint)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={`Redo (${formatShortcutCompact(keyboardShortcuts.redo)})`}
            aria-label="Redo"
            disabled={redoStack.length === 0}
            onClick={redo}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-900)] hover:bg-[var(--surface-tint)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <span
          data-testid="save-status-indicator"
          className="hidden items-center gap-1 px-1 text-[11px] font-semibold text-[var(--navy-600)] md:inline-flex"
        >
          <Check className="h-3 w-3 text-[var(--state-success)]" />
          {saveStatus === 'saving' ? 'Saving…' : 'Saved'}
        </span>

        <UpdateHeaderButton />

        {activeNotebook?.isLocked && (
          <button
            type="button"
            data-testid="lock-now-button"
            title="Lock notebook and clear Master Key from memory"
            onClick={() => void lockNow()}
            className="folio-press folio-badge-warning inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold hover:opacity-90"
          >
            <Lock className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Lock Now</span>
          </button>
        )}

        {onToggleStudioPopover && (
          <div className="flex items-center gap-0.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/90 p-0.5">
            <button
              type="button"
              data-testid="studio-brush-btn"
              title={`Brush Studio (${activeBrush.name})`}
              aria-label="Brush Studio"
              aria-pressed={activeStudioPopover === 'brush'}
              onClick={() => onToggleStudioPopover('brush')}
              className={`folio-press inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-semibold ${
                activeStudioPopover === 'brush'
                  ? 'folio-glass-active'
                  : 'text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
              }`}
            >
              <Paintbrush className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">{activeBrush.name.split(' ')[0]}</span>
            </button>
            <button
              type="button"
              data-testid="studio-symmetry-btn"
              title={`Symmetry Guides (${symmetryMode})`}
              aria-label="Symmetry Guides"
              aria-pressed={activeStudioPopover === 'symmetry' || symmetryMode !== 'off'}
              onClick={() => onToggleStudioPopover('symmetry')}
              className={`folio-press inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-semibold ${
                activeStudioPopover === 'symmetry' || symmetryMode !== 'off'
                  ? 'folio-glass-active'
                  : 'text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
              }`}
            >
              <FlipHorizontal2 className="h-3.5 w-3.5" />
              {symmetryMode !== 'off' && (
                <span className="hidden xl:inline capitalize">{symmetryMode}</span>
              )}
            </button>
            <button
              type="button"
              data-testid="studio-layers-btn"
              title={`Layers (${layerCount})`}
              aria-label="Layers"
              aria-pressed={activeStudioPopover === 'layers'}
              onClick={() => onToggleStudioPopover('layers')}
              className={`folio-press inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-semibold ${
                activeStudioPopover === 'layers'
                  ? 'folio-glass-active'
                  : 'text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              {layerCount > 1 && (
                <span className="folio-mono text-[10px] font-bold">{layerCount}</span>
              )}
            </button>
            <button
              type="button"
              data-testid="studio-color-btn"
              title="Color Studio Wheel"
              aria-label="Color Studio"
              aria-pressed={activeStudioPopover === 'color'}
              onClick={() => onToggleStudioPopover('color')}
              className={`folio-press inline-flex h-7 w-7 items-center justify-center rounded-lg ${
                activeStudioPopover === 'color'
                  ? 'bg-[var(--crimson-soft)] ring-1 ring-[var(--crimson-500)]'
                  : 'hover:bg-[var(--surface-tint)]'
              }`}
            >
              <span
                className="h-4.5 w-4.5 rounded-full border-2 border-white shadow-sm ring-1 ring-black/20"
                style={{ backgroundColor: inkColor }}
              />
            </button>
          </div>
        )}

        {onToggleAiSidebar && (
          <button
            type="button"
            data-testid="ai-sidebar-toggle"
            title={`AI Study Suite (${formatShortcutCompact(keyboardShortcuts.toggleAiSidebar)})`}
            aria-label="Toggle AI Study Suite"
            aria-pressed={aiSidebarOpen}
            onClick={onToggleAiSidebar}
            className={`folio-press inline-flex h-8 items-center gap-1.5 rounded-xl border px-2 text-xs font-semibold sm:px-2.5 ${
              aiSidebarOpen
                ? 'folio-glass-active'
                : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)]/90 text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
            <span className="hidden lg:inline">AI Study</span>
          </button>
        )}

        <button
          type="button"
          data-testid="shortcuts-modal-button"
          title={`Keyboard Shortcuts (${formatShortcutCompact(keyboardShortcuts.showShortcuts)})`}
          aria-label="Keyboard Shortcuts"
          onClick={onOpenShortcuts}
          className="folio-press hidden h-8 w-8 items-center justify-center rounded-xl text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)] sm:inline-flex"
        >
          <HelpCircle className="h-4 w-4" />
        </button>

        <button
          type="button"
          title={`Export Notebook (${formatShortcutCompact(keyboardShortcuts.exportNotebook)})`}
          aria-label="Export Notebook"
          onClick={onOpenExport}
          className="folio-btn-crimson inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold sm:px-3"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Export</span>
        </button>
      </div>
    </header>
  );
};
