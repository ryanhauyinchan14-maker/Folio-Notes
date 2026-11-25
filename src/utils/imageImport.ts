import type { PageImage, PaperConfig } from '../types/notes';
import { createId } from './id';

const MAX_LONGEST_EDGE = 2048;

const SUPPORTED_EXTENSIONS = /\.(png|jpe?g|webp|gif)$/i;

export function isSupportedImageFile(file: File): boolean {
  if (file.type && /^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)) {
    return true;
  }
  return SUPPORTED_EXTENSIONS.test(file.name);
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image.'));
    img.src = src;
  });
}

export async function processUploadedImage(file: Blob): Promise<{
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}> {
  const rawDataUrl = await readBlobAsDataUrl(file);
  const img = await loadImageElement(rawDataUrl);

  const origW = Math.max(1, img.naturalWidth || img.width);
  const origH = Math.max(1, img.naturalHeight || img.height);
  const maxEdge = Math.max(origW, origH);

  // Keep images <= 2048px unmodified so PNG/WebP transparency & GIFs remain exact
  if (maxEdge <= MAX_LONGEST_EDGE) {
    return {
      dataUrl: rawDataUrl,
      naturalWidth: origW,
      naturalHeight: origH,
    };
  }

  const scale = MAX_LONGEST_EDGE / maxEdge;
  const targetW = Math.max(1, Math.round(origW * scale));
  const targetH = Math.max(1, Math.round(origH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      dataUrl: rawDataUrl,
      naturalWidth: origW,
      naturalHeight: origH,
    };
  }

  ctx.drawImage(img, 0, 0, targetW, targetH);

  // Preserve transparency for PNG/WebP/GIF; use compact JPEG for opaque photos
  const isJpeg = file.type === 'image/jpeg' || file.type === 'image/jpg';
  const outMime = isJpeg ? 'image/jpeg' : file.type === 'image/webp' ? 'image/webp' : 'image/png';
  const encoded = canvas.toDataURL(outMime, isJpeg ? 0.9 : 0.92);

  return {
    dataUrl: encoded,
    naturalWidth: targetW,
    naturalHeight: targetH,
  };
}

export function buildPlacedPageImage(params: {
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  paper: Pick<PaperConfig, 'width' | 'height'>;
  centerX: number;
  centerY: number;
  zIndex: number;
  unbounded?: boolean;
}): PageImage {
  const {
    dataUrl,
    naturalWidth,
    naturalHeight,
    paper,
    centerX,
    centerY,
    zIndex,
    unbounded = false,
  } = params;
  const maxW = unbounded ? 480 : paper.width * 0.5;
  const maxH = unbounded ? 480 : paper.height * 0.6;
  const fitScale = Math.min(maxW / naturalWidth, maxH / naturalHeight, 1);

  const width = Math.max(40, Math.round(naturalWidth * fitScale));
  const height = Math.max(40, Math.round(naturalHeight * fitScale));

  const rawX = Math.round(centerX - width / 2);
  const rawY = Math.round(centerY - height / 2);
  const x = unbounded ? rawX : Math.max(8, Math.min(paper.width - width - 8, rawX));
  const y = unbounded ? rawY : Math.max(8, Math.min(paper.height - height - 8, rawY));

  const now = Date.now();
  return {
    id: createId(),
    dataUrl,
    x,
    y,
    width,
    height,
    naturalWidth,
    naturalHeight,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    borderRadius: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
    zIndex,
    createdAt: now,
    updatedAt: now,
  };
}
