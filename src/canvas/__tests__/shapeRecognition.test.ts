import { describe, expect, it } from 'vitest';
import type { StrokePoint } from '../../types/notes';
import { recognizeShape } from '../shapeRecognition';

function makeLine(x1: number, y1: number, x2: number, y2: number, count = 20): StrokePoint[] {
  const pts: StrokePoint[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    pts.push({
      x: x1 + (x2 - x1) * t,
      y: y1 + (y2 - y1) * t + Math.sin(t * Math.PI) * 1.2,
      pressure: 0.5,
    });
  }
  return pts;
}

function makeCircle(cx: number, cy: number, r: number, count = 48): StrokePoint[] {
  const pts: StrokePoint[] = [];
  for (let i = 0; i <= count; i++) {
    const a = (i / count) * Math.PI * 2;
    pts.push({
      x: cx + Math.cos(a) * r + Math.sin(a * 3) * 1.5,
      y: cy + Math.sin(a) * r + Math.cos(a * 2) * 1.5,
      pressure: 0.5,
    });
  }
  return pts;
}

function makeRect(x: number, y: number, w: number, h: number, perSide = 10): StrokePoint[] {
  const pts: StrokePoint[] = [];
  for (let i = 0; i < perSide; i++) {
    pts.push({ x: x + (w * i) / perSide, y, pressure: 0.5 });
  }
  for (let i = 0; i < perSide; i++) {
    pts.push({ x: x + w, y: y + (h * i) / perSide, pressure: 0.5 });
  }
  for (let i = 0; i < perSide; i++) {
    pts.push({ x: x + w - (w * i) / perSide, y: y + h, pressure: 0.5 });
  }
  for (let i = 0; i <= perSide; i++) {
    pts.push({ x, y: y + h - (h * i) / perSide, pressure: 0.5 });
  }
  return pts;
}

describe('recognizeShape (Hold-to-Snap)', () => {
  it('recognizes a straight diagonal line', () => {
    const res = recognizeShape(makeLine(100, 100, 340, 260));
    expect(res?.kind).toBe('line');
  });

  it('snaps near-horizontal lines to exact horizontal', () => {
    const res = recognizeShape(makeLine(100, 200, 350, 206));
    expect(res).toEqual({
      kind: 'line',
      x1: 100,
      y1: 200,
      x2: 350,
      y2: 200,
    });
  });

  it('recognizes a hand-drawn circle', () => {
    const res = recognizeShape(makeCircle(250, 250, 70));
    expect(res?.kind).toBe('circle');
    if (res?.kind === 'circle') {
      expect(Math.abs(res.cx - 250)).toBeLessThanOrEqual(2);
      expect(Math.abs(res.cy - 250)).toBeLessThanOrEqual(2);
      expect(Math.abs(res.r - 70)).toBeLessThanOrEqual(2);
    }
  });

  it('recognizes a rectangle and distinguishes a square from a circle', () => {
    const rectRes = recognizeShape(makeRect(100, 120, 220, 110));
    expect(rectRes?.kind).toBe('rect');

    const squareRes = recognizeShape(makeRect(100, 100, 140, 140));
    expect(squareRes?.kind).toBe('rect');
  });

  it('rejects open wavy handwriting strokes', () => {
    const wavy: StrokePoint[] = [];
    for (let i = 0; i < 30; i++) {
      wavy.push({
        x: 50 + i * 8,
        y: 120 + Math.sin(i * 0.9) * 28,
        pressure: 0.5,
      });
    }
    expect(recognizeShape(wavy)).toBeNull();
  });
});
