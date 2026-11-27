import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Command,
  FileText,
  FileUp,
  Folder as FolderIcon,
  FolderPlus,
  Layers,
  Lock,
  Palette,
  Presentation,
  Search,
  Settings,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  ALL_BUILT_IN_PAPER_VARIANTS,
  ALL_BUILT_IN_WHITEBOARD_VARIANTS,
  DEFAULT_PAPER_CONFIG,
  formatPaperPatternLabel,
} from '../../constants/papers';
import { BUILT_IN_NOTE_TEMPLATES } from '../../notes/noteTemplates';
import { BUILT_IN_SLIDE_TEMPLATES } from '../../slides/slideTemplates';
import type {
  Folder,
  Notebook,
  NotebookMode,
  NoteDocumentData,
  PageImage,
  PaperConfig,
  PaperTemplate,
  SlideData,
  SlideSizePresetId,
  Stroke,
  Textbox,
} from '../../types/notes';
import { PaperShaderBackdrop } from '../common/PaperShaderBackdrop';

interface CommandPaletteModalProps {
  open: boolean;
  notebooks: Notebook[];
  folders: Folder[];
  customTemplates: PaperTemplate[];
  onClose: () => void;
  onSelectNotebook: (notebook: Notebook) => void;
  onSelectFolder: (folder: Folder) => void;
  onLaunchTemplate: (
    title: string,
    paper: PaperConfig,
    strokes?: Stroke[],
    textboxes?: Textbox[],
    images?: PageImage[],
    mode?: NotebookMode,
    extra?: {
      slideSizePreset?: SlideSizePresetId;
      initialNoteData?: NoteDocumentData;
      initialSlides?: SlideData[];
    },
  ) => void;
  onNewNotebook: () => void;
  onNewNote?: () => void;
  onNewSlides?: () => void;
  onNewWhiteboard: () => void;
  onImportPdf: () => void;
  onImportFolio: () => void;
  onNewFolder: () => void;
  onOpenTemplates: () => void;
  onOpenSettings: () => void;
}

type CommandGroup = 'Actions' | 'Library' | 'Folders' | 'Templates';

