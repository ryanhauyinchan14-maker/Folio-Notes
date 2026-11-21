import { describe, expect, it } from 'vitest';
import type { Stroke } from '../../types/notes';
import {
  computeBoundsFromPoints,
  doesEraserHitStroke,
  getStrokesInLasso,
  sampleShapePoints,
  translateStroke,
} from '../geometry';

function createTestStroke(id: string, x1: number, y1: number, x2: number, y2: number): Stroke {
  const shape = { kind: 'line' as const, x1, y1, x2, y2 };
  const points = sampleShapePoints(shape);
  return {
    id,
    tool: 'pen',
    color: '#1E293B',
    size: 4,
    opacity: 1,
    simulatePressure: false,
    points,
    shape,
    bounds: computeBoundsFromPoints(points, 3, shape),
    createdAt: 1,
  };
}

describe('geometry hit-testing & transforms', () => {
  it('detects stroke eraser intersection against freehand & shaped strokes', () => {
    const lineStroke = createTestStroke('s1', 100, 100, 300, 100);
    expect(doesEraserHitStroke(200, 90, 200, 110, 12, lineStroke)).toBe(true);
    expect(doesEraserHitStroke(200, 140, 220, 160, 10, lineStroke)).toBe(false);
  });

  it('selects strokes captured inside a lasso polygon', () => {
    const insideStroke = createTestStroke('inside', 120, 120, 180, 160);
    const outsideStroke = createTestStroke('outside', 420, 420, 500, 460);
    const lasso = [
      { x: 90, y: 90 },
      { x: 220, y: 90 },
      { x: 220, y: 200 },
      { x: 90, y: 200 },
    ];

    const selected = getStrokesInLasso(lasso, [insideStroke, outsideStroke]);
    expect(selected).toEqual(['inside']);
  });

  it('translates points, shape geometry, and bounding box cleanly', () => {
    const stroke = createTestStroke('s2', 50, 60, 150, 60);
    const moved = translateStroke(stroke, 25, -10);
    expect(moved.shape).toEqual({
      kind: 'line',
      x1: 75,
      y1: 50,
      x2: 175,
      y2: 50,
    });
    expect(moved.bounds.minX).toBe(stroke.bounds.minX + 25);
    expect(moved.bounds.minY).toBe(stroke.bounds.minY - 10);
  });
});
