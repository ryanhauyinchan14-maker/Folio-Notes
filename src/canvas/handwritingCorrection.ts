import type { Stroke, StrokePoint } from '../types/notes';
import { createId } from '../utils/id';
import { computeBoundsFromPoints, distance } from './geometry';

function computePathLength(points: StrokePoint[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += distance(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  }
  return len;
}

/**
 * Determines whether an untidied Pen stroke looks like character/word handwriting
 * rather than a large diagram, border, or straight horizontal rule.
 */
export function isHandwritingCandidateStroke(stroke: Stroke): boolean {
  if (stroke.tool !== 'pen' || stroke.shape || stroke.isTidied) return false;
  if (stroke.points.length < 3) return false;

  const width = stroke.bounds.maxX - stroke.bounds.minX;
  const height = stroke.bounds.maxY - stroke.bounds.minY;

  // Reject tall diagrams, frames, or full-page boxes
  if (height > 92) return false;
  // Reject huge wide sketches
  if (width > 380) return false;

  const pathLen = computePathLength(stroke.points);
  if (pathLen < 6) return false;

  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  const endToEnd = distance(first.x, first.y, last.x, last.y);

  // Reject long straight divider lines / underlines
  if (width > 125 && height < 14 && pathLen <= endToEnd * 1.22) {
    return false;
  }

  return true;
}

/**
 * Finds a local horizontal word/line cluster of nearby untidied pen strokes
 * anchored around `seedStrokeId`.
 */
export function findHandwritingCluster(
  strokes: Stroke[],
  seedStrokeId: string,
): Stroke[] {
  const seed = strokes.find((s) => s.id === seedStrokeId);
  if (!seed || !isHandwritingCandidateStroke(seed)) return [];

  const cluster: Stroke[] = [seed];
  const inCluster = new Set<string>([seed.id]);

  let minX = seed.bounds.minX;
  let maxX = seed.bounds.maxX;
  let minY = seed.bounds.minY;
  let maxY = seed.bounds.maxY;

  let expanded = true;
  while (expanded) {
    expanded = false;
    const clusterCenterY = (minY + maxY) / 2;

    for (const candidate of strokes) {
      if (inCluster.has(candidate.id)) continue;
      if (!isHandwritingCandidateStroke(candidate)) continue;

      const candCenterY = (candidate.bounds.minY + candidate.bounds.maxY) / 2;
      const horizGap = Math.max(
        0,
        candidate.bounds.minX - maxX,
        minX - candidate.bounds.maxX,
      );
      const vertDist = Math.abs(candCenterY - clusterCenterY);

      if (horizGap <= 75 && vertDist <= 52) {
        inCluster.add(candidate.id);
        cluster.push(candidate);
        minX = Math.min(minX, candidate.bounds.minX);
        maxX = Math.max(maxX, candidate.bounds.maxX);
        minY = Math.min(minY, candidate.bounds.minY);
        maxY = Math.max(maxY, candidate.bounds.maxY);
        expanded = true;
      }
    }
  }

  const totalHeight = maxY - minY;
  if (totalHeight > 115) return [];

  const totalPathLen = cluster.reduce((sum, s) => sum + computePathLength(s.points), 0);
  const maxPoints = Math.max(...cluster.map((s) => s.points.length));

  if (totalPathLen < 24 || (cluster.length === 1 && maxPoints < 6)) {
    return [];
  }

  return cluster;
}

function fitLinearBaselineAngle(cluster: Stroke[]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const s of cluster) {
    if (s.bounds.minX < minX) minX = s.bounds.minX;
    if (s.bounds.maxX > maxX) maxX = s.bounds.maxX;
    if (s.bounds.minY < minY) minY = s.bounds.minY;
    if (s.bounds.maxY > maxY) maxY = s.bounds.maxY;
  }

  const spanX = maxX - minX;
  if (spanX < 36) return 0;

  const midY = (minY + maxY) / 2;
  const anchorPoints: { x: number; y: number }[] = [];

  if (cluster.length >= 3) {
    // Use lower-envelope points per character stroke (ignoring high dots/accents)
    const ordered = [...cluster].sort(
      (a, b) => (a.bounds.minX + a.bounds.maxX) / 2 - (b.bounds.minX + b.bounds.maxX) / 2,
    );
    for (const s of ordered) {
      const sh = s.bounds.maxY - s.bounds.minY;
      const scy = (s.bounds.minY + s.bounds.maxY) / 2;
      if (sh < 10 && scy < midY) continue;
      anchorPoints.push({
        x: (s.bounds.minX + s.bounds.maxX) / 2,
        y: s.bounds.maxY,
      });
    }
  } else {
    // Bin points across horizontal span and take 85th-percentile Y in each bin
    const binCount = Math.max(4, Math.min(12, Math.floor(spanX / 18)));
    const bins: { xSum: number; ys: number[] }[] = Array.from(
      { length: binCount },
      () => ({ xSum: 0, ys: [] }),
    );
    for (const s of cluster) {
      for (const p of s.points) {
        const idx = Math.min(
          binCount - 1,
          Math.max(0, Math.floor(((p.x - minX) / spanX) * binCount)),
        );
        bins[idx].xSum += p.x;
        bins[idx].ys.push(p.y);
      }
    }
    for (const bin of bins) {
      if (bin.ys.length === 0) continue;
      bin.ys.sort((a, b) => a - b);
      const p85 = bin.ys[Math.min(bin.ys.length - 1, Math.floor(bin.ys.length * 0.85))];
      anchorPoints.push({ x: bin.xSum / bin.ys.length, y: p85 });
    }
  }

  if (anchorPoints.length < 3) return 0;

  let sumX = 0;
  let sumY = 0;
  for (const pt of anchorPoints) {
    sumX += pt.x;
    sumY += pt.y;
  }
  const meanX = sumX / anchorPoints.length;
  const meanY = sumY / anchorPoints.length;

  let num = 0;
  let den = 0;
  for (const pt of anchorPoints) {
    const dx = pt.x - meanX;
    num += dx * (pt.y - meanY);
    den += dx * dx;
  }
  if (den < 100) return 0;

  const slope = num / den;
  const theta = Math.atan(slope);
  const absDeg = Math.abs((theta * 180) / Math.PI);

  // Only straighten noticeable tilt between 1.2° and 22°
  if (absDeg < 1.2 || absDeg > 22) return 0;
  return theta;
}

