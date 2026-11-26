import type { BoundingBox, ShapeGeometry, Stroke, StrokePoint } from '../types/notes';
import { createId } from '../utils/id';

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

/**
 * Locks a line's endpoint to the horizontal or vertical axis relative to its origin,
 * choosing whichever axis has the larger cursor displacement.
 */
export function snapLineEndToCardinalAxis(
  x1: number,
  y1: number,
  x: number,
  y: number,
): { x2: number; y2: number } {
  return Math.abs(x - x1) >= Math.abs(y - y1)
    ? { x2: x, y2: y1 }
    : { x2: x1, y2: y };
}

/**
 * Generates dense sample points along a geometric shape so that stroke erasing,
 * lasso selection, and bounding box calculations treat snapped shapes identically to freehand strokes.
 */
export function sampleShapePoints(shape: ShapeGeometry, pressure = 0.5): StrokePoint[] {
  const points: StrokePoint[] = [];

  if (shape.kind === 'line') {
    const len = distance(shape.x1, shape.y1, shape.x2, shape.y2);
    const steps = Math.max(8, Math.ceil(len / 8));
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
    for (const [x1, y1, x2, y2] of edges) {
      const len = distance(x1, y1, x2, y2);
      const steps = Math.max(4, Math.ceil(len / 10));
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        points.push({
          x: x1 + (x2 - x1) * t,
          y: y1 + (y2 - y1) * t,
          pressure,
        });
      }
    }
    points.push({ x, y, pressure });
    return points;
  }

  // Circle
  const { cx, cy, r } = shape;
  const circumference = 2 * Math.PI * Math.max(1, r);
  const steps = Math.max(24, Math.min(120, Math.ceil(circumference / 8)));
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

export function computeBoundsFromPoints(
  points: StrokePoint[],
  padding = 0,
  shape?: ShapeGeometry,
): BoundingBox {
  if (shape) {
    if (shape.kind === 'line') {
      return {
        minX: Math.min(shape.x1, shape.x2) - padding,
        minY: Math.min(shape.y1, shape.y2) - padding,
        maxX: Math.max(shape.x1, shape.x2) + padding,
        maxY: Math.max(shape.y1, shape.y2) + padding,
      };
    }
    if (shape.kind === 'rect') {
      return {
        minX: Math.min(shape.x, shape.x + shape.width) - padding,
        minY: Math.min(shape.y, shape.y + shape.height) - padding,
        maxX: Math.max(shape.x, shape.x + shape.width) + padding,
        maxY: Math.max(shape.y, shape.y + shape.height) + padding,
      };
    }
    return {
      minX: shape.cx - shape.r - padding,
      minY: shape.cy - shape.r - padding,
      maxX: shape.cx + shape.r + padding,
      maxY: shape.cy + shape.r + padding,
    };
  }

  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pt of points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

export function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(px - x1, py - y1);
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function orientation(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const val = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
  if (Math.abs(val) < 1e-9) return 0;
  return val > 0 ? 1 : 2;
}

function onSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  return (
    bx <= Math.max(ax, cx) + 1e-6 &&
    bx >= Math.min(ax, cx) - 1e-6 &&
    by <= Math.max(ay, cy) + 1e-6 &&
    by >= Math.min(ay, cy) - 1e-6
  );
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const o1 = orientation(ax, ay, bx, by, cx, cy);
  const o2 = orientation(ax, ay, bx, by, dx, dy);
  const o3 = orientation(cx, cy, dx, dy, ax, ay);
  const o4 = orientation(cx, cy, dx, dy, bx, by);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(ax, ay, cx, cy, bx, by)) return true;
  if (o2 === 0 && onSegment(ax, ay, dx, dy, bx, by)) return true;
  if (o3 === 0 && onSegment(cx, cy, ax, ay, dx, dy)) return true;
  if (o4 === 0 && onSegment(cx, cy, bx, by, dx, dy)) return true;
  return false;
}

