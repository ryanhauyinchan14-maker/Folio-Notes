import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Printer,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  normalizeWhiteboardPageForExport,
  WHITEBOARD_EXPORT_MARGIN,
} from '../../canvas/whiteboard';
import { repository } from '../../db/repository';
import type { Notebook, Page } from '../../types/notes';
import {
  exportNotebookToPdf,
  type PageRangeMode,
  parsePageRange,
  renderExportPreviewDataUrl,
  renderPageToCanvas,
  sanitizeExportFilename,
  triggerBlobDownload,
} from '../../utils/exportNotebook';
import type {
  FolioPrinterInfo,
  PrintFitMode,
  PrintMarginsMode,
  PrintPaperSize,
} from '../../vite-env';
import { PRINT_PAPER_DIMENSIONS } from '../../../electron/printCore';

interface PrintPreviewModalProps {
  open: boolean;
  notebook: Notebook | null;
  pages: Page[];
  currentPageIndex?: number;
  masterKey?: CryptoKey | null;
  onClose: () => void;
}

const SAVE_PDF_DEST = '__save_pdf__';
const BROWSER_PRINT_DEST = '__browser_print__';

const PAPER_SIZE_OPTIONS: Array<{ id: PrintPaperSize; label: string }> = [
  { id: 'Letter', label: 'Letter (8.5 × 11 in)' },
  { id: 'A4', label: 'A4 (210 × 297 mm)' },
  { id: 'Legal', label: 'Legal (8.5 × 14 in)' },
  { id: 'Tabloid', label: 'Tabloid (11 × 17 in)' },
];

interface SheetPreviewItem {
  pageIndex: number;
  pageNumber: number;
  dataUrl: string;
}

function inferDefaultPaperSize(page: Page | undefined): PrintPaperSize {
  const preset = page?.paper.sizePreset;
  if (preset === 'a4') return 'A4';
  if (preset === 'legal') return 'Legal';
  return 'Letter';
}