interface CommandEntry {
  id: string;
  group: CommandGroup;
  title: string;
  subtitle: string;
  badge?: string;
  icon: React.ReactNode;
  run: () => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  open,
  notebooks,
  folders,
  customTemplates,
  onClose,
  onSelectNotebook,
  onSelectFolder,
  onLaunchTemplate,
  onNewNotebook,
  onNewNote,
  onNewSlides,
  onNewWhiteboard,
  onImportPdf,
  onImportFolio,
  onNewFolder,
  onOpenTemplates,
  onOpenSettings,
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const raf = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [open]);

  const allEntries = useMemo<CommandEntry[]>(() => {
    const actions: CommandEntry[] = [
      {
        id: 'act-new-notebook',
        group: 'Actions',
        title: 'New Canvas (Drawing Board)',
        subtitle: 'Choose cover art, folder, and paper or studio mode',
        badge: 'Canvas',
        icon: <Palette className="h-4 w-4 text-[var(--crimson-500)]" />,
        run: onNewNotebook,
      },
      ...(onNewNote
        ? [
            {
              id: 'act-new-note',
              group: 'Actions' as const,
              title: 'New Doc (Notes Mode)',
              subtitle: 'Create a Google Docs-style rich document with outline & slash commands',
              badge: 'Docs',
              icon: <FileText className="h-4 w-4 text-[var(--crimson-500)]" />,
              run: onNewNote,
            },
          ]
        : []),
      ...(onNewSlides
        ? [
            {
              id: 'act-new-slides',
              group: 'Actions' as const,
              title: 'New Slides Deck',
              subtitle: 'Create a Canva-style 16:9 presentation with layouts & present mode',
              badge: 'Slides',
              icon: <Presentation className="h-4 w-4 text-[var(--crimson-500)]" />,
              run: onNewSlides,
            },
          ]
        : []),
      {
        id: 'act-new-whiteboard',
        group: 'Actions',
        title: 'New Infinite Board',
        subtitle: 'Open unbounded drawing canvas with smooth zoom & pan',
        badge: 'Board',
        icon: <Sparkles className="h-4 w-4 text-[var(--crimson-500)]" />,
        run: onNewWhiteboard,
      },
      {
        id: 'act-templates',
        group: 'Actions',
        title: 'Browse Studio Template Gallery',
        subtitle: 'Docs, Slide Decks, Infinite Boards, papers & saved templates',
        icon: <Layers className="h-4 w-4" />,
        run: onOpenTemplates,
      },
      {
        id: 'act-import-pdf',
        group: 'Actions',
        title: 'Import PDF Document',
        subtitle: 'Annotate any PDF locally with zero upload',
        icon: <FileUp className="h-4 w-4 text-[var(--crimson-500)]" />,
        run: onImportPdf,
      },
      {
        id: 'act-new-folder',
        group: 'Actions',
        title: 'Create New Folder',
        subtitle: 'Organize canvases, docs & decks with custom folder colors',
        icon: <FolderPlus className="h-4 w-4" />,
        run: onNewFolder,
      },
      {
        id: 'act-import-folio',
        group: 'Actions',
        title: 'Import .folio.json Archive',
        subtitle: 'Restore a shared or backed-up studio item',
        icon: <Upload className="h-4 w-4" />,
        run: onImportFolio,
      },
      {
        id: 'act-settings',
        group: 'Actions',
        title: 'Open Studio Preferences',
        subtitle: 'Mode defaults, UI scale (up to 200%), AI keys & backups',
        icon: <Settings className="h-4 w-4" />,
        run: onOpenSettings,
      },
    ];

    const folderMap = new Map(folders.map((f) => [f.id, f.name]));

    const nbEntries: CommandEntry[] = notebooks.map((nb) => {
      const folderName = nb.folderId ? folderMap.get(nb.folderId) : null;
      const countText =
        nb.mode === 'whiteboard'
          ? 'Infinite Board'
          : nb.mode === 'notes'
            ? 'Doc'
            : nb.mode === 'slides'
              ? `${nb.pageOrder.length} slide${nb.pageOrder.length === 1 ? '' : 's'}`
              : `${nb.pageOrder.length} page${nb.pageOrder.length === 1 ? '' : 's'}`;
      const modeBadge = nb.isLocked
        ? 'Locked'
        : nb.mode === 'slides'
          ? 'Slides'
          : nb.mode === 'notes'
            ? 'Doc'
            : nb.mode === 'whiteboard'
              ? 'Board'
              : 'Canvas';
      const icon = nb.isLocked ? (
        <Lock className="h-4 w-4 text-[var(--state-warning)]" />
      ) : nb.mode === 'slides' ? (
        <Presentation className="h-4 w-4 text-[var(--crimson-500)]" />
      ) : nb.mode === 'notes' ? (
        <FileText className="h-4 w-4 text-[var(--crimson-500)]" />
      ) : (
        <Palette className="h-4 w-4" />
      );
      return {
        id: `nb-${nb.id}`,
        group: 'Library',
        title: nb.title,
        subtitle: folderName ? `${folderName} · ${countText}` : countText,
        badge: modeBadge,
        icon,
        run: () => onSelectNotebook(nb),
      };
    });

    const folderEntries: CommandEntry[] = folders.map((f) => ({
      id: `folder-${f.id}`,
      group: 'Folders',
      title: f.name,
      subtitle: 'Jump directly into folder',
      icon: <FolderIcon className="h-4 w-4" style={{ color: f.color }} />,
      run: () => onSelectFolder(f),
    }));

    const templateEntries: CommandEntry[] = [
      ...BUILT_IN_NOTE_TEMPLATES.map((tpl) => ({
        id: `tpl-note-${tpl.id}`,
        group: 'Templates' as const,
        title: tpl.name,
        subtitle: tpl.badge,
        badge: 'Doc',
        icon: <FileText className="h-4 w-4 text-[var(--crimson-500)]" />,
        run: () =>
          onLaunchTemplate(tpl.name, { ...DEFAULT_PAPER_CONFIG }, [], [], [], 'notes', {
            initialNoteData: tpl.buildNoteData(),
          }),
      })),
      ...BUILT_IN_SLIDE_TEMPLATES.map((tpl) => ({
        id: `tpl-slide-${tpl.id}`,
        group: 'Templates' as const,
        title: tpl.name,
        subtitle: tpl.aspectLabel,
        badge: 'Slides',
        icon: <Presentation className="h-4 w-4 text-[var(--crimson-500)]" />,
        run: () => {
          const built = tpl.buildDeck();
          onLaunchTemplate(tpl.name, built.paper, [], [], [], 'slides', {
            slideSizePreset: tpl.slideSizePreset,
            initialSlides: built.slides,
          });
        },
      })),
      ...customTemplates.map((t) => ({
        id: `tpl-custom-${t.id}`,
        group: 'Templates' as const,
        title: t.name,
        subtitle: `Saved template · ${formatPaperPatternLabel(t.paper.pattern)}`,
        badge:
          t.mode === 'whiteboard'
            ? t.name.toLowerCase().includes('whiteboard')
              ? undefined
              : 'Board'
            : 'Custom',
        icon:
          t.mode === 'whiteboard' ? (
            <Presentation className="h-4 w-4 text-[var(--crimson-500)]" />
          ) : (
            <Sparkles className="h-4 w-4 text-[var(--crimson-500)]" />
          ),
        run: () =>
          onLaunchTemplate(
            t.name,
            t.paper,
            t.strokes,
            t.textboxes,
            t.images,
            t.mode ?? 'notebook',
          ),
      })),
      ...ALL_BUILT_IN_WHITEBOARD_VARIANTS.map((b) => ({
        id: `tpl-wb-${b.id}`,
        group: 'Templates' as const,
        title: b.name,
        subtitle: 'Infinite Board',
        icon: <Palette className="h-4 w-4 text-[var(--crimson-500)]" />,
        run: () => onLaunchTemplate(b.name, b.paper, undefined, undefined, undefined, 'whiteboard'),
      })),
      ...ALL_BUILT_IN_PAPER_VARIANTS.map((b) => ({
        id: `tpl-paper-${b.id}`,
        group: 'Templates' as const,
        title: b.name,
        subtitle: formatPaperPatternLabel(b.paper.pattern),
        icon: <Layers className="h-4 w-4" />,
        run: () => onLaunchTemplate(b.name, b.paper, undefined, undefined, undefined, 'notebook'),
      })),
    ];

    return [...actions, ...nbEntries, ...folderEntries, ...templateEntries];
  }, [
    notebooks,
    folders,
    customTemplates,
    onNewNotebook,
    onNewNote,
    onNewSlides,
    onNewWhiteboard,
    onImportPdf,
    onOpenTemplates,
    onNewFolder,
    onImportFolio,
    onOpenSettings,
    onSelectNotebook,
    onSelectFolder,
    onLaunchTemplate,
  ]);

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const quickActions = allEntries.filter((e) => e.group === 'Actions');
      const topNotebooks = allEntries.filter((e) => e.group === 'Library').slice(0, 4);
      const topFolders = allEntries.filter((e) => e.group === 'Folders').slice(0, 3);
      return [...quickActions, ...topNotebooks, ...topFolders];
    }
    return allEntries
      .filter(
        (entry) =>
          entry.title.toLowerCase().includes(q) ||
          entry.subtitle.toLowerCase().includes(q) ||
          entry.group.toLowerCase().includes(q) ||
          (entry.badge?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 18);
  }, [allEntries, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const groupedOrder: CommandGroup[] = ['Actions', 'Library', 'Folders', 'Templates'];
  const executeEntry = (entry: CommandEntry | undefined) => {
    if (!entry) return;
    onClose();
    entry.run();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (filteredEntries.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((idx) => (idx + 1) % filteredEntries.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((idx) => (idx - 1 + filteredEntries.length) % filteredEntries.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeEntry(filteredEntries[activeIndex]);
    }
  };

  return (
    <div
      className="folio-modal-backdrop fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Workspace Command Palette"
        data-testid="command-palette-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="folio-modal-card w-full max-w-2xl overflow-hidden rounded-[22px] text-[var(--navy-900)]"
      >
        {/* Shader-washed Studio Strip */}
        <div className="relative overflow-hidden border-b border-[var(--border-subtle)] px-4 py-3">
          <PaperShaderBackdrop variant="static-accent" />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(242,247,251,0.92)_0%,rgba(242,247,251,0.78)_60%,rgba(242,247,251,0.55)_100%)]"
          />
          <div className="relative z-10 flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-elevated)]/85 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--navy-900)] ring-1 ring-[var(--border-subtle)] backdrop-blur-md">
              <Command className="h-3 w-3 text-[var(--crimson-500)]" />
              <span>Command Studio</span>
            </div>
            <button
              type="button"
              aria-label="Close Command Palette"
              onClick={onClose}
              className="folio-press inline-flex items-center gap-1 rounded-lg bg-[var(--surface-elevated)]/85 px-2 py-1 text-[10px] font-bold text-[var(--navy-600)] ring-1 ring-[var(--border-subtle)] hover:text-[var(--navy-900)]"
            >
              <kbd>ESC</kbd>
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
          <Search className="h-4.5 w-4.5 shrink-0 text-[var(--navy-600)]" />
          <input
            ref={inputRef}
            type="text"
            data-testid="command-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a canvas, doc, slide deck, folder, template, or action…"
            className="w-full bg-transparent text-sm font-medium text-[var(--navy-900)] placeholder:text-[var(--navy-600)]/70 outline-none"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear command search"
              onClick={() => setQuery('')}
              className="folio-press rounded-full p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Results */}
        <div className="custom-scrollbar max-h-[54vh] overflow-y-auto p-2.5">
          {filteredEntries.length === 0 ? (
            <div className="py-12 text-center text-xs font-medium text-[var(--navy-600)]">
              No canvases, docs, slides, folders, or templates match &ldquo;{query.trim()}&rdquo;.
            </div>
          ) : (
            <div className="space-y-3">
              {groupedOrder.map((group) => {
                const rows = filteredEntries.filter((item) => item.group === group);
                if (rows.length === 0) return null;
                return (
                  <section key={group}>
                    <div className="folio-section-label px-2.5 pb-1">{group}</div>
                    <div className="space-y-0.5">
                      {rows.map((entry) => {
                        const globalIdx = filteredEntries.indexOf(entry);
                        const active = globalIdx === activeIndex;
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            data-testid={`command-item-${entry.id}`}
                            onMouseEnter={() => setActiveIndex(globalIdx)}
                            onClick={() => executeEntry(entry)}
                            className={`folio-press flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition duration-150 ${
                              active
                                ? 'folio-glass-active'
                                : 'text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                  active
                                    ? 'bg-white/16 text-white'
                                    : 'bg-[var(--surface-tint)] text-[var(--navy-900)]'
                                }`}
                              >
                                {entry.icon}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-xs font-bold">{entry.title}</span>
                                  {entry.badge && (
                                    <span
                                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                        active
                                          ? 'bg-[var(--crimson-500)] text-white'
                                          : 'bg-[var(--surface-seal)] text-[var(--navy-900)]'
                                      }`}
                                    >
                                      {entry.badge}
                                    </span>
                                  )}
                                </div>
                                <div
                                  className={`truncate text-[11px] ${
                                    active ? 'text-[#DBF2FC]/85' : 'text-[var(--navy-600)]'
                                  }`}
                                >
                                  {entry.subtitle}
                                </div>
                              </div>
                            </div>
                            <ArrowRight
                              className={`h-3.5 w-3.5 shrink-0 ${
                                active ? 'text-[var(--crimson-500)]' : 'text-[var(--navy-600)]/45'
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div className="folio-modal-footer flex items-center justify-between px-4 py-2 text-[10px] font-semibold text-[var(--navy-600)]">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[9px]">
                ↑↓
              </kbd>
              Navigate
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[9px]">
                ↵
              </kbd>
              Open
            </span>
          </div>
          <span className="folio-mono tabular-nums">Ctrl+K</span>
        </div>
      </div>
    </div>
  );
};
