import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { db } from '../db/database';
import type { PaperConfig } from '../types/notes';
import { decryptBinaryPayload } from './vaultCrypto';

if (typeof window !== 'undefined' && window.location?.href) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(pdfWorkerUrl, window.location.href).href;
  } catch {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }
} else {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

const MAX_CACHED_DOCS = 6;
const PX_PER_PT = 96 / 72;

export interface PdfImportPageSpec {
  pageNumber: number;
  paper: PaperConfig;
  thumbnailDataUrl?: string;
}

export interface PdfImportProgress {
  fileName: string;
  current: number;
  total: number;
  phase: 'reading' | 'saving';
}

export interface ExtractedPdfResult {
  pdfBytes: ArrayBuffer;
  pageCount: number;
  coverDataUrl?: string;
  pageSpecs: PdfImportPageSpec[];
}

const docCache = new Map<string, PDFDocumentProxy>();
const inFlightDocLoads = new Map<string, Promise<PDFDocumentProxy | null>>();

async function destroyPdfDoc(doc: PDFDocumentProxy): Promise<void> {
  try {
    await doc.cleanup(false);
  } catch {
    // Ignore cleanup errors
  }
  try {
    await doc.loadingTask.destroy();
  } catch {
    // Ignore destroy errors
  }
}

export function isPdfFile(file: { type?: string; name?: string }): boolean {
  if (file.type === 'application/pdf' || file.type === 'application/x-pdf') {
    return true;
  }
  return Boolean(file.name && file.name.toLowerCase().endsWith('.pdf'));
}

/**
 * Converts 72-DPI PDF points into 96-DPI Folio logical canvas dimensions
 * while preserving exact aspect ratio and orientation.
 */
export function pdfViewportToPaperConfig(widthPt: number, heightPt: number): PaperConfig {
  const safeWidthPt = Math.max(72, widthPt || 612);
  const safeHeightPt = Math.max(72, heightPt || 792);
  const width = Math.max(120, Math.round(safeWidthPt * PX_PER_PT));
  const height = Math.max(120, Math.round(safeHeightPt * PX_PER_PT));

  return {
    sizePreset: 'custom',
    orientation: width > height ? 'landscape' : 'portrait',
    width,
    height,
    pattern: 'blank',
    spacing: 32,
    marginLine: false,
    paperColor: '#FFFFFF',
  };
}

export async function loadPdfDocumentFromBytes(
  bytes: ArrayBuffer | Uint8Array,
): Promise<PDFDocumentProxy> {
  // Always clone bytes before transferring to PDF.js worker so DB/caller buffers stay intact.
  const copy =
    bytes instanceof Uint8Array
      ? new Uint8Array(bytes.slice().buffer)
      : new Uint8Array(bytes.slice(0));

  const task = pdfjsLib.getDocument({
    data: copy,
    useSystemFonts: true,
    disableAutoFetch: true,
    disableStream: true,
    useWorkerFetch: false,
  });

  try {
    return await task.promise;
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'PasswordException') {
      throw new Error('This PDF is password-protected and cannot be imported.');
    }
    if (name === 'InvalidPDFException') {
      throw new Error('Selected file is not a valid PDF document.');
    }
    throw err instanceof Error ? err : new Error('Failed to load PDF document.');
  }
}

async function defaultResolvePdfBytes(
  assetId: string,
  masterKey?: CryptoKey | null,
): Promise<ArrayBuffer | null> {
  const asset = await db.pdfAssets.get(assetId);
  if (!asset) return null;
  if (asset.data) {
    if (asset.data instanceof ArrayBuffer) return asset.data;
    if (typeof Blob !== 'undefined' && asset.data instanceof Blob) {
      return asset.data.arrayBuffer();
    }
  }
  if (asset.encryptedData) {
    if (!masterKey) {
      throw new Error('PDF asset is encrypted. Master key required.');
    }
    return decryptBinaryPayload(asset.encryptedData, masterKey);
  }
  return null;
}

function touchCacheEntry(key: string, doc: PDFDocumentProxy): void {
  if (docCache.has(key)) {
    docCache.delete(key);
  }
  docCache.set(key, doc);

  while (docCache.size > MAX_CACHED_DOCS) {
    const oldestKey = docCache.keys().next().value;
    if (!oldestKey) break;
    const evicted = docCache.get(oldestKey);
    docCache.delete(oldestKey);
    if (evicted) {
      void destroyPdfDoc(evicted);
    }
  }
}

export async function getPdfDocumentForAsset(
  assetId: string,
  masterKey?: CryptoKey | null,
  resolvePdfBytes?: (id: string) => Promise<ArrayBuffer | null>,
): Promise<PDFDocumentProxy | null> {
  const cached = docCache.get(assetId);
  if (cached) {
    touchCacheEntry(assetId, cached);
    return cached;
  }

  const pending = inFlightDocLoads.get(assetId);
  if (pending) {
    return pending;
  }

  const loadPromise = (async () => {
    const bytes = resolvePdfBytes
      ? await resolvePdfBytes(assetId)
      : await defaultResolvePdfBytes(assetId, masterKey);
    if (!bytes) return null;
    const doc = await loadPdfDocumentFromBytes(bytes);
    touchCacheEntry(assetId, doc);
    return doc;
  })();

  inFlightDocLoads.set(assetId, loadPromise);
  try {
    return await loadPromise;
  } finally {
    inFlightDocLoads.delete(assetId);
  }
}

