import { describe, expect, it } from 'vitest';
import { eraseStrokesPrecisionSegment } from '../eraser';
import { doesEraserHitStroke, getCombinedBounds, getStrokesInLasso } from '../geometry';
import {
  isHandwritingAccessoryStroke,
  isHandwritingCandidateStroke,
} from '../handwritingCorrection';
import { getFreehandStrokeOutline } from '../strokeRenderer';
import { textToHandwritingStrokes } from '../vectorHandwritingFont';

describe('vectorHandwritingFont stroke synthesis & native drawing compatibility', () => {
  it('converts all ASCII letters, digits, punctuation, math symbols, accented Latin, and multi-line text into valid pen Stroke[] drawings', () => {
    const sample =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789 .,;:!?\'"`-_+=*×÷/\\()[]{}<>≤≥≈≠±^%&@#$~|°√π∞∂∑∫θαβγδΔΩ→←↔ éñü';
    const strokes = textToHandwritingStrokes({
      text: sample,
      bounds: { minX: 100, minY: 120, maxX: 500, maxY: 240 },
      color: '#072D59',
      strokeSize: 3.2,
      groupId: 'grp-full',
      createdAt: 123456,
    });

    expect(strokes.length).toBeGreaterThan(80);
    for (const s of strokes) {
      expect(s.tool).toBe('pen');
      expect(s.isTidied).toBe(true);
      expect(s.color).toBe('#072D59');
      expect(s.groupId).toBe('grp-full');
      expect(s.opacity).toBe(1);
      expect(s.simulatePressure).toBe(false);
      expect(s.points.length).toBeGreaterThanOrEqual(2);
      expect(Number.isFinite(s.bounds.minX)).toBe(true);
      expect(Number.isFinite(s.bounds.maxY)).toBe(true);
      for (const pt of s.points) {
        expect(Number.isFinite(pt.x)).toBe(true);
        expect(Number.isFinite(pt.y)).toBe(true);
        expect(Number.isFinite(pt.pressure)).toBe(true);
      }
      // Synthesized ink must NOT re-trigger live OCR loops
      expect(isHandwritingCandidateStroke(s)).toBe(false);
      expect(isHandwritingAccessoryStroke(s, s.bounds)).toBe(false);
    }
  });

  it('keeps x-height-only words vertically aligned to source bounds and renders closed dot loops', () => {
    const catStrokes = textToHandwritingStrokes({
      text: 'cat',
      bounds: { minX: 100, minY: 200, maxX: 220, maxY: 235 },
      color: '#1E293B',
      strokeSize: 3,
    });
    const combined = getCombinedBounds(catStrokes)!;
    expect(combined).not.toBeNull();
    // Aligned near top/bottom of source bounds rather than floating or shrinking
    expect(combined.minY).toBeLessThan(215);
    expect(combined.maxY).toBeGreaterThan(228);

    const dotStrokes = textToHandwritingStrokes({
      text: 'i.!',
      bounds: { minX: 100, minY: 100, maxX: 160, maxY: 140 },
      color: '#1E293B',
      strokeSize: 3,
    });
    const smallDotStrokes = dotStrokes.filter((s) => s.points.length === 7);
    expect(smallDotStrokes.length).toBe(3);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(
      textToHandwritingStrokes({
        text: '   \n\t  ',
        bounds: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
        color: '#072D59',
        strokeSize: 3,
      }),
    ).toEqual([]);
  });

  it('supports Precision Eraser, Stroke Eraser, and Lasso Selection natively on synthesized strokes', () => {
    const strokes = textToHandwritingStrokes({
      text: 'Hi',
      bounds: { minX: 100, minY: 100, maxX: 200, maxY: 148 },
      color: '#2563EB',
      strokeSize: 3.5,
      groupId: 'grp-hi',
    });
    const bounds = getCombinedBounds(strokes)!;
    const midY = (bounds.minY + bounds.maxY) / 2;

    // 1. Stroke eraser detects intersection
    const hitCount = strokes.filter((s) =>
      doesEraserHitStroke(bounds.minX - 5, midY, bounds.maxX + 5, midY, 12, s),
    ).length;
    expect(hitCount).toBeGreaterThan(0);

    // 2. Precision eraser carves/modifies strokes cleanly
    const precisionRes = eraseStrokesPrecisionSegment(
      strokes,
      bounds.minX - 5,
      midY,
      bounds.maxX + 5,
      midY,
      10,
    );
    expect(precisionRes.changed).toBe(true);

    // 3. Lasso captures all strokes inside polygon
    const lasso = [
      { x: bounds.minX - 15, y: bounds.minY - 15 },
      { x: bounds.maxX + 15, y: bounds.minY - 15 },
      { x: bounds.maxX + 15, y: bounds.maxY + 15 },
      { x: bounds.minX - 15, y: bounds.maxY + 15 },
    ];
    const lassoed = getStrokesInLasso(lasso, strokes);
    expect(lassoed.length).toBe(strokes.length);
  });

  it('renders exponents and superscripts as genuine raised scaled digits rather than ^2 carets', () => {
    const caretExpr = textToHandwritingStrokes({
      text: 'y = 500x^2 + 200x - 20',
      bounds: { minX: 100, minY: 200, maxX: 520, maxY: 260 },
      color: '#072D59',
      strokeSize: 3.2,
    });
    const unicodeExpr = textToHandwritingStrokes({
      text: 'y = 500x² + 200x - 20',
      bounds: { minX: 100, minY: 200, maxX: 520, maxY: 260 },
      color: '#072D59',
      strokeSize: 3.2,
    });

    expect(caretExpr.length).toBe(unicodeExpr.length);
    const caretBounds = getCombinedBounds(caretExpr)!;
    const unicodeBounds = getCombinedBounds(unicodeExpr)!;
    expect(caretBounds.minX).toBeCloseTo(unicodeBounds.minX, 1);
    expect(caretBounds.maxX).toBeCloseTo(unicodeBounds.maxX, 1);
    expect(caretBounds.minY).toBeCloseTo(unicodeBounds.minY, 1);
    expect(caretBounds.maxY).toBeCloseTo(unicodeBounds.maxY, 1);

    // Compare x vs x² to confirm the superscript `2` sits higher and smaller than base `x`
    const xOnly = textToHandwritingStrokes({
      text: 'x',
      bounds: { minX: 100, minY: 200, maxX: 150, maxY: 260 },
      color: '#072D59',
      strokeSize: 3.2,
    });
    const xSquared = textToHandwritingStrokes({
      text: 'x^2',
      bounds: { minX: 100, minY: 200, maxX: 180, maxY: 260 },
      color: '#072D59',
      strokeSize: 3.2,
    });
    expect(xSquared.length).toBe(xOnly.length + 2); // '2' has 2 strokes, NO '^' stroke added
    const supStrokes = xSquared.slice(xOnly.length);
    const supBounds = getCombinedBounds(supStrokes)!;
    const baseBounds = getCombinedBounds(xSquared.slice(0, xOnly.length))!;
    expect(supBounds.minY).toBeLessThan(baseBounds.minY);
    expect(supBounds.maxY - supBounds.minY).toBeLessThan(
      (baseBounds.maxY - baseBounds.minY) * 1.15,
    );
  });

  it('supports grouped superscripts/subscripts, LaTeX math symbols, large handwriting scale, and untapered tidied outlines', () => {
    const complex = textToHandwritingStrokes({
      text: '$e^{-x} + H_2O + 2\\pi r$',
      bounds: { minX: 80, minY: 100, maxX: 460, maxY: 165 },
      color: '#072D59',
      strokeSize: 3.2,
    });
    expect(complex.length).toBeGreaterThan(10);

    // snake_case keeps its underscore intact
    const snake = textToHandwritingStrokes({
      text: 'foo_bar',
      bounds: { minX: 80, minY: 100, maxX: 280, maxY: 150 },
      color: '#072D59',
      strokeSize: 3.2,
    });
    const fooOnly = textToHandwritingStrokes({
      text: 'foobar',
      bounds: { minX: 80, minY: 100, maxX: 280, maxY: 150 },
      color: '#072D59',
      strokeSize: 3.2,
    });
    expect(snake.length).toBe(fooOnly.length + 1);

    // Large 130px handwriting preserves tall scale instead of shrinking to 68px
    const largeWord = textToHandwritingStrokes({
      text: 'Hello',
      bounds: { minX: 100, minY: 100, maxX: 420, maxY: 230 },
      color: '#072D59',
      strokeSize: 5,
    });
    const largeBounds = getCombinedBounds(largeWord)!;
    expect(largeBounds.maxY - largeBounds.minY).toBeGreaterThan(95);

    // Tidied freehand outlines render cleanly without zero-width bowties
    const tidiedOutline = getFreehandStrokeOutline(
      largeWord[0].points,
      'pen',
      largeWord[0].size,
      false,
      true,
      true,
    );
    expect(tidiedOutline.length).toBeGreaterThan(6);
  });
});
