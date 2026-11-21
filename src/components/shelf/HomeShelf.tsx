import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignJustify,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  Edit3,
  FileUp,
  Folder as FolderIcon,
  FolderPlus,
  Grid3X3,
  Home,
  Layers,
  Lock,
  LockOpen,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { COVER_PRESETS } from '../../constants/covers';
import { BUILT_IN_PAPER_PRESETS } from '../../constants/papers';
import { repository } from '../../db/repository';
import { useAppStore } from '../../store/useAppStore';
import type {
  Folder,
  Notebook,
  Page,
  PageImage,
  PaperConfig,
  Stroke,
  Textbox,
} from '../../types/notes';
import { isPdfFile } from '../../utils/pdfEngine';
import { hasVaultSetup } from '../../utils/vaultCrypto';
import { ExportModal } from '../modals/ExportModal';
import { FolderModal } from '../modals/FolderModal';
import { NotebookModal } from '../modals/NotebookModal';
import { SettingsModal } from '../modals/SettingsModal';
import { TemplatePickerModal } from '../modals/TemplatePickerModal';
import { UnlockNotebookModal } from '../modals/UnlockNotebookModal';
import { VaultSetupModal } from '../modals/VaultSetupModal';
import { CoverPreview } from './CoverPreview';

type SortMode = 'updated' | 'title' | 'created';

