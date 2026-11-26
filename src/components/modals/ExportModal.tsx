import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Code2,
  Crop,
  Download,
  FileArchive,
  FileImage,
  FileText,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Monitor,
  Scissors,
  X,
} from 'lucide-react';
import { getPageContentBounds, WHITEBOARD_EXPORT_MARGIN } from '../../canvas/whiteboard';
import { repository } from '../../db/repository';
import type { Notebook, Page } from '../../types/notes';
import {
  buildFolioNotebookExportAsync,
  computeContentCropRect,
  computeWhiteboardOverviewRect,
  estimateExportSizeLabel,
  type ExportCropRect,
  exportNotebookToPdf,
  exportPagesToImages,
  exportPageToSvg,
  type ExportFormat,
  IMAGE_EXPORT_MAX_PRESETS,
  type ImageExportAreaMode,
  type ImageExportMaxDimension,
  MAX_EXPORT_CANVAS_DIMENSION,
  type PageRangeMode,
  parsePageRange,
  renderExportDetailSampleDataUrl,
  renderExportPreviewDataUrl,
  renderPdfPageToDataUrl,
  resolveImageExportMetrics,
  sanitizeExportFilename,
  triggerBlobDownload,
} from '../../utils/exportNotebook';
import { clearPdfDocumentCache } from '../../utils/pdfEngine';
import { DraggableRangeSlider } from '../common/DraggableRangeSlider';
import { MorphingPill, useMorphingIndicator } from '../common/MorphingIndicator';

interface ExportModalProps {
  open: boolean;
  notebook: Notebook | null;
  pages: Page[];
  currentPageIndex?: number;
  visibleRegion?: ExportCropRect | null;
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

function clampCropToBounds(
  rect: ExportCropRect,
  bounds: ExportCropRect,
  minSize = 64,
): ExportCropRect {
  const minW = Math.min(bounds.width, minSize);
  const minH = Math.min(bounds.height, minSize);
  const w = Math.max(minW, Math.min(bounds.width, Math.round(rect.width)));
  const h = Math.max(minH, Math.min(bounds.height, Math.round(rect.height)));
  const x = Math.max(bounds.x, Math.min(bounds.x + bounds.width - w, Math.round(rect.x)));
  const y = Math.max(bounds.y, Math.min(bounds.y + bounds.height - h, Math.round(rect.y)));
  return { x, y, width: w, height: h };
}

function buildDefaultCustomRect(
  overview: ExportCropRect,
  preferred?: ExportCropRect | null,
): ExportCropRect {
  if (preferred && preferred.width > 0 && preferred.height > 0) {
    return clampCropToBounds(preferred, overview);
  }
  const defW = Math.min(
    overview.width,
    Math.max(240, Math.min(2400, Math.round(overview.width * 0.45))),
  );
  const defH = Math.min(
    overview.height,
    Math.max(180, Math.min(2400, Math.round(overview.height * 0.45))),
  );
  return {
    x: Math.round(overview.x + (overview.width - defW) / 2),
    y: Math.round(overview.y + (overview.height - defH) / 2),
    width: defW,
    height: defH,
  };
}

type AreaDragMode = 'draw' | 'move' | 'nw' | 'ne' | 'sw' | 'se';

export const ExportModal: React.FC<ExportModalProps> = ({
  open,
  notebook,
  pages,
  currentPageIndex = 0,
  visibleRegion = null,
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
  const [areaMode, setAreaMode] = useState<ImageExportAreaMode>('full');
  const [maxImageDim, setMaxImageDim] = useState<ImageExportMaxDimension>(8192);
  const [customRect, setCustomRect] = useState<ExportCropRect | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [overviewMapUrl, setOverviewMapUrl] = useState('');
  const [detailSampleUrl, setDetailSampleUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickerBoxRef = useRef<HTMLDivElement | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const formatTrackRef = useRef<HTMLDivElement | null>(null);
  const formatIndicator = useMorphingIndicator(formatTrackRef, open ? format : null, [open]);

  const isWhiteboard = notebook?.mode === 'whiteboard';
  const isRasterFormat = format === 'png' || format === 'jpg';
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
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!open || !notebook) return;
    dragCleanupRef.current?.();
    setFormat('pdf');
    setFilename(sanitizeExportFilename(notebook.title));
    setRangeMode(pages.length > 1 ? 'all' : 'current');
    setCustomRange(`1${pages.length > 1 ? `-${pages.length}` : ''}`);
    setIncludeBackground(true);
    setIncludeAnnotations(true);
    setPdfScale(1.5);
    setPngTransparent(false);
    setJpgQuality(92);
    setAreaMode('full');
    setMaxImageDim(8192);
    setCustomRect(null);
    setBusy(false);
    setProgress(null);
    setNotice(null);
    setError(null);
  }, [open, notebook?.id, pages.length]);

