import type { ShapeGeometry, StrokePoint } from '../types/notes';
import { distance, pointToSegmentDistance } from './geometry';

function computePolygonArea(points: StrokePoint[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(area) / 2;
}

/**
 * Classifies a user's drawn stroke held steady into one of:
 * - Line (straight segment, snapping within 5 deg of horizontal/vertical)
 * - Circle (closed round loop)
 * - Rectangle (closed 4-sided box)
 * Returns null if the stroke looks like handwriting or an unrecognized scribble.
 */
export function recognizeShape(points: StrokePoint[]): ShapeGeometry | null {
  if (points.length < 6) return null;

  const first = points[0];
  const last = points[points.length - 1];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let totalLength = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (i > 0) {
      totalLength += distance(points[i - 1].x, points[i - 1].y, p.x, p.y);
    }
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const maxDim = Math.max(width, height);
  const minDim = Math.min(width, height);

  if (totalLength < 24) return null;

  // 1. Check Straight Line first
  const endToEnd = distance(first.x, first.y, last.x, last.y);
  if (endToEnd >= 24 && totalLength <= endToEnd * 1.22) {
    let maxPerp = 0;
    for (const p of points) {
      const d = pointToSegmentDistance(p.x, p.y, first.x, first.y, last.x, last.y);
      if (d > maxPerp) maxPerp = d;
    }

    if (maxPerp <= Math.max(9, endToEnd * 0.085)) {
      let x2 = last.x;
      let y2 = last.y;
      const dx = x2 - first.x;
      const dy = y2 - first.y;
      const angleDeg = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
      if (angleDeg < 5) {
        y2 = first.y;
      } else if (angleDeg > 85) {
        x2 = first.x;
      }
      return {
        kind: 'line',
        x1: first.x,
        y1: first.y,
        x2,
        y2,
      };
    }
  }

  // Must be sufficiently closed and non-degenerate to be a Circle or Rectangle
  if (maxDim < 22 || minDim < 14) return null;
  const closureThreshold = Math.max(32, maxDim * 0.45);
  if (endToEnd > closureThreshold) return null;

  // Resample by arc length? Computing metrics directly weighted or over uniform segments gives clean stats.
  // Compute centroid via bounding-box center vs point centroid:
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / points.length;
  const cy = sumY / points.length;

  // Compute radial stats around centroid
  const radii = points.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const meanR = radii.reduce((acc, r) => acc + r, 0) / radii.length;
  if (meanR < 10) return null;

  const meanAbsRadialErr =
    radii.reduce((acc, r) => acc + Math.abs(r - meanR), 0) / radii.length / meanR;

  // Compute bounding box edge fit error (normalized by half-minDim)
  let sumEdgeErr = 0;
  let leftHits = 0;
  let rightHits = 0;
  let topHits = 0;
  let bottomHits = 0;
  const edgeThreshold = Math.max(8, minDim * 0.22);

  for (const p of points) {
    const dLeft = Math.abs(p.x - minX);
    const dRight = Math.abs(p.x - maxX);
    const dTop = Math.abs(p.y - minY);
    const dBottom = Math.abs(p.y - maxY);
    const dMin = Math.min(dLeft, dRight, dTop, dBottom);
    sumEdgeErr += dMin;

    if (dLeft <= edgeThreshold) leftHits++;
    if (dRight <= edgeThreshold) rightHits++;
    if (dTop <= edgeThreshold) topHits++;
    if (dBottom <= edgeThreshold) bottomHits++;
  }

  const normalizedBoxEdgeErr = sumEdgeErr / points.length / (minDim * 0.5);
  const minEdgeHits = Math.max(1, Math.floor(points.length * 0.06));
  const hasAllFourSides =
    leftHits >= minEdgeHits &&
    rightHits >= minEdgeHits &&
    topHits >= minEdgeHits &&
    bottomHits >= minEdgeHits;

  // Polygon area ratio vs bounding box area (Circle ≈ 0.785, Rectangle ≈ 1.0)
  const polyArea = computePolygonArea(points);
  const boxArea = width * height;
  const areaRatio = boxArea > 0 ? polyArea / boxArea : 0;

  // Angular sweep check to avoid classifying open arcs as circles
  const angles = points.map((p) => Math.atan2(p.y - cy, p.x - cx)).sort((a, b) => a - b);
  let maxAngularGap = angles[0] + Math.PI * 2 - angles[angles.length - 1];
  for (let i = 1; i < angles.length; i++) {
    const gap = angles[i] - angles[i - 1];
    if (gap > maxAngularGap) maxAngularGap = gap;
  }
  const angularCoverage = Math.PI * 2 - maxAngularGap;

  const aspectRatio = minDim / maxDim;

  // Evaluate Circle vs Rectangle cleanly:
  // A hand-drawn square has radial err ~0.095-0.125 and box edge err ~0.03-0.08 with areaRatio ~0.88-1.0.
  // A hand-drawn circle has radial err ~0.02-0.08 and box edge err ~0.12-0.25 with areaRatio ~0.72-0.84.
  const isCircleCandidate =
    aspectRatio >= 0.72 &&
    angularCoverage >= Math.PI * 1.4 &&
    meanAbsRadialErr <= 0.145 &&
    totalLength <= Math.PI * 2 * meanR * 1.35;

  const isRectCandidate =
    hasAllFourSides &&
    normalizedBoxEdgeErr <= 0.24 &&
    areaRatio >= 0.72 &&
    totalLength <= 2 * (width + height) * 1.3;

  if (isCircleCandidate && isRectCandidate) {
    // Disambiguate square vs circle by comparing fit errors + areaRatio closeness to 0.785 vs 1.0
    const circleScore = meanAbsRadialErr + Math.abs(areaRatio - Math.PI / 4) * 0.35;
    const rectScore = normalizedBoxEdgeErr * 0.75 + Math.abs(areaRatio - 0.96) * 0.35;
    if (rectScore < circleScore) {
      return { kind: 'rect', x: minX, y: minY, width, height };
    }
    return {
      kind: 'circle',
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      r: (width + height) / 4,
    };
  }

  if (isCircleCandidate) {
    return {
      kind: 'circle',
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      r: (width + height) / 4,
    };
  }

  if (isRectCandidate) {
    return {
      kind: 'rect',
      x: minX,
      y: minY,
      width,
      height,
    };
  }

  return null;
}
