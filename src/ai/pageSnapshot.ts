import { getCombinedBounds, translateStroke } from '../canvas/geometry';
import type { BoundingBox, Page } from '../types/notes';
import {
  MAX_EXPORT_CANVAS_DIMENSION,
  MAX_EXPORT_CANVAS_PIXELS,
  renderPageToCanvas,
} from '../utils/exportNotebook';

export interface SnapshotCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapshotImagePart {
  label: string;
  mimeType: 'image/png';
  base64: string;
  dataUrl: string;
  width: number;
  height: number;
  cropRect?: SnapshotCropRect;
}

export interface SnapshotCaptureOptions {
  scale?: number;
  padding?: number;
  maxPages?: number;
  isWhiteboard?: boolean;
  resolvePdfBytes?: (assetId: string) => Promise<ArrayBuffer | null>;
}

export function stripPngDataUrlPrefix(dataUrl: string): string {
  const idx = dataUrl.indexOf(',');
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

/**
 * Expands stroke bounds by `padding` px on all sides and clamps within page dimensions.
 */
export function computePaddedCropRect(
  bounds: BoundingBox,
  paperWidth: number,
  paperHeight: number,
  padding = 16,
): SnapshotCropRect {
  const safeW = Math.max(1, paperWidth);
  const safeH = Math.max(1, paperHeight);

  let x1 = Math.max(0, Math.floor(bounds.minX - padding));
  let y1 = Math.max(0, Math.floor(bounds.minY - padding));
  let x2 = Math.min(safeW, Math.ceil(bounds.maxX + padding));
  let y2 = Math.min(safeH, Math.ceil(bounds.maxY + padding));

  const minSpanX = Math.min(32, safeW);
  if (x2 - x1 < minSpanX) {
    x2 = Math.min(safeW, x1 + minSpanX);
    x1 = Math.max(0, x2 - minSpanX);
  }

  const minSpanY = Math.min(32, safeH);
  if (y2 - y1 < minSpanY) {
    y2 = Math.min(safeH, y1 + minSpanY);
    y1 = Math.max(0, y2 - minSpanY);
  }

  return {
    x: x1,
    y: y1,
    width: Math.max(1, x2 - x1),
    height: Math.max(1, y2 - y1),
  };
}

/**
 * Selects up to `maxPages` (capped at 5) page indices centered around `activeIndex`.
 */
export function selectMultiPageWindow(
  totalPages: number,
  activeIndex: number,
  maxPages = 5,
): number[] {
  if (totalPages <= 0) return [];
  const cap = Math.max(1, Math.min(5, maxPages));
  if (totalPages <= cap) {
    return Array.from({ length: totalPages }, (_, i) => i);
  }
  const safeActive = Math.max(0, Math.min(totalPages - 1, activeIndex));
  const half = Math.floor(cap / 2);
  let start = Math.max(0, safeActive - half);
  if (start + cap > totalPages) {
    start = Math.max(0, totalPages - cap);
  }
  return Array.from({ length: cap }, (_, i) => start + i);
}

export async function capturePageSnapshot(
  page: Page,
  pageNumber: number,
  options?: SnapshotCaptureOptions,
): Promise<SnapshotImagePart> {
  const requestedScale = options?.scale ?? 1.5;
  const maxSpan = Math.max(1, page.paper.width, page.paper.height);
  const scale = Math.min(requestedScale, 2048 / maxSpan);
  const canvas = await renderPageToCanvas(page, {
    scale,
    includeBackground: true,
    includeAnnotations: true,
    transparentBackground: false,
    isWhiteboard: options?.isWhiteboard,
    resolvePdfBytes: options?.resolvePdfBytes,
  });
  const dataUrl = canvas.toDataURL('image/png');
  return {
    label: options?.isWhiteboard ? 'Whiteboard' : `Page ${pageNumber}`,
    mimeType: 'image/png',
    base64: stripPngDataUrlPrefix(dataUrl),
    dataUrl,
    width: canvas.width,
    height: canvas.height,
  };
}

export async function captureViewportSnapshot(
  page: Page,
  pageNumber: number,
  viewportRect: SnapshotCropRect | null | undefined,
  options?: SnapshotCaptureOptions,
): Promise<SnapshotImagePart> {
  if (
    !viewportRect ||
    !Number.isFinite(viewportRect.x) ||
    !Number.isFinite(viewportRect.y) ||
    !Number.isFinite(viewportRect.width) ||
    !Number.isFinite(viewportRect.height) ||
    viewportRect.width <= 0 ||
    viewportRect.height <= 0
  ) {
    return capturePageSnapshot(page, pageNumber, options);
  }

  let rect: SnapshotCropRect;
  if (options?.isWhiteboard) {
    rect = {
      x: Math.floor(viewportRect.x),
      y: Math.floor(viewportRect.y),
      width: Math.max(32, Math.ceil(viewportRect.width)),
      height: Math.max(32, Math.ceil(viewportRect.height)),
    };
  } else {
    const safeW = Math.max(1, page.paper.width);
    const safeH = Math.max(1, page.paper.height);
    const x1 = Math.max(0, Math.floor(viewportRect.x));
    const y1 = Math.max(0, Math.floor(viewportRect.y));
    const x2 = Math.min(safeW, Math.ceil(viewportRect.x + viewportRect.width));
    const y2 = Math.min(safeH, Math.ceil(viewportRect.y + viewportRect.height));
    if (x2 <= x1 || y2 <= y1) {
      return capturePageSnapshot(page, pageNumber, options);
    }
    const width = Math.max(Math.min(32, safeW), x2 - x1);
    const height = Math.max(Math.min(32, safeH), y2 - y1);
    rect = {
      x: Math.min(x1, Math.max(0, safeW - width)),
      y: Math.min(y1, Math.max(0, safeH - height)),
      width,
      height,
    };
  }

  const requestedScale = options?.scale ?? 1.5;
  const maxSpan = Math.max(1, rect.width, rect.height);
  const scale = Math.min(requestedScale, 2048 / maxSpan);
  const canvas = await renderPageToCanvas(page, {
    scale,
    includeBackground: true,
    includeAnnotations: true,
    transparentBackground: false,
    isWhiteboard: options?.isWhiteboard,
    cropRect: rect,
    resolvePdfBytes: options?.resolvePdfBytes,
  });
  const dataUrl = canvas.toDataURL('image/png');
  // Omit cropRect so "Insert as Textbox" centers inside the current screen instead of below it
  return {
    label: options?.isWhiteboard
      ? 'Current Screen (Whiteboard)'
      : `Current Screen (Page ${pageNumber})`,
    mimeType: 'image/png',
    base64: stripPngDataUrlPrefix(dataUrl),
    dataUrl,
    width: canvas.width,
    height: canvas.height,
  };
}

export async function captureLassoCropSnapshot(
  page: Page,
  pageNumber: number,
  strokeIds: string[],
  options?: SnapshotCaptureOptions,
): Promise<SnapshotImagePart> {
  if (typeof document === 'undefined') {
    throw new Error('Lasso snapshot rendering requires a DOM environment.');
  }

  const idSet = new Set(strokeIds);
  const selected = page.strokes.filter((s) => idSet.has(s.id));
  const bounds = getCombinedBounds(selected);
  if (!bounds) {
    return capturePageSnapshot(page, pageNumber, options);
  }

  const scale = options?.scale ?? 1.5;
  const padding = options?.padding ?? 16;

  if (options?.isWhiteboard) {
    const originX = Math.floor(bounds.minX - padding);
    const originY = Math.floor(bounds.minY - padding);
    const cropW = Math.max(32, Math.ceil(bounds.maxX + padding) - originX);
    const cropH = Math.max(32, Math.ceil(bounds.maxY + padding) - originY);
    const cropRect: SnapshotCropRect = {
      x: originX,
      y: originY,
      width: cropW,
      height: cropH,
    };

    const tempPage: Page = {
      ...page,
      paper: {
        ...page.paper,
        sizePreset: 'custom',
        width: cropW,
        height: cropH,
        marginLine: false,
      },
      strokes: selected.map((s) => translateStroke(s, -originX, -originY)),
      textboxes: [],
      images: [],
      pdfBackground: null,
    };

    const cropCanvas = await renderPageToCanvas(tempPage, {
      scale,
      includeBackground: true,
      includeAnnotations: true,
      transparentBackground: false,
    });
    const dataUrl = cropCanvas.toDataURL('image/png');
    return {
      label: 'Lasso Selection (Whiteboard)',
      mimeType: 'image/png',
      base64: stripPngDataUrlPrefix(dataUrl),
      dataUrl,
      width: cropCanvas.width,
      height: cropCanvas.height,
      cropRect,
    };
  }

  const cropRect = computePaddedCropRect(bounds, page.paper.width, page.paper.height, padding);
  const rawW = page.paper.width * scale;
  const rawH = page.paper.height * scale;
  const isOversizedForCrop =
    rawW > MAX_EXPORT_CANVAS_DIMENSION ||
    rawH > MAX_EXPORT_CANVAS_DIMENSION ||
    rawW * rawH > MAX_EXPORT_CANVAS_PIXELS;

  if (isOversizedForCrop) {
    const directScale = Math.min(scale, 2048 / Math.max(1, cropRect.width, cropRect.height));
    const cropCanvas = await renderPageToCanvas(page, {
      scale: directScale,
      includeBackground: true,
      includeAnnotations: true,
      transparentBackground: false,
      cropRect,
      resolvePdfBytes: options?.resolvePdfBytes,
    });
    const dataUrl = cropCanvas.toDataURL('image/png');
    return {
      label: `Lasso Selection (Page ${pageNumber})`,
      mimeType: 'image/png',
      base64: stripPngDataUrlPrefix(dataUrl),
      dataUrl,
      width: cropCanvas.width,
      height: cropCanvas.height,
      cropRect,
    };
  }

  const fullCanvas = await renderPageToCanvas(page, {
    scale,
    includeBackground: true,
    includeAnnotations: true,
    transparentBackground: false,
    resolvePdfBytes: options?.resolvePdfBytes,
  });

  const sx = Math.max(0, Math.round(cropRect.x * scale));
  const sy = Math.max(0, Math.round(cropRect.y * scale));
  const sw = Math.max(1, Math.min(fullCanvas.width - sx, Math.round(cropRect.width * scale)));
  const sh = Math.max(1, Math.min(fullCanvas.height - sy, Math.round(cropRect.height * scale)));

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = sw;
  cropCanvas.height = sh;

  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) {
    throw new Error('Failed to acquire 2D canvas context for lasso crop.');
  }

  cropCtx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const dataUrl = cropCanvas.toDataURL('image/png');

  return {
    label: `Lasso Selection (Page ${pageNumber})`,
    mimeType: 'image/png',
    base64: stripPngDataUrlPrefix(dataUrl),
    dataUrl,
    width: sw,
    height: sh,
    cropRect,
  };
}

export async function captureMultiPageSnapshots(
  pages: Page[],
  activeIndex: number,
  options?: SnapshotCaptureOptions,
): Promise<SnapshotImagePart[]> {
  const indices = selectMultiPageWindow(pages.length, activeIndex, options?.maxPages ?? 5);
  const scale = options?.scale ?? 1.25;
  const results: SnapshotImagePart[] = [];
  for (const idx of indices) {
    const target = pages[idx];
    if (!target) continue;
    results.push(
      await capturePageSnapshot(target, idx + 1, {
        ...options,
        scale,
      }),
    );
  }
  return results;
}
