import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Code2,
  Download,
  FileArchive,
  FileImage,
  FileText,
  Image as ImageIcon,
  Loader2,
  X,
} from 'lucide-react';
import { repository } from '../../db/repository';
import type { Notebook, Page } from '../../types/notes';
import {
  buildFolioNotebookExportAsync,
  estimateExportSizeLabel,
  exportNotebookToPdf,
  exportPagesToImages,
  exportPageToSvg,
  type ExportFormat,
  type PageRangeMode,
  parsePageRange,
  renderExportPreviewDataUrl,
  renderPdfPageToDataUrl,
  sanitizeExportFilename,
  triggerBlobDownload,
} from '../../utils/exportNotebook';
import { clearPdfDocumentCache } from '../../utils/pdfEngine';

interface ExportModalProps {
  open: boolean;
  notebook: Notebook | null;
  pages: Page[];
  currentPageIndex?: number;
  masterKey?: CryptoKey | null;
  preloadedPdfAssets?: Map<string, ArrayBuffer> | null;
  onClose: () => void;
}

const FORMAT_TABS: Array<{
  id: ExportFormat;
  label: string;
  ext: string;
  icon: React.ReactNode;
}> = [
  { id: 'pdf', label: 'PDF', ext: '.pdf', icon: <FileText className="h-3.5 w-3.5" /> },
  { id: 'png', label: 'PNG', ext: '.png', icon: <ImageIcon className="h-3.5 w-3.5" /> },
  { id: 'jpg', label: 'JPG', ext: '.jpg', icon: <FileImage className="h-3.5 w-3.5" /> },
  { id: 'svg', label: 'SVG', ext: '.svg', icon: <Code2 className="h-3.5 w-3.5" /> },
  {
    id: 'folio',
    label: 'Folio Backup',
    ext: '.folio.json',
    icon: <FileArchive className="h-3.5 w-3.5" />,
  },
];

const CHECKERBOARD_STYLE: React.CSSProperties = {
  backgroundColor: '#ffffff',
  backgroundImage:
    'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
};

