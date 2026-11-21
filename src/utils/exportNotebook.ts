import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { drawCommittedImage } from '../canvas/imageRenderer';
import { renderPaperBackground, resolvePaperLineColors } from '../canvas/paperRenderer';
import {
  drawCommittedStroke,
  getFreehandStrokeOutline,
  outlineToSvgPath,
} from '../canvas/strokeRenderer';
import {
  drawCommittedTextbox,
  measureTextboxLayout,
  TEXTBOX_FONT_STACKS,
} from '../canvas/textLayout';
import { db } from '../db/database';
import type {
  CoverConfig,
  Folder,
  Notebook,
  Page,
  PageImage,
  PaperConfig,
  PaperTemplate,
  PdfPageBackground,
  Stroke,
  Textbox,
} from '../types/notes';
import { getPdfDocumentForAsset, renderPdfPageToCanvas } from './pdfEngine';
import { arrayBufferToBase64 } from './vaultCrypto';

export type ExportFormat = 'pdf' | 'png' | 'jpg' | 'svg' | 'folio';
export type PageRangeMode = 'current' | 'all' | 'custom';

export interface PageRangeParseResult {
  valid: boolean;
  indices: number[];
  error?: string;
}

export interface SerializedPdfAsset {
  id: string;
  name: string;
  pageCount: number;
  base64Data: string;
  createdAt: number;
}

export interface FolioNotebookExport {
  format: 'folio-notebook';
  version: 1;
  exportedAt: number;
  notebook: {
    title: string;
    cover: CoverConfig;
    defaultPaper: PaperConfig;
  };
  pages: Array<{
    paper: PaperConfig;
    strokes: Stroke[];
    textboxes: Textbox[];
    images: PageImage[];
    pdfBackground?: PdfPageBackground | null;
  }>;
  pdfAssets?: SerializedPdfAsset[];
}

export interface FolioWorkspaceBackup {
  format: 'folio-workspace';
  version: 1;
  exportedAt: number;
  folders: Folder[];
  notebooks: Array<{
    notebook: Notebook;
    pages: Page[];
  }>;
  templates: PaperTemplate[];
  pdfAssets?: Array<SerializedPdfAsset & { notebookId: string }>;
  skippedLockedTitles?: string[];
}

export function sanitizeExportFilename(name: string, fallback = 'Folio Notebook'): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

/**
 * Parses Current / All / Custom (e.g. "1-3, 5") page range inputs into 0-based indices.
 */
export function parsePageRange(
  mode: PageRangeMode,
  rawCustom: string,
  currentIndex: number,
  totalPages: number,
): PageRangeParseResult {
  if (totalPages <= 0) {
    return { valid: false, indices: [], error: 'Notebook has no pages.' };
  }

  const safeCurrent = Math.max(0, Math.min(totalPages - 1, currentIndex));

  if (mode === 'current') {
    return { valid: true, indices: [safeCurrent] };
  }

  if (mode === 'all') {
    return {
      valid: true,
      indices: Array.from({ length: totalPages }, (_, i) => i),
    };
  }

  const trimmed = rawCustom.trim();
  if (!trimmed) {
    return {
      valid: false,
      indices: [],
      error: `Enter page numbers between 1 and ${totalPages} (e.g. 1-${totalPages}).`,
    };
  }

  const seen = new Set<number>();
  const ordered: number[] = [];
  const parts = trimmed.split(',');

  for (const partRaw of parts) {
    const part = partRaw.trim();
    if (!part) {
      return {
        valid: false,
        indices: [],
        error: 'Remove empty commas from custom page range.',
      };
    }

    const dashMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (dashMatch) {
      const start = Number(dashMatch[1]);
      const end = Number(dashMatch[2]);
      if (start < 1 || end < 1 || start > totalPages || end > totalPages) {
        return {
          valid: false,
          indices: [],
          error: `Pages must be between 1 and ${totalPages}.`,
        };
      }
      if (start > end) {
        return {
          valid: false,
          indices: [],
          error: `Invalid range "${part}": start page exceeds end page.`,
        };
      }
      for (let p = start; p <= end; p++) {
        const idx = p - 1;
        if (!seen.has(idx)) {
          seen.add(idx);
          ordered.push(idx);
        }
      }
      continue;
    }

    if (/^\d+$/.test(part)) {
      const pageNum = Number(part);
      if (pageNum < 1 || pageNum > totalPages) {
        return {
          valid: false,
          indices: [],
          error: `Page ${pageNum} is out of bounds (1–${totalPages}).`,
        };
      }
      const idx = pageNum - 1;
      if (!seen.has(idx)) {
        seen.add(idx);
        ordered.push(idx);
      }
      continue;
    }

    return {
      valid: false,
      indices: [],
      error: `Invalid token "${part}". Use numbers or ranges like 1-3, 5.`,
    };
  }

  return ordered.length > 0
    ? { valid: true, indices: ordered }
    : { valid: false, indices: [], error: 'Select at least one valid page.' };
}

