import { describe, expect, it } from 'vitest';
import {
  eraseStrokePrecision,
  eraseStrokesPrecisionSegment,
  intersectSegmentWithCapsule,
  sampleShapePointsForPrecision,
} from '../eraser';
import { computeBoundsFromPoints } from '../geometry';
import type { ShapeGeometry, Stroke, StrokePoint } from '../../types/notes';

function makeStroke(
  id: string,
  pts: Array<{ x: number; y: number; pressure?: number }>,
  overrides: Partial<Stroke> = {},
): Stroke {
  const points: StrokePoint[] = pts.map((p, i) => ({
    x: p.x,
    y: p.y,
    pressure: p.pressure ?? 0.5,
    t: i * 16,
  }));
  const size = overrides.size ?? 4;
  return {
    id,
    tool: 'pen',
    color: '#072D59',
    size,
    opacity: 1,
    simulatePressure: false,
    points,
    bounds: computeBoundsFromPoints(points, size * 0.6, overrides.shape),
    createdAt: 1000,
    ...overrides,
  };
}

function makeShapeStroke(id: string, shape: ShapeGeometry, overrides: Partial<Stroke> = {}): Stroke {
  const pts = sampleShapePointsForPrecision(shape);
  const size = overrides.size ?? 4;
  return {
    id,
    tool: 'pen',
    color: '#072D59',
    size,
    opacity: 1,
    simulatePressure: false,
    points: pts,
    shape,
    bounds: computeBoundsFromPoints(pts, size * 0.6, shape),
    createdAt: 1000,
    ...overrides,
  };
}