export const ExportModal: React.FC<ExportModalProps> = ({
  open,
  notebook,
  pages,
  currentPageIndex = 0,
  masterKey = null,
  preloadedPdfAssets = null,
  onClose,
}) => {
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [filename, setFilename] = useState('');
  const [rangeMode, setRangeMode] = useState<PageRangeMode>('all');
  const [customRange, setCustomRange] = useState('');
  const [includeBackground, setIncludeBackground] = useState(true);
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [pdfScale, setPdfScale] = useState<1.5 | 2.5>(1.5);
  const [pngTransparent, setPngTransparent] = useState(false);
  const [jpgQuality, setJpgQuality] = useState(92);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const safeCurrentIdx = Math.max(0, Math.min(Math.max(0, pages.length - 1), currentPageIndex));
  const hasPdfPages = pages.some((p) => Boolean(p.pdfBackground));

  const resolvePdfBytes = useMemo(
    () => async (assetId: string): Promise<ArrayBuffer | null> => {
      const preloaded = preloadedPdfAssets?.get(assetId);
      if (preloaded) return preloaded;
      return repository.getPdfAssetData(assetId, masterKey);
    },
    [preloadedPdfAssets, masterKey],
  );

  // Evict cached PDFDocumentProxy instances when a Home-Shelf preloaded Vault export modal closes
  useEffect(() => {
    if (!open && preloadedPdfAssets && preloadedPdfAssets.size > 0) {
      clearPdfDocumentCache();
    }
    return () => {
      if (preloadedPdfAssets && preloadedPdfAssets.size > 0) {
        clearPdfDocumentCache();
      }
    };
  }, [open, preloadedPdfAssets]);

  useEffect(() => {
    if (!open || !notebook) return;
    setFormat('pdf');
    setFilename(sanitizeExportFilename(notebook.title));
    setRangeMode(pages.length > 1 ? 'all' : 'current');
    setCustomRange(`1${pages.length > 1 ? `-${pages.length}` : ''}`);
    setIncludeBackground(true);
    setIncludeAnnotations(true);
    setPdfScale(1.5);
    setPngTransparent(false);
    setJpgQuality(92);
    setBusy(false);
    setProgress(null);
    setNotice(null);
    setError(null);
  }, [open, notebook?.id, pages.length]);

  const parsedRange = useMemo(() => {
    if (format === 'svg') {
      return parsePageRange('current', '', safeCurrentIdx, pages.length);
    }
    if (format === 'folio') {
      return parsePageRange('all', '', safeCurrentIdx, pages.length);
    }
    return parsePageRange(rangeMode, customRange, safeCurrentIdx, pages.length);
  }, [format, rangeMode, customRange, safeCurrentIdx, pages.length]);

  const previewPageIndex = parsedRange.valid
    ? parsedRange.indices[0] ?? safeCurrentIdx
    : safeCurrentIdx;
  const previewPage = pages[previewPageIndex] ?? pages[0] ?? null;

  const effectiveIncludeBackground =
    format === 'folio'
      ? true
      : format === 'png' && pngTransparent
        ? false
        : includeBackground;
  const effectiveIncludeAnnotations = format === 'folio' ? true : includeAnnotations;
  const effectiveTransparent = format === 'png' && pngTransparent;

  // Render reactive thumbnail preview whenever options or first selected page change
  useEffect(() => {
    if (!open || !previewPage) {
      setPreviewUrl('');
      return;
    }

    let cancelled = false;
    void renderExportPreviewDataUrl(previewPage, {
      includeBackground: effectiveIncludeBackground,
      includeAnnotations: effectiveIncludeAnnotations,
      transparentBackground: effectiveTransparent,
      resolvePdfBytes,
      maxWidth: 260,
    })
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    previewPage,
    effectiveIncludeBackground,
    effectiveIncludeAnnotations,
    effectiveTransparent,
    resolvePdfBytes,
  ]);

  if (!open || !notebook) return null;

  const baseName = sanitizeExportFilename(filename, notebook.title);
  const pageCount = parsedRange.valid ? parsedRange.indices.length : 0;

  const resolvedFilename = (() => {
    if (format === 'pdf') return `${baseName}.pdf`;
    if (format === 'svg') return `${baseName} - Page ${previewPageIndex + 1}.svg`;
    if (format === 'folio') return `${baseName}.folio.json`;
    const ext = format === 'png' ? 'png' : 'jpg';
    if (pageCount <= 1) {
      const idx = parsedRange.indices[0] ?? safeCurrentIdx;
      return `${baseName} - Page ${idx + 1}.${ext}`;
    }
    return `${baseName} - Pages.zip`;
  })();

  const selectedPagesSubset = parsedRange.indices.map((idx) => pages[idx]).filter(Boolean);
  const sizeEstimate = estimateExportSizeLabel({
    format,
    pageCount: Math.max(1, pageCount),
    scale: format === 'pdf' ? pdfScale : 2,
    pages: selectedPagesSubset.length > 0 ? selectedPagesSubset : pages,
  });

  const handleDownload = async () => {
    if (!parsedRange.valid || parsedRange.indices.length === 0) {
      setError(parsedRange.error ?? 'Select at least one page to export.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    setProgress({ current: 0, total: parsedRange.indices.length });

    try {
      if (format === 'pdf') {
        const pdfBytes = await exportNotebookToPdf({
          title: baseName,
          pages,
          selectedIndices: parsedRange.indices,
          includeBackground,
          includeAnnotations,
          scale: pdfScale,
          resolvePdfBytes,
          onProgress: (current, total) => setProgress({ current, total }),
        });
        const ab = pdfBytes.buffer.slice(
          pdfBytes.byteOffset,
          pdfBytes.byteOffset + pdfBytes.byteLength,
        ) as ArrayBuffer;
        triggerBlobDownload(new Blob([ab], { type: 'application/pdf' }), resolvedFilename);
      } else if (format === 'png' || format === 'jpg') {
        const result = await exportPagesToImages({
          baseName,
          pages,
          selectedIndices: parsedRange.indices,
          format,
          includeBackground,
          includeAnnotations,
          transparentBackground: pngTransparent,
          jpgQuality: jpgQuality / 100,
          scale: 2,
          resolvePdfBytes,
          onProgress: (current, total) => setProgress({ current, total }),
        });
        triggerBlobDownload(result.blob, result.filename);
      } else if (format === 'svg') {
        const targetPage = pages[previewPageIndex];
        if (!targetPage) throw new Error('Page not found.');
        const pdfBackgroundDataUrl =
          includeBackground && targetPage.pdfBackground
            ? await renderPdfPageToDataUrl(targetPage, 2, resolvePdfBytes)
            : undefined;
        const svgContent = exportPageToSvg({
          page: targetPage,
          includeBackground,
          includeAnnotations,
          pdfBackgroundDataUrl,
        });
        triggerBlobDownload(
          new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' }),
          resolvedFilename,
        );
      } else {
        const archive = await buildFolioNotebookExportAsync(notebook, pages, resolvePdfBytes);
        const json = JSON.stringify(archive, null, 2);
        triggerBlobDownload(
          new Blob([json], { type: 'application/json;charset=utf-8' }),
          resolvedFilename,
        );
      }

      setNotice(`Exported ${resolvedFilename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const toggleDisabledForFolio = format === 'folio';
  const bgToggleDisabled =
    toggleDisabledForFolio || (format === 'png' && pngTransparent);

  return (
    <div
      className="folio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
        data-testid="export-modal"
        className="folio-modal-card flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl text-[#072D59]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FD6E88] text-white shadow-xs">
              <Download className="h-4 w-4" />
            </div>
            <div>
              <h2 id="export-modal-title" className="text-base font-bold text-[#072D59]">
                Export Notebook
              </h2>
              <p className="text-xs text-[#072D59]/65">
                Watermark-free local export · {pages.length} page
                {pages.length === 1 ? '' : 's'} in {notebook.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Export modal"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#072D59]/55 transition duration-150 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Format Tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-[#072D59]/10 bg-[#DBF2FC]/25 px-5 py-2.5">
          {FORMAT_TABS.map((tab) => {
            const active = format === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`export-tab-${tab.id}`}
                aria-pressed={active}
                onClick={() => {
                  setFormat(tab.id);
                  setError(null);
                  setNotice(null);
                }}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition duration-150 ${
                  active
                    ? 'bg-[#072D59] text-white shadow-xs'
                    : 'border border-[#072D59]/12 bg-white text-[#072D59]/75 hover:bg-[#DBF2FC]/55 hover:text-[#072D59]'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Main Content Grid */}
        <div className="grid flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-[240px_1fr]">
          {/* Left: Live Thumbnail Preview */}
          <div className="flex flex-col items-center rounded-2xl border border-[#072D59]/10 bg-[#DBF2FC]/30 p-4">
            <div
              data-testid="export-preview-stage"
              data-transparent={effectiveTransparent ? 'true' : 'false'}
              style={effectiveTransparent ? CHECKERBOARD_STYLE : undefined}
              className="flex h-60 w-full items-center justify-center overflow-hidden rounded-xl border border-[#072D59]/12 bg-white shadow-sm"
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  data-testid="export-preview-image"
                  alt={`Preview of Page ${previewPageIndex + 1}`}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-[#072D59]/45">Generating preview…</span>
              )}
            </div>

            <div className="mt-3 flex w-full items-center justify-between text-[11px] font-semibold text-[#072D59]/65">
              <span>Preview: Page {previewPageIndex + 1}</span>
              <span
                data-testid="export-meta-badge"
                className="rounded-full bg-white px-2 py-0.5 font-bold text-[#072D59] ring-1 ring-[#072D59]/12"
              >
                {pageCount > 0 ? `${pageCount} pg${pageCount === 1 ? '' : 's'}` : '0 pgs'} ·{' '}
                {sizeEstimate}
              </span>
            </div>
          </div>

          {/* Right: Options & Range */}
          <div className="space-y-4">
            {/* Filename */}
            <div>
              <label
                htmlFor="export-filename-input"
                className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65"
              >
                File Name
              </label>
              <input
                id="export-filename-input"
                data-testid="export-filename-input"
                type="text"
                value={filename}
                onChange={(e) => {
                  setFilename(e.target.value);
                  setNotice(null);
                }}
                placeholder={notebook.title}
                className="folio-input w-full rounded-xl px-3 py-2 text-sm"
              />
              <div
                data-testid="export-output-filename"
                className="mt-1 truncate text-[11px] text-[#072D59]/60"
              >
                Output: <span className="font-mono font-semibold text-[#072D59]">{resolvedFilename}</span>
              </div>
            </div>

            {/* Page Range (PDF, PNG, JPG) */}
            {(format === 'pdf' || format === 'png' || format === 'jpg') && (
              <div className="space-y-2 rounded-xl border border-[#072D59]/10 bg-[#DBF2FC]/25 p-3">
                <div className="text-xs font-bold text-[#072D59]">Page Range</div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    data-testid="export-range-current"
                    aria-pressed={rangeMode === 'current'}
                    onClick={() => setRangeMode('current')}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition duration-150 ${
                      rangeMode === 'current'
                        ? 'bg-[#072D59] text-white'
                        : 'border border-[#072D59]/12 bg-white text-[#072D59] hover:bg-[#DBF2FC]/60'
                    }`}
                  >
                    Current ({safeCurrentIdx + 1})
                  </button>
                  <button
                    type="button"
                    data-testid="export-range-all"
                    aria-pressed={rangeMode === 'all'}
                    onClick={() => setRangeMode('all')}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition duration-150 ${
                      rangeMode === 'all'
                        ? 'bg-[#072D59] text-white'
                        : 'border border-[#072D59]/12 bg-white text-[#072D59] hover:bg-[#DBF2FC]/60'
                    }`}
                  >
                    All Pages ({pages.length})
                  </button>
                  <button
                    type="button"
                    data-testid="export-range-custom"
                    aria-pressed={rangeMode === 'custom'}
                    onClick={() => setRangeMode('custom')}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition duration-150 ${
                      rangeMode === 'custom'
                        ? 'bg-[#072D59] text-white'
                        : 'border border-[#072D59]/12 bg-white text-[#072D59] hover:bg-[#DBF2FC]/60'
                    }`}
                  >
                    Custom
                  </button>
                </div>

                {rangeMode === 'custom' && (
                  <div className="pt-1">
                    <input
                      type="text"
                      data-testid="export-custom-range-input"
                      aria-label="Custom page range"
                      value={customRange}
                      onChange={(e) => setCustomRange(e.target.value)}
                      placeholder={`e.g. 1-3, 5 (max ${pages.length})`}
                      className="folio-input w-full rounded-lg px-3 py-1.5 text-xs"
                    />
                  </div>
                )}

                {!parsedRange.valid && parsedRange.error && (
                  <p data-testid="export-range-error" className="text-xs font-semibold text-[#F95573]">
                    {parsedRange.error}
                  </p>
                )}

                {(format === 'png' || format === 'jpg') && pageCount > 1 && (
                  <p className="text-[11px] font-medium text-[#072D59]/75">
                    Multi-page image exports bundle automatically into a <code>.zip</code> archive.
                  </p>
                )}
              </div>
            )}

            {format === 'svg' && (
              <div className="rounded-xl border border-[#072D59]/10 bg-[#DBF2FC]/25 p-3 text-xs text-[#072D59]/75">
                Exports Page {previewPageIndex + 1} as a standalone crisp vector SVG with embedded
                images, <code>perfect-freehand</code> curves, and editable text layers.
              </div>
            )}

            {format === 'folio' && (
              <div className="rounded-xl border border-[#072D59]/12 bg-[#DBF2FC]/45 p-3 text-xs text-[#072D59]">
                Exports an editable <code>.folio.json</code> archive containing all {pages.length}{' '}
                decrypted page{pages.length === 1 ? '' : 's'}, strokes, photos, textboxes, and paper
                settings for re-importing later.
              </div>
            )}

            {/* Format-Specific & Goodnotes Options */}
            {format !== 'folio' && (
              <div className="space-y-3 rounded-xl border border-[#072D59]/10 bg-white p-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-[#072D59]">
                      {hasPdfPages ? 'Include Paper / PDF Background' : 'Include Paper Background'}
                    </div>
                    <div className="text-[11px] text-[#072D59]/60">
                      {format === 'png' && pngTransparent
                        ? 'Overridden when PNG Transparent Background is enabled'
                        : 'Disable to print/export onto clean white paper'}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    data-testid="export-toggle-background"
                    aria-label="Include Paper Background"
                    disabled={bgToggleDisabled}
                    checked={effectiveIncludeBackground}
                    onChange={(e) => setIncludeBackground(e.target.checked)}
                    className="h-4 w-4 rounded border-[#072D59]/25 accent-[#FD6E88] disabled:opacity-40"
                  />
                </div>

                <div className="flex items-center justify-between border-t border-[#072D59]/10 pt-2.5">
                  <div>
                    <div className="text-xs font-bold text-[#072D59]">
                      Include Annotations
                    </div>
                    <div className="text-[11px] text-[#072D59]/60">
                      Handwriting strokes, highlighters, textboxes &amp; photos
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    data-testid="export-toggle-annotations"
                    aria-label="Include Annotations"
                    checked={includeAnnotations}
                    onChange={(e) => setIncludeAnnotations(e.target.checked)}
                    className="h-4 w-4 rounded border-[#072D59]/25 accent-[#FD6E88]"
                  />
                </div>

                {format === 'png' && (
                  <div className="flex items-center justify-between border-t border-[#072D59]/10 pt-2.5">
                    <div>
                      <div className="text-xs font-bold text-[#072D59]">
                        Transparent Background
                      </div>
                      <div className="text-[11px] text-[#072D59]/60">
                        Alpha channel PNG without paper fill or lines
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      data-testid="export-toggle-transparent"
                      aria-label="Transparent Background"
                      checked={pngTransparent}
                      onChange={(e) => setPngTransparent(e.target.checked)}
                      className="h-4 w-4 rounded border-[#072D59]/25 accent-[#FD6E88]"
                    />
                  </div>
                )}

                {format === 'jpg' && (
                  <label className="flex items-center justify-between gap-3 border-t border-[#072D59]/10 pt-2.5">
                    <span className="text-xs font-bold text-[#072D59]">JPG Quality</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        data-testid="export-jpg-quality-slider"
                        min={70}
                        max={100}
                        step={2}
                        value={jpgQuality}
                        onChange={(e) => setJpgQuality(Number(e.target.value))}
                        className="h-1.5 w-28 accent-[#FD6E88]"
                      />
                      <span className="w-9 text-right text-xs font-bold text-[#072D59] tabular-nums">
                        {jpgQuality}%
                      </span>
                    </div>
                  </label>
                )}

                {format === 'pdf' && (
                  <div className="flex items-center justify-between border-t border-[#072D59]/10 pt-2.5">
                    <span className="text-xs font-bold text-[#072D59]">PDF Quality</span>
                    <div className="flex rounded-lg border border-[#072D59]/12 bg-[#DBF2FC]/30 p-0.5">
                      <button
                        type="button"
                        data-testid="export-pdf-standard"
                        aria-pressed={pdfScale === 1.5}
                        onClick={() => setPdfScale(1.5)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition duration-150 ${
                          pdfScale === 1.5
                            ? 'bg-[#072D59] text-white shadow-2xs'
                            : 'text-[#072D59]/75 hover:text-[#072D59]'
                        }`}
                      >
                        Standard (1.5x)
                      </button>
                      <button
                        type="button"
                        data-testid="export-pdf-high"
                        aria-pressed={pdfScale === 2.5}
                        onClick={() => setPdfScale(2.5)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition duration-150 ${
                          pdfScale === 2.5
                            ? 'bg-[#072D59] text-white shadow-2xs'
                            : 'text-[#072D59]/75 hover:text-[#072D59]'
                        }`}
                      >
                        High / Print (2.5x)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Progress / Status */}
            {busy && progress && (
              <div
                data-testid="export-progress"
                className="space-y-1.5 rounded-xl border border-[#072D59]/12 bg-[#DBF2FC]/45 p-3"
              >
                <div className="flex items-center justify-between text-xs font-semibold text-[#072D59]">
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FD6E88]" />
                    Rendering page {progress.current} of {progress.total}…
                  </span>
                  <span>
                    {Math.round((progress.current / Math.max(1, progress.total)) * 100)}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full bg-[#FD6E88] transition-all"
                    style={{
                      width: `${Math.round((progress.current / Math.max(1, progress.total)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {error && (
              <p data-testid="export-error-message" className="text-xs font-semibold text-[#F95573]">
                {error}
              </p>
            )}
            {notice && (
              <p
                data-testid="export-success-notice"
                className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700"
              >
                <Check className="h-3.5 w-3.5" />
                {notice}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="folio-modal-footer flex items-center justify-end gap-2 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="folio-btn-secondary rounded-xl px-4 py-2 text-xs font-semibold"
          >
            Close
          </button>
          <button
            type="button"
            data-testid="export-download-btn"
            disabled={busy || !parsedRange.valid}
            onClick={() => void handleDownload()}
            className="folio-btn-crimson inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            <span>{busy ? 'Exporting…' : 'Download'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