export function segmentToSegmentDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) {
    return 0;
  }
  return Math.min(
    pointToSegmentDistance(ax, ay, cx, cy, dx, dy),
    pointToSegmentDistance(bx, by, cx, cy, dx, dy),
    pointToSegmentDistance(cx, cy, ax, ay, bx, by),
    pointToSegmentDistance(dx, dy, ax, ay, bx, by),
  );
}

export function boundsOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function doesEraserHitStroke(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  eraserRadius: number,
  stroke: Stroke,
): boolean {
  const hitRadius = eraserRadius + stroke.size * 0.5;
  const sweepBounds: BoundingBox = {
    minX: Math.min(x1, x2) - hitRadius,
    minY: Math.min(y1, y2) - hitRadius,
    maxX: Math.max(x1, x2) + hitRadius,
    maxY: Math.max(y1, y2) + hitRadius,
  };

  if (!boundsOverlap(sweepBounds, stroke.bounds)) {
    return false;
  }

  const pts = stroke.shape && stroke.points.length < 4
    ? sampleShapePoints(stroke.shape)
    : stroke.points;

  if (pts.length === 0) return false;
  if (pts.length === 1) {
    return pointToSegmentDistance(pts[0].x, pts[0].y, x1, y1, x2, y2) <= hitRadius;
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const pA = pts[i];
    const pB = pts[i + 1];
    if (segmentToSegmentDistance(x1, y1, x2, y2, pA.x, pA.y, pB.x, pB.y) <= hitRadius) {
      return true;
    }
  }

  return false;
}

export function isPointInPolygon(
  x: number,
  y: number,
  polygon: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Returns IDs of all strokes captured by the lasso polygon.
 * Selects a stroke when at least 40% of its sample points fall inside the polygon,
 * OR if the lasso polygon is intersecting/covering the majority of a compact stroke.
 */
export function getStrokesInLasso(
  polygon: ReadonlyArray<{ x: number; y: number }>,
  strokes: Stroke[],
): string[] {
  if (polygon.length < 3) return [];

  let polyMinX = Infinity;
  let polyMinY = Infinity;
  let polyMaxX = -Infinity;
  let polyMaxY = -Infinity;
  for (const p of polygon) {
    if (p.x < polyMinX) polyMinX = p.x;
    if (p.y < polyMinY) polyMinY = p.y;
    if (p.x > polyMaxX) polyMaxX = p.x;
    if (p.y > polyMaxY) polyMaxY = p.y;
  }
  const polyBounds: BoundingBox = {
    minX: polyMinX,
    minY: polyMinY,
    maxX: polyMaxX,
    maxY: polyMaxY,
  };

  const selectedIds: string[] = [];

  for (const stroke of strokes) {
    if (!boundsOverlap(polyBounds, stroke.bounds)) continue;
    const pts = stroke.shape ? sampleShapePoints(stroke.shape) : stroke.points;
    if (pts.length === 0) continue;

    let insideCount = 0;
    const step = pts.length > 80 ? Math.ceil(pts.length / 80) : 1;
    let sampledCount = 0;
    for (let i = 0; i < pts.length; i += step) {
      sampledCount++;
      if (isPointInPolygon(pts[i].x, pts[i].y, polygon)) {
        insideCount++;
      }
    }

    if (sampledCount > 0 && insideCount / sampledCount >= 0.4) {
      selectedIds.push(stroke.id);
    }
  }

  return selectedIds;
}

export function getCombinedBounds(strokes: Stroke[]): BoundingBox | null {
  if (strokes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    if (s.bounds.minX < minX) minX = s.bounds.minX;
    if (s.bounds.minY < minY) minY = s.bounds.minY;
    if (s.bounds.maxX > maxX) maxX = s.bounds.maxX;
    if (s.bounds.maxY > maxY) maxY = s.bounds.maxY;
  }
  return { minX, minY, maxX, maxY };
}

export function translateStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  const movedPoints = stroke.points.map((pt) => ({
    ...pt,
    x: pt.x + dx,
    y: pt.y + dy,
  }));

  let movedShape: ShapeGeometry | undefined = stroke.shape;
  if (stroke.shape) {
    if (stroke.shape.kind === 'line') {
      movedShape = {
        kind: 'line',
        x1: stroke.shape.x1 + dx,
        y1: stroke.shape.y1 + dy,
        x2: stroke.shape.x2 + dx,
        y2: stroke.shape.y2 + dy,
      };
    } else if (stroke.shape.kind === 'rect') {
      movedShape = {
        kind: 'rect',
        x: stroke.shape.x + dx,
        y: stroke.shape.y + dy,
        width: stroke.shape.width,
        height: stroke.shape.height,
      };
    } else {
      movedShape = {
        kind: 'circle',
        cx: stroke.shape.cx + dx,
        cy: stroke.shape.cy + dy,
        r: stroke.shape.r,
      };
    }
  }

  return {
    ...stroke,
    points: movedPoints,
    shape: movedShape,
    bounds: {
      minX: stroke.bounds.minX + dx,
      minY: stroke.bounds.minY + dy,
      maxX: stroke.bounds.maxX + dx,
      maxY: stroke.bounds.maxY + dy,
    },
  };
}

