import type { BoundingBox, PageImage, PaperConfig, Stroke, Textbox } from '../types/notes';
import { getImageBounds } from './imageRenderer';
import { measureTextboxLayout } from './textLayout';

export interface AlignmentGuide {
  orientation: 'vertical' | 'horizontal';
  pos: number;
  start: number;
  end: number;
  kind: 'snap' | 'axis';
}

export interface DragAlignmentResult {
  dx: number;
  dy: number;
  guides: AlignmentGuide[];
}

export function getTextboxBoundsList(
  textboxes: Textbox[],
  excludeIds: ReadonlySet<string>,
  images: PageImage[] = [],
  strokes: Stroke[] = [],
): BoundingBox[] {
  const out: BoundingBox[] = [];
  for (const tb of textboxes) {
    if (excludeIds.has(tb.id)) continue;
    const layout = measureTextboxLayout(tb);
    out.push({
      minX: tb.x,
      minY: tb.y,
      maxX: tb.x + layout.width,
      maxY: tb.y + layout.height,
    });
  }
  for (const img of images) {
    if (excludeIds.has(img.id)) continue;
    out.push(getImageBounds(img));
  }
  for (const stroke of strokes) {
    if (excludeIds.has(stroke.id)) continue;
    out.push(stroke.bounds);
  }
  return out;
}

export function computeDragAlignment(params: {
  originBounds: BoundingBox;
  rawDx: number;
  rawDy: number;
  paper: Pick<PaperConfig, 'width' | 'height'>;
  otherTextboxBounds: BoundingBox[];
  axisLock: boolean;
  bypassSnap: boolean;
  snapThreshold?: number;
}): DragAlignmentResult {
  const {
    originBounds,
    rawDx,
    rawDy,
    paper,
    otherTextboxBounds,
    axisLock,
    bypassSnap,
    snapThreshold = 5,
  } = params;

  let dx = rawDx;
  let dy = rawDy;
  const guides: AlignmentGuide[] = [];

  let lockAxis: 'x' | 'y' | null = null;
  if (axisLock) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      dy = 0;
      lockAxis = 'x';
      const cy = (originBounds.minY + originBounds.maxY) / 2;
      guides.push({
        orientation: 'horizontal',
        pos: cy,
        start: 0,
        end: paper.width,
        kind: 'axis',
      });
    } else {
      dx = 0;
      lockAxis = 'y';
      const cx = (originBounds.minX + originBounds.maxX) / 2;
      guides.push({
        orientation: 'vertical',
        pos: cx,
        start: 0,
        end: paper.height,
        kind: 'axis',
      });
    }
  }

  if (bypassSnap) {
    return { dx, dy, guides };
  }

  const cand: BoundingBox = {
    minX: originBounds.minX + dx,
    minY: originBounds.minY + dy,
    maxX: originBounds.maxX + dx,
    maxY: originBounds.maxY + dy,
  };

  // X snapping (allowed unless axis-locked purely vertically)
  if (lockAxis !== 'y') {
    const xAnchors = [cand.minX, (cand.minX + cand.maxX) / 2, cand.maxX];
    const xTargets: { pos: number; start: number; end: number }[] = [
      { pos: paper.width / 2, start: 0, end: paper.height },
      { pos: 48, start: 0, end: paper.height },
      { pos: Math.max(48, paper.width - 48), start: 0, end: paper.height },
    ];
    for (const ob of otherTextboxBounds) {
      const spanStart = Math.min(cand.minY, ob.minY) - 12;
      const spanEnd = Math.max(cand.maxY, ob.maxY) + 12;
      xTargets.push(
        { pos: ob.minX, start: spanStart, end: spanEnd },
        { pos: (ob.minX + ob.maxX) / 2, start: spanStart, end: spanEnd },
        { pos: ob.maxX, start: spanStart, end: spanEnd },
      );
    }

    let bestDist = snapThreshold + 0.001;
    let bestDelta = 0;
    let bestTarget: { pos: number; start: number; end: number } | null = null;

    for (const anchor of xAnchors) {
      for (const target of xTargets) {
        const diff = target.pos - anchor;
        const absDiff = Math.abs(diff);
        if (absDiff < bestDist) {
          bestDist = absDiff;
          bestDelta = diff;
          bestTarget = target;
        }
      }
    }

    if (bestTarget) {
      dx += bestDelta;
      guides.push({
        orientation: 'vertical',
        pos: bestTarget.pos,
        start: Math.max(0, bestTarget.start),
        end: Math.min(paper.height, bestTarget.end),
        kind: 'snap',
      });
    }
  }

  // Y snapping (allowed unless axis-locked purely horizontally)
  if (lockAxis !== 'x') {
    const yAnchors = [cand.minY, (cand.minY + cand.maxY) / 2, cand.maxY];
    const yTargets: { pos: number; start: number; end: number }[] = [
      { pos: paper.height / 2, start: 0, end: paper.width },
      { pos: 48, start: 0, end: paper.width },
      { pos: Math.max(48, paper.height - 48), start: 0, end: paper.width },
    ];
    for (const ob of otherTextboxBounds) {
      const spanStart = Math.min(cand.minX, ob.minX) - 12;
      const spanEnd = Math.max(cand.maxX, ob.maxX) + 12;
      yTargets.push(
        { pos: ob.minY, start: spanStart, end: spanEnd },
        { pos: (ob.minY + ob.maxY) / 2, start: spanStart, end: spanEnd },
        { pos: ob.maxY, start: spanStart, end: spanEnd },
      );
    }

    let bestDist = snapThreshold + 0.001;
    let bestDelta = 0;
    let bestTarget: { pos: number; start: number; end: number } | null = null;

    for (const anchor of yAnchors) {
      for (const target of yTargets) {
        const diff = target.pos - anchor;
        const absDiff = Math.abs(diff);
        if (absDiff < bestDist) {
          bestDist = absDiff;
          bestDelta = diff;
          bestTarget = target;
        }
      }
    }

    if (bestTarget) {
      dy += bestDelta;
      guides.push({
        orientation: 'horizontal',
        pos: bestTarget.pos,
        start: Math.max(0, bestTarget.start),
        end: Math.min(paper.width, bestTarget.end),
        kind: 'snap',
      });
    }
  }

  return { dx, dy, guides };
}