function formatRelativeDate(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

const QUICK_PAPER_ACTIONS: Array<{
  id: string;
  presetId: string;
  label: string;
  defaultTitle: string;
  coverIndex: number;
  icon: React.ReactNode;
}> = [
  {
    id: 'blank',
    presetId: 'builtin-blank',
    label: '+ Blank',
    defaultTitle: 'Blank Notes',
    coverIndex: 0,
    icon: <Plus className="h-3.5 w-3.5 text-[#FD6E88]" />,
  },
  {
    id: 'ruled',
    presetId: 'builtin-ruled-letter',
    label: 'Ruled',
    defaultTitle: 'Ruled Notes',
    coverIndex: 1,
    icon: <AlignJustify className="h-3.5 w-3.5" />,
  },
  {
    id: 'grid',
    presetId: 'builtin-grid',
    label: 'Grid',
    defaultTitle: 'Grid Notes',
    coverIndex: 2,
    icon: <Grid3X3 className="h-3.5 w-3.5" />,
  },
  {
    id: 'cornell',
    presetId: 'builtin-cornell',
    label: 'Cornell',
    defaultTitle: 'Cornell Notes',
    coverIndex: 3,
    icon: <Columns2 className="h-3.5 w-3.5" />,
  },
];

export const HomeShelf: React.FC = () => {
  const currentFolderId = useAppStore((s) => s.currentFolderId);
  const folders = useAppStore((s) => s.folders);
  const notebooks = useAppStore((s) => s.notebooks);
  const breadcrumbs = useAppStore((s) => s.breadcrumbs);
  const customTemplates = useAppStore((s) => s.customTemplates);
  const shelfLoading = useAppStore((s) => s.shelfLoading);
  const heroHeadline = useAppStore((s) => s.heroHeadline);

  const navigateToFolder = useAppStore((s) => s.navigateToFolder);
  const openNotebook = useAppStore((s) => s.openNotebook);
  const duplicateNotebook = useAppStore((s) => s.duplicateNotebook);
  const deleteNotebook = useAppStore((s) => s.deleteNotebook);
  const deleteFolder = useAppStore((s) => s.deleteFolder);
  const createNotebook = useAppStore((s) => s.createNotebook);
  const importFolioNotebook = useAppStore((s) => s.importFolioNotebook);
  const importPdfAsNotebook = useAppStore((s) => s.importPdfAsNotebook);
  const setHeroHeadline = useAppStore((s) => s.setHeroHeadline);

  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('updated');
  const [editingHeroHeadline, setEditingHeroHeadline] = useState(false);
  const [heroDraft, setHeroDraft] = useState(heroHeadline);
  const heroInputRef = useRef<HTMLInputElement | null>(null);

  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [notebookModalOpen, setNotebookModalOpen] = useState(false);
  const [editingNotebook, setEditingNotebook] = useState<Notebook | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [foldersJumpOpen, setFoldersJumpOpen] = useState(false);
  const [allFolders, setAllFolders] = useState<Folder[]>([]);
  const [vaultSetupNotebook, setVaultSetupNotebook] = useState<Notebook | null>(null);
  const [vaultSetupOpen, setVaultSetupOpen] = useState(false);
  const [unlockModalState, setUnlockModalState] = useState<{
    open: boolean;
    notebook: Notebook | null;
    mode: 'open' | 'remove-lock' | 'lock-existing' | 'export';
  }>({ open: false, notebook: null, mode: 'open' });
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const shelfDragDepthRef = useRef(0);
  const [shelfDropActive, setShelfDropActive] = useState(false);
  const [importNotice, setImportNotice] = useState<{
    kind: 'success' | 'error';
    message: string;
    notebookId?: string;
  } | null>(null);
  const [exportState, setExportState] = useState<{
    open: boolean;
    notebook: Notebook | null;
    pages: Page[];
    pdfAssets?: Map<string, ArrayBuffer>;
  }>({ open: false, notebook: null, pages: [] });

  useEffect(() => {
    if (!foldersJumpOpen) return;
    void repository.getAllFolders().then((list) => {
      setAllFolders([...list].sort((a, b) => a.name.localeCompare(b.name)));
    });
  }, [foldersJumpOpen, folders]);

  useEffect(() => {
    if (editingHeroHeadline && heroInputRef.current) {
      heroInputRef.current.focus();
      heroInputRef.current.select();
    }
  }, [editingHeroHeadline]);

  const commitHeroHeadline = () => {
    setEditingHeroHeadline(false);
    setHeroHeadline(heroDraft);
  };

  const handleImportFolioFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const raw = await file.text();
      const created = await importFolioNotebook(raw, false);
      setImportNotice({
        kind: 'success',
        message: `Imported "${created.title}" into your shelf.`,
        notebookId: created.id,
      });
    } catch (err) {
      setImportNotice({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to import .folio.json archive.',
      });
    }
  };

  const handleImportPdfFiles = async (files: File[]) => {
    const pdfs = files.filter(isPdfFile);
    if (pdfs.length === 0) return;

    if (pdfs.length === 1) {
      try {
        await importPdfAsNotebook(pdfs[0], true);
      } catch (err) {
        setImportNotice({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to import PDF document.',
        });
      }
      return;
    }

    let importedCount = 0;
    let lastNotebook: Notebook | null = null;
    try {
      for (const pdf of pdfs) {
        const created = await importPdfAsNotebook(pdf, false);
        if (created) {
          importedCount++;
          lastNotebook = created;
        }
      }
      if (importedCount > 0 && lastNotebook) {
        setImportNotice({
          kind: 'success',
          message: `Imported ${importedCount} PDF notebooks into your shelf.`,
          notebookId: lastNotebook.id,
        });
      }
    } catch (err) {
      setImportNotice({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to import PDF document.',
      });
    }
  };

  const handleShelfDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    shelfDragDepthRef.current += 1;
    setShelfDropActive(true);
  };

  const handleShelfDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleShelfDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    shelfDragDepthRef.current = Math.max(0, shelfDragDepthRef.current - 1);
    if (shelfDragDepthRef.current === 0) {
      setShelfDropActive(false);
    }
  };

  const handleShelfDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    shelfDragDepthRef.current = 0;
    setShelfDropActive(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;

    const pdfs = files.filter(isPdfFile);
    const folioFiles = files.filter((f) => f.name.toLowerCase().endsWith('.json'));
    if (pdfs.length === 0 && folioFiles.length === 0) return;

    e.preventDefault();
    e.stopPropagation();

    if (pdfs.length > 0) {
      await handleImportPdfFiles(pdfs);
      return;
    }

    if (folioFiles.length > 0) {
      try {
        const raw = await folioFiles[0].text();
        const created = await importFolioNotebook(raw, false);
        setImportNotice({
          kind: 'success',
          message: `Imported "${created.title}" into your shelf.`,
          notebookId: created.id,
        });
      } catch (err) {
        setImportNotice({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to import .folio.json archive.',
        });
      }
    }
  };

  const handleExportFromMenu = async (notebook: Notebook) => {
    setOpenMenuId(null);
    if (notebook.isLocked) {
      setUnlockModalState({ open: true, notebook, mode: 'export' });
      return;
    }
    try {
      const loaded = await repository.getNotebookWithPages(notebook.id);
      if (!loaded) return;
      setExportState({ open: true, notebook: loaded.notebook, pages: loaded.pages });
    } catch (err) {
      setImportNotice({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to load notebook for export.',
      });
    }
  };

  const handleNotebookCardClick = (notebook: Notebook) => {
    if (notebook.isLocked) {
      setUnlockModalState({ open: true, notebook, mode: 'open' });
      return;
    }
    void openNotebook(notebook.id);
  };

  const handleLockActionFromMenu = (notebook: Notebook) => {
    setOpenMenuId(null);
    if (notebook.isLocked) {
      setUnlockModalState({ open: true, notebook, mode: 'remove-lock' });
      return;
    }
    if (!hasVaultSetup()) {
      setVaultSetupNotebook(notebook);
      setVaultSetupOpen(true);
      return;
    }
    setUnlockModalState({ open: true, notebook, mode: 'lock-existing' });
  };

  const handleQuickCreatePreset = async (
    presetId: string,
    defaultTitle: string,
    coverIndex: number,
  ) => {
    const preset = BUILT_IN_PAPER_PRESETS.find((p) => p.id === presetId) ?? BUILT_IN_PAPER_PRESETS[0];
    const presetCover = (COVER_PRESETS[coverIndex % COVER_PRESETS.length] ?? COVER_PRESETS[0]).cover;
    await createNotebook({
      title: defaultTitle,
      folderId: currentFolderId,
      cover: { ...presetCover },
      paper: preset.paper,
      openImmediately: true,
    });
  };

  const handleLaunchTemplate = async (
    title: string,
    paper: PaperConfig,
    strokes?: Stroke[],
    textboxes?: Textbox[],
    images?: PageImage[],
  ) => {
    await createNotebook({
      title,
      folderId: currentFolderId,
      cover: {
        ...(COVER_PRESETS[0]?.cover ?? {
          styleId: 'classic-navy',
          primaryColor: '#072D59',
          accentColor: '#DBF2FC',
          pattern: 'spine-band',
        }),
      },
      paper,
      initialStrokes: strokes,
      initialTextboxes: textboxes,
      initialImages: images,
      openImmediately: true,
    });
  };

  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? folders.filter((f) => f.name.toLowerCase().includes(q)) : folders;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [folders, query]);

  const filteredNotebooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? notebooks.filter((n) => n.title.toLowerCase().includes(q)) : notebooks;
    return [...list].sort((a, b) => {
      if (sortMode === 'title') return a.title.localeCompare(b.title);
      if (sortMode === 'created') return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });
  }, [notebooks, query, sortMode]);

  const matchingTemplates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const customMatches = customTemplates
      .filter(
        (t) =>
          t.name.toLowerCase().includes(q) || t.paper.pattern.toLowerCase().includes(q),
      )
      .map((t) => ({
        id: t.id,
        name: t.name,
        subtitle: `Saved template · ${t.paper.pattern}`,
        paper: t.paper,
        strokes: t.strokes,
        textboxes: t.textboxes,
        images: t.images,
      }));
    const builtInMatches = BUILT_IN_PAPER_PRESETS.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q) ||
        b.paper.pattern.toLowerCase().includes(q),
    ).map((b) => ({
      id: b.id,
      name: b.name,
      subtitle: b.description,
      paper: b.paper,
      strokes: [] as Stroke[],
      textboxes: undefined,
      images: undefined,
    }));
    return [...customMatches, ...builtInMatches];
  }, [query, customTemplates]);

  const activeFolderName =
    breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].name : null;

  return (
    <div
      className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#F4F8FB] text-[#072D59] md:flex-row"
      onClick={() => {
        if (openMenuId) setOpenMenuId(null);
        if (foldersJumpOpen) setFoldersJumpOpen(false);
      }}
      onDragEnter={handleShelfDragEnter}
      onDragOver={handleShelfDragOver}
      onDragLeave={handleShelfDragLeave}
      onDrop={(e) => void handleShelfDrop(e)}
    >
      {/* Drag-and-Drop PDF Shelf Overlay */}
      {shelfDropActive && (
        <div
          data-testid="shelf-pdf-drop-overlay"
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[#072D59]/25 backdrop-blur-xs"
        >
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[#FD6E88] bg-white/95 px-8 py-6 text-center shadow-2xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#DBF2FC] text-[#072D59]">
              <FileUp className="h-6 w-6 text-[#FD6E88]" />
            </div>
            <p className="text-sm font-bold text-[#072D59]">Drop PDF to create an annotated notebook</p>
            <p className="text-xs text-[#072D59]/65">
              100% offline · Unlimited size · Preserves page aspect ratios
            </p>
          </div>
        </div>
      )}

      {/* Hidden Folio Backup & PDF Import Inputs */}
      <input
        ref={importInputRef}
        type="file"
        accept=".folio.json,.json,application/json"
        data-testid="import-folio-input"
        onChange={(e) => void handleImportFolioFile(e)}
        className="hidden"
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        data-testid="import-pdf-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) {
            void handleImportPdfFiles(files);
          }
        }}
        className="hidden"
      />

      {/* Deep Navy Left Icon Rail (68px desktop) / Compact Bottom Nav (< md narrow panes) */}
      <nav
        data-testid="home-icon-rail"
        aria-label="Primary workspace navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-center justify-around border-t border-white/12 bg-[#072D59] px-2 text-white shadow-[0_-8px_24px_rgba(7,45,89,0.22)] md:sticky md:inset-x-auto md:bottom-auto md:top-0 md:h-screen md:w-[68px] md:shrink-0 md:flex-col md:justify-between md:border-r md:border-white/10 md:border-t-0 md:px-0 md:py-4 md:shadow-[4px_0_24px_rgba(7,45,89,0.12)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full items-center justify-around md:h-full md:flex-col md:justify-start md:gap-4">
          {/* Primary Crimson Circle Create Button */}
          <button
            type="button"
            data-testid="rail-new-notebook-btn"
            aria-label="Create New Notebook"
            title="New Notebook"
            onClick={() => {
              setEditingNotebook(null);
              setNotebookModalOpen(true);
            }}
            className="group order-3 flex flex-col items-center gap-1 md:order-1 md:mb-1"
          >
            <span className="folio-btn-crimson flex h-10 w-10 items-center justify-center rounded-full shadow-[0_6px_18px_rgba(253,110,136,0.45)] group-hover:scale-105 md:h-11 md:w-11">
              <Plus className="h-5 w-5 stroke-[2.5]" />
            </span>
            <span className="hidden text-[10px] font-semibold tracking-tight text-white/90 md:block">
              Create
            </span>
          </button>

          {/* Home */}
          <button
            type="button"
            data-testid="rail-nav-home"
            onClick={() => {
              setFoldersJumpOpen(false);
              setQuery('');
              void navigateToFolder(null);
            }}
            className={`order-1 flex flex-col items-center gap-0.5 rounded-xl px-2.5 py-1 transition duration-150 md:order-2 md:w-14 md:px-1 md:py-2 ${
              currentFolderId === null && !foldersJumpOpen
                ? 'bg-white/12 text-white ring-1 ring-white/15'
                : 'text-[#DBF2FC]/80 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Home className="h-4.5 w-4.5" />
            <span className="text-[10px] font-semibold">Home</span>
          </button>

          {/* Folders Quick Jump */}
          <div className="relative order-2 md:order-3">
            <button
              type="button"
              data-testid="rail-nav-folders"
              aria-expanded={foldersJumpOpen}
              onClick={() => setFoldersJumpOpen((o) => !o)}
              className={`flex flex-col items-center gap-0.5 rounded-xl px-2.5 py-1 transition duration-150 md:w-14 md:px-1 md:py-2 ${
                currentFolderId !== null || foldersJumpOpen
                  ? 'bg-white/12 text-white ring-1 ring-white/15'
                  : 'text-[#DBF2FC]/80 hover:bg-white/10 hover:text-white'
              }`}
            >
              <FolderIcon className="h-4.5 w-4.5" />
              <span className="text-[10px] font-semibold">Folders</span>
            </button>

            {foldersJumpOpen && (
              <div
                data-testid="folders-jump-popover"
                className="absolute bottom-full left-1/2 z-40 mb-3 w-64 -translate-x-1/2 rounded-2xl border border-[#072D59]/14 bg-white p-2 text-[#072D59] shadow-2xl md:bottom-auto md:left-full md:top-0 md:mb-0 md:ml-3 md:translate-x-0"
              >
                <div className="mb-1.5 flex items-center justify-between px-2 py-1">
                  <span className="folio-section-label text-[10px] font-bold uppercase text-[#072D59]/60">
                    Jump to Folder
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setFoldersJumpOpen(false);
                      setEditingFolder(null);
                      setFolderModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#DBF2FC]/80 px-2 py-0.5 text-[11px] font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]"
                  >
                    <FolderPlus className="h-3 w-3" />
                    New
                  </button>
                </div>

                <div className="custom-scrollbar max-h-56 space-y-0.5 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setFoldersJumpOpen(false);
                      void navigateToFolder(null);
                    }}
                    className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-semibold transition duration-150 ${
                      currentFolderId === null
                        ? 'bg-[#DBF2FC]/75 text-[#072D59]'
                        : 'text-[#072D59]/80 hover:bg-[#DBF2FC]/40'
                    }`}
                  >
                    <Home className="h-3.5 w-3.5 text-[#072D59]" />
                    <span>All Notes (Root)</span>
                  </button>

                  {allFolders.length === 0 ? (
                    <div className="px-2.5 py-3 text-center text-[11px] text-[#072D59]/55">
                      No folders created yet.
                    </div>
                  ) : (
                    allFolders.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          setFoldersJumpOpen(false);
                          void navigateToFolder(f.id);
                        }}
                        className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs font-medium transition duration-150 ${
                          currentFolderId === f.id
                            ? 'bg-[#DBF2FC]/75 font-semibold text-[#072D59]'
                            : 'text-[#072D59]/80 hover:bg-[#DBF2FC]/40'
                        }`}
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: f.color }}
                        />
                        <span className="truncate">{f.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Templates */}
          <button
            type="button"
            data-testid="rail-nav-templates"
            onClick={() => setTemplatesOpen(true)}
            className="order-4 flex flex-col items-center gap-0.5 rounded-xl px-2.5 py-1 text-[#DBF2FC]/80 transition duration-150 hover:bg-white/10 hover:text-white md:w-14 md:px-1 md:py-2"
          >
            <Layers className="h-4.5 w-4.5" />
            <span className="text-[10px] font-semibold">Templates</span>
          </button>

          {/* Settings (bottom pinned on desktop rail, rightmost on narrow bar) */}
          <button
            type="button"
            title="Settings"
            aria-label="Open Settings"
            data-testid="rail-nav-settings"
            onClick={() => setSettingsOpen(true)}
            className="order-5 flex flex-col items-center gap-0.5 rounded-xl px-2.5 py-1 text-[#DBF2FC]/80 transition duration-150 hover:bg-white/10 hover:text-white md:mt-auto md:w-14 md:px-1 md:py-2"
          >
            <Settings className="h-4.5 w-4.5" />
            <span className="text-[10px] font-semibold">Settings</span>
          </button>
        </div>
      </nav>

      {/* Main Seamless Mist Workspace */}
      <div className="folio-shelf-canvas flex min-w-0 flex-1 flex-col pb-20 md:pb-12">
        {/* Seamless Full-Bleed Atmospheric Gradient Header (~185px) */}
        <header
          data-testid="home-hero-banner"
          className="folio-hero-banner w-full px-4 pb-5 pt-5 sm:px-8 sm:pt-6"
        >
          <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
            {breadcrumbs.length > 0 && (
              <nav
                aria-label="Folder breadcrumbs"
                className="mb-2 inline-flex flex-wrap items-center gap-1 rounded-full border border-[#072D59]/10 bg-white/75 px-2.5 py-0.5 text-xs backdrop-blur-xs"
              >
                <button
                  type="button"
                  onClick={() => void navigateToFolder(null)}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[#072D59]/75 transition duration-150 hover:bg-white hover:text-[#072D59]"
                >
                  <Home className="h-3 w-3" />
                  <span>All Notes</span>
                </button>
                {breadcrumbs.map((crumb, idx) => {
                  const isLast = idx === breadcrumbs.length - 1;
                  return (
                    <React.Fragment key={crumb.id}>
                      <ChevronRight className="h-3 w-3 text-[#072D59]/40" />
                      <button
                        type="button"
                        onClick={() => void navigateToFolder(crumb.id)}
                        className={`rounded-full px-2 py-0.5 font-semibold transition duration-150 ${
                          isLast
                            ? 'bg-[#072D59] text-white'
                            : 'text-[#072D59]/75 hover:bg-white hover:text-[#072D59]'
                        }`}
                      >
                        {crumb.name}
                      </button>
                    </React.Fragment>
                  );
                })}
              </nav>
            )}

            {/* Compact Editorial Greeting (Click to edit at Root) */}
            {activeFolderName ? (
              <h1 className="folio-display-heading text-2xl font-bold text-[#072D59] sm:text-[32px] sm:leading-tight">
                {activeFolderName}
              </h1>
            ) : editingHeroHeadline ? (
              <input
                ref={heroInputRef}
                data-testid="hero-headline-input"
                type="text"
                maxLength={80}
                value={heroDraft}
                onChange={(e) => setHeroDraft(e.target.value)}
                onBlur={commitHeroHeadline}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitHeroHeadline();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setHeroDraft(heroHeadline);
                    setEditingHeroHeadline(false);
                  }
                }}
                aria-label="Edit workspace headline"
                className="folio-display-heading w-full max-w-md rounded-xl border border-[#FD6E88] bg-white/95 px-3 py-0.5 text-center text-2xl font-bold text-[#072D59] shadow-sm outline-none ring-4 ring-[#FD6E88]/20 sm:text-[32px]"
              />
            ) : (
              <h1 className="folio-display-heading text-2xl font-bold text-[#072D59] sm:text-[32px] sm:leading-tight">
                <button
                  type="button"
                  data-testid="hero-headline-button"
                  title="Click to customize your workspace headline"
                  onClick={() => {
                    setHeroDraft(heroHeadline);
                    setEditingHeroHeadline(true);
                  }}
                  className="group inline-flex items-center gap-2 rounded-xl px-2 py-0.5 transition duration-150 hover:bg-white/45"
                >
                  <span>{heroHeadline}</span>
                  <Pencil className="h-3.5 w-3.5 text-[#072D59]/35 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                </button>
              </h1>
            )}

            {/* Sleek 440px Pill Search Bar */}
            <div className="mt-3 w-full max-w-[440px]">
              <div className="relative flex items-center rounded-full border border-[#072D59]/12 bg-white/95 px-3.5 py-2 shadow-[0_6px_20px_-6px_rgba(7,45,89,0.14)] transition duration-150 focus-within:border-[#FD6E88] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#FD6E88]/20">
                <Search className="h-4 w-4 shrink-0 text-[#072D59]/55" />
                <input
                  type="search"
                  data-testid="shelf-search-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search notebooks, folders, or templates..."
                  className="w-full bg-transparent pl-2.5 pr-1.5 text-[13px] font-medium text-[#072D59] placeholder:text-[#072D59]/45 outline-none"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setQuery('')}
                    className="rounded-full p-0.5 text-[#072D59]/50 transition duration-150 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Single Tight Row of Horizontal Quick-Create Chips */}
            <div
              data-testid="quick-create-row"
              className="mt-3 flex flex-wrap items-center justify-center gap-2"
            >
              {QUICK_PAPER_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  data-testid={`quick-create-${action.id}`}
                  onClick={() =>
                    void handleQuickCreatePreset(
                      action.presetId,
                      action.defaultTitle,
                      action.coverIndex,
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#072D59]/12 bg-white/88 px-3 py-1.5 text-xs font-semibold text-[#072D59] shadow-2xs backdrop-blur-xs transition duration-150 hover:-translate-y-0.5 hover:border-[#FD6E88] hover:bg-white hover:shadow-sm"
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              ))}

              <button
                type="button"
                data-testid="quick-create-templates"
                onClick={() => setTemplatesOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#072D59]/12 bg-white/88 px-3 py-1.5 text-xs font-semibold text-[#072D59] shadow-2xs backdrop-blur-xs transition duration-150 hover:-translate-y-0.5 hover:border-[#072D59]/40 hover:bg-white hover:shadow-sm"
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Templates</span>
              </button>

              <button
                type="button"
                data-testid="import-pdf-btn"
                onClick={() => pdfInputRef.current?.click()}
                title="Import any PDF document as an annotatable notebook"
                className="inline-flex items-center gap-1.5 rounded-full border border-[#072D59]/12 bg-white/88 px-3 py-1.5 text-xs font-semibold text-[#072D59] shadow-2xs backdrop-blur-xs transition duration-150 hover:-translate-y-0.5 hover:border-[#FD6E88] hover:bg-white hover:shadow-sm"
              >
                <FileUp className="h-3.5 w-3.5 text-[#FD6E88]" />
                <span>Import PDF</span>
              </button>

              <button
                type="button"
                data-testid="import-folio-btn"
                onClick={() => importInputRef.current?.click()}
                title="Import an editable .folio.json notebook archive"
                className="inline-flex items-center gap-1.5 rounded-full border border-[#072D59]/12 bg-white/88 px-3 py-1.5 text-xs font-semibold text-[#072D59] shadow-2xs backdrop-blur-xs transition duration-150 hover:-translate-y-0.5 hover:border-[#FD6E88] hover:bg-white hover:shadow-sm"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Import</span>
              </button>
            </div>
          </div>
        </header>

        {/* Centered Shelf Content */}
        <div className="mx-auto w-full max-w-6xl space-y-6 px-4 sm:px-8">
          {/* Import / Status Banner */}
          {importNotice && (
            <div
              data-testid="import-folio-notice"
              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs shadow-sm ${
                importNotice.kind === 'error'
                  ? 'border-[#FD6E88]/40 bg-white text-[#F95573]'
                  : 'border-[#072D59]/12 bg-white/95 text-[#072D59]'
              }`}
            >
              <span className="font-semibold">{importNotice.message}</span>
              <div className="flex items-center gap-2">
                {importNotice.notebookId && (
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = importNotice.notebookId;
                      setImportNotice(null);
                      if (targetId) void openNotebook(targetId);
                    }}
                    className="folio-btn-crimson rounded-xl px-3 py-1.5 text-xs font-semibold shadow-2xs"
                  >
                    Open Notebook
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Dismiss notice"
                  onClick={() => setImportNotice(null)}
                  className="rounded-lg p-1 text-[#072D59]/65 transition duration-150 hover:bg-[#DBF2FC]/70"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Main Shelf Body */}
          {shelfLoading ? (
            <div className="py-16 text-center text-sm font-medium text-[#072D59]/65">
              Loading your local library…
            </div>
          ) : (
            <main className="space-y-7">
              {/* Search Matching Templates */}
              {matchingTemplates.length > 0 && (
                <section data-testid="matching-templates-section">
                  <div className="mb-2.5 flex items-center justify-between">
                    <h2 className="folio-section-label text-xs font-bold uppercase text-[#072D59]/65 tabular-nums">
                      Matching Templates ({matchingTemplates.length})
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {matchingTemplates.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() =>
                          void handleLaunchTemplate(
                            tpl.name,
                            tpl.paper,
                            tpl.strokes,
                            tpl.textboxes,
                            tpl.images,
                          )
                        }
                        className="flex items-center gap-3 rounded-2xl border border-[#072D59]/12 bg-white p-3.5 text-left shadow-[0_4px_14px_-4px_rgba(7,45,89,0.08)] transition duration-150 hover:-translate-y-0.5 hover:border-[#FD6E88]/65 hover:shadow-md"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#DBF2FC] text-[#072D59]">
                          <Layers className="h-4.5 w-4.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-[#072D59]">
                            {tpl.name}
                          </div>
                          <div className="truncate text-[11px] font-medium text-[#072D59]/60">
                            {tpl.subtitle}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Folders Grid */}
              {filteredFolders.length > 0 && (
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="folio-section-label text-xs font-bold uppercase text-[#072D59]/65 tabular-nums">
                      Folders ({filteredFolders.length})
                    </h2>
                    <button
                      type="button"
                      data-testid="new-folder-btn"
                      onClick={() => {
                        setEditingFolder(null);
                        setFolderModalOpen(true);
                      }}
                      className="folio-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold shadow-2xs"
                    >
                      <FolderPlus className="h-3.5 w-3.5 text-[#FD6E88]" />
                      <span>New Folder</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {filteredFolders.map((folder) => {
                      const menuOpen = openMenuId === `folder-${folder.id}`;
                      return (
                        <div
                          key={folder.id}
                          className="group relative flex items-center justify-between rounded-2xl border border-[#072D59]/12 bg-white p-3.5 shadow-[0_4px_14px_-4px_rgba(7,45,89,0.09)] transition duration-150 hover:-translate-y-0.5 hover:border-[#072D59]/25 hover:shadow-md"
                        >
                          <button
                            type="button"
                            onClick={() => void navigateToFolder(folder.id)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <div
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-xs"
                              style={{ backgroundColor: folder.color }}
                            >
                              <FolderIcon className="h-5 w-5 fill-current/25" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold text-[#072D59]">
                                {folder.name}
                              </div>
                              <div className="text-[11px] font-medium text-[#072D59]/50">
                                Folder
                              </div>
                            </div>
                          </button>

                          <button
                            type="button"
                            aria-label={`Folder options for ${folder.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(menuOpen ? null : `folder-${folder.id}`);
                            }}
                            className="rounded-lg p-1 text-[#072D59]/45 transition duration-150 hover:bg-[#DBF2FC]/60 hover:text-[#072D59]"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>

                          {menuOpen && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-2 top-12 z-30 w-42 rounded-xl border border-[#072D59]/12 bg-white p-1.5 shadow-xl"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  setEditingFolder(folder);
                                  setFolderModalOpen(true);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/55"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                                Rename / Color
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  void deleteFolder(folder.id);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#F95573] transition duration-150 hover:bg-[#FD6E88]/10"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete Folder
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Notebooks Grid (Starts cleanly with user's notebooks) */}
              <section>
                <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="folio-section-label text-xs font-bold uppercase text-[#072D59]/65 tabular-nums">
                    Notebooks ({filteredNotebooks.length})
                  </h2>

                  <div className="flex items-center gap-2">
                    {filteredFolders.length === 0 && (
                      <button
                        type="button"
                        data-testid="new-folder-btn"
                        onClick={() => {
                          setEditingFolder(null);
                          setFolderModalOpen(true);
                        }}
                        className="folio-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold shadow-2xs"
                      >
                        <FolderPlus className="h-3.5 w-3.5 text-[#FD6E88]" />
                        <span>New Folder</span>
                      </button>
                    )}

                    <select
                      aria-label="Sort notebooks"
                      value={sortMode}
                      onChange={(e) => setSortMode(e.target.value as SortMode)}
                      className="folio-input rounded-xl px-3 py-1.5 text-xs font-semibold shadow-2xs"
                    >
                      <option value="updated">Recently Edited</option>
                      <option value="created">Newest Created</option>
                      <option value="title">Title (A–Z)</option>
                    </select>
                  </div>
                </div>

                {filteredNotebooks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-[#072D59]/10 bg-white/70 py-14 text-center">
                    <p className="text-sm font-semibold text-[#072D59]">
                      {query.trim()
                        ? `No notebooks match "${query.trim()}"`
                        : 'No notebooks in this folder yet'}
                    </p>
                    <p className="mt-1 text-xs text-[#072D59]/60">
                      Use the + Create button or choose a quick paper above to start one.
                    </p>
                  </div>
                ) : (
                  <div
                    data-testid="notebooks-grid"
                    className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
                  >
                    {filteredNotebooks.map((notebook) => {
                      const menuOpen = openMenuId === `nb-${notebook.id}`;
                      return (
                        <div key={notebook.id} className="group relative flex flex-col">
                          <button
                            type="button"
                            onClick={() => handleNotebookCardClick(notebook)}
                            className="folio-cover-lift aspect-[3/4] w-full text-left group-hover:-translate-y-1.5"
                          >
                            <CoverPreview
                              cover={notebook.cover}
                              title={notebook.title}
                              locked={Boolean(notebook.isLocked)}
                              className="h-full w-full"
                            />
                          </button>

                          <div className="mt-2.5 flex items-start justify-between gap-1 px-0.5">
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => handleNotebookCardClick(notebook)}
                                className="block w-full truncate text-left text-sm font-bold text-[#072D59] transition duration-150 hover:text-[#FD6E88]"
                              >
                                {notebook.title}
                              </button>
                              <div className="text-[11px] font-medium text-[#072D59]/60 tabular-nums">
                                {notebook.pageOrder.length} page
                                {notebook.pageOrder.length === 1 ? '' : 's'} ·{' '}
                                {formatRelativeDate(notebook.updatedAt)}
                              </div>
                            </div>

                            <button
                              type="button"
                              aria-label={`Notebook options for ${notebook.title}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(menuOpen ? null : `nb-${notebook.id}`);
                              }}
                              className="rounded-lg p-1 text-[#072D59]/45 transition duration-150 hover:bg-white/80 hover:text-[#072D59]"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </div>

                          {menuOpen && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute bottom-10 right-0 z-30 w-48 rounded-xl border border-[#072D59]/12 bg-white p-1.5 shadow-2xl"
                            >
                              <button
                                type="button"
                                onClick={() => handleLockActionFromMenu(notebook)}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/55"
                              >
                                {notebook.isLocked ? (
                                  <>
                                    <LockOpen className="h-3.5 w-3.5 text-amber-600" />
                                    Unlock / Remove Lock
                                  </>
                                ) : (
                                  <>
                                    <Lock className="h-3.5 w-3.5 text-[#072D59]/75" />
                                    Lock Notebook
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  setEditingNotebook(notebook);
                                  setNotebookModalOpen(true);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/55"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                                Edit Cover / Move
                              </button>
                              <button
                                type="button"
                                data-testid="notebook-card-export-btn"
                                onClick={() => void handleExportFromMenu(notebook)}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/55"
                              >
                                <Download className="h-3.5 w-3.5 text-[#FD6E88]" />
                                {notebook.isLocked ? 'Unlock & Export…' : 'Export…'}
                              </button>
                              {!notebook.isLocked && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    void duplicateNotebook(notebook.id);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/55"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  Duplicate
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  void deleteNotebook(notebook.id);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#F95573] transition duration-150 hover:bg-[#FD6E88]/10"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete Notebook
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </main>
          )}
        </div>
      </div>

      {/* Modals */}
      <FolderModal
        open={folderModalOpen}
        editingFolder={editingFolder}
        onClose={() => setFolderModalOpen(false)}
      />

      <NotebookModal
        open={notebookModalOpen}
        editingNotebook={editingNotebook}
        defaultFolderId={currentFolderId}
        onClose={() => setNotebookModalOpen(false)}
      />

      <TemplatePickerModal
        open={templatesOpen}
        currentPaper={null}
        onSelect={async (paper, strokes, textboxes, images) => {
          await handleLaunchTemplate(
            `Notes (${paper.pattern})`,
            paper,
            strokes,
            textboxes,
            images,
          );
        }}
        onClose={() => setTemplatesOpen(false)}
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <VaultSetupModal
        open={vaultSetupOpen}
        notebookToLock={vaultSetupNotebook}
        onClose={() => {
          setVaultSetupOpen(false);
          setVaultSetupNotebook(null);
        }}
      />

      <UnlockNotebookModal
        open={unlockModalState.open}
        notebook={unlockModalState.notebook}
        mode={unlockModalState.mode}
        onUnlockedForExport={(unlockedNotebook, unlockedPages, pdfAssets) => {
          setExportState({
            open: true,
            notebook: unlockedNotebook,
            pages: unlockedPages,
            pdfAssets,
          });
        }}
        onClose={() => setUnlockModalState((s) => ({ ...s, open: false }))}
      />

      <ExportModal
        open={exportState.open}
        notebook={exportState.notebook}
        pages={exportState.pages}
        currentPageIndex={0}
        preloadedPdfAssets={exportState.pdfAssets}
        onClose={() => setExportState((s) => ({ ...s, open: false, pdfAssets: undefined }))}
      />
    </div>
  );
};
