import type { Page, PageImage, PaperConfig, Stroke, Textbox } from '../types/notes';
import { getPdfDocumentForAsset, renderPdfPageToCanvas } from '../utils/pdfEngine';
import { drawCommittedImage } from './imageRenderer';
import { renderPaperBackground } from './paperRenderer';
import { drawCommittedStroke } from './strokeRenderer';
import { drawCommittedTextbox } from './textLayout';

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
): string {
  if (typeof document === 'undefined') return '';

  const aspect = paper.height / Math.max(1, paper.width);
  const width = Math.max(80, Math.round(targetWidth));
  const height = Math.max(80, Math.round(width * aspect));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const scale = width / Math.max(1, paper.width);
  ctx.save();
  ctx.scale(scale, scale);

  if (backgroundSource) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, paper.width, paper.height);
    ctx.drawImage(backgroundSource, 0, 0, paper.width, paper.height);
  } else {
    renderPaperBackground(ctx, paper);
  }

  const sortedImages = [...images].sort((a, b) => a.zIndex - b.zIndex);
  for (const img of sortedImages) {
    drawCommittedImage(ctx, img);
  }
  for (const stroke of strokes) {
    drawCommittedStroke(ctx, stroke, true);
  }
  for (const tb of textboxes) {
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
): Promise<string> {
  if (typeof document === 'undefined') return '';

  if (!page.pdfBackground) {
    return generatePageThumbnail(
      page.paper,
      page.strokes,
      targetWidth,
      page.textboxes ?? [],
      page.images ?? [],
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
  );
}