describe('Precision Vector Eraser engine', () => {
  it('computes analytical capsule intersection and splits a mid-stroke into 2 fragments with exact boundary coords', () => {
    const p0: StrokePoint = { x: 0, y: 50, pressure: 0.5 };
    const p1: StrokePoint = { x: 100, y: 50, pressure: 0.5 };
    const hit = intersectSegmentWithCapsule(p0, p1, 50, 50, 50, 50, 10);
    expect(hit).not.toBeNull();
    expect(hit![0]).toBeCloseTo(0.4, 5);
    expect(hit![1]).toBeCloseTo(0.6, 5);

    const stroke = makeStroke(
      'line-1',
      [
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ],
      { tool: 'highlighter', color: '#FACC15', opacity: 0.45, size: 18, groupId: 'grp-1' },
    );

    const res = eraseStrokePrecision(stroke, 50, 50, 50, 50, 10);
    expect(res.changed).toBe(true);
    expect(res.strokes).toHaveLength(2);

    const [left, right] = res.strokes;
    expect(left.id).not.toBe(stroke.id);
    expect(right.id).not.toBe(stroke.id);
    expect(left.id).not.toBe(right.id);

    // Exact cut points sit cleanly at x=40 and x=60
    expect(left.points[0].x).toBe(0);
    expect(left.points[left.points.length - 1].x).toBeCloseTo(40, 4);
    expect(right.points[0].x).toBeCloseTo(60, 4);
    expect(right.points[right.points.length - 1].x).toBe(100);

    // Bounds & metadata are preserved and tightly recomputed
    expect(left.bounds.maxX).toBeCloseTo(40 + 18 * 0.6, 3);
    expect(right.bounds.minX).toBeCloseTo(60 - 18 * 0.6, 3);
    expect(left.tool).toBe('highlighter');
    expect(left.color).toBe('#FACC15');
    expect(left.opacity).toBe(0.45);
    expect(left.size).toBe(18);
    expect(left.groupId).toBe('grp-1');
    expect(right.groupId).toBe('grp-1');
  });

  it('trims start/end of a stroke cleanly and handles fast-drag capsule sweeps across sparse 2-point strokes', () => {
    const startTrimStroke = makeStroke('trim-start', [
      { x: 0, y: 20 },
      { x: 100, y: 20 },
    ]);
    const trimmedStart = eraseStrokePrecision(startTrimStroke, 0, 20, 10, 20, 15);
    expect(trimmedStart.changed).toBe(true);
    expect(trimmedStart.strokes).toHaveLength(1);
    expect(trimmedStart.strokes[0].points[0].x).toBeCloseTo(25, 4);
    expect(trimmedStart.strokes[0].points[trimmedStart.strokes[0].points.length - 1].x).toBe(100);

    const endTrimStroke = makeStroke('trim-end', [
      { x: 0, y: 20 },
      { x: 100, y: 20 },
    ]);
    const trimmedEnd = eraseStrokePrecision(endTrimStroke, 90, 20, 105, 20, 15);
    expect(trimmedEnd.changed).toBe(true);
    expect(trimmedEnd.strokes).toHaveLength(1);
    expect(trimmedEnd.strokes[0].points[0].x).toBe(0);
    expect(trimmedEnd.strokes[0].points[trimmedEnd.strokes[0].points.length - 1].x).toBeCloseTo(75, 4);

    // Fast diagonal sweep crossing a sparse horizontal stroke at (60, 20)
    const fastDragTarget = makeStroke('sparse', [
      { x: 0, y: 20 },
      { x: 120, y: 20 },
    ]);
    const fastRes = eraseStrokePrecision(fastDragTarget, 60, -80, 60, 120, 8);
    expect(fastRes.changed).toBe(true);
    expect(fastRes.strokes).toHaveLength(2);
    expect(fastRes.strokes[0].points[fastRes.strokes[0].points.length - 1].x).toBeCloseTo(52, 4);
    expect(fastRes.strokes[1].points[0].x).toBeCloseTo(68, 4);
  });

  it('erases a stroke completely when fully covered and discards tiny micro-dot remnants', () => {
    const shortStroke = makeStroke('short', [
      { x: 40, y: 40 },
      { x: 52, y: 40 },
    ]);
    const full = eraseStrokePrecision(shortStroke, 46, 40, 46, 40, 18);
    expect(full.changed).toBe(true);
    expect(full.strokes).toHaveLength(0);

    // Leaving only a ~1.5px tail at the right edge discards the stray micro-dot
    const microTail = makeStroke('micro-tail', [
      { x: 0, y: 40 },
      { x: 51.5, y: 40 },
    ]);
    const tailRes = eraseStrokePrecision(microTail, 40, 40, 40, 40, 10);
    expect(tailRes.changed).toBe(true);
    expect(tailRes.strokes).toHaveLength(1);
    expect(tailRes.strokes[0].points[tailRes.strokes[0].points.length - 1].x).toBeCloseTo(30, 4);
  });

  it('carves snapped geometric shapes into editable freehand strokes while leaving untouched shapes intact', () => {
    const circle = makeShapeStroke('shape-circle', { kind: 'circle', cx: 200, cy: 200, r: 50 });

    // Miss keep shape intact
    const miss = eraseStrokePrecision(circle, 200, 200, 200, 200, 10);
    expect(miss.changed).toBe(false);
    expect(miss.strokes[0]).toBe(circle);
    expect(miss.strokes[0].shape).toEqual({ kind: 'circle', cx: 200, cy: 200, r: 50 });

    // Single notch at bottom (200, 250) stitches the closed seam cleanly into 1 continuous open arc
    const singleNotch = eraseStrokePrecision(circle, 200, 250, 200, 250, 12);
    expect(singleNotch.changed).toBe(true);
    expect(singleNotch.strokes).toHaveLength(1);
    expect(singleNotch.strokes[0].shape).toBeUndefined();
    expect(singleNotch.strokes[0].points.length).toBeGreaterThan(20);

    // Vertical slice through center splits circle into 2 separate left/right arcs
    const slicedCircle = eraseStrokePrecision(circle, 200, 120, 200, 280, 12);
    expect(slicedCircle.changed).toBe(true);
    expect(slicedCircle.strokes).toHaveLength(2);
    expect(slicedCircle.strokes[0].shape).toBeUndefined();
    expect(slicedCircle.strokes[1].shape).toBeUndefined();

    // Snapped rectangle notch also turns into clean freehand curve
    const rect = makeShapeStroke('shape-rect', { kind: 'rect', x: 100, y: 100, width: 120, height: 80 });
    const rectNotch = eraseStrokePrecision(rect, 160, 180, 160, 180, 14);
    expect(rectNotch.changed).toBe(true);
    expect(rectNotch.strokes).toHaveLength(1);
    expect(rectNotch.strokes[0].shape).toBeUndefined();
  });

  it('never erases locked strokes while carving unlocked strokes in the same pass', () => {
    const unlocked = makeStroke('u1', [
      { x: 0, y: 60 },
      { x: 100, y: 60 },
    ]);
    const locked = makeStroke(
      'l1',
      [
        { x: 0, y: 65 },
        { x: 100, y: 65 },
      ],
      { locked: true },
    );

    const res = eraseStrokesPrecisionSegment([unlocked, locked], 50, 62, 50, 62, 12);
    expect(res.changed).toBe(true);
    expect(res.strokes).toHaveLength(3); // 2 fragments of u1 + 1 untouched l1
    expect(res.strokes[2]).toBe(locked);
  });
});
