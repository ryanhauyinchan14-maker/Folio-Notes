import { describe, expect, it } from 'vitest';
import type { Stroke, StrokePoint } from '../../types/notes';
import { computeBoundsFromPoints } from '../geometry';
import {
  expandClusterWithAdjacentUntidiedStrokes,
  findHandwritingCluster,
  isHandwritingAccessoryStroke,
  isHandwritingCandidateStroke,
  isHandwritingClusterReady,
  isNewHandwritingWordStart,
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

  it('accepts large tall handwriting, quick 2-point strokes, and scaled accessories/exponents', () => {
    // Large 135px tall cursive letter like "Hello" / "very" with rich sample points
    const tallPts: StrokePoint[] = Array.from({ length: 14 }, (_, idx) => ({
      x: 120 + Math.sin(idx * 0.5) * 28 + idx * 3,
      y: 100 + idx * (135 / 13),
      pressure: 0.5,
    }));
    const largeLetter = makeStroke('tall-h', tallPts);
    expect(isHandwritingCandidateStroke(largeLetter)).toBe(true);
    expect(findHandwritingCluster([largeLetter], 'tall-h')).toHaveLength(1);
    expect(isHandwritingClusterReady([largeLetter])).toBe(true);

    // Quick 2-point mouse strokes like '=' bars or '1'
    const eqTop = makeStroke('eq-1', [
      { x: 200, y: 150, pressure: 0.5 },
      { x: 224, y: 150, pressure: 0.5 },
    ]);
    const eqBot = makeStroke('eq-2', [
      { x: 200, y: 164, pressure: 0.5 },
      { x: 224, y: 164, pressure: 0.5 },
    ]);
    expect(isHandwritingCandidateStroke(eqTop)).toBe(true);
    expect(isHandwritingClusterReady([eqTop, eqBot])).toBe(true);

    // Large word bounds should treat a t-crossbar or exponent '²' as an accessory (not a new word break)
    const activeWordBounds = { minX: 120, minY: 110, maxX: 340, maxY: 235 };
    const largeTBar = makeStroke('t-bar', [
      { x: 135, y: 135, pressure: 0.5 },
      { x: 185, y: 135, pressure: 0.5 },
    ]);
    const raisedExponent = makeStroke('exp-2', [
      { x: 350, y: 85, pressure: 0.5 },
      { x: 372, y: 84, pressure: 0.5 },
      { x: 352, y: 115, pressure: 0.5 },
      { x: 376, y: 115, pressure: 0.5 },
    ]);
    expect(isHandwritingAccessoryStroke(largeTBar, activeWordBounds)).toBe(true);
    expect(isHandwritingAccessoryStroke(raisedExponent, activeWordBounds)).toBe(true);

    // Dropping down onto the next notebook line MUST start a new line cluster immediately
    expect(isNewHandwritingWordStart(activeWordBounds, { x: 140, y: 315 })).toBe(true);
  });

  it('sweeps adjacent recently-drawn untidied strokes into the active flush while skipping old, in-flight, or other-line strokes', () => {
    const now = 1_700_000_000_000;
    const seed = {
      ...makeStroke('seed-00x', [
        { x: 240, y: 120, pressure: 0.5 },
        { x: 265, y: 165, pressure: 0.5 },
        { x: 285, y: 125, pressure: 0.5 },
      ]),
      createdAt: now - 1000,
    };
    const strandedLeft = {
      ...makeStroke('stranded-5', [
        { x: 185, y: 118, pressure: 0.5 },
        { x: 185, y: 142, pressure: 0.5 },
        { x: 205, y: 162, pressure: 0.5 },
      ]),
      createdAt: now - 2500,
    };
    const farLeft = {
      ...makeStroke('far-y', [
        { x: 125, y: 120, pressure: 0.5 },
        { x: 145, y: 165, pressure: 0.5 },
      ]),
      createdAt: now - 4000,
    };
    const alreadyTidied = {
      ...makeStroke('tidied', [
        { x: 300, y: 125, pressure: 0.5 },
        { x: 325, y: 160, pressure: 0.5 },
      ]),
      isTidied: true,
      createdAt: now - 500,
    };
    const inFlight = {
      ...makeStroke('inflight', [
        { x: 305, y: 125, pressure: 0.5 },
        { x: 325, y: 160, pressure: 0.5 },
      ]),
      createdAt: now - 500,
    };
    const oldDoodle = {
      ...makeStroke('old-stroke', [
        { x: 295, y: 125, pressure: 0.5 },
        { x: 320, y: 160, pressure: 0.5 },
      ]),
      createdAt: now - 120_000,
    };
    const nextLine = {
      ...makeStroke('next-line', [
        { x: 200, y: 265, pressure: 0.5 },
        { x: 240, y: 310, pressure: 0.5 },
      ]),
      createdAt: now - 1000,
    };

    const expanded = expandClusterWithAdjacentUntidiedStrokes(
      [seed],
      [farLeft, strandedLeft, seed, alreadyTidied, inFlight, oldDoodle, nextLine],
      new Set(['inflight']),
      now,
      45_000,
    );
    expect(expanded.map((s) => s.id)).toEqual(['far-y', 'stranded-5', 'seed-00x']);
  });
});
