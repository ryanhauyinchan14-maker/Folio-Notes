import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Columns2,
  Copy,
  FilePlus2,
  FileUp,
  Lock,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  generatePageThumbnail,
  generatePdfAwarePageThumbnail,
} from '../../canvas/thumbnail';
import { db } from '../../db/database';
import { repository } from '../../db/repository';
import { useAppStore } from '../../store/useAppStore';
import type { Notebook, Page } from '../../types/notes';
import { isPdfFile } from '../../utils/pdfEngine';
import { unlockMasterKeyWithPassword } from '../../utils/vaultCrypto';

interface PagesDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelectPage: (pageId: string) => void;
  onOpenTemplatePicker: () => void;
  onImportPdfFiles?: (files: File[]) => void;
  onImportPdfClick?: () => void;
}

const DrawerPageThumb: React.FC<{
  page: Page;
  pageNumber: number;
  masterKey: CryptoKey | null;
  isLocked: boolean;
}> = ({ page, pageNumber, masterKey, isLocked }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [lazyThumb, setLazyThumb] = useState<string>('');

  const syncThumb =
    page.thumbnailDataUrl ||
    (!page.pdfBackground
      ? generatePageThumbnail(
          page.paper,
          page.strokes,
          180,
          page.textboxes ?? [],
          page.images ?? [],
        )
      : '');

  useEffect(() => {
    if (syncThumb || !page.pdfBackground) return;
    let cancelled = false;
    let observer: IntersectionObserver | null = null;

    const triggerRender = () => {
      void generatePdfAwarePageThumbnail(page, 180, masterKey).then((url) => {
        if (cancelled || !url) return;
        setLazyThumb(url);
        if (!isLocked) {
          void db.pages.update(page.id, { thumbnailDataUrl: url });
          useAppStore.setState((s) => ({
            pages: s.pages.map((p) => (p.id === page.id ? { ...p, thumbnailDataUrl: url } : p)),
          }));
        }
      });
    };

    const el = containerRef.current;
    if (el && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            observer?.disconnect();
            triggerRender();
          }
        },
        { rootMargin: '200px 0px' },
      );
      observer.observe(el);
    } else {
      triggerRender();
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [syncThumb, page, masterKey, isLocked]);

  const thumbSrc = syncThumb || lazyThumb;

  return (
    <div
      ref={containerRef}
      className="flex h-36 w-full items-center justify-center overflow-hidden rounded-lg bg-[var(--surface-tint)] p-2"
    >
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt={`Page ${pageNumber}`}
          className="max-h-full rounded-xs shadow-[var(--shadow-ambient)] ring-1 ring-[var(--border-subtle)]"
        />
      ) : (
        <div className="flex h-28 w-20 items-center justify-center rounded bg-[var(--surface-elevated)] text-[10px] font-semibold text-[var(--navy-600)] shadow-xs">
          PDF {page.pdfBackground?.pageNumber ?? pageNumber}
        </div>
      )}
    </div>
  );
};