export async function ensurePageImagesDecoded(images: PageImage[] | undefined): Promise<void> {
  if (!images || images.length === 0 || typeof Image === 'undefined') return;
  await Promise.all(
    images.map(
      (imgData) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = imgData.dataUrl;
          if (img.complete) resolve();
        }),
    ),
  );
}

async function readPlainAssetBytesFromDb(assetId: string): Promise<ArrayBuffer | null> {
  const asset = await db.pdfAssets.get(assetId);
  if (!asset?.data) return null;
  if (asset.data instanceof ArrayBuffer) return asset.data;
  if (typeof Blob !== 'undefined' && asset.data instanceof Blob) {
    return asset.data.arrayBuffer();
  }
  return null;
}

export interface RenderPageExportOptions {
  scale: number;
  includeBackground: boolean;
  includeAnnotations: boolean;
  transparentBackground?: boolean;
  resolvePdfBytes?: (assetId: string) => Promise<ArrayBuffer | null>;
}

export async function renderPageToCanvas(
  page: Page,
  options: RenderPageExportOptions,
): Promise<HTMLCanvasElement> {
  if (typeof document === 'undefined') {
    throw new Error('Canvas rendering requires a browser/DOM environment.');
  }

  if (options.includeAnnotations && page.images && page.images.length > 0) {
    await ensurePageImagesDecoded(page.images);
  }

  const width = Math.max(1, Math.round(page.paper.width * options.scale));
  const height = Math.max(1, Math.round(page.paper.height * options.scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context.');
  }

  ctx.save();
  ctx.scale(options.scale, options.scale);

  if (options.transparentBackground) {
    ctx.clearRect(0, 0, page.paper.width, page.paper.height);
  } else if (options.includeBackground && page.pdfBackground) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, page.paper.width, page.paper.height);
    const doc = await getPdfDocumentForAsset(
      page.pdfBackground.assetId,
      null,
      options.resolvePdfBytes,
    );
    if (doc) {
      const pdfCanvas = document.createElement('canvas');
      const ok = await renderPdfPageToCanvas({
        doc,
        pageNumber: page.pdfBackground.pageNumber,
        canvas: pdfCanvas,
        targetWidthPx: width,
        targetHeightPx: height,
      });
      if (ok) {
        ctx.drawImage(pdfCanvas, 0, 0, page.paper.width, page.paper.height);
      }
    }
  } else if (options.includeBackground) {
    renderPaperBackground(ctx, page.paper);
  } else {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, page.paper.width, page.paper.height);
  }

  if (options.includeAnnotations) {
    const sortedImages = [...(page.images ?? [])].sort((a, b) => a.zIndex - b.zIndex);
    for (const img of sortedImages) {
      drawCommittedImage(ctx, img);
    }
    for (const stroke of page.strokes) {
      drawCommittedStroke(ctx, stroke, true);
    }
    for (const tb of page.textboxes ?? []) {
      drawCommittedTextbox(ctx, tb);
    }
  }

  ctx.restore();
  return canvas;
}

function canvasToBytes(
  canvas: HTMLCanvasElement,
  mimeType: 'image/png' | 'image/jpeg',
  quality = 0.92,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error(`Canvas encoding failed for ${mimeType}`));
          return;
        }
        const buf = await blob.arrayBuffer();
        resolve(new Uint8Array(buf));
      },
      mimeType,
      mimeType === 'image/jpeg' ? quality : undefined,
    );
  });
}