export function evictPdfDocument(assetId: string): void {
  const doc = docCache.get(assetId);
  if (doc) {
    docCache.delete(assetId);
    void destroyPdfDoc(doc);
  }
}

export function clearPdfDocumentCache(): void {
  for (const doc of docCache.values()) {
    void destroyPdfDoc(doc);
  }
  docCache.clear();
  inFlightDocLoads.clear();
}

export async function renderPdfPageToCanvas(params: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  canvas: HTMLCanvasElement;
  targetWidthPx: number;
  targetHeightPx?: number;
  signal?: AbortSignal;
}): Promise<boolean> {
  const { doc, pageNumber, canvas, targetWidthPx, targetHeightPx, signal } = params;
  if (signal?.aborted) return false;

  const clampedPage = Math.max(1, Math.min(doc.numPages, pageNumber));
  const pdfPage = await doc.getPage(clampedPage);
  if (signal?.aborted) return false;

  const baseVp = pdfPage.getViewport({ scale: 1 });
  const scaleX = targetWidthPx / Math.max(1, baseVp.width);
  const scale = targetHeightPx
    ? Math.min(scaleX, targetHeightPx / Math.max(1, baseVp.height))
    : scaleX;
  const viewport = pdfPage.getViewport({ scale });

  canvas.width = Math.max(1, Math.round(targetWidthPx));
  canvas.height = Math.max(1, Math.round(targetHeightPx ?? viewport.height));

  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  const renderTask = pdfPage.render({
    canvas,
    canvasContext: ctx,
    viewport,
  });

  const onAbort = () => {
    try {
      renderTask.cancel();
    } catch {
      // Ignore cancel failures
    }
  };

  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await renderTask.promise;
    return !signal?.aborted;
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    if (signal?.aborted || name === 'RenderingCancelledException') {
      return false;
    }
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function extractPdfForImport(
  file: Blob,
  fileName: string,
  onProgress?: (progress: PdfImportProgress) => void,
  signal?: AbortSignal,
): Promise<ExtractedPdfResult> {
  if (signal?.aborted) {
    throw new DOMException('PDF import aborted.', 'AbortError');
  }

  const pdfBytes = await file.arrayBuffer();
  if (signal?.aborted) {
    throw new DOMException('PDF import aborted.', 'AbortError');
  }

  const doc = await loadPdfDocumentFromBytes(pdfBytes);
  const pageCount = doc.numPages;
  const pageSpecs: PdfImportPageSpec[] = [];
  let coverDataUrl: string | undefined;

  const canRenderCanvas =
    typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined';

  try {
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      if (signal?.aborted) {
        throw new DOMException('PDF import aborted.', 'AbortError');
      }

      onProgress?.({
        fileName,
        current: pageNum,
        total: pageCount,
        phase: 'reading',
      });

      const pdfPage = await doc.getPage(pageNum);
      const vp = pdfPage.getViewport({ scale: 1 });
      const paper = pdfViewportToPaperConfig(vp.width, vp.height);
      const aspect = paper.height / Math.max(1, paper.width);
      let thumbnailDataUrl: string | undefined;

      if (canRenderCanvas) {
        if (pageNum === 1) {
          const coverCanvas = document.createElement('canvas');
          const coverOk = await renderPdfPageToCanvas({
            doc,
            pageNumber: 1,
            canvas: coverCanvas,
            targetWidthPx: 480,
            targetHeightPx: Math.max(80, Math.round(480 * aspect)),
            signal,
          });
          if (coverOk) {
            coverDataUrl = coverCanvas.toDataURL('image/jpeg', 0.85);
          }

          const thumbCanvas = document.createElement('canvas');
          const thumbOk = await renderPdfPageToCanvas({
            doc,
            pageNumber: 1,
            canvas: thumbCanvas,
            targetWidthPx: 200,
            targetHeightPx: Math.max(80, Math.round(200 * aspect)),
            signal,
          });
          if (thumbOk) {
            thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.82);
          }
        } else if (pageNum <= 25) {
          const thumbCanvas = document.createElement('canvas');
          const thumbOk = await renderPdfPageToCanvas({
            doc,
            pageNumber: pageNum,
            canvas: thumbCanvas,
            targetWidthPx: 180,
            targetHeightPx: Math.max(80, Math.round(180 * aspect)),
            signal,
          });
          if (thumbOk) {
            thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.8);
          }
        }
      }

      pdfPage.cleanup();
      pageSpecs.push({ pageNumber: pageNum, paper, thumbnailDataUrl });

      if (pageNum % 10 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    return {
      pdfBytes,
      pageCount,
      coverDataUrl,
      pageSpecs,
    };
  } finally {
    await destroyPdfDoc(doc);
  }
}
