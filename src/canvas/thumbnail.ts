import type { Page, PageImage, PaperConfig, Stroke, Textbox } from '../types/notes';
import { getPdfDocumentForAsset, renderPdfPageToCanvas } from '../utils/pdfEngine';
import { drawCommittedImage } from './imageRenderer';
import { renderPaperBackground } from './paperRenderer';
import { drawCommittedStroke } from './strokeRenderer';
import { drawCommittedTextbox } from './textLayout';
import { normalizeWhiteboardPageForExport, WHITEBOARD_EXPORT_MARGIN } from './whiteboard';

/**
 * Generates a crisp PNG data URL thumbnail capturing the paper background
 * (or optional pre-rendered PDF canvas), committed images, strokes, and textboxes.
 */
export function generatePageThumbnail(
  paper: PaperConfig,
  strokes: Stroke[],
  targetWidth = 240,
  textboxes: Textbox[] = [],
  images: PageImage[] = [],
  backgroundSource?: CanvasImageSource | null,
  isWhiteboard = false,
): string {
  if (typeof document === 'undefined') return '';

  let effPaper = paper;
  let effStrokes = strokes;
  let effTextboxes = textboxes;
  let effImages = images;
  if (isWhiteboard && !backgroundSource) {
    const normalized = normalizeWhiteboardPageForExport(
      {
        id: 'thumb',
        notebookId: '',
        paper,
        strokes,
        textboxes,
        images,
        createdAt: 0,
        updatedAt: 0,
      },
      WHITEBOARD_EXPORT_MARGIN,
    );
    effPaper = normalized.paper;
    effStrokes = normalized.strokes;
    effTextboxes = normalized.textboxes ?? [];
    effImages = normalized.images ?? [];
  }

  const aspect = effPaper.height / Math.max(1, effPaper.width);
  const maxDim = Math.max(360, Math.round(targetWidth * 1.6));
  let width = Math.max(80, Math.round(targetWidth));
  let height = Math.max(80, Math.round(width * aspect));
  if (height > maxDim) {
    height = maxDim;
    width = Math.max(48, Math.round(height / Math.max(0.01, aspect)));
  }
  if (width > maxDim) {
    width = maxDim;
    height = Math.max(48, Math.round(width * aspect));
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const scale = width / Math.max(1, effPaper.width);
  ctx.save();
  ctx.scale(scale, scale);

  if (backgroundSource) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, effPaper.width, effPaper.height);
    ctx.drawImage(backgroundSource, 0, 0, effPaper.width, effPaper.height);
  } else {
    renderPaperBackground(ctx, effPaper);
  }

  const sortedImages = [...effImages].sort((a, b) => a.zIndex - b.zIndex);
  for (const img of sortedImages) {
    drawCommittedImage(ctx, img);
  }
  for (const stroke of effStrokes) {
    drawCommittedStroke(ctx, stroke, true);
  }
  for (const tb of effTextboxes) {
    drawCommittedTextbox(ctx, tb);
  }

  ctx.restore();
  return backgroundSource ? canvas.toDataURL('image/jpeg', 0.85) : canvas.toDataURL('image/png');
}

/**
 * Generates a page thumbnail asynchronously, rendering any PDF page background
 * underneath images, strokes, and textboxes.
 */
export async function generatePdfAwarePageThumbnail(
  page: Page,
  targetWidth = 240,
  masterKey?: CryptoKey | null,
  isWhiteboard = false,
): Promise<string> {
  if (typeof document === 'undefined') return '';

  if (!page.pdfBackground) {
    return generatePageThumbnail(
      page.paper,
      page.strokes,
      targetWidth,
      page.textboxes ?? [],
      page.images ?? [],
      undefined,
      isWhiteboard,
    );
  }

  try {
    const doc = await getPdfDocumentForAsset(page.pdfBackground.assetId, masterKey);
    if (doc) {
      const aspect = page.paper.height / Math.max(1, page.paper.width);
      const width = Math.max(80, Math.round(targetWidth));
      const height = Math.max(80, Math.round(width * aspect));
      const bgCanvas = document.createElement('canvas');
      const ok = await renderPdfPageToCanvas({
        doc,
        pageNumber: page.pdfBackground.pageNumber,
        canvas: bgCanvas,
        targetWidthPx: width,
        targetHeightPx: height,
      });
      if (ok) {
        return generatePageThumbnail(
          page.paper,
          page.strokes,
          targetWidth,
          page.textboxes ?? [],
          page.images ?? [],
          bgCanvas,
          isWhiteboard,
        );
      }
    }
  } catch {
    // Fall back to regular paper thumbnail if PDF asset cannot be loaded
  }

  return generatePageThumbnail(
    page.paper,
    page.strokes,
    targetWidth,
    page.textboxes ?? [],
    page.images ?? [],
    undefined,
    isWhiteboard,
  );
}