  const currentPageObj = pages[safeCurrentIdx] ?? pages[0] ?? null;

  const clampedVisibleRegion = useMemo<ExportCropRect | null>(() => {
    if (!currentPageObj || !visibleRegion || visibleRegion.width <= 0 || visibleRegion.height <= 0) {
      return null;
    }
    if (isWhiteboard) {
      return {
        x: Math.round(visibleRegion.x),
        y: Math.round(visibleRegion.y),
        width: Math.max(32, Math.round(visibleRegion.width)),
        height: Math.max(32, Math.round(visibleRegion.height)),
      };
    }
    const ix1 = Math.max(0, visibleRegion.x);
    const iy1 = Math.max(0, visibleRegion.y);
    const ix2 = Math.min(currentPageObj.paper.width, visibleRegion.x + visibleRegion.width);
    const iy2 = Math.min(currentPageObj.paper.height, visibleRegion.y + visibleRegion.height);
    if (ix2 - ix1 < 16 || iy2 - iy1 < 16) return null;
    return {
      x: Math.floor(ix1),
      y: Math.floor(iy1),
      width: Math.max(32, Math.ceil(ix2 - ix1)),
      height: Math.max(32, Math.ceil(iy2 - iy1)),
    };
  }, [currentPageObj, isWhiteboard, visibleRegion]);

  const areaLocksToCurrentPage =
    isRasterFormat &&
    ((areaMode === 'screen' && Boolean(clampedVisibleRegion)) || areaMode === 'custom');

  const parsedRange = useMemo(() => {
    if (isWhiteboard) {
      return parsePageRange('current', '', 0, pages.length);
    }
    if (format === 'svg' || areaLocksToCurrentPage) {
      return parsePageRange('current', '', safeCurrentIdx, pages.length);
    }
    if (format === 'folio') {
      return parsePageRange('all', '', safeCurrentIdx, pages.length);
    }
    return parsePageRange(rangeMode, customRange, safeCurrentIdx, pages.length);
  }, [
    areaLocksToCurrentPage,
    isWhiteboard,
    format,
    rangeMode,
    customRange,
    safeCurrentIdx,
    pages.length,
  ]);

  const previewPageIndex = parsedRange.valid
    ? parsedRange.indices[0] ?? safeCurrentIdx
    : safeCurrentIdx;
  const previewPage = pages[previewPageIndex] ?? pages[0] ?? null;

  const contentCropRect = useMemo<ExportCropRect | null>(() => {
    if (!previewPage || isWhiteboard) return null;
    return computeContentCropRect(previewPage, 48);
  }, [isWhiteboard, previewPage]);

  const overviewRect = useMemo<ExportCropRect | null>(() => {
    if (!previewPage) return null;
    if (isWhiteboard) {
      return computeWhiteboardOverviewRect(previewPage, clampedVisibleRegion);
    }
    return {
      x: 0,
      y: 0,
      width: Math.max(1, previewPage.paper.width),
      height: Math.max(1, previewPage.paper.height),
    };
  }, [clampedVisibleRegion, isWhiteboard, previewPage]);

  const defaultCustomRect = useMemo<ExportCropRect | null>(() => {
    if (!overviewRect) return null;
    return buildDefaultCustomRect(overviewRect, clampedVisibleRegion ?? contentCropRect);
  }, [clampedVisibleRegion, contentCropRect, overviewRect]);

  const effectiveCustomRect = useMemo<ExportCropRect | null>(() => {
    if (!overviewRect) return null;
    const candidate = customRect ?? defaultCustomRect;
    return candidate ? clampCropToBounds(candidate, overviewRect) : null;
  }, [customRect, defaultCustomRect, overviewRect]);

