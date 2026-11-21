import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, FilePlus2, FileUp, Trash2, X } from 'lucide-react';
import {
  generatePageThumbnail,
  generatePdfAwarePageThumbnail,
} from '../../canvas/thumbnail';
import { db } from '../../db/database';
import { useAppStore } from '../../store/useAppStore';
import type { Page } from '../../types/notes';
import { isPdfFile } from '../../utils/pdfEngine';

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
      className="flex h-36 w-full items-center justify-center overflow-hidden rounded-lg bg-slate-100 p-2"
    >
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt={`Page ${pageNumber}`}
          className="max-h-full rounded-xs shadow-xs ring-1 ring-[#072D59]/10"
        />
      ) : (
        <div className="flex h-28 w-20 items-center justify-center rounded bg-white text-[10px] font-semibold text-[#072D59]/45 shadow-xs">
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
  const duplicatePage = useAppStore((s) => s.duplicatePage);
  const deletePage = useAppStore((s) => s.deletePage);
  const reorderPages = useAppStore((s) => s.reorderPages);

  const [pdfDragActive, setPdfDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  if (!open) return null;

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
      className="relative z-20 flex h-full w-64 shrink-0 flex-col border-r border-[#072D59]/10 bg-white shadow-lg"
    >
      {pdfDragActive && (
        <div
          data-testid="pages-drawer-pdf-drop-hint"
          className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#FD6E88] bg-[#DBF2FC]/90 p-4 text-center backdrop-blur-xs"
        >
          <FileUp className="mb-1.5 h-6 w-6 text-[#FD6E88]" />
          <p className="text-xs font-bold text-[#072D59]">Drop PDF to append pages</p>
        </div>
      )}

      <div className="flex items-center justify-between border-b border-[#072D59]/10 bg-[#DBF2FC]/35 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-[#072D59]">Pages ({pages.length})</h2>
          <p className="text-[11px] font-medium text-[#072D59]/60">
            Jump, reorder, or drop PDFs
          </p>
        </div>
        <button
          type="button"
          aria-label="Close Pages Drawer"
          onClick={onClose}
          className="rounded-lg p-1 text-[#072D59]/55 transition duration-150 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto p-3">
        {pages.map((page, index) => {
          const isActive = page.id === activePageId;

          return (
            <div
              key={page.id}
              className={`group rounded-xl border p-2 transition duration-150 ${
                isActive
                  ? 'border-[#FD6E88] bg-[#DBF2FC]/35 ring-2 ring-[#FD6E88]/25'
                  : 'border-[#072D59]/10 bg-white hover:border-[#072D59]/25'
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
                <span className="text-xs font-bold text-[#072D59]">
                  Page {index + 1}
                </span>

                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    title="Move up"
                    aria-label={`Move page ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => movePage(index, -1)}
                    className="rounded p-1 text-[#072D59]/45 transition duration-150 hover:bg-[#DBF2FC]/65 hover:text-[#072D59] disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    aria-label={`Move page ${index + 1} down`}
                    disabled={index === pages.length - 1}
                    onClick={() => movePage(index, 1)}
                    className="rounded p-1 text-[#072D59]/45 transition duration-150 hover:bg-[#DBF2FC]/65 hover:text-[#072D59] disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Duplicate page"
                    aria-label={`Duplicate page ${index + 1}`}
                    onClick={() => void duplicatePage(page.id)}
                    className="rounded p-1 text-[#072D59]/45 transition duration-150 hover:bg-[#DBF2FC]/65 hover:text-[#072D59]"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Delete page"
                    aria-label={`Delete page ${index + 1}`}
                    disabled={pages.length <= 1}
                    onClick={() => void deletePage(page.id)}
                    className="rounded p-1 text-[#072D59]/45 transition duration-150 hover:bg-[#FD6E88]/14 hover:text-[#F95573] disabled:opacity-30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2 border-t border-[#072D59]/10 p-3">
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
            <FileUp className="h-4 w-4 text-[#FD6E88]" />
            Import PDF Pages
          </button>
        )}
      </div>
    </aside>
  );
};
