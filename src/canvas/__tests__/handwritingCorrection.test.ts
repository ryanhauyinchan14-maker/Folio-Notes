import { describe, expect, it } from 'vitest';
import type { Stroke, StrokePoint } from '../../types/notes';
import { computeBoundsFromPoints } from '../geometry';
import {
  findHandwritingCluster,
  tidyHandwritingCluster,
} from '../handwritingCorrection';

function makeStroke(id: string, points: StrokePoint[], color = '#1E293B'): Stroke {
  return {
    id,
    tool: 'pen',
    color,
    size: 4,
    opacity: 1,
    simulatePressure: true,
    points,
    bounds: computeBoundsFromPoints(points, 2.4),
    createdAt: Date.now(),
  };
}

function linearSlope(strokes: Stroke[]): number {
  const pts = strokes.map((s) => ({
    x: (s.bounds.minX + s.bounds.maxX) / 2,
    y: s.bounds.maxY,
  }));
  const mx = pts.reduce((a, b) => a + b.x, 0) / pts.length;
  const my = pts.reduce((a, b) => a + b.y, 0) / pts.length;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return num / den;
}

describe('handwritingCorrection', () => {
  it('clusters tilted cursive/character strokes while rejecting large diagrams & dividers', () => {
    // 4 small slanted handwritten letter strokes climbing ~11 deg
    const s1 = makeStroke('l1', [
      { x: 100, y: 240, pressure: 0.2 },
      { x: 105, y: 210, pressure: 0.7 },
      { x: 112, y: 242, pressure: 0.3 },
      { x: 120, y: 238, pressure: 0.6 },
    ]);
    const s2 = makeStroke('l2', [
      { x: 132, y: 234, pressure: 0.8 },
      { x: 140, y: 215, pressure: 0.3 },
      { x: 148, y: 232, pressure: 0.9 },
      { x: 154, y: 229, pressure: 0.4 },
    ]);
    const s3 = makeStroke('l3', [
      { x: 168, y: 225, pressure: 0.2 },
      { x: 174, y: 196, pressure: 0.8 },
      { x: 180, y: 223, pressure: 0.5 },
      { x: 188, y: 221, pressure: 0.6 },
    ]);
    const s4 = makeStroke('l4', [
      { x: 202, y: 218, pressure: 0.9 },
      { x: 210, y: 200, pressure: 0.3 },
      { x: 218, y: 215, pressure: 0.6 },
      { x: 224, y: 213, pressure: 0.4 },
    ]);

    // Large diagram stroke (height 160px) should NOT be clustered
    const bigDiagram = makeStroke('big', [
      { x: 400, y: 100, pressure: 0.5 },
      { x: 520, y: 100, pressure: 0.5 },
      { x: 520, y: 260, pressure: 0.5 },
      { x: 400, y: 260, pressure: 0.5 },
    ]);

    // Long straight divider rule should NOT be detected as handwriting
    const divider = makeStroke('div', [
      { x: 80, y: 340, pressure: 0.5 },
      { x: 260, y: 342, pressure: 0.5 },
      { x: 440, y: 341, pressure: 0.5 },
    ]);

    expect(findHandwritingCluster([s1, s2, s3, s4, bigDiagram, divider], 'big')).toEqual([]);
    expect(findHandwritingCluster([s1, s2, s3, s4, bigDiagram, divider], 'div')).toEqual([]);

    const cluster = findHandwritingCluster([s1, s2, s3, s4, bigDiagram, divider], 'l4');
    expect(cluster.map((s) => s.id)).toContain('l1');
    expect(cluster).toHaveLength(4);

    const rawSlope = Math.abs(linearSlope(cluster));
    expect(rawSlope).toBeGreaterThan(0.15);

    const tidied = tidyHandwritingCluster(cluster);
    expect(tidied).toHaveLength(4);
    expect(tidied.every((s) => s.isTidied === true && s.simulatePressure === false)).toBe(true);
    expect(tidied.every((s) => s.color === '#1E293B')).toBe(true);

    // Baseline slope is significantly leveled after tidying
    const tidySlope = Math.abs(linearSlope(tidied));
    expect(tidySlope).toBeLessThan(rawSlope * 0.35);
  });
});