function decimateJitter(points: StrokePoint[], minStep = 2.4): StrokePoint[] {
  if (points.length <= 3) return points.map((p) => ({ ...p }));
  const kept: StrokePoint[] = [{ ...points[0] }];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = kept[kept.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    const dist = distance(prev.x, prev.y, curr.x, curr.y);

    // Preserve sharp cusps/corners even if spacing is tight
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    const dot = l1 > 0.5 && l2 > 0.5 ? (v1x * v2x + v1y * v2y) / (l1 * l2) : 1;

    if (dist >= minStep || dot < 0.45) {
      kept.push({ ...curr });
    }
  }

  kept.push({ ...points[points.length - 1] });
  return kept;
}

function smoothChaikin(points: StrokePoint[], passes = 2): StrokePoint[] {
  let current = points;
  for (let pass = 0; pass < passes; pass++) {
    if (current.length < 3) break;
    const next: StrokePoint[] = [{ ...current[0] }];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i];
      const b = current[i + 1];
      if (i > 0) {
        next.push({
          x: 0.75 * a.x + 0.25 * b.x,
          y: 0.75 * a.y + 0.25 * b.y,
          pressure: 0.75 * a.pressure + 0.25 * b.pressure,
          t: a.t,
        });
      }
      if (i < current.length - 2) {
        next.push({
          x: 0.25 * a.x + 0.75 * b.x,
          y: 0.25 * a.y + 0.75 * b.y,
          pressure: 0.25 * a.pressure + 0.75 * b.pressure,
          t: b.t,
        });
      }
    }
    next.push({ ...current[current.length - 1] });
    current = next;
  }
  return current;
}

function normalizePressures(points: StrokePoint[]): StrokePoint[] {
  const n = points.length;
  return points.map((p, idx) => {
    const edgeFactor =
      idx === 0 || idx === n - 1 ? 0.42 : idx === 1 || idx === n - 2 ? 0.49 : 0.55;
    return {
      ...p,
      pressure: edgeFactor,
    };
  });
}

/**
 * Applies baseline slant straightening, micro-tremor Chaikin smoothing,
 * and normalized ink pressure across a handwriting stroke cluster.
 */
export function tidyHandwritingCluster(cluster: Stroke[]): Stroke[] {
  if (cluster.length === 0) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of cluster) {
    if (s.bounds.minX < minX) minX = s.bounds.minX;
    if (s.bounds.maxX > maxX) maxX = s.bounds.maxX;
    if (s.bounds.minY < minY) minY = s.bounds.minY;
    if (s.bounds.maxY > maxY) maxY = s.bounds.maxY;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const theta = fitLinearBaselineAngle(cluster);
  const cosT = Math.cos(-theta);
  const sinT = Math.sin(-theta);

  // Rotate all strokes around cluster centroid by -theta to level the baseline
  const rotatedList = cluster.map((stroke) => {
    const rotatedPts = stroke.points.map((p) => {
      if (theta === 0) return { ...p };
      const dx = p.x - cx;
      const dy = p.y - cy;
      return {
        ...p,
        x: cx + dx * cosT - dy * sinT,
        y: cy + dx * sinT + dy * cosT,
      };
    });
    return {
      stroke,
      points: rotatedPts,
      bounds: computeBoundsFromPoints(rotatedPts, stroke.size * 0.6),
    };
  });

  // Gentle baseline alignment for detached character strokes when >= 3 strokes exist
  if (rotatedList.length >= 3) {
    const fullBaselines = rotatedList
      .filter((item) => item.bounds.maxY - item.bounds.minY >= 12)
      .map((item) => item.bounds.maxY)
      .sort((a, b) => a - b);

    if (fullBaselines.length >= 2) {
      const medianBaseline = fullBaselines[Math.floor(fullBaselines.length / 2)];
      for (const item of rotatedList) {
        const h = item.bounds.maxY - item.bounds.minY;
        const deltaY = medianBaseline - item.bounds.maxY;
        // Skip dots/crossbars & keep intentional deep descenders intact while nudging small drift
        if (h >= 12 && Math.abs(deltaY) >= 2 && Math.abs(deltaY) <= 18) {
          const shift = deltaY * 0.6;
          item.points = item.points.map((p) => ({ ...p, y: p.y + shift }));
        }
      }
    }
  }

  return rotatedList.map(({ stroke, points }) => {
    const decimated = decimateJitter(points, 2.4);
    const smoothed = smoothChaikin(decimated, 2);
    const normalized = normalizePressures(smoothed);
    return {
      ...stroke,
      id: createId(),
      points: normalized,
      simulatePressure: false,
      isTidied: true,
      bounds: computeBoundsFromPoints(normalized, stroke.size * 0.6),
    };
  });
}