  const effectiveAreaMode: ImageExportAreaMode = useMemo(() => {
    if (!isRasterFormat) return 'full';
    if (areaMode === 'screen' && !clampedVisibleRegion) return 'full';
    if (areaMode === 'content' && (isWhiteboard || !contentCropRect)) return 'full';
    return areaMode;
  }, [areaMode, clampedVisibleRegion, contentCropRect, isRasterFormat, isWhiteboard]);

  const activeCropRect = useMemo<ExportCropRect | null>(() => {
    if (!isRasterFormat) return null;
    if (effectiveAreaMode === 'screen') return clampedVisibleRegion;
    if (effectiveAreaMode === 'custom') return effectiveCustomRect;
    if (effectiveAreaMode === 'content') return contentCropRect;
    return null;
  }, [
    clampedVisibleRegion,
    contentCropRect,
    effectiveAreaMode,
    effectiveCustomRect,
    isRasterFormat,
  ]);

  const imageMetrics = useMemo(() => {
    if (!isRasterFormat || !previewPage) return null;
    let sourceWidth = previewPage.paper.width;
    let sourceHeight = previewPage.paper.height;
    if (activeCropRect) {
      sourceWidth = activeCropRect.width;
      sourceHeight = activeCropRect.height;
    } else if (isWhiteboard) {
      const bounds = getPageContentBounds(previewPage);
      if (bounds) {
        sourceWidth = Math.max(120, Math.ceil(bounds.maxX - bounds.minX + WHITEBOARD_EXPORT_MARGIN * 2));
        sourceHeight = Math.max(120, Math.ceil(bounds.maxY - bounds.minY + WHITEBOARD_EXPORT_MARGIN * 2));
      } else {
        sourceWidth = 1200;
        sourceHeight = 800;
      }
    }
    return resolveImageExportMetrics({
      sourceWidth,
      sourceHeight,
      scale: 2,
      maxDimension:
        effectiveAreaMode === 'full' ? maxImageDim : MAX_EXPORT_CANVAS_DIMENSION,
    });
  }, [activeCropRect, effectiveAreaMode, isRasterFormat, isWhiteboard, maxImageDim, previewPage]);

  const effectiveIncludeBackground =
    format === 'folio'
      ? true
      : format === 'png' && pngTransparent
        ? false
        : includeBackground;
  const effectiveIncludeAnnotations = format === 'folio' ? true : includeAnnotations;
  const effectiveTransparent = format === 'png' && pngTransparent;

