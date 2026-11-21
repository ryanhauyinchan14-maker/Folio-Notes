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
  HelpCircle,
  LayoutGrid,
  Lock,
  Moon,
  PanelLeft,
  Printer,
  Redo2,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Undo2,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

interface TopHeaderBarProps {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  aiSidebarOpen?: boolean;
  onToggleAiSidebar?: () => void;
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
  drawerOpen,
  onToggleDrawer,
  aiSidebarOpen = false,
  onToggleAiSidebar,
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
  const closeNotebook = useAppStore((s) => s.closeNotebook);
  const lockNow = useAppStore((s) => s.lockNow);
  const updateNotebookMeta = useAppStore((s) => s.updateNotebookMeta);
  const undoStack = useAppStore((s) => s.undoStack);
  const redoStack = useAppStore((s) => s.redoStack);
  const saveStatus = useAppStore((s) => s.saveStatus);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const darkPaperView = useAppStore((s) => s.darkPaperView);
  const setDarkPaperView = useAppStore((s) => s.setDarkPaperView);

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
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
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
      className="folio-editor-header z-30 flex h-12 shrink-0 items-center justify-between gap-2 px-3 text-[#072D59] sm:gap-3"
    >
      {/* Left: Back to Shelf + Inline-Editable Title + Page ▾ Menu */}
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          title="Back to Home Shelf"
          aria-label="Back to Home Shelf"
          onClick={() => void closeNotebook()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-[#072D59]/80 transition duration-150 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Shelf</span>
        </button>

        <div className="h-4 w-px bg-[#072D59]/12" />

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
            className="folio-input h-7 w-40 rounded-md px-2 text-sm font-bold sm:w-52"
          />
        ) : (
          <button
            type="button"
            data-testid="inline-notebook-title"
            title="Click to rename notebook"
            onClick={startEditingTitle}
            className="max-w-[140px] truncate rounded-md px-2 py-1 text-left text-sm font-bold tracking-[-0.02em] text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/65 sm:max-w-[220px]"
          >
            {activeNotebook?.title ?? 'Notebook'}
          </button>
        )}

