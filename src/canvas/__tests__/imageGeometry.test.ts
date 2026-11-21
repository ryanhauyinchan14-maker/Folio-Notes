import { describe, expect, it } from 'vitest';
import { getTextboxBoundsList } from '../alignment';
import {
  cropImageFromSide,
  panCropInsideFrame,
  resizeImageFromCorner,
} from '../imageRenderer';
import { buildPlacedPageImage } from '../../utils/imageImport';
import type { PageImage } from '../../types/notes';

function makeSampleImage(overrides: Partial<PageImage> = {}): PageImage {
  return {
    id: 'img-1',
    dataUrl: 'data:image/png;base64,stub',
    naturalWidth: 800,
    naturalHeight: 400,
    x: 100,
    y: 120,
    width: 200,
    height: 100,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    opacity: 1,
    borderRadius: 0,
    flipX: false,
    flipY: false,
    zIndex: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('Image geometry, fitting, proportional scaling, and non-destructive cropping', () => {
  it('auto-fits inserted photos within 50% width / 60% height preserving aspect ratio', () => {
    const placed = buildPlacedPageImage({
      dataUrl: 'data:image/png;base64,wide',
      naturalWidth: 1600,
      naturalHeight: 800,
      paper: { width: 816, height: 1056 },
      centerX: 408,
      centerY: 528,
      zIndex: 1,
    });

    expect(placed.width).toBeCloseTo(408, 2); // 50% of 816
    expect(placed.height).toBeCloseTo(204, 2); // exact 2:1 aspect
    expect(placed.x + placed.width / 2).toBeCloseTo(408, 1);
    expect(placed.y + placed.height / 2).toBeCloseTo(528, 1);
    expect(placed.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('proportionally scales from all 4 corners while anchoring the opposite corner', () => {
    const img = makeSampleImage(); // x=100, y=120, w=200, h=100 (right=300, bottom=220)

    const br = resizeImageFromCorner(img, 'br', 100, 50);
    expect(br.x).toBe(100);
    expect(br.y).toBe(120);
    expect(br.width).toBeCloseTo(300, 2);
    expect(br.height).toBeCloseTo(150, 2);

    const tl = resizeImageFromCorner(img, 'tl', -40, -20);
    expect(tl.x + tl.width).toBeCloseTo(300, 2); // bottom-right stays anchored
    expect(tl.y + tl.height).toBeCloseTo(220, 2);
    expect(tl.width).toBeCloseTo(240, 2);
    expect(tl.height).toBeCloseTo(120, 2);

    // Can shrink below small-element threshold (44x30) cleanly
    const tiny = resizeImageFromCorner(img, 'br', -180, -90, 20);
    expect(tiny.width).toBeLessThan(44);
    expect(tiny.height).toBeLessThan(30);
    expect(tiny.width / tiny.height).toBeCloseTo(2, 2);
  });

  it('non-destructively crops from side handles without stretching or squishing aspect', () => {
    const img = makeSampleImage(); // w=200, h=100, crop=[0,0,1,1]

    // Crop 50px inward from the right edge -> visible crop width becomes 0.75
    const rightCrop = cropImageFromSide(img, 'right', -50, 0);
    expect(rightCrop.x).toBe(100);
    expect(rightCrop.width).toBeCloseTo(150, 2);
    expect(rightCrop.height).toBe(100);
    expect(rightCrop.crop.x).toBeCloseTo(0, 4);
    expect(rightCrop.crop.width).toBeCloseTo(0.75, 4);

    // Crop 40px inward from left edge -> x shifts +40, crop.x advances to 0.2
    const leftCrop = cropImageFromSide(img, 'left', 40, 0);
    expect(leftCrop.x).toBeCloseTo(140, 2);
    expect(leftCrop.width).toBeCloseTo(160, 2);
    expect(leftCrop.crop.x).toBeCloseTo(0.2, 4);
    expect(leftCrop.crop.width).toBeCloseTo(0.8, 4);

    // Horizontal crop when flipX is active adjusts opposite normalized crop edge
    const flippedImg = makeSampleImage({ flipX: true });
    const flippedRightCrop = cropImageFromSide(flippedImg, 'right', -50, 0);
    expect(flippedRightCrop.crop.x).toBeCloseTo(0.25, 4);
    expect(flippedRightCrop.crop.width).toBeCloseTo(0.75, 4);
  });

  it('pans crop window within [0..1] source bounds during double-click crop mode', () => {
    const croppedImg = makeSampleImage({
      width: 100,
      height: 100,
      crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
    });

    // fullW = 200px; dragging image right +30px decreases crop.x by 30/200 = 0.15 -> 0.10
    const pannedRight = panCropInsideFrame(croppedImg, 30, 0);
    expect(pannedRight.x).toBeCloseTo(0.1, 4);

    // Clamps cleanly at left & right source boundaries
    const clampedLeft = panCropInsideFrame(croppedImg, 500, 0);
    expect(clampedLeft.x).toBe(0);
    const clampedRight = panCropInsideFrame(croppedImg, -500, 0);
    expect(clampedRight.x).toBeCloseTo(0.5, 4);
  });

  it('includes PageImages alongside Textboxes in mutual alignment bounds', () => {
    const imgA = makeSampleImage({ id: 'img-a', x: 10, y: 20, width: 100, height: 80 });
    const imgB = makeSampleImage({ id: 'img-b', x: 200, y: 200, width: 50, height: 50 });

    const bounds = getTextboxBoundsList([], new Set(['img-a']), [imgA, imgB]);
    expect(bounds).toEqual([{ minX: 200, minY: 200, maxX: 250, maxY: 250 }]);
  });
});
