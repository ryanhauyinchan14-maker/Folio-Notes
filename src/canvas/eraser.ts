import type { BoundingBox, ShapeGeometry, Stroke, StrokePoint } from '../types/notes';
import { createId } from '../utils/id';
import {
  boundsOverlap,
  computeBoundsFromPoints,
  distance,
  pointToSegmentDistance,
} from './geometry';

const CAPSULE_EPS = 1e-5;

function intersectSegmentWithDisk(
  p0: StrokePoint,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  radius: number,
): [number, number] | null {
  const vx = p0.x - cx;
  const vy = p0.y - cy;
  const rSq = radius * radius;
  const a = dx * dx + dy * dy;
  const c = vx * vx + vy * vy - rSq;

  if (a <= 1e-12) {
    return c <= 0 ? [0, 1] : null;
  }

  const b = 2 * (vx * dx + vy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  const lo = Math.max(0, (-b - sqrtDisc) / (2 * a));
  const hi = Math.min(1, (-b + sqrtDisc) / (2 * a));
  return lo <= hi ? [lo, hi] : null;
}

function clampLinearInterval(
  v0: number,
  k: number,
  minBound: number,
  maxBound: number,
  tLo: number,
  tHi: number,
): [number, number] | null {
  if (Math.abs(k) <= 1e-12) {
    return v0 >= minBound && v0 <= maxBound ? [tLo, tHi] : null;
  }
  const a = (minBound - v0) / k;
  const b = (maxBound - v0) / k;
  const nextLo = Math.max(tLo, Math.min(a, b));
  const nextHi = Math.min(tHi, Math.max(a, b));
  return nextLo <= nextHi ? [nextLo, nextHi] : null;
}

/**
 * Exact closed-form intersection parameter interval [t0, t1] in [0, 1]
 * where stroke segment P(t) = p0 + t*(p1 - p0) lies inside the convex
 * eraser capsule sweeping from (x1, y1) to (x2, y2) with radius `radius`.
 */
export function intersectSegmentWithCapsule(
  p0: StrokePoint,
  p1: StrokePoint,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number,
): [number, number] | null {
  if (radius <= 0) return null;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;

  const intervals: [number, number][] = [];
  const dA = intersectSegmentWithDisk(p0, dx, dy, x1, y1, radius);
  if (dA) intervals.push(dA);

  const segLen = Math.hypot(x2 - x1, y2 - y1);
  if (segLen > 1e-9) {
    const dB = intersectSegmentWithDisk(p0, dx, dy, x2, y2, radius);
    if (dB) intervals.push(dB);

    const ux = (x2 - x1) / segLen;
    const uy = (y2 - y1) / segLen;
    const nx = -uy;
    const ny = ux;

    const rx = p0.x - x1;
    const ry = p0.y - y1;

    const along0 = rx * ux + ry * uy;
    const alongK = dx * ux + dy * uy;
    const slabAlong = clampLinearInterval(along0, alongK, 0, segLen, 0, 1);
    if (slabAlong) {
      const perp0 = rx * nx + ry * ny;
      const perpK = dx * nx + dy * ny;
      const slab = clampLinearInterval(
        perp0,
        perpK,
        -radius,
        radius,
        slabAlong[0],
        slabAlong[1],
      );
      if (slab) intervals.push(slab);
    }
  }

  if (intervals.length === 0) return null;

  let minT = intervals[0][0];
  let maxT = intervals[0][1];
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i][0] < minT) minT = intervals[i][0];
    if (intervals[i][1] > maxT) maxT = intervals[i][1];
  }
  return [minT, maxT];
}

/**
 * Generates dense sample points along a snapped geometric shape (~4px spacing)
 * so partial precision erasing carves shapes cleanly with zero faceting.
 */
export function sampleShapePointsForPrecision(
  shape: ShapeGeometry,
  pressure = 0.5,
): StrokePoint[] {
  const points: StrokePoint[] = [];

  if (shape.kind === 'line') {
    const len = distance(shape.x1, shape.y1, shape.x2, shape.y2);
    const steps = Math.max(8, Math.ceil(len / 4));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push({
        x: shape.x1 + (shape.x2 - shape.x1) * t,
        y: shape.y1 + (shape.y2 - shape.y1) * t,
        pressure,
      });
    }
    return points;
  }

  if (shape.kind === 'rect') {
    const { x, y, width, height } = shape;
    const edges: [number, number, number, number][] = [
      [x, y, x + width, y],
      [x + width, y, x + width, y + height],
      [x + width, y + height, x, y + height],
      [x, y + height, x, y],
    ];
    for (const [ex1, ey1, ex2, ey2] of edges) {
      const len = distance(ex1, ey1, ex2, ey2);
      const steps = Math.max(4, Math.ceil(len / 4));
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        points.push({
          x: ex1 + (ex2 - ex1) * t,
          y: ey1 + (ey2 - ey1) * t,
          pressure,
        });
      }
    }
    points.push({ x, y, pressure });
    return points;
  }

  const { cx, cy, r } = shape;
  const circumference = 2 * Math.PI * Math.max(1, r);
  const steps = Math.max(36, Math.min(240, Math.ceil(circumference / 4)));
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    points.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      pressure,
    });
  }
  return points;
}

function interpolateStrokePoint(
  p0: StrokePoint,
  p1: StrokePoint,
  t: number,
): StrokePoint {
  const point: StrokePoint = {
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
    pressure: p0.pressure + (p1.pressure - p0.pressure) * t,
  };
  if (p0.t !== undefined && p1.t !== undefined) {
    point.t = p0.t + (p1.t - p0.t) * t;
  } else if (p0.t !== undefined) {
    point.t = p0.t;
  }
  return point;
}

