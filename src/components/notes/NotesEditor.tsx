import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  FileText,
  ListTree,
  Printer,
  Settings,
  Sparkles,
} from 'lucide-react';
import { createDefaultNoteDocumentData } from '../../db/repository';
import {
  buildStandaloneNoteHtml,
  computeNoteStats,
  downloadNoteFile,
  extractNoteOutline,
  noteJsonToMarkdown,
} from '../../notes/noteExport';
import { createNotesExtensions } from '../../notes/tiptapExtensions';
import { useAppStore } from '../../store/useAppStore';
import type { NoteDocumentData, NotePageMargins, NotePageStyle } from '../../types/notes';
import {
  buildFolioNotebookExport,
  sanitizeExportFilename,
  triggerBlobDownload,
} from '../../utils/exportNotebook';
import { isSupportedImageFile, processUploadedImage } from '../../utils/imageImport';
import { resolveDeskBackdropProps } from '../../utils/settings';
import { SettingsModal } from '../modals/SettingsModal';
import { NotesAiPanel } from './NotesAiPanel';
import { NotesFormattingToolbar } from './NotesFormattingToolbar';
import { NotesOutlineSidebar } from './NotesOutlineSidebar';
import { NotesSlashMenu } from './NotesSlashMenu';

const MARGIN_PX: Record<NotePageMargins, number> = {
  narrow: 40,
  normal: 72,
  wide: 104,
};

