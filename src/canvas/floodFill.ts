import { hexToRgb } from './colorMath';

export interface FloodFillResult {
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

const MAX_FILL_WORK_DIM = 800;

export function computeFloodFillRegion(
  sourceCanvas: HTMLCanvasElement,
  seedNormX: number,
  seedNormY: number,
  fillHex: string,
  pageWidth: number,
  pageHeight: number,
  tolerance = 36,
): FloodFillResult | null {
  if (sourceCanvas.width <= 0 || sourceCanvas.height <= 0) return null;
  if (seedNormX < 0 || seedNormX > 1 || seedNormY < 0 || seedNormY > 1) return null;

  const maxDim = Math.max(sourceCanvas.width, sourceCanvas.height);
  const downscale = maxDim > MAX_FILL_WORK_DIM ? MAX_FILL_WORK_DIM / maxDim : 1;
  const workW = Math.max(1, Math.round(sourceCanvas.width * downscale));
  const workH = Math.max(1, Math.round(sourceCanvas.height * downscale));

  const workCanvas = document.createElement('canvas');
  workCanvas.width = workW;
  workCanvas.height = workH;
  const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
  if (!workCtx) return null;

  workCtx.drawImage(sourceCanvas, 0, 0, workW, workH);
  const srcData = workCtx.getImageData(0, 0, workW, workH).data;

  const seedX = Math.max(0, Math.min(workW - 1, Math.floor(seedNormX * workW)));
  const seedY = Math.max(0, Math.min(workH - 1, Math.floor(seedNormY * workH)));
  const seedIdx = (seedY * workW + seedX) * 4;
  const targetR = srcData[seedIdx];
  const targetG = srcData[seedIdx + 1];
  const targetB = srcData[seedIdx + 2];
  const targetA = srcData[seedIdx + 3];

  const fillRgb = hexToRgb(fillHex);
  const alreadyFilledDist =
    Math.abs(targetR - fillRgb.r) +
    Math.abs(targetG - fillRgb.g) +
    Math.abs(targetB - fillRgb.b);
  if (targetA > 240 && alreadyFilledDist <= 12) {
    return null;
  }

  const outData = new Uint8ClampedArray(workW * workH * 4);
  const visited = new Uint8Array(workW * workH);

  const matchesTarget = (pixelIdx: number): boolean => {
    const i4 = pixelIdx * 4;
    return (
      Math.abs(srcData[i4] - targetR) <= tolerance &&
      Math.abs(srcData[i4 + 1] - targetG) <= tolerance &&
      Math.abs(srcData[i4 + 2] - targetB) <= tolerance &&
      Math.abs(srcData[i4 + 3] - targetA) <= tolerance
    );
  };

  if (!matchesTarget(seedY * workW + seedX)) return null;

  let minX = workW;
  let minY = workH;
  let maxX = -1;
  let maxY = -1;
  let filledCount = 0;

  const stack: number[] = [seedX, seedY];
  while (stack.length > 0) {
    const y = stack.pop()!;
    const startX = stack.pop()!;

    let lx = startX;
    while (lx >= 0 && !visited[y * workW + lx] && matchesTarget(y * workW + lx)) {
      lx--;
    }
    lx++;

    let rx = startX;
    while (rx < workW && !visited[y * workW + rx] && matchesTarget(y * workW + rx)) {
      rx++;
    }
    rx--;

    if (lx > rx) continue;

    if (lx < minX) minX = lx;
    if (rx > maxX) maxX = rx;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    let aboveAdded = false;
    let belowAdded = false;

    for (let x = lx; x <= rx; x++) {
      const pIdx = y * workW + x;
      visited[pIdx] = 1;
      const o4 = pIdx * 4;
      outData[o4] = fillRgb.r;
      outData[o4 + 1] = fillRgb.g;
      outData[o4 + 2] = fillRgb.b;
      outData[o4 + 3] = 255;
      filledCount++;

      if (y > 0) {
        const upIdx = (y - 1) * workW + x;
        const upMatch = !visited[upIdx] && matchesTarget(upIdx);
        if (upMatch && !aboveAdded) {
          stack.push(x, y - 1);
          aboveAdded = true;
        } else if (!upMatch) {
          aboveAdded = false;
        }
      }

      if (y < workH - 1) {
        const downIdx = (y + 1) * workW + x;
        const downMatch = !visited[downIdx] && matchesTarget(downIdx);
        if (downMatch && !belowAdded) {
          stack.push(x, y + 1);
          belowAdded = true;
        } else if (!downMatch) {
          belowAdded = false;
        }
      }
    }
  }

  workCanvas.width = 0;
  workCanvas.height = 0;

  if (filledCount === 0 || maxX < minX || maxY < minY) {
    return null;
  }

  const cropX = Math.max(0, minX - 1);
  const cropY = Math.max(0, minY - 1);
  const cropW = Math.min(workW - cropX, maxX - minX + 3);
  const cropH = Math.min(workH - cropY, maxY - minY + 3);

  const fullOutCanvas = document.createElement('canvas');
  fullOutCanvas.width = workW;
  fullOutCanvas.height = workH;
  const fullOutCtx = fullOutCanvas.getContext('2d');
  if (!fullOutCtx) return null;
  fullOutCtx.putImageData(new ImageData(outData, workW, workH), 0, 0);

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) return null;
  cropCtx.drawImage(fullOutCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  const dataUrl = cropCanvas.toDataURL('image/png');
  fullOutCanvas.width = 0;
  fullOutCanvas.height = 0;
  cropCanvas.width = 0;
  cropCanvas.height = 0;

  return {
    dataUrl,
    x: Number(((cropX / workW) * pageWidth).toFixed(2)),
    y: Number(((cropY / workH) * pageHeight).toFixed(2)),
    width: Math.max(2, Number(((cropW / workW) * pageWidth).toFixed(2))),
    height: Math.max(2, Number(((cropH / workH) * pageHeight).toFixed(2))),
    naturalWidth: cropW,
    naturalHeight: cropH,
  };
}
