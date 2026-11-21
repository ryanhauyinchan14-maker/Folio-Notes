import type { BoundingBox, ImageCropRect, PageImage } from '../types/notes';

interface CachedImageEntry {
  img: HTMLImageElement;
  loaded: boolean;
  listeners: Set<() => void>;
}

const imageElementCache = new Map<string, CachedImageEntry>();

export function getCachedHtmlImage(
  dataUrl: string,
  onLoad?: () => void,
): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;

  let entry = imageElementCache.get(dataUrl);
  if (!entry) {
    const img = new Image();
    const newEntry: CachedImageEntry = {
      img,
      loaded: false,
      listeners: new Set(),
    };
    if (onLoad) newEntry.listeners.add(onLoad);

    img.onload = () => {
      newEntry.loaded = true;
      for (const cb of newEntry.listeners) {
        cb();
      }
      newEntry.listeners.clear();
    };
    img.src = dataUrl;
    imageElementCache.set(dataUrl, newEntry);
    entry = newEntry;
  }

  if (entry.loaded || (entry.img.complete && entry.img.naturalWidth > 0)) {
    entry.loaded = true;
    return entry.img;
  }

  if (onLoad) {
    entry.listeners.add(onLoad);
  }
  return null;
}

export function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.beginPath();
  if (r === 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function drawCommittedImage(
  ctx: CanvasRenderingContext2D,
  imgData: PageImage,
  onAsyncLoad?: () => void,
): void {
  const htmlImg = getCachedHtmlImage(imgData.dataUrl, onAsyncLoad);
  if (!htmlImg) return;

  const natW = htmlImg.naturalWidth || imgData.naturalWidth;
  const natH = htmlImg.naturalHeight || imgData.naturalHeight;
  if (natW <= 0 || natH <= 0) return;

  const crop = imgData.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const sx = Math.max(0, crop.x * natW);
  const sy = Math.max(0, crop.y * natH);
  const sw = Math.max(1, crop.width * natW);
  const sh = Math.max(1, crop.height * natH);

  ctx.save();
  ctx.globalAlpha = Math.max(0.05, Math.min(1, imgData.opacity ?? 1));
  drawRoundedRectPath(
    ctx,
    imgData.x,
    imgData.y,
    imgData.width,
    imgData.height,
    imgData.borderRadius ?? 0,
  );
  ctx.clip();

  const cx = imgData.x + imgData.width / 2;
  const cy = imgData.y + imgData.height / 2;
  ctx.translate(cx, cy);
  ctx.scale(imgData.flipX ? -1 : 1, imgData.flipY ? -1 : 1);

  ctx.drawImage(
    htmlImg,
    sx,
    sy,
    sw,
    sh,
    -imgData.width / 2,
    -imgData.height / 2,
    imgData.width,
    imgData.height,
  );
  ctx.restore();
}

export function getImageBounds(img: PageImage): BoundingBox {
  return {
    minX: img.x,
    minY: img.y,
    maxX: img.x + img.width,
    maxY: img.y + img.height,
  };
}

export type CornerHandle = 'tl' | 'tr' | 'bl' | 'br';
export type SideHandle = 'top' | 'bottom' | 'left' | 'right';

/**
 * Proportionally scales an image from any of its 4 corner handles while anchoring
 * the opposite corner cleanly. Allows shrinking below 44x30 down to `minSize`.
 */
export function resizeImageFromCorner(
  img: PageImage,
  corner: CornerHandle,
  dx: number,
  dy: number,
  minSize = 20,
): { x: number; y: number; width: number; height: number } {
  const aspect = img.width / Math.max(1, img.height);
  const signedDx = corner === 'br' || corner === 'tr' ? dx : -dx;
  const signedDy = corner === 'br' || corner === 'bl' ? dy : -dy;

  // Drive scale from the dominant axis projection preserving exact aspect ratio
  const scaleFromW = (img.width + signedDx) / Math.max(1, img.width);
  const scaleFromH = (img.height + signedDy) / Math.max(1, img.height);
  const rawScale =
    Math.abs(signedDx) >= Math.abs(signedDy * aspect) ? scaleFromW : scaleFromH;

  const effectiveMin = Math.min(minSize, img.width, img.height);
  const minScale = Math.max(
    effectiveMin / Math.max(1, img.width),
    effectiveMin / Math.max(1, img.height),
  );
  const clampedScale = Math.max(minScale, Math.min(6, rawScale));

  const newW = img.width * clampedScale;
  const newH = newW / aspect;

  let newX = img.x;
  let newY = img.y;
  if (corner === 'tl') {
    newX = img.x + img.width - newW;
    newY = img.y + img.height - newH;
  } else if (corner === 'tr') {
    newY = img.y + img.height - newH;
  } else if (corner === 'bl') {
    newX = img.x + img.width - newW;
  }

  return {
    x: newX,
    y: newY,
    width: newW,
    height: newH,
  };
}

/**
 * Non-destructively crops an image along one of its 4 side pill handles without
 * squishing or distorting the underlying image pixels, accounting for flipX / flipY.
 */
export function cropImageFromSide(
  img: PageImage,
  side: SideHandle,
  dx: number,
  dy: number,
  minSize = 24,
): { x: number; y: number; width: number; height: number; crop: ImageCropRect } {
  const crop = img.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const fullW = img.width / Math.max(0.02, crop.width);
  const fullH = img.height / Math.max(0.02, crop.height);

  let x = img.x;
  let y = img.y;
  let width = img.width;
  let height = img.height;
  let nextCrop: ImageCropRect = { ...crop };

  if (side === 'right') {
    if (!img.flipX) {
      const maxW = fullW * (1 - crop.x);
      width = Math.max(minSize, Math.min(maxW, img.width + dx));
      nextCrop.width = width / fullW;
    } else {
      const rightLimit = crop.x + crop.width;
      const maxW = fullW * rightLimit;
      width = Math.max(minSize, Math.min(maxW, img.width + dx));
      nextCrop.width = width / fullW;
      nextCrop.x = Math.max(0, rightLimit - nextCrop.width);
    }
  } else if (side === 'left') {
    const rightEdge = img.x + img.width;
    if (!img.flipX) {
      const rightLimit = crop.x + crop.width;
      const maxW = fullW * rightLimit;
      width = Math.max(minSize, Math.min(maxW, img.width - dx));
      x = rightEdge - width;
      nextCrop.width = width / fullW;
      nextCrop.x = Math.max(0, rightLimit - nextCrop.width);
    } else {
      const maxW = fullW * (1 - crop.x);
      width = Math.max(minSize, Math.min(maxW, img.width - dx));
      x = rightEdge - width;
      nextCrop.width = width / fullW;
    }
  } else if (side === 'bottom') {
    if (!img.flipY) {
      const maxH = fullH * (1 - crop.y);
      height = Math.max(minSize, Math.min(maxH, img.height + dy));
      nextCrop.height = height / fullH;
    } else {
      const bottomLimit = crop.y + crop.height;
      const maxH = fullH * bottomLimit;
      height = Math.max(minSize, Math.min(maxH, img.height + dy));
      nextCrop.height = height / fullH;
      nextCrop.y = Math.max(0, bottomLimit - nextCrop.height);
    }
  } else {
    // 'top'
    const bottomEdge = img.y + img.height;
    if (!img.flipY) {
      const bottomLimit = crop.y + crop.height;
      const maxH = fullH * bottomLimit;
      height = Math.max(minSize, Math.min(maxH, img.height - dy));
      y = bottomEdge - height;
      nextCrop.height = height / fullH;
      nextCrop.y = Math.max(0, bottomLimit - nextCrop.height);
    } else {
      const maxH = fullH * (1 - crop.y);
      height = Math.max(minSize, Math.min(maxH, img.height - dy));
      y = bottomEdge - height;
      nextCrop.height = height / fullH;
    }
  }

  return { x, y, width, height, crop: nextCrop };
}

/**
 * Moves the source crop window inside the fixed image frame when the user drags
 * inside double-click crop-pan mode. Dragging right shifts the photo rightward.
 */
export function panCropInsideFrame(
  img: PageImage,
  dx: number,
  dy: number,
): ImageCropRect {
  const crop = img.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const fullW = img.width / Math.max(0.02, crop.width);
  const fullH = img.height / Math.max(0.02, crop.height);

  const deltaCropX = (img.flipX ? 1 : -1) * (dx / fullW);
  const deltaCropY = (img.flipY ? 1 : -1) * (dy / fullH);

  return {
    ...crop,
    x: Math.max(0, Math.min(1 - crop.width, crop.x + deltaCropX)),
    y: Math.max(0, Math.min(1 - crop.height, crop.y + deltaCropY)),
  };
}