function pushDedupPoint(run: StrokePoint[], pt: StrokePoint): void {
  const prev = run[run.length - 1];
  if (prev && distance(prev.x, prev.y, pt.x, pt.y) < 1e-4) {
    return;
  }
  run.push(pt);
}

function computePolylineLength(pts: StrokePoint[]): number {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    len += distance(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
  }
  return len;
}

/**
 * Precision vector carving for a single stroke along eraser drag segment (x1, y1) -> (x2, y2).
 * Locked strokes and untouched strokes return `{ strokes: [stroke], changed: false }`.
 */
export function eraseStrokePrecision(
  stroke: Stroke,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  eraserRadius: number,
): { strokes: Stroke[]; changed: boolean } {
  if (stroke.locked) {
    return { strokes: [stroke], changed: false };
  }

  const expand = eraserRadius + Math.max(2, stroke.size * 0.6);
  const capsuleBounds: BoundingBox = {
    minX: Math.min(x1, x2) - expand,
    minY: Math.min(y1, y2) - expand,
    maxX: Math.max(x1, x2) + expand,
    maxY: Math.max(y1, y2) + expand,
  };
  if (!boundsOverlap(capsuleBounds, stroke.bounds)) {
    return { strokes: [stroke], changed: false };
  }

  const isClosedLoop =
    stroke.shape?.kind === 'rect' || stroke.shape?.kind === 'circle';
  const pts = stroke.shape
    ? sampleShapePointsForPrecision(stroke.shape, stroke.points[0]?.pressure ?? 0.5)
    : stroke.points;

  if (pts.length === 0) {
    return { strokes: [], changed: true };
  }

  if (pts.length === 1) {
    if (pointToSegmentDistance(pts[0].x, pts[0].y, x1, y1, x2, y2) <= eraserRadius) {
      return { strokes: [], changed: true };
    }
    return { strokes: [stroke], changed: false };
  }

  let anyHit = false;
  const runs: StrokePoint[][] = [];
  let currentRun: StrokePoint[] = [];

  const flushRun = () => {
    if (currentRun.length > 0) {
      runs.push(currentRun);
      currentRun = [];
    }
  };

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const hit = intersectSegmentWithCapsule(p0, p1, x1, y1, x2, y2, eraserRadius);

    if (!hit) {
      if (currentRun.length === 0) {
        pushDedupPoint(currentRun, { ...p0 });
      }
      pushDedupPoint(currentRun, { ...p1 });
      continue;
    }

    anyHit = true;
    const [t0, t1] = hit;

    if (t0 > CAPSULE_EPS) {
      if (currentRun.length === 0) {
        pushDedupPoint(currentRun, { ...p0 });
      }
      pushDedupPoint(currentRun, interpolateStrokePoint(p0, p1, t0));
    }
    flushRun();

    if (t1 < 1 - CAPSULE_EPS) {
      pushDedupPoint(currentRun, interpolateStrokePoint(p0, p1, t1));
      pushDedupPoint(currentRun, { ...p1 });
    }
  }
  flushRun();

  if (!anyHit) {
    return { strokes: [stroke], changed: false };
  }

  // Stitch closed-shape start/end seam when a single notch avoids pts[0]
  if (isClosedLoop && runs.length >= 2) {
    const firstRun = runs[0];
    const lastRun = runs[runs.length - 1];
    if (
      firstRun.length > 0 &&
      lastRun.length > 0 &&
      distance(lastRun[lastRun.length - 1].x, lastRun[lastRun.length - 1].y, firstRun[0].x, firstRun[0].y) <
        1e-2
    ) {
      runs[0] = [...lastRun, ...firstRun.slice(1)];
      runs.pop();
    }
  }

  const fragments: Stroke[] = [];
  for (const run of runs) {
    if (run.length < 2 || computePolylineLength(run) < 2.5) {
      continue;
    }
    const finalPoints =
      run.length === 2 && distance(run[0].x, run[0].y, run[1].x, run[1].y) > 8
        ? [run[0], interpolateStrokePoint(run[0], run[1], 0.5), run[1]]
        : run;

    fragments.push({
      id: createId(),
      tool: stroke.tool,
      color: stroke.color,
      size: stroke.size,
      opacity: stroke.opacity,
      simulatePressure: stroke.shape ? false : stroke.simulatePressure,
      points: finalPoints,
      shape: undefined,
      bounds: computeBoundsFromPoints(finalPoints, stroke.size * 0.6),
      isTidied: stroke.isTidied,
      groupId: stroke.groupId,
      locked: stroke.locked,
      createdAt: stroke.createdAt,
    });
  }

  return { strokes: fragments, changed: true };
}

/**
 * Applies precision eraser carving across an ordered list of strokes,
 * preserving paint order and original references for unaffected strokes.
 */
export function eraseStrokesPrecisionSegment(
  strokes: Stroke[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  eraserRadius: number,
): { strokes: Stroke[]; changed: boolean } {
  let changed = false;
  const next: Stroke[] = [];

  for (const stroke of strokes) {
    const res = eraseStrokePrecision(stroke, x1, y1, x2, y2, eraserRadius);
    if (res.changed) {
      changed = true;
    }
    for (const frag of res.strokes) {
      next.push(frag);
    }
  }

  return changed ? { strokes: next, changed: true } : { strokes, changed: false };
}