export function cloneStrokeWithNewId(stroke: Stroke, dx = 0, dy = 0): Stroke {
  const translated = dx !== 0 || dy !== 0 ? translateStroke(stroke, dx, dy) : stroke;
  return {
    ...translated,
    id: createId(),
    points: translated.points.map((p) => ({ ...p })),
    shape: translated.shape ? { ...translated.shape } : undefined,
    bounds: { ...translated.bounds },
    createdAt: Date.now(),
  };
}

function getStrokeHitSegments(stroke: Stroke): StrokePoint[] {
  if (stroke.shape && stroke.points.length < 4) {
    return sampleShapePoints(stroke.shape);
  }
  return stroke.points;
}

/**
 * Hit-tests individual strokes in reverse paint order (topmost wins) within `tolerance` px.
 */
export function hitTestStroke(
  x: number,
  y: number,
  strokes: Stroke[],
  tolerance = 8,
): Stroke | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    const hitRadius = tolerance + stroke.size * 0.5;
    if (
      x < stroke.bounds.minX - hitRadius ||
      x > stroke.bounds.maxX + hitRadius ||
      y < stroke.bounds.minY - hitRadius ||
      y > stroke.bounds.maxY + hitRadius
    ) {
      continue;
    }

    if (stroke.shape) {
      const s = stroke.shape;
      if (s.kind === 'line') {
        if (pointToSegmentDistance(x, y, s.x1, s.y1, s.x2, s.y2) <= hitRadius) {
          return stroke;
        }
        continue;
      }
      if (s.kind === 'rect') {
        const edges: [number, number, number, number][] = [
          [s.x, s.y, s.x + s.width, s.y],
          [s.x + s.width, s.y, s.x + s.width, s.y + s.height],
          [s.x + s.width, s.y + s.height, s.x, s.y + s.height],
          [s.x, s.y + s.height, s.x, s.y],
        ];
        if (edges.some(([x1, y1, x2, y2]) => pointToSegmentDistance(x, y, x1, y1, x2, y2) <= hitRadius)) {
          return stroke;
        }
        continue;
      }
      const ringDist = Math.abs(distance(x, y, s.cx, s.cy) - s.r);
      if (ringDist <= hitRadius) {
        return stroke;
      }
      continue;
    }

    const pts = getStrokeHitSegments(stroke);
    if (pts.length === 0) continue;
    if (pts.length === 1) {
      if (distance(x, y, pts[0].x, pts[0].y) <= hitRadius) {
        return stroke;
      }
      continue;
    }

    for (let j = 0; j < pts.length - 1; j++) {
      const pA = pts[j];
      const pB = pts[j + 1];
      if (pointToSegmentDistance(x, y, pA.x, pA.y, pB.x, pB.y) <= hitRadius) {
        return stroke;
      }
    }
  }
  return null;
}

/**
 * Checks whether any point or segment of a stroke intersects a marquee rectangle.
 */