  // Render reactive main output preview whenever area, page, or layer toggles change
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
      isWhiteboard,
      cropRect: activeCropRect,
      resolvePdfBytes,
      maxWidth: 268,
      maxHeight: effectiveAreaMode === 'custom' ? 180 : 230,
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
    effectiveAreaMode,
    activeCropRect,
    isWhiteboard,
    resolvePdfBytes,
  ]);

  // Render overview map when interactive Select Area picker is active
  useEffect(() => {
    if (!open || !previewPage || !overviewRect || !isRasterFormat || effectiveAreaMode !== 'custom') {
      setOverviewMapUrl('');
      return;
    }

    let cancelled = false;
    void renderExportPreviewDataUrl(previewPage, {
      includeBackground: effectiveIncludeBackground,
      includeAnnotations: effectiveIncludeAnnotations,
      transparentBackground: effectiveTransparent,
      isWhiteboard,
      cropRect: overviewRect,
      resolvePdfBytes,
      maxWidth: 268,
      maxHeight: 156,
    })
      .then((url) => {
        if (!cancelled) setOverviewMapUrl(url);
      })
      .catch(() => {
        if (!cancelled) setOverviewMapUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    previewPage,
    overviewRect,
    isRasterFormat,
    effectiveAreaMode,
    effectiveIncludeBackground,
    effectiveIncludeAnnotations,
    effectiveTransparent,
    isWhiteboard,
    resolvePdfBytes,
  ]);

  // Render 1:1 sharpness detail comparison strip for PNG / JPG outputs
  useEffect(() => {
    if (!open || !previewPage || !isRasterFormat || !imageMetrics) {
      setDetailSampleUrl('');
      return;
    }

    let cancelled = false;
    void renderExportDetailSampleDataUrl(previewPage, {
      includeBackground: effectiveIncludeBackground,
      includeAnnotations: effectiveIncludeAnnotations,
      transparentBackground: effectiveTransparent,
      isWhiteboard,
      cropRect: activeCropRect,
      effectiveScale: imageMetrics.effectiveScale,
      resolvePdfBytes,
      sampleWidth: 260,
      sampleHeight: 68,
    })
      .then((url) => {
        if (!cancelled) setDetailSampleUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDetailSampleUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    previewPage,
    isRasterFormat,
    activeCropRect,
    imageMetrics?.effectiveScale,
    effectiveIncludeBackground,
    effectiveIncludeAnnotations,
    effectiveTransparent,
    isWhiteboard,
    resolvePdfBytes,
  ]);

  if (!open || !notebook) return null;

  const pickerDisplayBox = (() => {
    if (!overviewRect) return { width: 260, height: 140 };
    const fitScale = Math.min(264 / overviewRect.width, 148 / overviewRect.height);
    return {
      width: Math.max(44, Math.round(overviewRect.width * fitScale)),
      height: Math.max(44, Math.round(overviewRect.height * fitScale)),
    };
  })();

  const startAreaDrag = (dragMode: AreaDragMode, e: React.PointerEvent) => {
    if (!overviewRect || !effectiveCustomRect || !pickerBoxRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    dragCleanupRef.current?.();

    const boxRect = pickerBoxRef.current.getBoundingClientRect();
    if (boxRect.width <= 0 || boxRect.height <= 0) return;

    const clientToWorld = (clientX: number, clientY: number) => {
      const nx = Math.max(0, Math.min(1, (clientX - boxRect.left) / boxRect.width));
      const ny = Math.max(0, Math.min(1, (clientY - boxRect.top) / boxRect.height));
      return {
        x: overviewRect.x + nx * overviewRect.width,
        y: overviewRect.y + ny * overviewRect.height,
      };
    };

    const startWorld = clientToWorld(e.clientX, e.clientY);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const initialRect = { ...effectiveCustomRect };
    const minSpanX = Math.min(overviewRect.width, 64);
    const minSpanY = Math.min(overviewRect.height, 64);
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY) > 3) {
        moved = true;
      }
      const cur = clientToWorld(ev.clientX, ev.clientY);

      if (dragMode === 'move') {
        const dx = cur.x - startWorld.x;
        const dy = cur.y - startWorld.y;
        setCustomRect(
          clampCropToBounds(
            {
              x: initialRect.x + dx,
              y: initialRect.y + dy,
              width: initialRect.width,
              height: initialRect.height,
            },
            overviewRect,
          ),
        );
        return;
      }

      if (dragMode === 'draw') {
        const x1 = Math.min(startWorld.x, cur.x);
        const y1 = Math.min(startWorld.y, cur.y);
        const x2 = Math.max(startWorld.x, cur.x);
        const y2 = Math.max(startWorld.y, cur.y);
        if (!moved) return;
        setCustomRect(
          clampCropToBounds(
            {
              x: x1,
              y: y1,
              width: Math.max(minSpanX, x2 - x1),
              height: Math.max(minSpanY, y2 - y1),
            },
            overviewRect,
          ),
        );
        return;
      }

      const anchorX =
        dragMode === 'nw' || dragMode === 'sw'
          ? initialRect.x + initialRect.width
          : initialRect.x;
      const anchorY =
        dragMode === 'nw' || dragMode === 'ne'
          ? initialRect.y + initialRect.height
          : initialRect.y;
      const edgeX =
        dragMode === 'nw' || dragMode === 'sw'
          ? Math.min(anchorX - minSpanX, Math.max(overviewRect.x, cur.x))
          : Math.max(
              anchorX + minSpanX,
              Math.min(overviewRect.x + overviewRect.width, cur.x),
            );
      const edgeY =
        dragMode === 'nw' || dragMode === 'ne'
          ? Math.min(anchorY - minSpanY, Math.max(overviewRect.y, cur.y))
          : Math.max(
              anchorY + minSpanY,
              Math.min(overviewRect.y + overviewRect.height, cur.y),
            );

      const x1 = Math.min(anchorX, edgeX);
      const y1 = Math.min(anchorY, edgeY);
      setCustomRect(
        clampCropToBounds(
          {
            x: x1,
            y: y1,
            width: Math.max(minSpanX, Math.abs(edgeX - anchorX)),
            height: Math.max(minSpanY, Math.abs(edgeY - anchorY)),
          },
          overviewRect,
        ),
      );
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      dragCleanupRef.current = null;
    };

    const onUp = () => {
      if (dragMode === 'draw' && !moved) {
        // Quick click centers the current crop window onto the clicked point
        setCustomRect(
          clampCropToBounds(
            {
              x: startWorld.x - initialRect.width / 2,
              y: startWorld.y - initialRect.height / 2,
              width: initialRect.width,
              height: initialRect.height,
            },
            overviewRect,
          ),
        );
      }
      cleanup();
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
  };

  const baseName = sanitizeExportFilename(filename, notebook.title);
  const pageCount = parsedRange.valid ? parsedRange.indices.length : 0;

  const resolvedFilename = (() => {
    if (format === 'pdf') return `${baseName}.pdf`;
    if (format === 'svg') return `${baseName} - Page ${previewPageIndex + 1}.svg`;
    if (format === 'folio') return `${baseName}.folio.json`;
    const ext = format === 'png' ? 'png' : 'jpg';
    if (pageCount <= 1) {
      const idx = parsedRange.indices[0] ?? safeCurrentIdx;
      const areaSuffix =
        effectiveAreaMode === 'screen'
          ? ' (Screen)'
          : effectiveAreaMode === 'custom'
            ? ' (Area)'
            : effectiveAreaMode === 'content'
              ? ' (Cropped)'
              : '';
      return `${baseName} - Page ${idx + 1}${areaSuffix}.${ext}`;
    }
    return `${baseName} - Pages.zip`;
  })();

  const selectedPagesSubset = parsedRange.indices.map((idx) => pages[idx]).filter(Boolean);
  const sizeEstimate = estimateExportSizeLabel({
    format,
    pageCount: Math.max(1, pageCount),
    scale: format === 'pdf' ? pdfScale : 2,
    pages: selectedPagesSubset.length > 0 ? selectedPagesSubset : pages,
    outputWidth: isRasterFormat ? imageMetrics?.outputWidth : undefined,
    outputHeight: isRasterFormat ? imageMetrics?.outputHeight : undefined,
    jpgQuality: format === 'jpg' ? jpgQuality : undefined,
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
          isWhiteboard,
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
          isWhiteboard,
          areaMode: effectiveAreaMode,
          cropRect: activeCropRect,
          maxDimension:
            effectiveAreaMode === 'full' ? maxImageDim : MAX_EXPORT_CANVAS_DIMENSION,
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
          isWhiteboard,
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
        className="folio-modal-card flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl text-[#072D59]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--crimson-500)] text-white shadow-xs">
              <Download className="h-4 w-4" />
            </div>
            <div>
              <h2 id="export-modal-title" className="text-base font-bold text-[var(--navy-900)]">
                {isWhiteboard ? 'Export Whiteboard' : 'Export Notebook'}
              </h2>
              <p className="text-xs text-[var(--navy-600)]">
                {isWhiteboard
                  ? `Whiteboard · framed to content · ${notebook.title}`
                  : `Watermark-free local export · ${pages.length} page${pages.length === 1 ? '' : 's'} in ${notebook.title}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Export modal"
            onClick={onClose}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Format Tabs */}
        <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-5 py-2.5">
          <div
            ref={formatTrackRef}
            className="folio-segmented-track inline-flex max-w-full flex-wrap gap-1 rounded-xl p-1"
          >
            <MorphingPill indicator={formatIndicator} className="rounded-lg" />
            {FORMAT_TABS.map((tab) => {
              const active = format === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-morph-key={tab.id}
                  data-testid={`export-tab-${tab.id}`}
                  aria-pressed={active}
                  onClick={() => {
                    setFormat(tab.id);
                    setError(null);
                    setNotice(null);
                  }}
                  className={`folio-press relative z-10 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    active
                      ? formatIndicator.ready
                        ? 'bg-transparent text-white'
                        : 'folio-glass-active'
                      : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-[300px_1fr]">
          {/* Left: Live Area Picker + Output Preview + Sharpness Comparison */}
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-tint)]/55 p-3.5">
            {isRasterFormat && effectiveAreaMode === 'custom' && overviewRect && effectiveCustomRect && (
              <div
                data-testid="export-area-picker"
                className="w-full space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-2.5 shadow-2xs"
              >
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-[var(--navy-600)]">
                  <span>Drag to pick export area</span>
                  <span className="font-mono text-[var(--navy-900)] tabular-nums">
                    {effectiveCustomRect.width}×{effectiveCustomRect.height}
                  </span>
                </div>

                <div className="flex w-full justify-center rounded-lg bg-[var(--surface-canvas)] p-1">
                  <div
                    ref={pickerBoxRef}
                    data-testid="export-area-picker-canvas"
                    onPointerDown={(e) => startAreaDrag('draw', e)}
                    style={{
                      width: `${pickerDisplayBox.width}px`,
                      height: `${pickerDisplayBox.height}px`,
                    }}
                    className="relative cursor-crosshair select-none overflow-hidden rounded border border-[#072D59]/20 bg-white touch-none"
                  >
                    {overviewMapUrl ? (
                      <img
                        src={overviewMapUrl}
                        alt="Full page overview map"
                        draggable={false}
                        className="pointer-events-none block h-full w-full object-fill"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-[#072D59]/40">
                        Loading map…
                      </div>
                    )}

                    {/* Highlighted Crop Rectangle */}
                    {(() => {
                      const leftPct =
                        ((effectiveCustomRect.x - overviewRect.x) / overviewRect.width) * 100;
                      const topPct =
                        ((effectiveCustomRect.y - overviewRect.y) / overviewRect.height) * 100;
                      const widthPct = (effectiveCustomRect.width / overviewRect.width) * 100;
                      const heightPct = (effectiveCustomRect.height / overviewRect.height) * 100;
                      return (
                        <div
                          data-testid="export-area-selection-box"
                          onPointerDown={(e) => startAreaDrag('move', e)}
                          style={{
                            left: `${leftPct}%`,
                            top: `${topPct}%`,
                            width: `${widthPct}%`,
                            height: `${heightPct}%`,
                            boxShadow: '0 0 0 9999px rgba(7, 45, 89, 0.34)',
                          }}
                          className="absolute cursor-move border-2 border-[#FD6E88] bg-[#FD6E88]/8"
                        >
                          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                            <span
                              key={corner}
                              onPointerDown={(e) => startAreaDrag(corner, e)}
                              className={`absolute h-2.5 w-2.5 rounded-full border border-white bg-[#FD6E88] shadow-2xs ${
                                corner === 'nw'
                                  ? '-left-1 -top-1 cursor-nwse-resize'
                                  : corner === 'ne'
                                    ? '-right-1 -top-1 cursor-nesw-resize'
                                    : corner === 'sw'
                                      ? '-bottom-1 -left-1 cursor-nesw-resize'
                                      : '-bottom-1 -right-1 cursor-nwse-resize'
                              }`}
                            />
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 pt-0.5">
                  {clampedVisibleRegion && (
                    <button
                      type="button"
                      data-testid="export-picker-snap-screen"
                      onClick={() =>
                        setCustomRect(clampCropToBounds(clampedVisibleRegion, overviewRect))
                      }
                      className="rounded-md border border-[#072D59]/12 bg-[#DBF2FC]/45 px-2 py-0.5 text-[10px] font-semibold text-[#072D59] hover:bg-[#DBF2FC]"
                    >
                      Snap to Screen
                    </button>
                  )}
                  {contentCropRect && (
                    <button
                      type="button"
                      data-testid="export-picker-snap-notes"
                      onClick={() =>
                        setCustomRect(clampCropToBounds(contentCropRect, overviewRect))
                      }
                      className="rounded-md border border-[#072D59]/12 bg-[#DBF2FC]/45 px-2 py-0.5 text-[10px] font-semibold text-[#072D59] hover:bg-[#DBF2FC]"
                    >
                      Snap to Notes
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="export-picker-reset"
                    onClick={() =>
                      setCustomRect(buildDefaultCustomRect(overviewRect, clampedVisibleRegion ?? contentCropRect))
                    }
                    className="folio-press rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-semibold text-[var(--navy-600)] hover:bg-[var(--surface-canvas)]"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}

            <div
              data-testid="export-preview-stage"
              data-transparent={effectiveTransparent ? 'true' : 'false'}
              style={effectiveTransparent ? CHECKERBOARD_STYLE : undefined}
              className={`flex ${
                isRasterFormat && effectiveAreaMode === 'custom' ? 'h-40' : 'h-52'
              } w-full items-center justify-center overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] shadow-[var(--shadow-ambient)]`}
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  data-testid="export-preview-image"
                  alt={`Preview of Page ${previewPageIndex + 1}`}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-[var(--navy-600)]">Generating preview…</span>
              )}
            </div>

            {isRasterFormat && imageMetrics && (
              <div
                data-testid="export-output-stats"
                className="w-full space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-2.5 shadow-2xs"
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span
                    data-testid="export-output-dimensions"
                    className="font-mono font-bold text-[var(--navy-900)] tabular-nums"
                  >
                    {imageMetrics.outputWidth.toLocaleString()} ×{' '}
                    {imageMetrics.outputHeight.toLocaleString()} px
                  </span>
                  <span
                    data-testid="export-sharpness-badge"
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      imageMetrics.isCondensed ? 'folio-badge-warning' : 'folio-badge-success'
                    }`}
                  >
                    {imageMetrics.isCondensed
                      ? `Condensed (${imageMetrics.scalePercent}%)`
                      : `Full Sharpness (${imageMetrics.effectiveScale.toFixed(1)}×)`}
                  </span>
                </div>

                {detailSampleUrl && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-semibold text-[var(--navy-600)]">
                      <span>Actual detail preview (1:1)</span>
                      <span>
                        {imageMetrics.isCondensed ? 'Zoomed out to fit' : 'Crisp close up'}
                      </span>
                    </div>
                    <img
                      src={detailSampleUrl}
                      data-testid="export-detail-sample"
                      alt="1:1 detail sharpness preview"
                      className="h-14 w-full rounded-lg border border-[var(--border-subtle)] object-cover"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex w-full items-center justify-between text-[11px] font-semibold text-[var(--navy-600)] tabular-nums">
              <span>Preview: Page {previewPageIndex + 1}</span>
              <span
                data-testid="export-meta-badge"
                className="rounded-full bg-[var(--surface-elevated)] px-2 py-0.5 font-bold text-[var(--navy-900)] ring-1 ring-[var(--border-subtle)]"
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

            {/* Export Area & Condensed Resolution (PNG / JPG) */}
            {isRasterFormat && (
              <div
                data-testid="export-area-section"
                className="space-y-2.5 rounded-xl border border-[#072D59]/10 bg-[#DBF2FC]/25 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#072D59]">Export Area</span>
                  <span className="text-[11px] font-medium text-[#072D59]/60">
                    Choose a crisp small region or the whole sheet
                  </span>
                </div>

                <div className={`grid gap-1.5 ${isWhiteboard ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
                  <button
                    type="button"
                    data-testid="export-area-full"
                    aria-pressed={effectiveAreaMode === 'full'}
                    onClick={() => setAreaMode('full')}
                    className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition duration-150 ${
                      effectiveAreaMode === 'full'
                        ? 'folio-glass-active'
                        : 'border border-[#072D59]/12 bg-white text-[#072D59] hover:bg-[#DBF2FC]/60'
                    }`}
                  >
                    <Maximize2 className="h-3 w-3 shrink-0" />
                    <span>{isWhiteboard ? 'All Notes' : 'Entire Page'}</span>
                  </button>

                  <button
                    type="button"
                    data-testid="export-area-screen"
                    disabled={!clampedVisibleRegion}
                    aria-pressed={effectiveAreaMode === 'screen'}
                    onClick={() => setAreaMode('screen')}
                    title={
                      clampedVisibleRegion
                        ? 'Export only what is currently visible on screen at crisp resolution'
                        : 'Open Export from inside the editor to capture your current screen view'
                    }
                    className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
                      effectiveAreaMode === 'screen'
                        ? 'folio-glass-active'
                        : 'border border-[#072D59]/12 bg-white text-[#072D59] hover:bg-[#DBF2FC]/60'
                    }`}
                  >
                    <Monitor className="h-3 w-3 shrink-0" />
                    <span>Current Screen</span>
                  </button>

                  <button
                    type="button"
                    data-testid="export-area-custom"
                    aria-pressed={effectiveAreaMode === 'custom'}
                    onClick={() => setAreaMode('custom')}
                    className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition duration-150 ${
                      effectiveAreaMode === 'custom'
                        ? 'bg-[#FD6E88] text-white'
                        : 'border border-[#072D59]/12 bg-white text-[#072D59] hover:bg-[#DBF2FC]/60'
                    }`}
                  >
                    <Crop className="h-3 w-3 shrink-0" />
                    <span>Select Area</span>
                  </button>

                  {!isWhiteboard && (
                    <button
                      type="button"
                      data-testid="export-area-content"
                      disabled={!contentCropRect}
                      aria-pressed={effectiveAreaMode === 'content'}
                      onClick={() => setAreaMode('content')}
                      title={
                        contentCropRect
                          ? 'Trim empty paper margins around your notes automatically'
                          : 'Draw or type notes on this page first to crop to content'
                      }
                      className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
                        effectiveAreaMode === 'content'
                          ? 'folio-glass-active'
                          : 'border border-[#072D59]/12 bg-white text-[#072D59] hover:bg-[#DBF2FC]/60'
                      }`}
                    >
                      <Scissors className="h-3 w-3 shrink-0" />
                      <span>Used Area</span>
                    </button>
                  )}
                </div>

                {effectiveAreaMode === 'full' && (
                  <div
                    data-testid="export-max-size-selector"
                    className="space-y-1.5 border-t border-[#072D59]/10 pt-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-[#072D59]">Max Image Size</span>
                      <div className="flex rounded-lg border border-[#072D59]/12 bg-white p-0.5">
                        {IMAGE_EXPORT_MAX_PRESETS.map((preset) => {
                          const active = maxImageDim === preset;
                          const label =
                            preset === 8192
                              ? '8,192 px (Max)'
                              : `${preset.toLocaleString()} px`;
                          return (
                            <button
                              key={preset}
                              type="button"
                              data-testid={`export-max-${preset}`}
                              aria-pressed={active}
                              onClick={() => setMaxImageDim(preset)}
                              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition duration-150 ${
                                active
                                  ? 'folio-glass-active'
                                  : 'text-[#072D59]/75 hover:text-[#072D59]'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <p className="text-[10.5px] leading-snug text-[#072D59]/65">
                      {imageMetrics?.isCondensed
                        ? `Entire sheet condenses cleanly to fit inside ${maxImageDim.toLocaleString()} px. Switch to Current Screen or Select Area for crisp close up detail.`
                        : 'Fits cleanly without condensing at crisp 2× resolution.'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Page Range (PDF, PNG, JPG — standard notebooks only) */}
            {!isWhiteboard && (format === 'pdf' || isRasterFormat) && (
              <div className="space-y-2 rounded-xl border border-[#072D59]/10 bg-[#DBF2FC]/25 p-3">
                <div className="text-xs font-bold text-[#072D59]">Page Range</div>
                {areaLocksToCurrentPage ? (
                  <p className="text-xs font-medium text-[#072D59]/75">
                    Area export applies to Page {safeCurrentIdx + 1}.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        data-testid="export-range-current"
                        aria-pressed={rangeMode === 'current'}
                        onClick={() => setRangeMode('current')}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition duration-150 ${
                          rangeMode === 'current'
                            ? 'folio-glass-active'
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
                            ? 'folio-glass-active'
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
                            ? 'folio-glass-active'
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
                      <p
                        data-testid="export-range-error"
                        className="text-xs font-semibold text-[var(--state-danger-text)]"
                      >
                        {parsedRange.error}
                      </p>
                    )}

                    {isRasterFormat && pageCount > 1 && (
                      <p className="text-[11px] font-medium text-[#072D59]/75">
                        Multi page image exports bundle automatically into a <code>.zip</code> archive.
                      </p>
                    )}
                  </>
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
                settings for reimporting later.
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
                      <DraggableRangeSlider
                        testId="export-jpg-quality-slider"
                        ariaLabel="JPG quality"
                        min={70}
                        max={100}
                        step={2}
                        value={jpgQuality}
                        onChange={setJpgQuality}
                        className="w-28"
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
                            ? 'folio-glass-active'
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
                            ? 'folio-glass-active'
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
              <p
                data-testid="export-error-message"
                className="text-xs font-semibold text-[var(--state-danger-text)]"
              >
                {error}
              </p>
            )}
            {notice && (
              <p
                data-testid="export-success-notice"
                className="flex items-center gap-1.5 text-xs font-semibold text-[var(--state-success-text)]"
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
