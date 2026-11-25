import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Copy,
  Download,
  Edit3,
  FileUp,
  Folder as FolderIcon,
  FolderPlus,
  Home,
  Layers,
  Lock,
  LockOpen,
  MoreVertical,
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { DEFAULT_WHITEBOARD_PAPER } from '../../canvas/whiteboard';
import { COVER_PRESETS } from '../../constants/covers';
import {
  ALL_BUILT_IN_PAPER_VARIANTS,
  ALL_BUILT_IN_WHITEBOARD_VARIANTS,
  formatPaperPatternLabel,
} from '../../constants/papers';
import { formatTrashTimeRemaining, repository } from '../../db/repository';
import { useAppStore } from '../../store/useAppStore';
import { useUpdaterStore } from '../../store/useUpdaterStore';
import type {
  Folder,
  Notebook,
  NotebookMode,
  Page,
  PageImage,
  PaperConfig,
  Stroke,
  Textbox,
} from '../../types/notes';
import { isPdfFile } from '../../utils/pdfEngine';
import { hasVaultSetup } from '../../utils/vaultCrypto';
import { PaperShaderBackdrop } from '../common/PaperShaderBackdrop';
import { CommandPaletteModal } from '../modals/CommandPaletteModal';
import { ExportModal } from '../modals/ExportModal';
import { FolderModal } from '../modals/FolderModal';
import { NotebookModal } from '../modals/NotebookModal';
import { SettingsModal } from '../modals/SettingsModal';
import { TemplatePickerModal } from '../modals/TemplatePickerModal';
import { UnlockNotebookModal } from '../modals/UnlockNotebookModal';
import { VaultSetupModal } from '../modals/VaultSetupModal';
import { BookTiltCard } from './BookTiltCard';
import { CoverPreview } from './CoverPreview';

type SortMode = 'updated' | 'title' | 'created';