export function doesStrokeIntersectRect(stroke: Stroke, rect: BoundingBox): boolean {
  if (!boundsOverlap(stroke.bounds, rect)) {
    return false;
  }

  const pts = stroke.shape ? sampleShapePoints(stroke.shape) : stroke.points;
  if (pts.length === 0) return false;

  const insideRect = (px: number, py: number) =>
    px >= rect.minX && px <= rect.maxX && py >= rect.minY && py <= rect.maxY;

  for (const pt of pts) {
    if (insideRect(pt.x, pt.y)) {
      return true;
    }
  }

  const edges: [number, number, number, number][] = [
    [rect.minX, rect.minY, rect.maxX, rect.minY],
    [rect.maxX, rect.minY, rect.maxX, rect.maxY],
    [rect.maxX, rect.maxY, rect.minX, rect.maxY],
    [rect.minX, rect.maxY, rect.minX, rect.minY],
  ];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    for (const [ex1, ey1, ex2, ey2] of edges) {
      if (segmentsIntersect(a.x, a.y, b.x, b.y, ex1, ey1, ex2, ey2)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Proportionally maps a stroke from `originBounds` into `targetBounds`, returning a fresh Stroke
 * so Path2D render caches invalidate cleanly.
 */
export function scaleStroke(
  stroke: Stroke,
  originBounds: BoundingBox,
  targetBounds: BoundingBox,
): Stroke {
  const rawOrigW = originBounds.maxX - originBounds.minX;
  const rawOrigH = originBounds.maxY - originBounds.minY;
  const safeOrigW = Math.max(1, rawOrigW);
  const safeOrigH = Math.max(1, rawOrigH);
  const targetW = Math.max(4, targetBounds.maxX - targetBounds.minX);
  const targetH = Math.max(4, targetBounds.maxY - targetBounds.minY);
  const scaleX = targetW / safeOrigW;
  const scaleY = targetH / safeOrigH;

  const mapX = (x: number) =>
    rawOrigW < 1
      ? (targetBounds.minX + targetBounds.maxX) / 2
      : targetBounds.minX + ((x - originBounds.minX) / safeOrigW) * targetW;
  const mapY = (y: number) =>
    rawOrigH < 1
      ? (targetBounds.minY + targetBounds.maxY) / 2
      : targetBounds.minY + ((y - originBounds.minY) / safeOrigH) * targetH;

  const avgScale =
    rawOrigW < 1
      ? scaleY
      : rawOrigH < 1
        ? scaleX
        : Math.sqrt(Math.max(0.04, scaleX * scaleY));
  const nextSize = Math.max(1.5, Math.min(512, Number((stroke.size * avgScale).toFixed(2))));

  let nextShape: ShapeGeometry | undefined;
  let nextPoints: StrokePoint[];

  if (stroke.shape) {
    if (stroke.shape.kind === 'line') {
      nextShape = {
        kind: 'line',
        x1: mapX(stroke.shape.x1),
        y1: mapY(stroke.shape.y1),
        x2: mapX(stroke.shape.x2),
        y2: mapY(stroke.shape.y2),
      };
    } else if (stroke.shape.kind === 'rect') {
      const x1 = mapX(stroke.shape.x);
      const y1 = mapY(stroke.shape.y);
      const x2 = mapX(stroke.shape.x + stroke.shape.width);
      const y2 = mapY(stroke.shape.y + stroke.shape.height);
      nextShape = {
        kind: 'rect',
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      };
    } else {
      nextShape = {
        kind: 'circle',
        cx: mapX(stroke.shape.cx),
        cy: mapY(stroke.shape.cy),
        r: Math.max(2, stroke.shape.r * avgScale),
      };
    }
    nextPoints = sampleShapePoints(nextShape, stroke.points[0]?.pressure ?? 0.5);
  } else {
    nextPoints = stroke.points.map((p) => ({
      ...p,
      x: mapX(p.x),
      y: mapY(p.y),
    }));
  }

  return {
    ...stroke,
    size: nextSize,
    points: nextPoints,
    shape: nextShape,
    bounds: computeBoundsFromPoints(nextPoints, nextSize * 0.6, nextShape),
  };
}

/**
 * Rotates a stroke by `angleRad` radians around `(cx, cy)`, returning a fresh Stroke
 * with updated points, optional shape geometry, and recomputed bounding box.
 */
export function rotateStroke(
  stroke: Stroke,
  angleRad: number,
  cx: number,
  cy: number,
): Stroke {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rotatePt = (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  };

  let nextShape: ShapeGeometry | undefined;
  let nextPoints: StrokePoint[];

  if (stroke.shape) {
    if (stroke.shape.kind === 'line') {
      const p1 = rotatePt(stroke.shape.x1, stroke.shape.y1);
      const p2 = rotatePt(stroke.shape.x2, stroke.shape.y2);
      nextShape = {
        kind: 'line',
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
      };
      nextPoints = sampleShapePoints(nextShape, stroke.points[0]?.pressure ?? 0.5);
    } else if (stroke.shape.kind === 'circle') {
      const c = rotatePt(stroke.shape.cx, stroke.shape.cy);
      nextShape = {
        kind: 'circle',
        cx: c.x,
        cy: c.y,
        r: stroke.shape.r,
      };
      nextPoints = sampleShapePoints(nextShape, stroke.points[0]?.pressure ?? 0.5);
    } else {
      const basePts =
        stroke.points.length >= 4
          ? stroke.points
          : sampleShapePoints(stroke.shape, stroke.points[0]?.pressure ?? 0.5);
      nextPoints = basePts.map((pt) => {
        const r = rotatePt(pt.x, pt.y);
        return { ...pt, x: r.x, y: r.y };
      });
      nextShape = undefined;
    }
  } else {
    nextPoints = stroke.points.map((pt) => {
      const r = rotatePt(pt.x, pt.y);
      return { ...pt, x: r.x, y: r.y };
    });
  }

  return {
    ...stroke,
    points: nextPoints,
    shape: nextShape,
    bounds: computeBoundsFromPoints(nextPoints, stroke.size * 0.6, nextShape),
  };
}

/**
 * Mirrors a stroke horizontally (`axis === 'x'`) across `x = cx` or vertically (`axis === 'y'`) across `y = cy`.
 */
export function flipStroke(
  stroke: Stroke,
  axis: 'x' | 'y',
  cx: number,
  cy: number,
): Stroke {
  const flipPt = (x: number, y: number) => ({
    x: axis === 'x' ? 2 * cx - x : x,
    y: axis === 'y' ? 2 * cy - y : y,
  });

  let nextShape: ShapeGeometry | undefined;
  let nextPoints: StrokePoint[];

  if (stroke.shape) {
    if (stroke.shape.kind === 'line') {
      const p1 = flipPt(stroke.shape.x1, stroke.shape.y1);
      const p2 = flipPt(stroke.shape.x2, stroke.shape.y2);
      nextShape = { kind: 'line', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    } else if (stroke.shape.kind === 'circle') {
      const c = flipPt(stroke.shape.cx, stroke.shape.cy);
      nextShape = { kind: 'circle', cx: c.x, cy: c.y, r: stroke.shape.r };
    } else {
      const p1 = flipPt(stroke.shape.x, stroke.shape.y);
      const p2 = flipPt(stroke.shape.x + stroke.shape.width, stroke.shape.y + stroke.shape.height);
      nextShape = {
        kind: 'rect',
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p2.x - p1.x),
        height: Math.abs(p2.y - p1.y),
      };
    }
    nextPoints = sampleShapePoints(nextShape, stroke.points[0]?.pressure ?? 0.5);
  } else {
    nextPoints = stroke.points.map((pt) => {
      const f = flipPt(pt.x, pt.y);
      return { ...pt, x: f.x, y: f.y };
    });
  }

  return {
    ...stroke,
    points: nextPoints,
    shape: nextShape,
    bounds: computeBoundsFromPoints(nextPoints, stroke.size * 0.6, nextShape),
  };
}