export async function renderExportPreviewDataUrl(
  page: Page,
  options: Omit<RenderPageExportOptions, 'scale'> & { maxWidth?: number },
): Promise<string> {
  const maxW = options.maxWidth ?? 260;
  const scale = Math.min(1, maxW / Math.max(1, page.paper.width));
  const canvas = await renderPageToCanvas(page, { ...options, scale });
  return canvas.toDataURL('image/png');
}

export async function renderPdfPageToDataUrl(
  page: Page,
  scale = 2,
  resolvePdfBytes?: (assetId: string) => Promise<ArrayBuffer | null>,
): Promise<string | undefined> {
  if (!page.pdfBackground || typeof document === 'undefined') return undefined;
  const doc = await getPdfDocumentForAsset(page.pdfBackground.assetId, null, resolvePdfBytes);
  if (!doc) return undefined;
  const canvas = document.createElement('canvas');
  const ok = await renderPdfPageToCanvas({
    doc,
    pageNumber: page.pdfBackground.pageNumber,
    canvas,
    targetWidthPx: Math.max(1, Math.round(page.paper.width * scale)),
    targetHeightPx: Math.max(1, Math.round(page.paper.height * scale)),
  });
  return ok ? canvas.toDataURL('image/png') : undefined;
}

/**
 * Exports selected pages to a clean, watermark-free multi-page PDF via pdf-lib.
 * Preserves vector text/graphics of unrotated PDF-backed pages via copyPages()
 * and composites transparent annotation overlays cleanly on top.
 */
export async function exportNotebookToPdf(params: {
  title: string;
  pages: Page[];
  selectedIndices: number[];
  includeBackground: boolean;
  includeAnnotations: boolean;
  scale: number;
  resolvePdfBytes?: (assetId: string) => Promise<ArrayBuffer | null>;
  onProgress?: (current: number, total: number) => void;
}): Promise<Uint8Array> {
  const {
    title,
    pages,
    selectedIndices,
    includeBackground,
    includeAnnotations,
    scale,
    resolvePdfBytes,
    onProgress,
  } = params;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(title);
  pdfDoc.setCreator('Folio Notes');

  const ptPerPx = 72 / 96;
  const total = selectedIndices.length;
  const sourcePdfCache = new Map<string, PDFDocument | null>();
  const resolveBytes = resolvePdfBytes ?? readPlainAssetBytesFromDb;

  const getCachedSourceDoc = async (assetId: string): Promise<PDFDocument | null> => {
    if (sourcePdfCache.has(assetId)) {
      return sourcePdfCache.get(assetId) ?? null;
    }
    try {
      const rawBytes = await resolveBytes(assetId);
      const loaded = rawBytes
        ? await PDFDocument.load(rawBytes, { ignoreEncryption: true })
        : null;
      sourcePdfCache.set(assetId, loaded);
      return loaded;
    } catch {
      sourcePdfCache.set(assetId, null);
      return null;
    }
  };

  for (let step = 0; step < total; step++) {
    const pageIndex = selectedIndices[step];
    const page = pages[pageIndex];
    if (!page) continue;

    onProgress?.(step + 1, total);

    if (page.pdfBackground && includeBackground) {
      const srcDoc = await getCachedSourceDoc(page.pdfBackground.assetId);
      if (srcDoc && srcDoc.getPageCount() > 0) {
        const srcIdx = Math.max(
          0,
          Math.min(srcDoc.getPageCount() - 1, page.pdfBackground.pageNumber - 1),
        );
        const [copiedPage] = await pdfDoc.copyPages(srcDoc, [srcIdx]);
        const rot = ((copiedPage.getRotation().angle % 360) + 360) % 360;
        if (rot === 0) {
          pdfDoc.addPage(copiedPage);
          const hasAnnotations =
            includeAnnotations &&
            (page.strokes.length > 0 ||
              (page.textboxes?.length ?? 0) > 0 ||
              (page.images?.length ?? 0) > 0);
          if (hasAnnotations) {
            const overlayCanvas = await renderPageToCanvas(page, {
              scale,
              includeBackground: false,
              includeAnnotations: true,
              transparentBackground: true,
            });
            const overlayPngBytes = await canvasToBytes(overlayCanvas, 'image/png');
            const embeddedOverlay = await pdfDoc.embedPng(overlayPngBytes);
            const cropBox = copiedPage.getCropBox();
            const box =
              cropBox && cropBox.width > 0 && cropBox.height > 0
                ? cropBox
                : copiedPage.getMediaBox();
            copiedPage.drawImage(embeddedOverlay, {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
            });
          }
          continue;
        }
      }
    }

    const canvas = await renderPageToCanvas(page, {
      scale,
      includeBackground,
      includeAnnotations,
      transparentBackground: false,
      resolvePdfBytes: resolveBytes,
    });
    const pngBytes = await canvasToBytes(canvas, 'image/png');
    const embeddedImage = await pdfDoc.embedPng(pngBytes);

    const ptWidth = page.paper.width * ptPerPx;
    const ptHeight = page.paper.height * ptPerPx;
    const pdfPage = pdfDoc.addPage([ptWidth, ptHeight]);
    pdfPage.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: ptWidth,
      height: ptHeight,
    });
  }

  return pdfDoc.save();
}