export const PrintPreviewModal: React.FC<PrintPreviewModalProps> = ({
  open,
  notebook,
  pages,
  currentPageIndex = 0,
  masterKey = null,
  onClose,
}) => {
  const printBridge =
    typeof window !== 'undefined' &&
    typeof window.folioDesktop?.print?.getPrinters === 'function' &&
    typeof window.folioDesktop?.print?.printSheets === 'function'
      ? window.folioDesktop.print
      : null;
  const hasElectronPrint = Boolean(printBridge);

  const [printers, setPrinters] = useState<FolioPrinterInfo[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [destination, setDestination] = useState<string>(
    hasElectronPrint ? SAVE_PDF_DEST : BROWSER_PRINT_DEST,
  );
  const [rangeMode, setRangeMode] = useState<PageRangeMode>('all');
  const [customRange, setCustomRange] = useState('1');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [paperSize, setPaperSize] = useState<PrintPaperSize>('Letter');
  const [copies, setCopies] = useState(1);
  const [colorMode, setColorMode] = useState<'color' | 'bw'>('color');
  const [margins, setMargins] = useState<PrintMarginsMode>('default');
  const [fitMode, setFitMode] = useState<PrintFitMode>('fit');
  const [includeBackground, setIncludeBackground] = useState(true);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);

  const [sheetPreviews, setSheetPreviews] = useState<SheetPreviewItem[]>([]);
  const [renderingPreviews, setRenderingPreviews] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sheetRefs = useRef<Array<HTMLDivElement | null>>([]);
  const browserPrintCleanupRef = useRef<(() => void) | null>(null);

  const isWhiteboard = notebook?.mode === 'whiteboard';
  const safeCurrentIdx = Math.max(0, Math.min(Math.max(0, pages.length - 1), currentPageIndex));

  const resolvePdfBytes = useMemo(
    () => async (assetId: string): Promise<ArrayBuffer | null> =>
      repository.getPdfAssetData(assetId, masterKey),
    [masterKey],
  );

  // Clean up any temporary browser-print DOM overlay on unmount
  useEffect(() => {
    return () => {
      browserPrintCleanupRef.current?.();
    };
  }, []);

  // Initialize defaults & discover system printers when opened
  useEffect(() => {
    if (!open || !notebook) return;

    const firstPage = pages[safeCurrentIdx] ?? pages[0];
    setRangeMode(pages.length > 1 ? 'all' : 'current');
    setCustomRange(pages.length > 1 ? `1-${pages.length}` : '1');
    setOrientation(firstPage && firstPage.paper.width > firstPage.paper.height ? 'landscape' : 'portrait');
    setPaperSize(inferDefaultPaperSize(firstPage));
    setCopies(1);
    setColorMode('color');
    setMargins('default');
    setFitMode('fit');
    setIncludeBackground(true);
    setPreviewZoom(100);
    setActiveSheetIndex(0);
    setError(null);
    setNotice(null);

    if (!printBridge) {
      setPrinters([]);
      setDestination(BROWSER_PRINT_DEST);
      setLoadingPrinters(false);
      return;
    }

    let cancelled = false;
    setLoadingPrinters(true);
    void printBridge
      .getPrinters()
      .then((list) => {
        if (cancelled) return;
        setPrinters(list);
        const preferred = list.find((p) => p.isDefault) ?? list[0];
        setDestination(preferred ? preferred.name : SAVE_PDF_DEST);
      })
      .catch(() => {
        if (cancelled) return;
        setPrinters([]);
        setDestination(SAVE_PDF_DEST);
      })
      .finally(() => {
        if (!cancelled) setLoadingPrinters(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, notebook?.id, pages, printBridge, safeCurrentIdx]);

  // Close cleanly on Escape when idle
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  const parsedRange = useMemo(
    () => parsePageRange(rangeMode, customRange, safeCurrentIdx, pages.length),
    [rangeMode, customRange, safeCurrentIdx, pages.length],
  );

  const selectedIndices = useMemo(() => {
    if (pages.length === 0) return [];
    if (isWhiteboard) return [safeCurrentIdx];
    return parsedRange.indices;
  }, [isWhiteboard, pages.length, parsedRange.indices, safeCurrentIdx]);

  // Keep active sheet index clamped when range changes
  useEffect(() => {
    setActiveSheetIndex((prev) =>
      selectedIndices.length === 0 ? 0 : Math.min(prev, selectedIndices.length - 1),
    );
  }, [selectedIndices.length]);

  // Rasterize live sheet previews for selected pages
  useEffect(() => {
    if (!open || !notebook) return;
    if (selectedIndices.length === 0) {
      setSheetPreviews([]);
      setRenderingPreviews(false);
      return;
    }

    let cancelled = false;
    setRenderingPreviews(true);

    void Promise.all(
      selectedIndices.map(async (pageIdx): Promise<SheetPreviewItem | null> => {
        const page = pages[pageIdx];
        if (!page) return null;
        try {
          const dataUrl = await renderExportPreviewDataUrl(page, {
            includeBackground,
            includeAnnotations: true,
            isWhiteboard: Boolean(isWhiteboard),
            maxWidth: 960,
            maxHeight: 1240,
            resolvePdfBytes,
          });
          return {
            pageIndex: pageIdx,
            pageNumber: pageIdx + 1,
            dataUrl,
          };
        } catch {
          return {
            pageIndex: pageIdx,
            pageNumber: pageIdx + 1,
            dataUrl: '',
          };
        }
      }),
    )
      .then((items) => {
        if (!cancelled) {
          setSheetPreviews(items.filter((x): x is SheetPreviewItem => Boolean(x)));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRenderingPreviews(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, notebook, pages, selectedIndices, includeBackground, isWhiteboard, resolvePdfBytes]);

  if (!open || !notebook) return null;

  const isSavePdf = destination === SAVE_PDF_DEST;
  const isBrowserDialog = destination === BROWSER_PRINT_DEST;
  const canSubmit =
    !busy &&
    selectedIndices.length > 0 &&
    (isWhiteboard || parsedRange.valid);

  const dims = PRINT_PAPER_DIMENSIONS[paperSize] ?? PRINT_PAPER_DIMENSIONS.Letter;
  const sheetAspectRatio =
    orientation === 'landscape' ? 1 / dims.aspectRatio : dims.aspectRatio;
  const baseSheetWidthPx = orientation === 'landscape' ? 520 : 410;
  const renderedSheetWidthPx = Math.round((baseSheetWidthPx * previewZoom) / 100);
  const sheetPaddingPx =
    margins === 'default' ? Math.max(12, Math.round(renderedSheetWidthPx * 0.047)) : 0;

  const jumpToSheet = (index: number) => {
    const clamped = Math.max(0, Math.min(Math.max(0, selectedIndices.length - 1), index));
    setActiveSheetIndex(clamped);
    sheetRefs.current[clamped]?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  };

  const renderHighDpiPrintSheets = async (): Promise<string[]> => {
    const urls: string[] = [];
    for (let i = 0; i < selectedIndices.length; i++) {
      setProgress({ current: i + 1, total: selectedIndices.length });
      const rawPage = pages[selectedIndices[i]];
      if (!rawPage) continue;
      const targetPage = isWhiteboard
        ? normalizeWhiteboardPageForExport(rawPage, WHITEBOARD_EXPORT_MARGIN)
        : rawPage;
      const scale = Math.min(
        2,
        2400 / Math.max(1, targetPage.paper.width, targetPage.paper.height),
      );
      const canvas = await renderPageToCanvas(targetPage, {
        scale,
        includeBackground,
        includeAnnotations: true,
        transparentBackground: false,
        isWhiteboard: false,
        resolvePdfBytes,
      });
      urls.push(canvas.toDataURL('image/png'));
    }
    return urls;
  };

  const handleSavePdf = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setProgress({ current: 1, total: Math.max(1, selectedIndices.length) });
    try {
      const pdfBytes = await exportNotebookToPdf({
        title: notebook.title,
        pages,
        selectedIndices,
        includeBackground,
        includeAnnotations: true,
        scale: 2,
        isWhiteboard: Boolean(isWhiteboard),
        resolvePdfBytes,
        onProgress: (current, total) => setProgress({ current, total }),
      });
      const filename = `${sanitizeExportFilename(notebook.title)}.pdf`;
      const ab = pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength,
      ) as ArrayBuffer;
      triggerBlobDownload(new Blob([ab], { type: 'application/pdf' }), filename);
      setNotice(`Saved ${filename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save PDF.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleElectronPrint = async (silent: boolean) => {
    if (!printBridge) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sheetDataUrls = await renderHighDpiPrintSheets();
      const res = await printBridge.printSheets({
        title: notebook.title,
        sheetDataUrls,
        deviceName: isSavePdf || isBrowserDialog ? undefined : destination,
        silent,
        landscape: orientation === 'landscape',
        color: colorMode === 'color',
        copies,
        pageSize: paperSize,
        margins,
        fitMode,
      });
      if (res.ok) {
        onClose();
      } else if (!/cancel/i.test(res.error ?? '')) {
        setError(res.error || 'Printing failed.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send print job.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleBrowserPrint = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sheetDataUrls = await renderHighDpiPrintSheets();
      browserPrintCleanupRef.current?.();

      const pageStyle = document.createElement('style');
      pageStyle.setAttribute('data-folio-print-page-style', 'true');
      pageStyle.textContent = `@page { size: ${paperSize} ${orientation}; margin: 0; }`;
      document.head.appendChild(pageStyle);

      const container = document.createElement('div');
      container.setAttribute('data-folio-print-container', 'true');
      for (const url of sheetDataUrls) {
        const sheet = document.createElement('div');
        sheet.className = 'folio-print-sheet';
        sheet.style.padding = margins === 'default' ? '0.4in' : '0';

        const img = document.createElement('img');
        img.src = url;
        img.alt = notebook.title;
        img.style.display = 'block';
        img.style.filter = colorMode === 'color' ? 'none' : 'grayscale(100%)';
        if (fitMode === 'actual') {
          img.style.maxWidth = 'none';
          img.style.maxHeight = 'none';
        } else {
          img.style.maxWidth = '100%';
          img.style.maxHeight = '100%';
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'contain';
        }
        sheet.appendChild(img);
        container.appendChild(sheet);
      }

      document.body.appendChild(container);
      document.body.classList.add('folio-printing-sheets');

      let cleaned = false;
      let fallbackTimer: number | null = null;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        if (fallbackTimer !== null) {
          window.clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        window.removeEventListener('afterprint', cleanup);
        document.body.classList.remove('folio-printing-sheets');
        container.remove();
        pageStyle.remove();
        if (browserPrintCleanupRef.current === cleanup) {
          browserPrintCleanupRef.current = null;
        }
      };

      browserPrintCleanupRef.current = cleanup;
      window.addEventListener('afterprint', cleanup);
      fallbackTimer = window.setTimeout(cleanup, 60_000);
      window.print();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open browser print.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handlePrimarySubmit = () => {
    if (!canSubmit) return;
    if (isSavePdf) {
      void handleSavePdf();
    } else if (hasElectronPrint) {
      void handleElectronPrint(true);
    } else {
      void handleBrowserPrint();
    }
  };

  const totalSheets = selectedIndices.length;

  return (
    <div
      className="folio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-preview-title"
        data-testid="print-preview-modal"
        className="folio-modal-card flex h-[88vh] max-h-[820px] w-full max-w-5xl flex-col overflow-hidden rounded-2xl text-[var(--navy-900)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)]/70 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="folio-glass-badge flex h-8 w-8 items-center justify-center rounded-xl">
              <Printer className="h-4 w-4" />
            </div>
            <div>
              <h2 id="print-preview-title" className="text-sm font-bold text-[var(--navy-900)]">
                Print Preview
              </h2>
              <p className="text-[11px] font-medium text-[var(--navy-600)]">
                {notebook.title} · {totalSheets} {totalSheets === 1 ? 'sheet' : 'sheets'}
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Close print preview"
            disabled={busy}
            onClick={onClose}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Main Split Workspace */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Left Controls Rail */}
          <div className="custom-scrollbar flex w-full shrink-0 flex-col gap-3.5 overflow-y-auto border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 md:w-80 md:border-b-0 md:border-r">
            {/* Destination */}
            <div>
              <label
                htmlFor="print-destination-select"
                className="folio-section-label mb-1.5 block"
              >
                Printer / Destination
              </label>
              <select
                id="print-destination-select"
                data-testid="print-destination-select"
                value={destination}
                disabled={busy || loadingPrinters}
                onChange={(e) => {
                  setDestination(e.target.value);
                  setError(null);
                  setNotice(null);
                }}
                className="folio-input w-full rounded-xl px-3 py-2 text-xs font-semibold"
              >
                {hasElectronPrint ? (
                  <>
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.displayName}
                        {p.isDefault ? ' (Default)' : ''}
                      </option>
                    ))}
                    <option value={SAVE_PDF_DEST}>Save as PDF</option>
                  </>
                ) : (
                  <>
                    <option value={BROWSER_PRINT_DEST}>Browser Print Dialog</option>
                    <option value={SAVE_PDF_DEST}>Save as PDF</option>
                  </>
                )}
              </select>
              {hasElectronPrint && !loadingPrinters && printers.length === 0 && (
                <p className="mt-1 text-[11px] text-[var(--navy-600)]">
                  No system printers found — save as PDF or open the system dialog.
                </p>
              )}
            </div>

            {/* Pages */}
            {!isWhiteboard && pages.length > 1 && (
              <div>
                <div className="folio-section-label mb-1.5">Pages</div>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--surface-canvas)] p-1 ring-1 ring-[var(--border-subtle)]">
                  {(
                    [
                      { id: 'all', label: `All (${pages.length})` },
                      { id: 'current', label: `Page ${safeCurrentIdx + 1}` },
                      { id: 'custom', label: 'Custom' },
                    ] as Array<{ id: PageRangeMode; label: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`print-range-${opt.id}`}
                      aria-pressed={rangeMode === opt.id}
                      onClick={() => setRangeMode(opt.id)}
                      className={`folio-press rounded-lg px-2 py-1.5 text-[11px] font-semibold ${
                        rangeMode === opt.id
                          ? 'folio-glass-active'
                          : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {rangeMode === 'custom' && (
                  <div className="mt-2">
                    <input
                      type="text"
                      data-testid="print-custom-range-input"
                      aria-label="Custom page range"
                      value={customRange}
                      onChange={(e) => setCustomRange(e.target.value)}
                      placeholder={`e.g. 1-${pages.length} or 1, 3`}
                      className="folio-input w-full rounded-xl px-3 py-1.5 text-xs font-medium"
                    />
                    {!parsedRange.valid && parsedRange.error && (
                      <p className="mt-1 text-[11px] font-medium text-[var(--state-danger-text)]">
                        {parsedRange.error}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Orientation & Color */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <div className="folio-section-label mb-1.5">Orientation</div>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-[var(--surface-canvas)] p-1 ring-1 ring-[var(--border-subtle)]">
                  {(
                    [
                      { id: 'portrait', label: 'Portrait' },
                      { id: 'landscape', label: 'Landscape' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`print-orientation-${opt.id}`}
                      aria-pressed={orientation === opt.id}
                      onClick={() => setOrientation(opt.id)}
                      className={`folio-press rounded-lg px-1.5 py-1.5 text-[11px] font-semibold ${
                        orientation === opt.id
                          ? 'folio-glass-active'
                          : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="folio-section-label mb-1.5">Color</div>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-[var(--surface-canvas)] p-1 ring-1 ring-[var(--border-subtle)]">
                  {(
                    [
                      { id: 'color', label: 'Color' },
                      { id: 'bw', label: 'B&W' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`print-color-${opt.id}`}
                      aria-pressed={colorMode === opt.id}
                      onClick={() => setColorMode(opt.id)}
                      className={`folio-press rounded-lg px-1.5 py-1.5 text-[11px] font-semibold ${
                        colorMode === opt.id
                          ? 'folio-glass-active'
                          : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Paper Size & Copies */}
            <div className={`grid gap-2.5 ${isSavePdf ? 'grid-cols-1' : 'grid-cols-3'}`}>
              <div className={isSavePdf ? '' : 'col-span-2'}>
                <label
                  htmlFor="print-paper-size-select"
                  className="folio-section-label mb-1.5 block"
                >
                  Paper Size
                </label>
                <select
                  id="print-paper-size-select"
                  data-testid="print-paper-size-select"
                  value={paperSize}
                  onChange={(e) => setPaperSize(e.target.value as PrintPaperSize)}
                  className="folio-input w-full rounded-xl px-2.5 py-1.5 text-xs font-semibold"
                >
                  {PAPER_SIZE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {!isSavePdf && (
                <div>
                  <label
                    htmlFor="print-copies-input"
                    className="folio-section-label mb-1.5 block"
                  >
                    Copies
                  </label>
                  <input
                    id="print-copies-input"
                    data-testid="print-copies-input"
                    type="number"
                    min={1}
                    max={99}
                    value={copies}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (Number.isFinite(val)) {
                        setCopies(Math.max(1, Math.min(99, Math.round(val))));
                      }
                    }}
                    className="folio-input w-full rounded-xl px-2.5 py-1.5 text-xs font-semibold tabular-nums"
                  />
                </div>
              )}
            </div>

            {/* Margins & Scale */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <div className="folio-section-label mb-1.5">Margins</div>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-[var(--surface-canvas)] p-1 ring-1 ring-[var(--border-subtle)]">
                  {(
                    [
                      { id: 'default', label: 'Default' },
                      { id: 'none', label: 'None' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`print-margins-${opt.id}`}
                      aria-pressed={margins === opt.id}
                      onClick={() => setMargins(opt.id)}
                      className={`folio-press rounded-lg px-1.5 py-1.5 text-[11px] font-semibold ${
                        margins === opt.id
                          ? 'folio-glass-active'
                          : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="folio-section-label mb-1.5">Scale</div>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-[var(--surface-canvas)] p-1 ring-1 ring-[var(--border-subtle)]">
                  {(
                    [
                      { id: 'fit', label: 'Fit' },
                      { id: 'actual', label: 'Actual' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`print-fit-${opt.id}`}
                      aria-pressed={fitMode === opt.id}
                      onClick={() => setFitMode(opt.id)}
                      className={`folio-press rounded-lg px-1.5 py-1.5 text-[11px] font-semibold ${
                        fitMode === opt.id
                          ? 'folio-glass-active'
                          : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Paper background checkbox */}
            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-3 py-2.5 text-xs font-semibold text-[var(--navy-900)]">
              <span>Include paper lines &amp; background</span>
              <input
                type="checkbox"
                data-testid="print-include-background"
                checked={includeBackground}
                onChange={(e) => setIncludeBackground(e.target.checked)}
                className="h-4 w-4 rounded accent-[var(--crimson-500)]"
              />
            </label>

            {error && (
              <div
                data-testid="print-preview-error"
                className="folio-badge-danger rounded-xl px-3 py-2 text-xs font-semibold"
              >
                {error}
              </div>
            )}
            {notice && (
              <div
                data-testid="print-preview-notice"
                className="rounded-xl border border-[var(--state-success-border)] bg-[var(--state-success-bg)] px-3 py-2 text-xs font-semibold text-[var(--state-success-text)]"
              >
                {notice}
              </div>
            )}
          </div>

          {/* Right Live Sheet Preview Stage */}
          <div className="flex min-h-0 flex-1 flex-col bg-[#D8E3EC]/70">
            {/* Preview Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-glass)] px-4 py-2 backdrop-blur-md">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Previous sheet"
                  disabled={activeSheetIndex <= 0}
                  onClick={() => jumpToSheet(activeSheetIndex - 1)}
                  className="folio-press rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1 text-[var(--navy-900)] hover:bg-[var(--surface-tint)] disabled:opacity-35"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span
                  data-testid="print-preview-sheet-counter"
                  className="folio-mono px-2 text-xs font-semibold text-[var(--navy-900)] tabular-nums"
                >
                  Sheet {totalSheets === 0 ? 0 : activeSheetIndex + 1} of {totalSheets}
                </span>
                <button
                  type="button"
                  aria-label="Next sheet"
                  disabled={activeSheetIndex >= totalSheets - 1}
                  onClick={() => jumpToSheet(activeSheetIndex + 1)}
                  className="folio-press rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1 text-[var(--navy-900)] hover:bg-[var(--surface-tint)] disabled:opacity-35"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Zoom out preview"
                  disabled={previewZoom <= 50}
                  onClick={() => setPreviewZoom((z) => Math.max(50, z - 25))}
                  className="folio-press rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1 text-[var(--navy-900)] hover:bg-[var(--surface-tint)] disabled:opacity-35"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Reset preview zoom"
                  onClick={() => setPreviewZoom(100)}
                  className="folio-mono min-w-[3.25rem] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 py-1 text-[11px] font-bold text-[var(--navy-900)] hover:bg-[var(--surface-tint)] tabular-nums"
                >
                  {previewZoom}%
                </button>
                <button
                  type="button"
                  aria-label="Zoom in preview"
                  disabled={previewZoom >= 150}
                  onClick={() => setPreviewZoom((z) => Math.min(150, z + 25))}
                  className="folio-press rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1 text-[var(--navy-900)] hover:bg-[var(--surface-tint)] disabled:opacity-35"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Scrollable Physical Sheets Canvas */}
            <div className="custom-scrollbar relative flex flex-1 flex-col items-center gap-6 overflow-auto p-6">
              {totalSheets === 0 ? (
                <div className="m-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-6 py-4 text-xs font-semibold text-[var(--navy-600)]">
                  Enter a valid page range to preview sheets.
                </div>
              ) : (
                selectedIndices.map((pageIdx, idx) => {
                  const previewItem = sheetPreviews.find((s) => s.pageIndex === pageIdx);
                  const isActiveSheet = idx === activeSheetIndex;
                  return (
                    <div
                      key={`${pageIdx}-${idx}`}
                      ref={(el) => {
                        sheetRefs.current[idx] = el;
                      }}
                      data-testid={`print-preview-sheet-${idx}`}
                      data-orientation={orientation}
                      data-paper-size={paperSize}
                      data-margins={margins}
                      data-color-mode={colorMode}
                      onClick={() => setActiveSheetIndex(idx)}
                      className="flex flex-col items-center gap-1.5"
                    >
                      <div
                        style={{
                          width: `${renderedSheetWidthPx}px`,
                          aspectRatio: `${sheetAspectRatio}`,
                          padding: `${sheetPaddingPx}px`,
                        }}
                        className={`relative flex items-center justify-center overflow-hidden bg-white shadow-[0_14px_34px_rgba(7,45,89,0.20)] transition-all ${
                          isActiveSheet
                            ? 'ring-2 ring-[var(--crimson-500)]'
                            : 'ring-1 ring-[#072D59]/12'
                        }`}
                      >
                        {previewItem?.dataUrl ? (
                          <img
                            src={previewItem.dataUrl}
                            alt={`Print sheet ${idx + 1}`}
                            style={{
                              filter: colorMode === 'bw' ? 'grayscale(100%)' : 'none',
                            }}
                            className={
                              fitMode === 'actual'
                                ? 'max-h-none max-w-none object-none'
                                : 'h-full w-full object-contain'
                            }
                          />
                        ) : (
                          <div className="flex items-center gap-2 text-xs font-medium text-[var(--navy-600)]">
                            {renderingPreviews && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            <span>
                              {renderingPreviews ? 'Rendering preview…' : `Page ${pageIdx + 1}`}
                            </span>
                          </div>
                        )}
                      </div>
                      <span className="folio-mono text-[11px] font-semibold text-[var(--navy-600)]">
                        Page {pageIdx + 1}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer CTA Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-canvas)]/70 px-5 py-3">
          <div className="text-xs font-medium text-[var(--navy-600)]">
            {busy && progress
              ? `Preparing sheet ${progress.current} of ${progress.total}…`
              : `${paperSize} · ${orientation === 'landscape' ? 'Landscape' : 'Portrait'} · ${colorMode === 'bw' ? 'Black & White' : 'Color'}`}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="folio-btn-secondary rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-40"
            >
              Cancel
            </button>

            {hasElectronPrint && !isSavePdf && (
              <button
                type="button"
                data-testid="print-system-dialog-btn"
                disabled={!canSubmit}
                onClick={() => void handleElectronPrint(false)}
                className="folio-btn-secondary rounded-xl px-3.5 py-2 text-xs font-semibold disabled:opacity-40"
              >
                System Dialog…
              </button>
            )}

            <button
              type="button"
              data-testid="print-confirm-btn"
              disabled={!canSubmit}
              onClick={handlePrimarySubmit}
              className="folio-btn-crimson inline-flex items-center gap-1.5 rounded-xl px-5 py-2 text-xs font-bold disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isSavePdf ? (
                <Download className="h-3.5 w-3.5" />
              ) : (
                <Printer className="h-3.5 w-3.5" />
              )}
              <span>{isSavePdf ? 'Save PDF' : 'Print'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
