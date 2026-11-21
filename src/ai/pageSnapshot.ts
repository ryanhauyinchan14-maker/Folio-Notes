import { getCombinedBounds } from '../canvas/geometry';
import type { BoundingBox, Page } from '../types/notes';
import { renderPageToCanvas } from '../utils/exportNotebook';

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
  const scale = options?.scale ?? 1.5;
  const canvas = await renderPageToCanvas(page, {
    scale,
    includeBackground: true,
    includeAnnotations: true,
    transparentBackground: false,
    resolvePdfBytes: options?.resolvePdfBytes,
  });
  const dataUrl = canvas.toDataURL('image/png');
  return {
    label: `Page ${pageNumber}`,
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
  const cropRect = computePaddedCropRect(bounds, page.paper.width, page.paper.height, padding);

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