export interface ImageExportResult {
  blob: Blob;
  filename: string;
  isZip: boolean;
}

/**
 * Renders 1 page directly to PNG/JPG or bundles multiple pages into a `.zip` archive via jszip.
 */
export async function exportPagesToImages(params: {
  baseName: string;
  pages: Page[];
  selectedIndices: number[];
  format: 'png' | 'jpg';
  includeBackground: boolean;
  includeAnnotations: boolean;
  transparentBackground: boolean;
  jpgQuality: number;
  scale?: number;
  resolvePdfBytes?: (assetId: string) => Promise<ArrayBuffer | null>;
  onProgress?: (current: number, total: number) => void;
}): Promise<ImageExportResult> {
  const {
    baseName,
    pages,
    selectedIndices,
    format,
    includeBackground,
    includeAnnotations,
    transparentBackground,
    jpgQuality,
    scale = 2,
    resolvePdfBytes,
    onProgress,
  } = params;

  const safeBase = sanitizeExportFilename(baseName);
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const ext = format === 'png' ? 'png' : 'jpg';
  const total = selectedIndices.length;

  const renderSingle = async (idx: number): Promise<Uint8Array> => {
    const page = pages[idx];
    const canvas = await renderPageToCanvas(page, {
      scale,
      includeBackground: format === 'png' && transparentBackground ? false : includeBackground,
      includeAnnotations,
      transparentBackground: format === 'png' ? transparentBackground : false,
      resolvePdfBytes,
    });
    return canvasToBytes(canvas, mime, jpgQuality);
  };

  if (total === 1) {
    const idx = selectedIndices[0];
    onProgress?.(1, 1);
    const bytes = await renderSingle(idx);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return {
      blob: new Blob([ab], { type: mime }),
      filename: `${safeBase} - Page ${idx + 1}.${ext}`,
      isZip: false,
    };
  }

  const zip = new JSZip();
  for (let step = 0; step < total; step++) {
    const idx = selectedIndices[step];
    onProgress?.(step + 1, total);
    const bytes = await renderSingle(idx);
    const pageNum = String(idx + 1).padStart(2, '0');
    zip.file(`${safeBase} - Page ${pageNum}.${ext}`, bytes);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  return {
    blob: zipBlob,
    filename: `${safeBase} - Pages.zip`,
    isZip: true,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPaperSvgElements(paper: PaperConfig): string {
  const { width, height, pattern } = paper;
  const spacing = Math.max(12, Math.min(96, paper.spacing || 32));
  const colors = resolvePaperLineColors(paper);
  const parts: string[] = [
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(paper.paperColor || '#FFFFFF')}" />`,
  ];

  if (pattern === 'ruled') {
    const topStart = Math.max(spacing * 2.25, 68);
    const bottomLimit = height - Math.max(spacing, 28);
    const cmds: string[] = [];
    for (let y = topStart; y <= bottomLimit; y += spacing) {
      const ay = Math.round(y) + 0.5;
      cmds.push(`M 0 ${ay} H ${width}`);
    }
    if (cmds.length > 0) {
      parts.push(`<path d="${cmds.join(' ')}" fill="none" stroke="${escapeXml(colors.primaryLine)}" stroke-width="1" />`);
    }
  } else if (pattern === 'grid') {
    const cmds: string[] = [];
    for (let x = spacing; x < width; x += spacing) {
      const ax = Math.round(x) + 0.5;
      cmds.push(`M ${ax} 0 V ${height}`);
    }
    for (let y = spacing; y < height; y += spacing) {
      const ay = Math.round(y) + 0.5;
      cmds.push(`M 0 ${ay} H ${width}`);
    }
    if (cmds.length > 0) {
      parts.push(`<path d="${cmds.join(' ')}" fill="none" stroke="${escapeXml(colors.primaryLine)}" stroke-width="1" />`);
    }
  } else if (pattern === 'dotted') {
    const radius = Math.max(1, Math.min(1.8, spacing * 0.045));
    const dots: string[] = [];
    for (let x = spacing; x <= width - spacing * 0.5; x += spacing) {
      for (let y = spacing; y <= height - spacing * 0.5; y += spacing) {
        dots.push(`<circle cx="${x}" cy="${y}" r="${radius.toFixed(2)}" />`);
      }
    }
    if (dots.length > 0) {
      parts.push(`<g fill="${escapeXml(colors.dotColor)}">${dots.join('')}</g>`);
    }
  } else if (pattern === 'cornell') {
    const topHeaderY = Math.round(Math.max(72, Math.min(110, height * 0.095)));
    const summaryY = Math.round(height - Math.max(140, Math.min(200, height * 0.175)));
    const cueX = Math.round(Math.max(150, Math.min(240, width * 0.275)));

    const ruledCmds: string[] = [];
    for (let y = topHeaderY + spacing; y < summaryY - 4; y += spacing) {
      ruledCmds.push(`M ${cueX} ${Math.round(y) + 0.5} H ${width - 24}`);
    }
    for (let y = summaryY + spacing; y < height - 20; y += spacing) {
      ruledCmds.push(`M 24 ${Math.round(y) + 0.5} H ${width - 24}`);
    }
    if (ruledCmds.length > 0) {
      parts.push(`<path d="${ruledCmds.join(' ')}" fill="none" stroke="${escapeXml(colors.primaryLine)}" stroke-width="1" />`);
    }

    const divCmds = [
      `M 24 ${topHeaderY + 0.5} H ${width - 24}`,
      `M 24 ${summaryY + 0.5} H ${width - 24}`,
      `M ${cueX + 0.5} ${topHeaderY + 0.5} V ${summaryY + 0.5}`,
    ];
    parts.push(`<path d="${divCmds.join(' ')}" fill="none" stroke="${escapeXml(colors.accentLine)}" stroke-width="1.75" />`);
  }

  if (paper.marginLine) {
    const marginX = Math.round(paper.marginOffset ?? Math.min(96, width * 0.12)) + 0.5;
    parts.push(
      `<line x1="${marginX}" y1="0" x2="${marginX}" y2="${height}" stroke="${escapeXml(colors.marginLine)}" stroke-width="1.25" />`,
    );
  }

  return parts.join('\n  ');
}

/**
 * Exports a single page as a standalone crisp Vector SVG containing paper pattern geometry,
 * cropped/rounded/flipped images, `perfect-freehand` stroke outlines, and glyph-positioned text.
 */
export function exportPageToSvg(params: {
  page: Page;
  includeBackground: boolean;
  includeAnnotations: boolean;
  pdfBackgroundDataUrl?: string;
}): string {
  const { page, includeBackground, includeAnnotations, pdfBackgroundDataUrl } = params;
  const { width, height } = page.paper;
  const defs: string[] = [];
  const body: string[] = [];

  if (includeBackground && pdfBackgroundDataUrl) {
    body.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF" />`);
    body.push(
      `<image href="${escapeXml(pdfBackgroundDataUrl)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" />`,
    );
  } else if (includeBackground) {
    body.push(buildPaperSvgElements(page.paper));
  } else {
    body.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF" />`);
  }

  if (includeAnnotations) {
    const sortedImages = [...(page.images ?? [])].sort((a, b) => a.zIndex - b.zIndex);
    for (const img of sortedImages) {
      const clipId = `img-clip-${img.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
      const r = Math.max(0, Math.min(img.borderRadius ?? 0, Math.min(img.width, img.height) / 2));
      defs.push(
        `<clipPath id="${clipId}"><rect x="0" y="0" width="${img.width}" height="${img.height}" rx="${r}" ry="${r}" /></clipPath>`,
      );
      const crop = img.crop ?? { x: 0, y: 0, width: 1, height: 1 };
      const fullW = img.width / Math.max(0.02, crop.width);
      const fullH = img.height / Math.max(0.02, crop.height);
      const imgX = -crop.x * fullW;
      const imgY = -crop.y * fullH;

      const innerFlip =
        img.flipX || img.flipY
          ? ` transform="translate(${img.width / 2}, ${img.height / 2}) scale(${img.flipX ? -1 : 1}, ${img.flipY ? -1 : 1}) translate(${-img.width / 2}, ${-img.height / 2})"`
          : '';

      body.push(
        `<g transform="translate(${img.x}, ${img.y})" opacity="${Math.max(0.05, Math.min(1, img.opacity ?? 1))}">` +
          `<g clip-path="url(#${clipId})">` +
          `<g${innerFlip}>` +
          `<image href="${escapeXml(img.dataUrl)}" x="${imgX}" y="${imgY}" width="${fullW}" height="${fullH}" preserveAspectRatio="none" />` +
          `</g></g></g>`,
      );
    }

    for (const stroke of page.strokes) {
      const blendAttr =
        stroke.tool === 'highlighter' ? ' style="mix-blend-mode: multiply"' : '';
      if (stroke.shape) {
        const s = stroke.shape;
        if (s.kind === 'line') {
          body.push(
            `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${escapeXml(stroke.color)}" stroke-width="${stroke.size}" stroke-linecap="round" opacity="${stroke.opacity}"${blendAttr} />`,
          );
        } else if (s.kind === 'rect') {
          body.push(
            `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" fill="none" stroke="${escapeXml(stroke.color)}" stroke-width="${stroke.size}" stroke-linejoin="round" opacity="${stroke.opacity}"${blendAttr} />`,
          );
        } else {
          body.push(
            `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="none" stroke="${escapeXml(stroke.color)}" stroke-width="${stroke.size}" opacity="${stroke.opacity}"${blendAttr} />`,
          );
        }
        continue;
      }

      if (stroke.points.length === 0) continue;
      const outline = getFreehandStrokeOutline(
        stroke.points,
        stroke.tool,
        stroke.size,
        stroke.simulatePressure,
        true,
      );
      const d = outlineToSvgPath(outline);
      if (d) {
        body.push(
          `<path d="${d}" fill="${escapeXml(stroke.color)}" opacity="${stroke.opacity}"${blendAttr} />`,
        );
      }
    }

    for (const tb of page.textboxes ?? []) {
      if (!tb.text) continue;
      const layout = measureTextboxLayout(tb);
      const family = TEXTBOX_FONT_STACKS[tb.fontFamily] ?? TEXTBOX_FONT_STACKS.sans;
      const drawX = tb.x + layout.leftOffset;
      for (let i = 0; i < layout.lines.length; i++) {
        const line = layout.lines[i];
        if (!line.text) continue;
        const baselineY = tb.y + layout.firstAscent + i * layout.lineStep;
        body.push(
          `<text x="${drawX}" y="${baselineY}" font-family="${escapeXml(family)}" font-size="${tb.fontSize}" font-weight="${tb.bold ? 700 : 400}" font-style="${tb.italic ? 'italic' : 'normal'}" fill="${escapeXml(tb.color)}" xml:space="preserve">${escapeXml(line.text)}</text>`,
        );
      }
    }
  }

  const defsBlock = defs.length > 0 ? `<defs>\n  ${defs.join('\n  ')}\n</defs>\n  ` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  ${defsBlock}${body.join('\n  ')}\n</svg>\n`;
}

export function buildFolioNotebookExport(
  notebook: Notebook,
  pages: Page[],
): FolioNotebookExport {
  return {
    format: 'folio-notebook',
    version: 1,
    exportedAt: Date.now(),
    notebook: {
      title: notebook.title,
      cover: { ...notebook.cover },
      defaultPaper: { ...notebook.defaultPaper },
    },
    pages: pages.map((p) => ({
      paper: { ...p.paper },
      strokes: p.strokes.map((s) => ({ ...s, points: [...s.points] })),
      textboxes: (p.textboxes ?? []).map((tb) => ({ ...tb })),
      images: (p.images ?? []).map((im) => ({ ...im, crop: { ...im.crop } })),
      ...(p.pdfBackground ? { pdfBackground: { ...p.pdfBackground } } : {}),
    })),
  };
}

export async function buildFolioNotebookExportAsync(
  notebook: Notebook,
  pages: Page[],
  resolvePdfBytes?: (assetId: string) => Promise<ArrayBuffer | null>,
): Promise<FolioNotebookExport> {
  const base = buildFolioNotebookExport(notebook, pages);
  const assetIds = Array.from(
    new Set(
      pages
        .map((p) => p.pdfBackground?.assetId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (assetIds.length === 0) {
    return base;
  }

  const pdfAssets: SerializedPdfAsset[] = [];
  const resolveBytes = resolvePdfBytes ?? readPlainAssetBytesFromDb;
  for (const assetId of assetIds) {
    const [meta, bytes] = await Promise.all([
      db.pdfAssets.get(assetId),
      resolveBytes(assetId),
    ]);
    if (!bytes) continue;
    pdfAssets.push({
      id: assetId,
      name: meta?.name ?? 'Document.pdf',
      pageCount: meta?.pageCount ?? pages.length,
      base64Data: arrayBufferToBase64(bytes),
      createdAt: meta?.createdAt ?? Date.now(),
    });
  }

  return pdfAssets.length > 0 ? { ...base, pdfAssets } : base;
}

export function parseFolioNotebookExport(rawJson: string): FolioNotebookExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Selected file is not valid JSON.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as FolioNotebookExport).format !== 'folio-notebook' ||
    (parsed as FolioNotebookExport).version !== 1 ||
    !(parsed as FolioNotebookExport).notebook ||
    !Array.isArray((parsed as FolioNotebookExport).pages) ||
    (parsed as FolioNotebookExport).pages.length === 0
  ) {
    throw new Error('File is not a valid Folio Notebook (.folio.json) archive.');
  }

  return parsed as FolioNotebookExport;
}

export function parseFolioWorkspaceBackup(rawJson: string): FolioWorkspaceBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Selected workspace backup file is not valid JSON.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as FolioWorkspaceBackup).format !== 'folio-workspace' ||
    (parsed as FolioWorkspaceBackup).version !== 1 ||
    !Array.isArray((parsed as FolioWorkspaceBackup).folders) ||
    !Array.isArray((parsed as FolioWorkspaceBackup).notebooks) ||
    !Array.isArray((parsed as FolioWorkspaceBackup).templates)
  ) {
    throw new Error('File is not a valid Folio Workspace (.folio-workspace.json) backup.');
  }

  return parsed as FolioWorkspaceBackup;
}

/**
 * Estimates exported output size string for badge display inside ExportModal.
 */
export function estimateExportSizeLabel(params: {
  format: ExportFormat;
  pageCount: number;
  scale?: number;
  pages?: Page[];
}): string {
  const { format, pageCount, scale = 1.5, pages = [] } = params;
  let estKb = 0;

  if (format === 'folio') {
    const rawChars = pages.reduce(
      (sum, p) =>
        sum +
        p.strokes.length * 420 +
        (p.textboxes?.length ?? 0) * 180 +
        (p.images ?? []).reduce((s, im) => s + Math.round((im.dataUrl.length * 0.75) / 1024), 0) *
          1024,
      2048,
    );
    estKb = Math.max(2, Math.round(rawChars / 1024));
  } else if (format === 'svg') {
    estKb = Math.max(4, Math.round(24 + (pages[0]?.strokes.length ?? 0) * 1.4));
  } else if (format === 'pdf') {
    estKb = Math.max(30, Math.round(pageCount * (scale >= 2 ? 260 : 120)));
  } else {
    estKb = Math.max(25, Math.round(pageCount * (format === 'png' ? 180 : 110)));
  }

  if (estKb >= 1024) {
    return `~${(estKb / 1024).toFixed(1)} MB`;
  }
  return `~${estKb} KB`;
}

/**
 * Triggers a clean browser & Electron desktop file download from a Blob without revoking
 * the object URL prematurely.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1500);
}