function formatRelativeDate(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

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
  const trashedNotebooks = useAppStore((s) => s.trashedNotebooks);
  const restoreTrashedNotebook = useAppStore((s) => s.restoreTrashedNotebook);
  const permanentlyDeleteTrashedNotebook = useAppStore((s) => s.permanentlyDeleteTrashedNotebook);
  const emptyTrash = useAppStore((s) => s.emptyTrash);
  const recentDeletedNotebooks = useAppStore((s) => s.recentDeletedNotebooks);
  const undoLastNotebookDelete = useAppStore((s) => s.undoLastNotebookDelete);
  const dismissNotebookDeleteUndo = useAppStore((s) => s.dismissNotebookDeleteUndo);
  const createNotebook = useAppStore((s) => s.createNotebook);
  const importFolioNotebook = useAppStore((s) => s.importFolioNotebook);
  const importPdfAsNotebook = useAppStore((s) => s.importPdfAsNotebook);
  const setHeroHeadline = useAppStore((s) => s.setHeroHeadline);
  const updateStatus = useUpdaterStore((s) => s.status);
  const updateRestarting = useUpdaterStore((s) => s.restarting);
  const restartAndInstall = useUpdaterStore((s) => s.restartAndInstall);

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
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmEmptyShelfTrash, setConfirmEmptyShelfTrash] = useState(false);
  const [allFolders, setAllFolders] = useState<Folder[]>([]);
  const [allNotebooks, setAllNotebooks] = useState<Notebook[]>([]);
  const [vaultSetupNotebook, setVaultSetupNotebook] = useState<Notebook | null>(null);
  const [vaultSetupOpen, setVaultSetupOpen] = useState(false);
  const [unlockModalState, setUnlockModalState] = useState<{
    open: boolean;
    notebook: Notebook | null;
    folder?: Folder | null;
    mode: 'open' | 'remove-lock' | 'lock-existing' | 'export' | 'delete' | 'delete-folder';
  }>({ open: false, notebook: null, folder: null, mode: 'open' });
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const shelfDragDepthRef = useRef(0);
  const openingNotebookRef = useRef(false);
  const [openingNotebookId, setOpeningNotebookId] = useState<string | null>(null);
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
    let active = true;
    void Promise.all([repository.getAllFolders(), repository.getAllNotebooks()]).then(
      ([folderList, nbList]) => {
        if (!active) return;
        setAllFolders([...folderList].sort((a, b) => a.name.localeCompare(b.name)));
        setAllNotebooks(nbList);
      },
    );
    return () => {
      active = false;
    };
  }, [folders, notebooks, commandPaletteOpen]);

  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        const target = e.target as HTMLElement | null;
        if (
          !commandPaletteOpen &&
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }

      if (
        !e.repeat &&
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'z'
      ) {
        const target = e.target as HTMLElement | null;
        const isEditable =
          Boolean(target) &&
          (target!.tagName === 'INPUT' ||
            target!.tagName === 'TEXTAREA' ||
            target!.tagName === 'SELECT' ||
            target!.isContentEditable);
        const anyModalOpen =
          commandPaletteOpen ||
          folderModalOpen ||
          notebookModalOpen ||
          templatesOpen ||
          settingsOpen ||
          vaultSetupOpen ||
          unlockModalState.open ||
          exportState.open;
        if (
          !isEditable &&
          !anyModalOpen &&
          useAppStore.getState().recentDeletedNotebooks.length > 0
        ) {
          e.preventDefault();
          void undoLastNotebookDelete();
        }
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [
    commandPaletteOpen,
    folderModalOpen,
    notebookModalOpen,
    templatesOpen,
    settingsOpen,
    vaultSetupOpen,
    unlockModalState.open,
    exportState.open,
    undoLastNotebookDelete,
  ]);

  useEffect(() => {
    if (editingHeroHeadline && heroInputRef.current) {
      heroInputRef.current.focus();
      heroInputRef.current.select();
    }
  }, [editingHeroHeadline]);

  useEffect(() => {
    if (trashedNotebooks.length === 0) {
      setConfirmEmptyShelfTrash(false);
    }
  }, [trashedNotebooks.length]);

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
      setUnlockModalState({ open: true, notebook, folder: null, mode: 'export' });
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

  const handleNotebookCardClick = async (notebook: Notebook) => {
    setOpenMenuId(null);
    if (notebook.isLocked) {
      setUnlockModalState({ open: true, notebook, folder: null, mode: 'open' });
      return;
    }
    if (openingNotebookRef.current) return;
    openingNotebookRef.current = true;
    setOpeningNotebookId(notebook.id);
    try {
      await openNotebook(notebook.id);
    } catch (err) {
      setImportNotice({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unable to open notebook.',
      });
    } finally {
      openingNotebookRef.current = false;
      setOpeningNotebookId(null);
    }
  };

  const handleLockActionFromMenu = (notebook: Notebook) => {
    setOpenMenuId(null);
    if (notebook.isLocked) {
      setUnlockModalState({ open: true, notebook, folder: null, mode: 'remove-lock' });
      return;
    }
    if (!hasVaultSetup()) {
      setVaultSetupNotebook(notebook);
      setVaultSetupOpen(true);
      return;
    }
    setUnlockModalState({ open: true, notebook, folder: null, mode: 'lock-existing' });
  };

  const handleDeleteNotebookFromMenu = (notebook: Notebook) => {
    setOpenMenuId(null);
    if (notebook.isLocked) {
      setUnlockModalState({ open: true, notebook, folder: null, mode: 'delete' });
      return;
    }
    void deleteNotebook(notebook.id);
  };

  const handleDeleteFolderFromMenu = async (folder: Folder) => {
    setOpenMenuId(null);
    const hasLocked = await repository.folderContainsLockedNotebook(folder.id);
    if (hasLocked) {
      setUnlockModalState({ open: true, notebook: null, folder, mode: 'delete-folder' });
      return;
    }
    await deleteFolder(folder.id);
  };

  const handleQuickCreateWhiteboard = async () => {
    const presetCover = (COVER_PRESETS[3] ?? COVER_PRESETS[0]).cover;
    await createNotebook({
      title: 'Untitled Whiteboard',
      mode: 'whiteboard',
      folderId: currentFolderId,
      cover: { ...presetCover },
      paper: { ...DEFAULT_WHITEBOARD_PAPER },
      openImmediately: true,
    });
  };

  const handleLaunchTemplate = async (
    title: string,
    paper: PaperConfig,
    strokes?: Stroke[],
    textboxes?: Textbox[],
    images?: PageImage[],
    mode: NotebookMode = 'notebook',
  ) => {
    const defaultCover =
      mode === 'whiteboard'
        ? COVER_PRESETS[3]?.cover ?? COVER_PRESETS[0]?.cover
        : COVER_PRESETS[0]?.cover;
    await createNotebook({
      title,
      mode,
      folderId: currentFolderId,
      cover: {
        ...(defaultCover ?? {
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

  const filteredTrashedNotebooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? trashedNotebooks.filter((item) => item.notebook.title.toLowerCase().includes(q))
      : trashedNotebooks;
  }, [trashedNotebooks, query]);

  const matchingTemplates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const customMatches = customTemplates
      .filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.paper.pattern.toLowerCase().includes(q) ||
          (t.mode === 'whiteboard' &&
            ('whiteboard'.includes(q) || 'board'.includes(q) || 'infinite'.includes(q))),
      )
      .map((t) => ({
        id: t.id,
        name: t.name,
        mode: (t.mode ?? 'notebook') as NotebookMode,
        subtitle: `Saved template · ${formatPaperPatternLabel(t.paper.pattern)}`,
        paper: t.paper,
        strokes: t.strokes,
        textboxes: t.textboxes,
        images: t.images,
      }));
    const whiteboardMatches = ALL_BUILT_IN_WHITEBOARD_VARIANTS.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.groupName.toLowerCase().includes(q) ||
        (b.variantLabel?.toLowerCase().includes(q) ?? false) ||
        b.paper.pattern.toLowerCase().includes(q) ||
        'whiteboard'.includes(q) ||
        'board'.includes(q) ||
        'infinite'.includes(q),
    ).map((b) => ({
      id: b.id,
      name: b.name,
      mode: 'whiteboard' as NotebookMode,
      subtitle: 'Whiteboard',
      paper: b.paper,
      strokes: [] as Stroke[],
      textboxes: undefined,
      images: undefined,
    }));
    const builtInMatches = ALL_BUILT_IN_PAPER_VARIANTS.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.groupName.toLowerCase().includes(q) ||
        (b.variantLabel?.toLowerCase().includes(q) ?? false) ||
        b.paper.pattern.toLowerCase().includes(q) ||
        formatPaperPatternLabel(b.paper.pattern).toLowerCase().includes(q),
    ).map((b) => ({
      id: b.id,
      name: b.name,
      mode: 'notebook' as NotebookMode,
      subtitle: formatPaperPatternLabel(b.paper.pattern),
      paper: b.paper,
      strokes: [] as Stroke[],
      textboxes: undefined,
      images: undefined,
    }));
    return [...customMatches, ...whiteboardMatches, ...builtInMatches];
  }, [query, customTemplates]);

  const activeFolderName =
    breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].name : null;

  const librarySummary = useMemo(() => {
    const source = allNotebooks.length > 0 ? allNotebooks : notebooks;
    const whiteboardCount = source.filter((n) => n.mode === 'whiteboard').length;
    const notebookCount = source.length - whiteboardCount;
    const totalPages = source.reduce((acc, n) => acc + Math.max(1, n.pageOrder.length), 0);
    return { notebookCount, whiteboardCount, totalPages };
  }, [allNotebooks, notebooks]);

  const anyModalOpen =
    commandPaletteOpen ||
    notebookModalOpen ||
    settingsOpen ||
    templatesOpen ||
    folderModalOpen ||
    vaultSetupOpen ||
    unlockModalState.open ||
    exportState.open;

  return (
    <div
      className="relative flex min-h-screen flex-col overflow-x-clip bg-[var(--surface-canvas)] text-[var(--navy-900)] md:flex-row"
      onClick={() => {
        if (openMenuId) setOpenMenuId(null);
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
          className="folio-modal-backdrop pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
        >
          <div className="folio-modal-card flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[var(--crimson-500)] px-8 py-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-seal)] text-[var(--navy-900)]">
              <FileUp className="h-6 w-6 text-[var(--crimson-500)]" />
            </div>
            <p className="text-sm font-bold text-[var(--navy-900)]">
              Drop PDF to create an annotated notebook
            </p>
            <p className="text-xs text-[var(--navy-600)]">
              100% offline · Preserves page aspect ratios
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

      {/* Detached Floating Glass Navigation Capsule (Left-Edge Centered Desktop / Bottom Pill < md) */}
      <nav
        data-testid="home-icon-rail"
        aria-label="Primary workspace navigation"
        className="folio-nav-capsule fixed bottom-3 left-1/2 z-30 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1 overflow-hidden rounded-full px-3 py-1.5 text-[var(--navy-900)] md:bottom-auto md:left-4 md:top-1/2 md:w-[64px] md:-translate-y-1/2 md:translate-x-0 md:flex-col md:gap-2 md:rounded-[24px] md:p-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        <PaperShaderBackdrop
          variant="hero"
          paused={anyModalOpen}
          data-testid="home-rail-shader"
        />
        <div
          aria-hidden="true"
          className="folio-rail-scrim pointer-events-none absolute inset-0 z-[1]"
        />

        {/* Home */}
        <button
          type="button"
          data-testid="rail-nav-home"
          aria-label="Home"
          title="Home"
          onClick={() => {
            setQuery('');
            void navigateToFolder(null);
          }}
          className={`folio-press relative z-10 flex flex-col items-center justify-center rounded-xl px-2.5 py-1.5 md:h-11 md:w-11 md:px-0 md:py-0 ${
            currentFolderId === null
              ? 'bg-white/88 text-[var(--navy-900)] shadow-xs ring-1 ring-white/85 backdrop-blur-sm'
              : 'text-[var(--navy-900)]/85 drop-shadow-[0_1px_1px_rgba(255,255,255,0.65)] hover:bg-white/70 hover:text-[var(--navy-900)]'
          }`}
        >
          <Home className="h-4.5 w-4.5" />
          <span className="mt-0.5 text-[9px] font-semibold md:hidden">Home</span>
        </button>

        {/* Templates */}
        <button
          type="button"
          data-testid="rail-nav-templates"
          aria-label="Templates"
          title="Templates"
          onClick={() => setTemplatesOpen(true)}
          className="folio-press relative z-10 flex flex-col items-center justify-center rounded-xl px-2.5 py-1.5 text-[var(--navy-900)]/85 drop-shadow-[0_1px_1px_rgba(255,255,255,0.65)] hover:bg-white/70 hover:text-[var(--navy-900)] md:h-11 md:w-11 md:px-0 md:py-0"
        >
          <Layers className="h-4.5 w-4.5" />
          <span className="mt-0.5 text-[9px] font-semibold md:hidden">Templates</span>
        </button>

        {updateStatus?.phase === 'ready' && (
          <button
            type="button"
            data-testid="rail-update-btn"
            disabled={updateRestarting}
            title={`Restart to Update (v${updateStatus.availableVersion ?? updateStatus.currentVersion})`}
            aria-label="Restart to Update"
            onClick={() => void restartAndInstall()}
            className="folio-btn-crimson relative z-10 flex flex-col items-center justify-center rounded-xl px-2.5 py-1.5 disabled:opacity-75 md:h-11 md:w-11 md:px-0 md:py-0"
          >
            <RefreshCw className={`h-4.5 w-4.5 ${updateRestarting ? 'animate-spin' : ''}`} />
            <span className="mt-0.5 text-[9px] font-bold md:hidden">Update</span>
          </button>
        )}

        {/* Settings */}
        <button
          type="button"
          title="Settings"
          aria-label="Open Settings"
          data-testid="rail-nav-settings"
          onClick={() => setSettingsOpen(true)}
          className="folio-press relative z-10 flex flex-col items-center justify-center rounded-xl px-2.5 py-1.5 text-[var(--navy-900)]/85 drop-shadow-[0_1px_1px_rgba(255,255,255,0.65)] hover:bg-white/70 hover:text-[var(--navy-900)] md:h-11 md:w-11 md:px-0 md:py-0"
        >
          <span className="relative">
            <Settings className="h-4.5 w-4.5" />
            {updateStatus?.phase === 'ready' && (
              <span
                data-testid="rail-settings-update-dot"
                className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--crimson-500)] ring-2 ring-white/90"
              />
            )}
          </span>
          <span className="mt-0.5 text-[9px] font-semibold md:hidden">Settings</span>
        </button>
      </nav>

      {/* Main Seamless Mist Studio Canvas */}
      <div className="folio-shelf-canvas flex min-w-0 flex-1 flex-col gap-6 px-4 pb-24 pt-4 sm:px-7 sm:pt-6 md:pb-12 md:pl-[96px]">
        {/* Compact Studio Header Backed by Live Paper Shader */}
        <div className="mx-auto w-full max-w-6xl">
          <header
            data-testid="home-hero-banner"
            className="relative overflow-hidden rounded-[26px] border border-[var(--border-subtle)] shadow-[var(--shadow-hero)]"
          >
            <PaperShaderBackdrop variant="hero" paused={anyModalOpen} />
            {/* Guardrail #1: Directional frosted scrim keeps hero text crisp against moving #072D59 shader stops */}
            <div
              aria-hidden="true"
              className="folio-hero-scrim pointer-events-none absolute inset-0 z-[1]"
            />

            <div className="relative z-10 flex min-w-0 flex-col items-start p-5 sm:px-7 sm:py-6">
              {breadcrumbs.length > 0 && (
                <nav
                  aria-label="Folder breadcrumbs"
                  className="mb-2.5 inline-flex flex-wrap items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/88 px-2.5 py-0.5 text-xs backdrop-blur-md"
                >
                  <button
                    type="button"
                    onClick={() => void navigateToFolder(null)}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[var(--navy-600)] transition duration-150 hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
                  >
                    <Home className="h-3 w-3" />
                    <span>All Notes</span>
                  </button>
                  {breadcrumbs.map((crumb, idx) => {
                    const isLast = idx === breadcrumbs.length - 1;
                    return (
                      <React.Fragment key={crumb.id}>
                        <ChevronRight className="h-3 w-3 text-[var(--navy-600)]/60" />
                        <button
                          type="button"
                          onClick={() => void navigateToFolder(crumb.id)}
                          className={`rounded-full px-2 py-0.5 font-semibold transition duration-150 ${
                            isLast
                              ? 'folio-glass-active'
                              : 'text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]'
                          }`}
                        >
                          {crumb.name}
                        </button>
                      </React.Fragment>
                    );
                  })}
                </nav>
              )}

              {activeFolderName ? (
                <h1 className="folio-display-heading text-3xl font-bold tracking-[-0.03em] text-[var(--navy-900)] sm:text-[40px] sm:leading-[1.08]">
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
                  className="folio-display-heading w-full max-w-lg rounded-2xl border border-[var(--crimson-500)] bg-[var(--surface-elevated)] px-3.5 py-1 text-3xl font-bold tracking-[-0.03em] text-[var(--navy-900)] shadow-sm outline-none ring-4 ring-[var(--crimson-glow)] sm:text-[40px]"
                />
              ) : (
                <h1 className="folio-display-heading text-3xl font-bold tracking-[-0.03em] text-[var(--navy-900)] sm:text-[40px] sm:leading-[1.08]">
                  <button
                    type="button"
                    data-testid="hero-headline-button"
                    title="Click to customize your workspace headline"
                    onClick={() => {
                      setHeroDraft(heroHeadline);
                      setEditingHeroHeadline(true);
                    }}
                    className="group -ml-2 inline-flex items-center gap-2 rounded-2xl px-2 py-0.5 text-left transition duration-150 hover:bg-[var(--surface-elevated)]/65"
                  >
                    <span>{heroHeadline}</span>
                    <Pencil className="h-4 w-4 shrink-0 text-[var(--navy-600)] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                  </button>
                </h1>
              )}

              <p className="mt-1.5 text-xs font-medium text-[var(--navy-600)] tabular-nums">
                {librarySummary.notebookCount} notebook
                {librarySummary.notebookCount === 1 ? '' : 's'}
                {librarySummary.whiteboardCount > 0
                  ? ` · ${librarySummary.whiteboardCount} board${librarySummary.whiteboardCount === 1 ? '' : 's'}`
                  : ''}{' '}
                · {librarySummary.totalPages} page{librarySummary.totalPages === 1 ? '' : 's'}
              </p>

              {/* Single Flat Action Bar (Zero Duplicates, Zero Nested Cards) */}
              <div
                data-testid="quick-create-row"
                className="mt-4 flex flex-wrap items-center gap-2"
              >
                <button
                  type="button"
                  data-testid="hero-new-notebook-btn"
                  onClick={() => {
                    setEditingNotebook(null);
                    setNotebookModalOpen(true);
                  }}
                  className="folio-btn-crimson inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold"
                >
                  <Plus className="h-4 w-4 stroke-[2.5]" />
                  <span>New Notebook</span>
                </button>

                <button
                  type="button"
                  data-testid="quick-create-whiteboard"
                  onClick={() => void handleQuickCreateWhiteboard()}
                  className="folio-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/92 px-3.5 py-2 text-xs font-semibold text-[var(--navy-900)] shadow-2xs backdrop-blur-md hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)]"
                >
                  <Presentation className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
                  <span>Whiteboard</span>
                </button>

                <button
                  type="button"
                  data-testid="import-pdf-btn"
                  onClick={() => pdfInputRef.current?.click()}
                  className="folio-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/92 px-3.5 py-2 text-xs font-semibold text-[var(--navy-900)] shadow-2xs backdrop-blur-md hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)]"
                >
                  <FileUp className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
                  <span>Import PDF</span>
                </button>

                <button
                  type="button"
                  data-testid="import-folio-btn"
                  onClick={() => importInputRef.current?.click()}
                  className="folio-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/92 px-3.5 py-2 text-xs font-semibold text-[var(--navy-900)] shadow-2xs backdrop-blur-md hover:border-[var(--border-strong)] hover:bg-[var(--surface-elevated)]"
                >
                  <Upload className="h-3.5 w-3.5 text-[var(--navy-600)]" />
                  <span>Import .folio</span>
                </button>
              </div>
            </div>
          </header>
        </div>

        {/* Centered Shelf Content + Inline Filter Toolbar */}
        <div className="mx-auto w-full max-w-6xl space-y-6">
          {/* Search Filter & Folder Actions Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="folio-glass-surface relative flex min-w-[210px] flex-1 max-w-md items-center rounded-full px-3.5 py-1.5 transition duration-150 focus-within:border-[var(--crimson-500)] focus-within:bg-[var(--surface-elevated)] focus-within:ring-4 focus-within:ring-[var(--crimson-glow)]">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--navy-600)]" />
              <input
                type="search"
                data-testid="shelf-search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes, folders & templates…"
                className="w-full bg-transparent pl-2 pr-1 text-xs font-medium text-[var(--navy-900)] placeholder:text-[var(--navy-600)]/75 outline-none"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                  className="folio-press rounded-full p-0.5 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="new-folder-btn"
                onClick={() => {
                  setEditingFolder(null);
                  setFolderModalOpen(true);
                }}
                className="folio-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
              >
                <FolderPlus className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
                <span>New Folder</span>
              </button>

              <select
                aria-label="Sort notebooks"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="folio-input rounded-xl px-3 py-1.5 text-xs font-semibold"
              >
                <option value="updated">Recently Edited</option>
                <option value="created">Newest Created</option>
                <option value="title">Title (A–Z)</option>
              </select>
            </div>
          </div>

          {/* Import / Status Banner */}
          {importNotice && (
            <div
              data-testid="import-folio-notice"
              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs shadow-[var(--shadow-ambient)] ${
                importNotice.kind === 'error'
                  ? 'folio-badge-danger'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)]'
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
                    className="folio-btn-crimson rounded-xl px-3 py-1.5 text-xs font-semibold"
                  >
                    Open Notebook
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Dismiss notice"
                  onClick={() => setImportNotice(null)}
                  className="folio-press rounded-lg p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Main Shelf Body */}
          {shelfLoading ? (
            <div className="py-16 text-center text-sm font-medium text-[var(--navy-600)]">
              Loading your local library…
            </div>
          ) : (
            <main className="space-y-7">
              {/* Search Matching Templates */}
              {matchingTemplates.length > 0 && (
                <section data-testid="matching-templates-section">
                  <div className="mb-2.5 flex items-center justify-between">
                    <h2 className="folio-section-label tabular-nums">
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
                            tpl.mode,
                          )
                        }
                        className="folio-press flex items-center gap-3 rounded-[20px] border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3.5 text-left shadow-[var(--shadow-ambient)] hover:-translate-y-0.5 hover:border-[var(--crimson-border)]"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-seal)] text-[var(--navy-900)]">
                          {tpl.mode === 'whiteboard' ? (
                            <Presentation className="h-4.5 w-4.5 text-[var(--crimson-500)]" />
                          ) : (
                            <Sparkles className="h-4.5 w-4.5 text-[var(--crimson-500)]" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-bold text-[var(--navy-900)]">
                              {tpl.name}
                            </span>
                          </div>
                          <div className="truncate text-[11px] font-medium text-[var(--navy-600)]">
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
                    <h2 className="folio-section-label tabular-nums">
                      Folders ({filteredFolders.length})
                    </h2>
                  </div>

                  <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {filteredFolders.map((folder) => {
                      const menuOpen = openMenuId === `folder-${folder.id}`;
                      return (
                        <div
                          key={folder.id}
                          className={`group relative flex items-center justify-between rounded-[20px] border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3.5 shadow-[var(--shadow-ambient)] transition duration-150 hover:-translate-y-0.5 hover:border-[var(--border-strong)] ${
                            menuOpen ? 'z-30' : 'z-0'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => void navigateToFolder(folder.id)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <div
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-[0_2px_8px_rgba(7,45,89,0.16)]"
                              style={{ backgroundColor: folder.color }}
                            >
                              <FolderIcon className="h-5 w-5 fill-current/25" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold text-[var(--navy-900)]">
                                {folder.name}
                              </div>
                              <div className="text-[11px] font-medium text-[var(--navy-600)]">
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
                            className="folio-press rounded-lg p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>

                          {menuOpen && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="folio-popover absolute right-2 top-12 z-30 w-42 rounded-xl p-1.5"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  setEditingFolder(folder);
                                  setFolderModalOpen(true);
                                }}
                                className="folio-press flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                                Rename / Color
                              </button>
                              <button
                                type="button"
                                data-testid="folder-card-delete-btn"
                                onClick={() => void handleDeleteFolderFromMenu(folder)}
                                className="folio-press flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--state-danger-text)] hover:bg-[var(--state-danger-bg)]"
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

              {/* Notebooks Grid with 3D Specular Book Tilt Cards */}
              <section>
                <div className="mb-3.5 flex items-center justify-between gap-2">
                  <h2 className="folio-section-label tabular-nums">
                    Notebooks ({filteredNotebooks.length})
                  </h2>
                </div>

                {filteredNotebooks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-[20px] border border-[var(--border-subtle)] bg-[var(--surface-glass)] py-14 text-center shadow-[var(--specular-rim)]">
                    <p className="text-sm font-semibold text-[var(--navy-900)]">
                      {query.trim()
                        ? `No notebooks match "${query.trim()}"`
                        : 'No notebooks in this folder yet'}
                    </p>
                    <p className="mt-1 text-xs text-[var(--navy-600)]">
                      Use New Notebook or Templates to get started.
                    </p>
                  </div>
                ) : (
                  <div
                    data-testid="notebooks-grid"
                    className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
                  >
                    {filteredNotebooks.map((notebook, idx) => {
                      const menuOpen = openMenuId === `nb-${notebook.id}`;
                      return (
                        <BookTiltCard
                          key={notebook.id}
                          notebook={notebook}
                          index={idx}
                          relativeUpdatedLabel={formatRelativeDate(notebook.updatedAt)}
                          menuOpen={menuOpen}
                          opening={openingNotebookId === notebook.id}
                          onOpen={() => {
                            void handleNotebookCardClick(notebook);
                          }}
                          onToggleMenu={() => setOpenMenuId(menuOpen ? null : `nb-${notebook.id}`)}
                          menuNode={
                            menuOpen ? (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="folio-popover absolute bottom-10 right-0 z-50 w-48 rounded-xl p-1.5"
                              >
                                <button
                                  type="button"
                                  onClick={() => handleLockActionFromMenu(notebook)}
                                  className="folio-press flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
                                >
                                  {notebook.isLocked ? (
                                    <>
                                      <LockOpen className="h-3.5 w-3.5 text-[var(--state-warning)]" />
                                      Unlock / Remove Lock
                                    </>
                                  ) : (
                                    <>
                                      <Lock className="h-3.5 w-3.5 text-[var(--navy-600)]" />
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
                                  className="folio-press flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                  Edit Cover / Move
                                </button>
                                <button
                                  type="button"
                                  data-testid="notebook-card-export-btn"
                                  onClick={() => void handleExportFromMenu(notebook)}
                                  className="folio-press flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
                                >
                                  <Download className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
                                  {notebook.isLocked ? 'Unlock & Export…' : 'Export…'}
                                </button>
                                {!notebook.isLocked && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      void duplicateNotebook(notebook.id);
                                    }}
                                    className="folio-press flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    Duplicate
                                  </button>
                                )}
                                <button
                                  type="button"
                                  data-testid="notebook-card-delete-btn"
                                  onClick={() => handleDeleteNotebookFromMenu(notebook)}
                                  className="folio-press flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--state-danger-text)] hover:bg-[var(--state-danger-bg)]"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  {notebook.isLocked ? 'Unlock & Delete…' : 'Delete Notebook'}
                                </button>
                              </div>
                            ) : null
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Recently Deleted Grid (matches Notebooks 5-column book card layout) */}
              {currentFolderId === null && filteredTrashedNotebooks.length > 0 && (
                <section data-testid="recently-deleted-section">
                  <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="folio-section-label tabular-nums">
                      Recently Deleted ({filteredTrashedNotebooks.length})
                    </h2>
                    <div className="flex items-center gap-2">
                      {!confirmEmptyShelfTrash ? (
                        <button
                          type="button"
                          data-testid="shelf-empty-trash-btn"
                          onClick={() => setConfirmEmptyShelfTrash(true)}
                          className="folio-btn-secondary folio-press inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold text-[var(--state-danger-text)] hover:border-[var(--state-danger-border)] hover:bg-[var(--state-danger-bg)]"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Empty Trash</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            data-testid="shelf-confirm-empty-trash-btn"
                            onClick={() => {
                              setConfirmEmptyShelfTrash(false);
                              void emptyTrash();
                            }}
                            className="folio-press inline-flex items-center gap-1 rounded-full border border-[var(--state-danger-border)] bg-[var(--state-danger-bg)] px-3 py-1 text-[11px] font-bold text-[var(--state-danger-text)]"
                          >
                            Confirm Empty
                          </button>
                          <button
                            type="button"
                            data-testid="shelf-cancel-empty-trash-btn"
                            onClick={() => setConfirmEmptyShelfTrash(false)}
                            className="folio-btn-secondary folio-press rounded-full px-2.5 py-1 text-[11px] font-semibold"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div
                    data-testid="recently-deleted-grid"
                    className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
                  >
                    {filteredTrashedNotebooks.map((item) => {
                      const menuOpen = openMenuId === `trash-${item.id}`;
                      const pageCount = Math.max(
                        1,
                        item.pages.length || item.notebook.pageOrder.length,
                      );
                      const isWhiteboard = item.notebook.mode === 'whiteboard';
                      return (
                        <div
                          key={item.id}
                          data-testid={`recently-deleted-card-${item.id}`}
                          className={`folio-card-enter group relative flex flex-col ${
                            menuOpen ? 'z-40' : 'z-0 hover:z-10'
                          }`}
                        >
                          <button
                            type="button"
                            draggable={false}
                            data-testid={`recently-deleted-cover-restore-${item.id}`}
                            aria-label={`Restore ${item.notebook.title}`}
                            title="Click to restore notebook"
                            onClick={() => {
                              setOpenMenuId(null);
                              void restoreTrashedNotebook(item.id);
                            }}
                            className="relative block aspect-[3/4] w-full cursor-pointer touch-manipulation select-none rounded-2xl text-left transition-transform duration-150 group-hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-[var(--crimson-500)]"
                          >
                            <CoverPreview
                              cover={item.notebook.cover}
                              title={item.notebook.title}
                              mode={item.notebook.mode}
                              locked={Boolean(item.notebook.isLocked)}
                              className="h-full w-full opacity-80 transition duration-200 group-hover:opacity-100"
                            />
                            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                              <span className="folio-glass-badge inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold">
                                <RotateCcw className="h-3 w-3" />
                                <span>Restore</span>
                              </span>
                            </div>
                          </button>

                          <div className="mt-2.5 flex items-start justify-between gap-1 px-0.5">
                            <button
                              type="button"
                              draggable={false}
                              onClick={() => {
                                setOpenMenuId(null);
                                void restoreTrashedNotebook(item.id);
                              }}
                              className="group/meta min-w-0 flex-1 cursor-pointer touch-manipulation select-none rounded-lg text-left focus-visible:outline-2 focus-visible:outline-[var(--crimson-500)]"
                            >
                              <div className="block w-full truncate text-sm font-bold text-[var(--navy-900)] transition duration-150 group-hover/meta:text-[var(--crimson-500)]">
                                {item.notebook.title}
                              </div>
                              <div className="text-[11px] font-medium text-[var(--navy-600)] tabular-nums">
                                {isWhiteboard
                                  ? 'Whiteboard'
                                  : `${pageCount} page${pageCount === 1 ? '' : 's'}`}{' '}
                                · {formatTrashTimeRemaining(item.expiresAt)}
                              </div>
                            </button>

                            <button
                              type="button"
                              aria-label={`Recently deleted options for ${item.notebook.title}`}
                              aria-expanded={menuOpen}
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(menuOpen ? null : `trash-${item.id}`);
                              }}
                              className="folio-press rounded-lg p-1 text-[var(--navy-600)] opacity-85 hover:bg-[var(--surface-elevated)] hover:text-[var(--navy-900)] group-hover:opacity-100"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </div>

                          {menuOpen && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="folio-popover absolute bottom-10 right-0 z-50 w-44 rounded-xl p-1.5"
                            >
                              <button
                                type="button"
                                data-testid={`recently-deleted-restore-${item.id}`}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  void restoreTrashedNotebook(item.id);
                                }}
                                className="folio-press flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Restore Notebook
                              </button>
                              <button
                                type="button"
                                data-testid={`recently-deleted-delete-${item.id}`}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  void permanentlyDeleteTrashedNotebook(item.id);
                                }}
                                className="folio-press flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--state-danger-text)] hover:bg-[var(--state-danger-bg)]"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete Forever
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </main>
          )}
        </div>
      </div>

      {/* Modals */}
      <CommandPaletteModal
        open={commandPaletteOpen}
        notebooks={allNotebooks.length > 0 ? allNotebooks : notebooks}
        folders={allFolders}
        customTemplates={customTemplates}
        onClose={() => setCommandPaletteOpen(false)}
        onSelectNotebook={handleNotebookCardClick}
        onSelectFolder={(folder) => void navigateToFolder(folder.id)}
        onLaunchTemplate={(name, paper, strokes, textboxes, images, mode) =>
          void handleLaunchTemplate(name, paper, strokes, textboxes, images, mode)
        }
        onNewNotebook={() => {
          setEditingNotebook(null);
          setNotebookModalOpen(true);
        }}
        onNewWhiteboard={() => void handleQuickCreateWhiteboard()}
        onImportPdf={() => pdfInputRef.current?.click()}
        onImportFolio={() => importInputRef.current?.click()}
        onNewFolder={() => {
          setEditingFolder(null);
          setFolderModalOpen(true);
        }}
        onOpenTemplates={() => setTemplatesOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
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
        onSelect={async (paper, strokes, textboxes, images, meta) => {
          const resolvedMode = meta?.mode ?? 'notebook';
          const resolvedTitle =
            meta?.title ??
            (resolvedMode === 'whiteboard' ? 'Untitled Whiteboard' : `Notes (${paper.pattern})`);
          await handleLaunchTemplate(
            resolvedTitle,
            paper,
            strokes,
            textboxes,
            images,
            resolvedMode,
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
        folder={unlockModalState.folder ?? null}
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

      {recentDeletedNotebooks.length > 0 && (() => {
        const latestUndo = recentDeletedNotebooks[recentDeletedNotebooks.length - 1];
        return (
          <div
            data-testid="delete-undo-toast"
            role="status"
            className="folio-glass-surface fixed bottom-5 left-1/2 z-40 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/95 shadow-[var(--shadow-popover)]"
          >
            <div className="flex items-center gap-3 px-4 py-2.5 text-xs">
              <span className="min-w-0 flex-1 truncate font-semibold text-[var(--navy-900)]">
                Moved &ldquo;{latestUndo.title}&rdquo; to Trash
                {recentDeletedNotebooks.length > 1
                  ? ` (+${recentDeletedNotebooks.length - 1} more)`
                  : ''}
              </span>
              <button
                type="button"
                data-testid="delete-undo-btn"
                onClick={() => void undoLastNotebookDelete()}
                className="folio-btn-navy folio-press inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1 text-[11px] font-bold"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Undo</span>
                <kbd className="rounded bg-white/18 px-1 py-0.5 text-[9px] font-semibold text-white">Ctrl+Z</kbd>
              </button>
              <button
                type="button"
                aria-label="Dismiss undo"
                onClick={() => dismissNotebookDeleteUndo(latestUndo.notebookId)}
                className="folio-press shrink-0 rounded-lg p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div
              key={`${latestUndo.notebookId}-${latestUndo.deletedAt}`}
              aria-hidden="true"
              className="folio-undo-progress h-0.5 w-full bg-[var(--crimson-500)]"
            />
          </div>
        );
      })()}
    </div>
  );
};