        {/* Single Page ▾ Dropdown */}
        <div ref={pageMenuRef} className="relative ml-1">
          <button
            type="button"
            data-testid="page-menu-button"
            aria-expanded={pageMenuOpen}
            onClick={() => setPageMenuOpen((o) => !o)}
            className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition duration-150 ${
              pageMenuOpen
                ? 'border-[#072D59] bg-[#072D59] text-white'
                : 'border-[#072D59]/12 bg-white/90 text-[#072D59] hover:bg-[#DBF2FC]/60'
            }`}
          >
            <span>Page</span>
            <ChevronDown
              className={`h-3.5 w-3.5 ${pageMenuOpen ? 'text-white/80' : 'text-[#072D59]/55'}`}
            />
          </button>

          {pageMenuOpen && (
            <div
              data-testid="page-dropdown-menu"
              className="absolute left-0 top-full z-40 mt-1.5 w-64 rounded-xl border border-[#072D59]/12 bg-white p-1.5 shadow-2xl"
            >
              <button
                type="button"
                onClick={() => {
                  setPageMenuOpen(false);
                  onOpenCustomizePaper();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/55"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#072D59]" />
                <span>Customize Paper…</span>
              </button>
              <button
                type="button"
                data-testid="page-menu-dark-paper-btn"
                onClick={() => {
                  setDarkPaperView(!darkPaperView);
                  setPageMenuOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/55"
              >
                <span className="flex items-center gap-2.5">
                  <Moon className="h-3.5 w-3.5 text-[#072D59]" />
                  <span>Smart Dark Paper View</span>
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    darkPaperView
                      ? 'bg-[#072D59] text-[#DBF2FC]'
                      : 'bg-[#DBF2FC]/70 text-[#072D59]/70'
                  }`}
                >
                  {darkPaperView ? 'On' : 'Off'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPageMenuOpen(false);
                  onOpenSaveTemplate();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/55"
              >
                <BookmarkPlus className="h-3.5 w-3.5 text-amber-600" />
                <span>Save Page as Template…</span>
              </button>
              <div className="my-1 h-px bg-[#072D59]/10" />
              <button
                type="button"
                onClick={() => {
                  setPageMenuOpen(false);
                  onQuickAddPage();
                }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/55"
              >
                <span className="flex items-center gap-2.5">
                  <FilePlus className="h-3.5 w-3.5 text-[#072D59]/70" />
                  Add Page
                </span>
                <kbd className="rounded bg-[#DBF2FC]/70 px-1.5 py-0.5 text-[10px] text-[#072D59]/75">
                  Ctrl+↵
                </kbd>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPageMenuOpen(false);
                  onOpenTemplatePicker();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/55"
              >
                <FilePlus2 className="h-3.5 w-3.5 text-[#072D59]" />
                <span>Add from Template…</span>
              </button>
              <button
                type="button"
                data-testid="page-menu-import-pdf-btn"
                onClick={() => {
                  setPageMenuOpen(false);
                  onImportPdfPages();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/55"
              >
                <FileUp className="h-3.5 w-3.5 text-[#FD6E88]" />
                <span>Import PDF Pages…</span>
              </button>
              <div className="my-1 h-px bg-[#072D59]/10" />
              <button
                type="button"
                data-testid="page-menu-export-btn"
                onClick={() => {
                  setPageMenuOpen(false);
                  onOpenExport();
                }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#FD6E88]/12"
              >
                <span className="flex items-center gap-2.5">
                  <Download className="h-3.5 w-3.5 text-[#FD6E88]" />
                  Export…
                </span>
                <kbd className="rounded bg-[#FD6E88]/14 px-1.5 py-0.5 text-[10px] font-bold text-[#F95573]">
                  Ctrl+E
                </kbd>
              </button>
              <button
                type="button"
                data-testid="page-menu-print-btn"
                onClick={() => {
                  setPageMenuOpen(false);
                  onPrint();
                }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/55"
              >
                <span className="flex items-center gap-2.5">
                  <Printer className="h-3.5 w-3.5 text-[#072D59]/70" />
                  Print
                </span>
                <kbd className="rounded bg-[#DBF2FC]/70 px-1.5 py-0.5 text-[10px] text-[#072D59]/75">
                  Ctrl+P
                </kbd>
              </button>
              <div className="my-1 h-px bg-[#072D59]/10" />
              <button
                type="button"
                onClick={() => {
                  setPageMenuOpen(false);
                  onOpenSettings();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/55"
              >
                <Settings className="h-3.5 w-3.5 text-[#072D59]/70" />
                <span>Settings…</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Center: Undo / Redo + Saved Indicator */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-[#072D59]/12 bg-white/85 p-0.5">
          <button
            type="button"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={undoStack.length === 0}
            onClick={undo}
            className="rounded-md p-1.5 text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/70 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
            disabled={redoStack.length === 0}
            onClick={redo}
            className="rounded-md p-1.5 text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/70 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <span
          data-testid="save-status-indicator"
          className="hidden items-center gap-1 text-[11px] font-semibold text-[#072D59]/55 sm:inline-flex"
        >
          <Check className="h-3 w-3 text-emerald-600" />
          {saveStatus === 'saving' ? 'Saving…' : 'Saved'}
        </span>
      </div>

      {/* Right: Lock Now, Smart Dark Paper, Export, Pages Drawer, Shortcuts (?) */}
      <div className="flex items-center gap-1.5">
        {activeNotebook?.isLocked && (
          <button
            type="button"
            data-testid="lock-now-button"
            title="Lock notebook and clear Master Key from memory"
            onClick={() => void lockNow()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-300/70 transition duration-150 hover:bg-amber-100"
          >
            <Lock className="h-3.5 w-3.5" />
            <span>Lock Now</span>
          </button>
        )}

        <button
          type="button"
          data-testid="dark-paper-toggle"
          title={
            darkPaperView
              ? 'Smart Dark Paper View: On (click to restore light paper)'
              : 'Smart Dark Paper View: Off (invert white paper to dark slate on screen)'
          }
          aria-label="Toggle Smart Dark Paper View"
          aria-pressed={darkPaperView}
          onClick={() => setDarkPaperView(!darkPaperView)}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition duration-150 ${
            darkPaperView
              ? 'border-[#072D59] bg-[#072D59] text-[#DBF2FC] shadow-2xs'
              : 'border-[#072D59]/12 bg-white/85 text-[#072D59]/80 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]'
          }`}
        >
          {darkPaperView ? <Sun className="h-4 w-4 text-amber-300" /> : <Moon className="h-4 w-4" />}
        </button>

        <button
          type="button"
          title="Export Notebook (Ctrl+E)"
          aria-label="Export Notebook"
          onClick={onOpenExport}
          className="folio-btn-crimson inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold shadow-2xs"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Export</span>
        </button>

        {onToggleAiSidebar && (
          <button
            type="button"
            data-testid="ai-sidebar-toggle"
            title="Gemini AI Study Suite (Ctrl+Shift+A)"
            aria-label="Toggle Gemini AI Study Suite"
            aria-pressed={aiSidebarOpen}
            onClick={onToggleAiSidebar}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition duration-150 ${
              aiSidebarOpen
                ? 'border-[#072D59] bg-[#072D59] text-[#DBF2FC] shadow-2xs'
                : 'border-[#072D59]/12 bg-white/85 text-[#072D59] hover:bg-[#DBF2FC]/70'
            }`}
          >
            <Sparkles
              className={`h-3.5 w-3.5 ${aiSidebarOpen ? 'text-[#FD6E88]' : 'text-[#FD6E88]'}`}
            />
            <span className="hidden lg:inline">Gemini AI</span>
          </button>
        )}

        <button
          type="button"
          data-testid="pages-drawer-toggle"
          title="Pages Drawer (Ctrl+/)"
          aria-label="Toggle Pages Drawer"
          aria-pressed={drawerOpen}
          onClick={onToggleDrawer}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition duration-150 ${
            drawerOpen
              ? 'bg-[#072D59] text-white shadow-2xs'
              : 'text-[#072D59]/80 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]'
          }`}
        >
          {drawerOpen ? <PanelLeft className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
          <span className="hidden md:inline">Pages</span>
        </button>

        <button
          type="button"
          data-testid="shortcuts-modal-button"
          title="Keyboard Shortcuts (?)"
          aria-label="Keyboard Shortcuts"
          onClick={onOpenShortcuts}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#072D59]/75 transition duration-150 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
};