export const NotesEditor: React.FC = () => {
  const activeNotebook = useAppStore((s) => s.activeNotebook);
  const pages = useAppStore((s) => s.pages);
  const saveStatus = useAppStore((s) => s.saveStatus);
  const deskBackdrop = useAppStore((s) => s.deskBackdrop);
  const deskCustomColor = useAppStore((s) => s.deskCustomColor);
  const closeNotebook = useAppStore((s) => s.closeNotebook);
  const updateNotebookMeta = useAppStore((s) => s.updateNotebookMeta);
  const saveNotePageData = useAppStore((s) => s.saveNotePageData);

  const activePage = pages[0] ?? null;
  const initialNoteData: NoteDocumentData = useMemo(
    () => activePage?.noteData ?? createDefaultNoteDocumentData(),
    [activePage?.noteData],
  );

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(activeNotebook?.title ?? 'Untitled Document');
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [docZoom, setDocZoom] = useState(1);

  const [pageStyle, setPageStyle] = useState<NotePageStyle>(initialNoteData.pageStyle);
  const [pageMargins, setPageMargins] = useState<NotePageMargins>(initialNoteData.pageMargins);
  const [defaultFont, setDefaultFont] = useState<string>(initialNoteData.defaultFont);
  const [noteJson, setNoteJson] = useState<Record<string, unknown>>(initialNoteData.contentJson);
  const [plainText, setPlainText] = useState<string>(initialNoteData.plainText);

  const [slashState, setSlashState] = useState<{
    open: boolean;
    query: string;
    range: { from: number; to: number } | null;
    position: { left: number; top: number };
  }>({ open: false, query: '', range: null, position: { left: 160, top: 200 } });

  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const latestDataRef = useRef<NoteDocumentData>(initialNoteData);

  const extensions = useMemo(() => createNotesExtensions(), []);

  const persistNow = useCallback(
    (data: NoteDocumentData) => {
      if (!activePage) return;
      saveNotePageData(activePage.id, data);
    },
    [activePage, saveNotePageData],
  );

  const schedulePersist = useCallback(
    (data: NoteDocumentData) => {
      latestDataRef.current = data;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        persistNow(latestDataRef.current);
      }, 350);
    },
    [persistNow],
  );

  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const st = useAppStore.getState();
      if (activePage && st.activeNotebook?.id === activeNotebook?.id && !st.activeNotebook?.isLocked) {
        persistNow(latestDataRef.current);
      }
    }
  }, [activeNotebook?.id, activePage, persistNow]);

  useEffect(() => {
    return () => {
      flushPendingSave();
    };
  }, [flushPendingSave]);

  const editor = useEditor({
    extensions,
    content: initialNoteData.contentJson,
    editorProps: {
      attributes: {
        class: 'folio-notes-prose min-h-[680px]',
        'data-testid': 'notes-tiptap-editor',
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter(isSupportedImageFile);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImageFiles(files);
        return true;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(isSupportedImageFile);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImageFiles(files);
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON() as Record<string, unknown>;
      const html = ed.getHTML();
      const text = ed.getText({ blockSeparator: '\n' });
      setNoteJson(json);
      setPlainText(text);

      // Detect slash command trigger ("/" at block start or after whitespace)
      const { from } = ed.state.selection;
      const $pos = ed.state.selection.$from;
      const textBefore = $pos.parent.textBetween(0, $pos.parentOffset, '\0', '\0');
      const match = /(?:^|\s)\/([a-zA-Z0-9]*)$/.exec(textBefore);
      if (match) {
        const query = match[1] ?? '';
        const slashFrom = from - query.length - 1;
        let left = 180;
        let top = 220;
        try {
          const coords = ed.view.coordsAtPos(from);
          left = Math.max(16, Math.min(window.innerWidth - 280, coords.left));
          top = Math.max(80, Math.min(window.innerHeight - 300, coords.bottom + 8));
        } catch {
          // Safe fallback in jsdom or detached views
        }
        setSlashState({
          open: true,
          query,
          range: { from: slashFrom, to: from },
          position: { left, top },
        });
      } else if (slashState.open) {
        setSlashState((prev) => ({ ...prev, open: false }));
      }

      const nextData: NoteDocumentData = {
        ...latestDataRef.current,
        contentJson: json,
        contentHtml: html,
        plainText: text,
        pageStyle,
        pageMargins,
        defaultFont,
      };
      schedulePersist(nextData);
    },
  });

  const insertImageFiles = async (files: File[]) => {
    if (!editor) return;
    for (const file of files) {
      if (!isSupportedImageFile(file)) continue;
      try {
        const { dataUrl } = await processUploadedImage(file);
        editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
      } catch {
        // Skip corrupt images
      }
    }
  };

  useEffect(() => {
    if (!exportOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [exportOpen]);

  const stats = useMemo(() => computeNoteStats(plainText), [plainText]);
  const outlineItems = useMemo(() => extractNoteOutline(noteJson), [noteJson]);

  const handlePageStyleChange = (next: NotePageStyle) => {
    setPageStyle(next);
    schedulePersist({ ...latestDataRef.current, pageStyle: next });
  };

  const handlePageMarginsChange = (next: NotePageMargins) => {
    setPageMargins(next);
    schedulePersist({ ...latestDataRef.current, pageMargins: next });
  };

  const handleDefaultFontChange = (nextFont: string) => {
    setDefaultFont(nextFont);
    schedulePersist({ ...latestDataRef.current, defaultFont: nextFont });
  };

  const handleSelectHeading = (index: number) => {
    const headings = editorContainerRef.current?.querySelectorAll('h1, h2, h3');
    const target = headings?.[index] as HTMLElement | undefined;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const commitTitle = () => {
    setEditingTitle(false);
    if (!activeNotebook) return;
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== activeNotebook.title) {
      void updateNotebookMeta(activeNotebook.id, { title: trimmed });
    }
  };

  const handleBackToShelf = async () => {
    flushPendingSave();
    await closeNotebook();
  };

  const handleExportMarkdown = () => {
    setExportOpen(false);
    const md = `# ${activeNotebook?.title ?? 'Untitled Document'}\n\n${noteJsonToMarkdown(noteJson)}`;
    downloadNoteFile(
      `${sanitizeExportFilename(activeNotebook?.title ?? 'Document')}.md`,
      md,
      'text/markdown;charset=utf-8',
    );
  };

  const handleExportHtml = (asWordDoc = false) => {
    setExportOpen(false);
    const html = buildStandaloneNoteHtml(
      activeNotebook?.title ?? 'Untitled Document',
      editor?.getHTML() ?? latestDataRef.current.contentHtml,
      defaultFont,
    );
    const ext = asWordDoc ? 'doc' : 'html';
    const mime = asWordDoc ? 'application/msword;charset=utf-8' : 'text/html;charset=utf-8';
    downloadNoteFile(`${sanitizeExportFilename(activeNotebook?.title ?? 'Document')}.${ext}`, html, mime);
  };

  const handleExportFolio = () => {
    setExportOpen(false);
    if (!activeNotebook) return;
    flushPendingSave();
    const archive = buildFolioNotebookExport(activeNotebook, pages);
    const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' });
    triggerBlobDownload(blob, `${sanitizeExportFilename(activeNotebook.title)}.folio.json`);
  };

  const handlePrintPdf = () => {
    setExportOpen(false);
    window.print?.();
  };

  const deskAppearance = resolveDeskBackdropProps(deskBackdrop, deskCustomColor);

  return (
    <div
      data-testid="notes-editor-shell"
      style={deskAppearance.style}
      className={`flex h-full flex-col overflow-hidden text-[var(--navy-900)] ${deskAppearance.className}`}
    >
      {/* Top Floating Glass Header */}
      <header className="pointer-events-none sticky top-2.5 z-30 flex items-center justify-between gap-2 px-3 py-2">
        <div className="folio-glass-island pointer-events-auto flex min-w-0 items-center gap-1.5 rounded-2xl px-2 py-1">
          <button
            type="button"
            data-testid="notes-back-to-shelf-btn"
            onClick={() => void handleBackToShelf()}
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
              data-testid="notes-inline-title"
              onClick={() => {
                setTitleDraft(activeNotebook?.title ?? '');
                setEditingTitle(true);
              }}
              className="folio-press max-w-[180px] truncate rounded-xl px-2 py-1 text-xs font-bold hover:bg-[var(--surface-tint)] sm:text-sm"
            >
              {activeNotebook?.title ?? 'Untitled Document'}
            </button>
          )}

          <span
            data-testid="editor-mode-badge"
            className="folio-glass-badge hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold sm:inline-flex"
          >
            <FileText className="h-3 w-3 text-[var(--crimson-500)]" />
            Notes
          </span>

          <button
            type="button"
            data-testid="notes-toggle-outline-btn"
            title="Toggle Document Outline"
            aria-pressed={outlineOpen}
            onClick={() => setOutlineOpen((o) => !o)}
            className={`folio-press hidden h-7 items-center gap-1 rounded-xl px-2 text-xs font-semibold lg:inline-flex ${
              outlineOpen ? 'folio-glass-active' : 'hover:bg-[var(--surface-tint)]'
            }`}
          >
            <ListTree className="h-3.5 w-3.5" />
            <span>Outline</span>
          </button>
        </div>

        <div className="folio-glass-island pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-2xl px-2 py-1">
          <span className="hidden items-center gap-1 px-2 text-[11px] font-medium text-[var(--navy-600)] sm:inline-flex">
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
            data-testid="notes-toggle-ai-btn"
            onClick={() => setAiOpen((o) => !o)}
            className={`folio-press inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-bold ${
              aiOpen
                ? 'folio-glass-active'
                : 'border border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-tint)]'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
            <span>AI Study</span>
          </button>

          <div ref={exportMenuRef} className="relative">
            <button
              type="button"
              data-testid="notes-export-btn"
              onClick={() => setExportOpen((o) => !o)}
              className="folio-btn-crimson inline-flex h-8 items-center gap-1 rounded-xl px-3 text-xs font-bold"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {exportOpen && (
              <div className="folio-popover absolute right-0 top-full z-40 mt-2 w-52 rounded-2xl p-1.5 text-xs font-semibold">
                <button
                  type="button"
                  data-testid="notes-export-md"
                  onClick={handleExportMarkdown}
                  className="folio-press flex w-full items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-tint)]"
                >
                  <span>Markdown (.md)</span>
                </button>
                <button
                  type="button"
                  data-testid="notes-export-html"
                  onClick={() => handleExportHtml(false)}
                  className="folio-press flex w-full items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-tint)]"
                >
                  <span>Web Document (.html)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportHtml(true)}
                  className="folio-press flex w-full items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-tint)]"
                >
                  <span>Word Compatible (.doc)</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrintPdf}
                  className="folio-press flex w-full items-center gap-2 rounded-xl px-3 py-2 hover:bg-[var(--surface-tint)]"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Print / Save PDF</span>
                </button>
                <div className="my-1 h-px bg-[var(--border-subtle)]" />
                <button
                  type="button"
                  onClick={handleExportFolio}
                  className="folio-press flex w-full items-center justify-between rounded-xl px-3 py-2 hover:bg-[var(--surface-tint)]"
                >
                  <span>Folio Backup (.folio.json)</span>
                </button>
              </div>
            )}
          </div>

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

      {/* Main Split Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <NotesOutlineSidebar
          open={outlineOpen}
          items={outlineItems}
          onSelectHeading={handleSelectHeading}
        />

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <NotesFormattingToolbar
            editor={editor}
            pageStyle={pageStyle}
            pageMargins={pageMargins}
            fontStack={defaultFont}
            onChangePageStyle={handlePageStyleChange}
            onChangePageMargins={handlePageMarginsChange}
            onChangeDefaultFont={handleDefaultFontChange}
            onTriggerImageUpload={() => imageInputRef.current?.click()}
          />

          <main className="custom-scrollbar flex-1 overflow-y-auto px-4 pb-20 pt-4">
            <div
              ref={editorContainerRef}
              onClick={() => editor?.commands.focus()}
              style={{
                fontFamily: defaultFont,
                transform: docZoom !== 1 ? `scale(${docZoom})` : undefined,
                transformOrigin: 'top center',
              }}
              className={`mx-auto transition-all duration-150 ${
                pageStyle === 'paginated'
                  ? 'w-full max-w-[816px] rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] shadow-[0_10px_34px_rgba(7,45,89,0.10)]'
                  : 'w-full max-w-5xl rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/95 shadow-sm'
              }`}
            >
              <div
                style={{
                  paddingLeft: `${MARGIN_PX[pageMargins]}px`,
                  paddingRight: `${MARGIN_PX[pageMargins]}px`,
                  paddingTop: '48px',
                  paddingBottom: '64px',
                }}
              >
                <EditorContent editor={editor} />
              </div>
            </div>
          </main>

          {/* Bottom Floating Word Count & Zoom Pill */}
          <div
            data-testid="notes-status-bar"
            className="folio-glass-island pointer-events-auto fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-1.5 text-[11px] font-semibold text-[var(--navy-900)]"
          >
            <span className="tabular-nums">
              {stats.words} word{stats.words === 1 ? '' : 's'}
            </span>
            <span className="text-[var(--navy-600)]">·</span>
            <span className="hidden tabular-nums sm:inline">
              {stats.characters} chars
            </span>
            <span className="hidden text-[var(--navy-600)] sm:inline">·</span>
            <span className="tabular-nums">
              {stats.readingMinutes} min read
            </span>
            <span className="text-[var(--navy-600)]">·</span>
            <select
              aria-label="Document zoom"
              value={String(docZoom)}
              onChange={(e) => setDocZoom(Number(e.target.value))}
              className="bg-transparent font-mono text-[11px] font-bold outline-none"
            >
              <option value="0.85">85%</option>
              <option value="1">100%</option>
              <option value="1.15">115%</option>
              <option value="1.3">130%</option>
            </select>
          </div>

          <NotesSlashMenu
            open={slashState.open}
            query={slashState.query}
            position={slashState.position}
            editor={editor}
            slashRange={slashState.range}
            onPickImage={() => imageInputRef.current?.click()}
            onClose={() => setSlashState((prev) => ({ ...prev, open: false }))}
          />
        </div>

        <NotesAiPanel
          open={aiOpen}
          documentText={plainText}
          getSelectedText={() => {
            if (!editor) return '';
            const { from, to } = editor.state.selection;
            return from === to ? '' : editor.state.doc.textBetween(from, to, ' ');
          }}
          onInsertAtCursor={(text) => {
            editor?.chain().focus().insertContent(`<p>${text.replace(/\n/g, '<br/>')}</p>`).run();
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onClose={() => setAiOpen(false)}
        />
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) void insertImageFiles(files);
        }}
        className="hidden"
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};

export default NotesEditor;
