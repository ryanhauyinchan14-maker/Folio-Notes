import { describe, expect, it } from 'vitest';
import type { BoundingBox, Page, PageImage, Stroke, Textbox } from '../../types/notes';
import {
  computeBoundsFromPoints,
  doesStrokeIntersectRect,
  hitTestStroke,
  scaleStroke,
} from '../geometry';
import {
  computeAlignedElements,
  expandSelectionWithGroups,
  getSelectionSummary,
  remapGroupIdsForClones,
} from '../selection';

function makeStroke(
  id: string,
  pts: Array<[number, number]>,
  opts?: Partial<Stroke>,
): Stroke {
  const points = pts.map(([x, y]) => ({ x, y, pressure: 0.5 }));
  return {
    id,
    tool: 'pen',
    color: '#072D59',
    size: 4,
    opacity: 1,
    simulatePressure: false,
    points,
    bounds: computeBoundsFromPoints(points, 2),
    createdAt: 1000,
    ...opts,
  };
}

function makeTextbox(id: string, x: number, y: number, opts?: Partial<Textbox>): Textbox {
  return {
    id,
    x,
    y,
    text: 'Note',
    fontFamily: 'sans',
    fontSize: 20,
    bold: false,
    italic: false,
    color: '#072D59',
    createdAt: 1000,
    updatedAt: 1000,
    ...opts,
  };
}

function makeImage(id: string, x: number, y: number, w = 80, h = 60, opts?: Partial<PageImage>): PageImage {
  return {
    id,
    dataUrl: 'data:image/png;base64,AA==',
    x,
    y,
    width: w,
    height: h,
    naturalWidth: w,
    naturalHeight: h,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    borderRadius: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
    zIndex: 1,
    createdAt: 1000,
    updatedAt: 1000,
    ...opts,
  };
}

describe('Universal Select geometry, hit-testing, scaling & group selection', () => {
  it('hit-tests individual freehand and snapped shape strokes within tolerance (topmost wins)', () => {
    const s1 = makeStroke('s1', [
      [100, 100],
      [200, 100],
    ]);
    const s2 = makeStroke('s2', [
      [150, 60],
      [150, 140],
    ]);
    const circle = makeStroke('c1', [[300, 300]], {
      shape: { kind: 'circle', cx: 300, cy: 300, r: 40 },
      bounds: { minX: 256, minY: 256, maxX: 344, maxY: 344 },
    });

    // Near s1 segment (within 8px tolerance)
    expect(hitTestStroke(120, 106, [s1], 8)?.id).toBe('s1');
    // Outside tolerance (> 10px away)
    expect(hitTestStroke(120, 118, [s1], 8)).toBeNull();
    // Overlapping intersection picks s2 because s2 is drawn later (topmost)
    expect(hitTestStroke(150, 100, [s1, s2], 8)?.id).toBe('s2');
    // Circle perimeter hits within tolerance, empty interior misses
    expect(hitTestStroke(340, 300, [circle], 8)?.id).toBe('c1');
    expect(hitTestStroke(300, 300, [circle], 8)).toBeNull();
  });

  it('detects marquee rectangle intersections cleanly even across segment crossings', () => {
    const diag = makeStroke('diag', [
      [50, 50],
      [250, 250],
    ]);
    // Box sits across middle of segment even though neither endpoint is inside
    const midBox: BoundingBox = { minX: 120, minY: 120, maxX: 180, maxY: 180 };
    const farBox: BoundingBox = { minX: 20, minY: 200, maxX: 80, maxY: 260 };

    expect(doesStrokeIntersectRect(diag, midBox)).toBe(true);
    expect(doesStrokeIntersectRect(diag, farBox)).toBe(false);
  });

  it('scales freehand and geometric strokes proportionally into target bounds', () => {
    const line = makeStroke('s1', [
      [100, 100],
      [200, 150],
    ]);
    const scaled = scaleStroke(
      line,
      { minX: 100, minY: 100, maxX: 200, maxY: 150 },
      { minX: 100, minY: 100, maxX: 300, maxY: 200 },
    );
    expect(scaled.points[0].x).toBeCloseTo(100, 1);
    expect(scaled.points[1].x).toBeCloseTo(300, 1);
    expect(scaled.points[1].y).toBeCloseTo(200, 1);
    expect(scaled.bounds.maxX).toBeGreaterThan(295);

    const rectStroke = makeStroke('r1', [[10, 10]], {
      shape: { kind: 'rect', x: 10, y: 10, width: 40, height: 20 },
      bounds: { minX: 8, minY: 8, maxX: 52, maxY: 32 },
    });
    const scaledRect = scaleStroke(
      rectStroke,
      { minX: 10, minY: 10, maxX: 50, maxY: 30 },
      { minX: 20, minY: 20, maxX: 100, maxY: 60 },
    );
    expect(scaledRect.shape).toMatchObject({
      kind: 'rect',
      x: 20,
      y: 20,
      width: 80,
      height: 40,
    });
  });

  it('expands grouped members across types, remaps clone groupIds, and aligns elements', () => {
    const s1 = makeStroke('s1', [
      [100, 100],
      [140, 120],
    ], { groupId: 'grp-1' });
    const tb1 = makeTextbox('tb1', 200, 150, { groupId: 'grp-1' });
    const img1 = makeImage('img1', 350, 260, 80, 60);

    const page: Pick<Page, 'strokes' | 'textboxes' | 'images'> & {
      paper: { width: number; height: number };
    } = {
      paper: { width: 816, height: 1056 },
      strokes: [s1],
      textboxes: [tb1],
      images: [img1],
    };

    // Clicking just tb1 expands selection to both tb1 and grouped s1
    const expanded = expandSelectionWithGroups(page, {
      strokeIds: [],
      textboxIds: ['tb1'],
      imageIds: [],
    });
    expect(expanded.strokeIds).toEqual(['s1']);
    expect(expanded.textboxIds).toEqual(['tb1']);

    const grpSummary = getSelectionSummary(page, expanded);
    expect(grpSummary.isSingleGroup).toBe(true);
    expect(grpSummary.canGroup).toBe(false);
    expect(grpSummary.canUngroup).toBe(true);

    // Remapping clones preserves intra-group linkage under a brand-new groupId
    const remapped = remapGroupIdsForClones([s1], [tb1], [], true);
    expect(remapped.strokes[0].groupId).toBeTruthy();
    expect(remapped.strokes[0].groupId).not.toBe('grp-1');
    expect(remapped.textboxes[0].groupId).toBe(remapped.strokes[0].groupId);

    // Selecting both group + img1 allows aligning left while keeping group relative offsets
    const fullSel = {
      strokeIds: ['s1'],
      textboxIds: ['tb1'],
      imageIds: ['img1'],
    };
    const aligned = computeAlignedElements(page, fullSel, 'left');
    expect(aligned.changed).toBe(true);
    const movedGroupStrokeMinX = aligned.strokes[0].bounds.minX;
    const movedImgX = aligned.images[0].x;
    expect(movedImgX).toBeCloseTo(movedGroupStrokeMinX, 1);
    // tb1 within group stays 100px right of s1's minX (~98 -> delta 0 inside group)
    expect(aligned.textboxes[0].x).toBe(200);
  });
});