export const PagesDrawer: React.FC<PagesDrawerProps> = ({
  open,
  onClose,
  onSelectPage,
  onOpenTemplatePicker,
  onImportPdfFiles,
  onImportPdfClick,
}) => {
  const activeNotebook = useAppStore((s) => s.activeNotebook);
  const pages = useAppStore((s) => s.pages);
  const activePageId = useAppStore((s) => s.activePageId);
  const unlockedMasterKey = useAppStore((s) => s.unlockedMasterKey);
  const splitPane = useAppStore((s) => s.splitPane);
  const activePaneSide = useAppStore((s) => s.activePaneSide);
  const notebooks = useAppStore((s) => s.notebooks);
  const openSplitNotebook = useAppStore((s) => s.openSplitNotebook);
  const swapSplitPanes = useAppStore((s) => s.swapSplitPanes);
  const closeSplitPane = useAppStore((s) => s.closeSplitPane);
  const duplicatePage = useAppStore((s) => s.duplicatePage);
  const deletePage = useAppStore((s) => s.deletePage);
  const reorderPages = useAppStore((s) => s.reorderPages);

  const isWhiteboard = activeNotebook?.mode === 'whiteboard';
  const [drawerTab, setDrawerTab] = useState<'pages' | 'split'>(() =>
    isWhiteboard ? 'split' : 'pages',
  );
  const [allNotebooks, setAllNotebooks] = useState<Notebook[]>([]);
  const [splitQuery, setSplitQuery] = useState('');
  const [unlockTargetNb, setUnlockTargetNb] = useState<Notebook | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockBusy, setUnlockBusy] = useState(false);

  const [pdfDragActive, setPdfDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    if (isWhiteboard) {
      setDrawerTab('split');
    }
    let cancelled = false;
    void repository.getAllNotebooks().then((list) => {
      if (!cancelled) setAllNotebooks(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open, notebooks, isWhiteboard]);

  const filteredNotebooks = useMemo(() => {
    const q = splitQuery.trim().toLowerCase();
    return q
      ? allNotebooks.filter((nb) => nb.title.toLowerCase().includes(q))
      : allNotebooks;
  }, [allNotebooks, splitQuery]);

  if (!open) return null;

  const leftTitle =
    activePaneSide === 'left'
      ? activeNotebook?.title ?? 'Left'
      : splitPane?.notebook.title ?? 'Left';
  const rightTitle =
    activePaneSide === 'right'
      ? activeNotebook?.title ?? 'Right'
      : splitPane?.notebook.title ?? 'Right';

  const handleSelectSplitNotebook = async (nb: Notebook) => {
    setUnlockError(null);
    if (nb.isLocked) {
      const candidateKey =
        activeNotebook?.isLocked && unlockedMasterKey
          ? unlockedMasterKey
          : splitPane?.unlockedMasterKey ?? null;
      if (candidateKey) {
        await openSplitNotebook(nb.id, candidateKey);
        return;
      }
      setUnlockTargetNb(nb);
      setUnlockPassword('');
      return;
    }
    setUnlockTargetNb(null);
    await openSplitNotebook(nb.id);
  };

  const handleUnlockSplitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockTargetNb || !unlockPassword) return;
    setUnlockBusy(true);
    setUnlockError(null);
    try {
      const key = await unlockMasterKeyWithPassword(unlockPassword, false);
      await openSplitNotebook(unlockTargetNb.id, key);
      setUnlockTargetNb(null);
      setUnlockPassword('');
    } catch {
      setUnlockError('Incorrect Vault Password.');
    } finally {
      setUnlockBusy(false);
    }
  };

  const movePage = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= pages.length) return;
    const nextOrder = pages.map((p) => p.id);
    const [item] = nextOrder.splice(index, 1);
    nextOrder.splice(target, 0, item);
    void reorderPages(nextOrder);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setPdfDragActive(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent<HTMLElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setPdfDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    dragDepthRef.current = 0;
    setPdfDragActive(false);
    const pdfs = Array.from(e.dataTransfer?.files ?? []).filter(isPdfFile);
    if (pdfs.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    onImportPdfFiles?.(pdfs);
  };

  return (
    <aside
      data-testid="pages-drawer"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative z-20 flex h-full w-64 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-elevated)] shadow-[var(--shadow-ambient)]"
    >
      {pdfDragActive && (
        <div
          data-testid="pages-drawer-pdf-drop-hint"
          className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--crimson-500)] bg-[var(--surface-seal)]/92 p-4 text-center backdrop-blur-xs"
        >
          <FileUp className="mb-1.5 h-6 w-6 text-[var(--crimson-500)]" />
          <p className="text-xs font-bold text-[var(--navy-900)]">Drop PDF to append pages</p>
        </div>
      )}

      <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-tint)]/75 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[var(--navy-900)] tabular-nums">
              {drawerTab === 'split'
                ? 'Split View'
                : `Pages (${pages.length})`}
            </h2>
            <p className="text-[11px] font-medium text-[var(--navy-600)]">
              {drawerTab === 'split'
                ? 'Open 2 notebooks side by side'
                : 'Jump, reorder, or drop PDFs'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close Pages Drawer"
            onClick={onClose}
            className="folio-press rounded-lg p-1 text-[var(--navy-600)] hover:bg-[var(--surface-elevated)] hover:text-[var(--navy-900)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="folio-segmented-track mt-2.5 flex rounded-xl p-0.5">
          {!isWhiteboard && (
            <button
              type="button"
              data-testid="drawer-tab-pages"
              onClick={() => setDrawerTab('pages')}
              className={`folio-press flex-1 rounded-lg py-1 text-[11px] font-bold transition-colors ${
                drawerTab === 'pages'
                  ? 'folio-glass-active'
                  : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
              }`}
            >
              Pages
            </button>
          )}
          <button
            type="button"
            data-testid="drawer-tab-split"
            onClick={() => setDrawerTab('split')}
            className={`folio-press inline-flex flex-1 items-center justify-center gap-1 rounded-lg py-1 text-[11px] font-bold transition-colors ${
              drawerTab === 'split'
                ? 'folio-glass-active'
                : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
            }`}
          >
            <Columns2 className="h-3 w-3" />
            <span>Split View</span>
            {splitPane && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-[var(--crimson-500)]"
              />
            )}
          </button>
        </div>
      </div>

      {drawerTab === 'split' ? (
        <div
          data-testid="drawer-split-panel"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {splitPane && (
            <div className="space-y-2 border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-3">
              <div className="flex items-center justify-between gap-1 text-[10px] font-bold uppercase tracking-wide text-[var(--navy-600)]">
                <span>Active Split</span>
                <span>Shared Top Tools</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div className="truncate rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 py-1 font-semibold text-[var(--navy-900)]">
                  L: {leftTitle}
                </div>
                <div className="truncate rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 py-1 font-semibold text-[var(--navy-900)]">
                  R: {rightTitle}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="split-swap-sides-btn"
                  onClick={swapSplitPanes}
                  className="folio-btn-secondary folio-press inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold"
                >
                  <ArrowLeftRight className="h-3 w-3" />
                  <span>Swap Sides</span>
                </button>
                <button
                  type="button"
                  data-testid="split-close-btn"
                  onClick={() => void closeSplitPane()}
                  className="folio-btn-secondary folio-press inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-[var(--state-danger-text)] hover:border-[var(--state-danger-border)] hover:bg-[var(--state-danger-bg)]"
                >
                  <X className="h-3 w-3" />
                  <span>Close Split</span>
                </button>
              </div>
            </div>
          )}

          <div className="border-b border-[var(--border-subtle)] p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--navy-600)]" />
              <input
                type="search"
                data-testid="split-notebook-search"
                value={splitQuery}
                onChange={(e) => setSplitQuery(e.target.value)}
                placeholder="Search notebooks…"
                className="folio-input w-full rounded-xl py-1.5 pl-8 pr-3 text-xs"
              />
            </div>
          </div>

          {unlockTargetNb && (
            <form
              onSubmit={(e) => void handleUnlockSplitSubmit(e)}
              className="space-y-2 border-b border-[var(--border-subtle)] bg-[var(--surface-tint)] p-3"
            >
              <div className="flex items-center justify-between text-[11px] font-bold text-[var(--navy-900)]">
                <span className="truncate">Unlock &ldquo;{unlockTargetNb.title}&rdquo;</span>
                <button
                  type="button"
                  onClick={() => setUnlockTargetNb(null)}
                  className="rounded p-0.5 text-[var(--navy-600)] hover:text-[var(--navy-900)]"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <input
                type="password"
                autoFocus
                value={unlockPassword}
                onChange={(e) => {
                  setUnlockPassword(e.target.value);
                  setUnlockError(null);
                }}
                placeholder="Vault Password"
                className="folio-input w-full rounded-lg px-2.5 py-1.5 text-xs"
              />
              {unlockError && (
                <p className="text-[11px] font-semibold text-[var(--state-danger-text)]">
                  {unlockError}
                </p>
              )}
              <button
                type="submit"
                disabled={unlockBusy || !unlockPassword}
                className="folio-btn-navy folio-press w-full rounded-lg py-1.5 text-[11px] font-bold disabled:opacity-50"
              >
                {unlockBusy ? 'Unlocking…' : 'Open in Split View'}
              </button>
            </form>
          )}

          <div className="custom-scrollbar flex-1 space-y-1.5 overflow-y-auto p-3">
            {filteredNotebooks.length === 0 ? (
              <p className="py-8 text-center text-xs font-medium text-[var(--navy-600)]">
                No matching notebooks
              </p>
            ) : (
              filteredNotebooks.map((nb) => {
                const isFocusedBook = activeNotebook?.id === nb.id;
                const isSplitCompanion = splitPane?.notebook.id === nb.id;
                const pageCount = Math.max(1, nb.pageOrder.length);
                return (
                  <button
                    key={nb.id}
                    type="button"
                    data-testid={`split-pick-notebook-${nb.id}`}
                    disabled={isFocusedBook}
                    onClick={() => void handleSelectSplitNotebook(nb)}
                    className={`folio-press flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition-colors ${
                      isFocusedBook
                        ? 'cursor-default border-[var(--border-subtle)] bg-[var(--surface-tint)] opacity-65'
                        : isSplitCompanion
                          ? 'border-[var(--crimson-border)] bg-[var(--surface-seal)]/65'
                          : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:border-[var(--navy-400)] hover:bg-[var(--surface-tint)]'
                    }`}
                  >
                    <div
                      className="relative flex h-9 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-black/10 shadow-2xs"
                      style={{ backgroundColor: nb.cover.primaryColor }}
                      aria-hidden="true"
                    >
                      <span
                        className="absolute inset-y-0 left-0 w-1"
                        style={{ backgroundColor: nb.cover.accentColor }}
                      />
                      {nb.isLocked && (
                        <Lock className="relative z-10 h-3 w-3 text-white drop-shadow-xs" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-[var(--navy-900)]">
                        {nb.title}
                      </div>
                      <div className="text-[10px] font-medium text-[var(--navy-600)] tabular-nums">
                        {nb.mode === 'whiteboard'
                          ? 'Whiteboard'
                          : `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`}
                      </div>
                    </div>

                    {isFocusedBook && (
                      <span className="shrink-0 rounded-full bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-bold text-[var(--navy-700)]">
                        Open
                      </span>
                    )}
                    {isSplitCompanion && (
                      <span className="shrink-0 rounded-full bg-[var(--crimson-500)] px-2 py-0.5 text-[10px] font-bold text-white">
                        In Split
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto p-3">
            {pages.map((page, index) => {
              const isActive = page.id === activePageId;

              return (
                <div
                  key={page.id}
                  className={`group rounded-xl border p-2 transition duration-150 ${
                    isActive
                      ? 'border-[var(--crimson-500)] bg-[var(--surface-tint)]/65 ring-2 ring-[var(--crimson-glow)]'
                      : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectPage(page.id)}
                    className="flex w-full flex-col items-center"
                  >
                    <DrawerPageThumb
                      page={page}
                      pageNumber={index + 1}
                      masterKey={unlockedMasterKey}
                      isLocked={Boolean(activeNotebook?.isLocked)}
                    />
                  </button>

                  <div className="mt-2 flex items-center justify-between px-1">
                    <span className="text-xs font-bold text-[var(--navy-900)] tabular-nums">
                      Page {index + 1}
                    </span>

                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        title="Move up"
                        aria-label={`Move page ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => movePage(index, -1)}
                        className="folio-press rounded p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)] disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Move down"
                        aria-label={`Move page ${index + 1} down`}
                        disabled={index === pages.length - 1}
                        onClick={() => movePage(index, 1)}
                        className="folio-press rounded p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)] disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Duplicate page"
                        aria-label={`Duplicate page ${index + 1}`}
                        onClick={() => void duplicatePage(page.id)}
                        className="folio-press rounded p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Delete page"
                        aria-label={`Delete page ${index + 1}`}
                        disabled={pages.length <= 1}
                        onClick={() => void deletePage(page.id)}
                        className="folio-press rounded p-1 text-[var(--navy-600)] hover:bg-[var(--state-danger-bg)] hover:text-[var(--state-danger-text)] disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-2 border-t border-[var(--border-subtle)] p-3">
            <button
              type="button"
              onClick={onOpenTemplatePicker}
              className="folio-btn-navy flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
            >
              <FilePlus2 className="h-4 w-4" />
              Add Page from Template
            </button>
            {onImportPdfClick && (
              <button
                type="button"
                data-testid="drawer-import-pdf-btn"
                onClick={onImportPdfClick}
                className="folio-btn-secondary flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
              >
                <FileUp className="h-4 w-4 text-[var(--crimson-500)]" />
                Import PDF Pages
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
};
