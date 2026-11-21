import { describe, expect, it, vi } from 'vitest';
import type { Textbox } from '../../types/notes';
import {
  drawCommittedTextbox,
  hitTestTextbox,
  measureTextboxLayout,
} from '../textLayout';

function createMockMeasureCtx(): CanvasRenderingContext2D {
  const metricsByText: Record<string, Partial<TextMetrics>> = {
    Hg: {
      width: 30,
      fontBoundingBoxAscent: 21,
      fontBoundingBoxDescent: 6,
      actualBoundingBoxAscent: 18,
      actualBoundingBoxDescent: 5,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 30,
    },
    eo: {
      width: 26,
      fontBoundingBoxAscent: 21,
      fontBoundingBoxDescent: 6,
      actualBoundingBoxAscent: 12.2,
      actualBoundingBoxDescent: 0.4,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 25.6,
    },
    hello: {
      width: 52,
      fontBoundingBoxAscent: 21,
      fontBoundingBoxDescent: 6,
      actualBoundingBoxAscent: 17.5,
      actualBoundingBoxDescent: 0.4,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 51.2,
    },
    gyp: {
      width: 38,
      fontBoundingBoxAscent: 21,
      fontBoundingBoxDescent: 6,
      actualBoundingBoxAscent: 12.4,
      actualBoundingBoxDescent: 5.5,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 37.5,
    },
  };

  return {
    font: '',
    textBaseline: 'alphabetic',
    textAlign: 'left',
    fillStyle: '#000',
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    measureText: (txt: string) =>
      ({
        width: txt.length * 10,
        fontBoundingBoxAscent: 21,
        fontBoundingBoxDescent: 6,
        actualBoundingBoxAscent: 14,
        actualBoundingBoxDescent: 0.4,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: txt.length * 10,
        ...(metricsByText[txt] ?? {}),
      }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D;
}

describe('textLayout (airtight glyph TextMetrics bounds)', () => {
  it('computes zero-whitespace airtight height from actualBoundingBoxAscent/Descent', () => {
    const ctx = createMockMeasureCtx();

    const eoLayout = measureTextboxLayout(
      { text: 'eo', fontFamily: 'sans', fontSize: 24, bold: false, italic: false },
      ctx,
    );
    expect(eoLayout.height).toBeCloseTo(12.6, 2);
    expect(eoLayout.width).toBeCloseTo(26, 2);
    // Negative domMarginTop lifts textarea so CSS baseline matches Canvas actualAscent
    expect(eoLayout.domMarginTop).toBeCloseTo(12.2 - 21, 2);

    const helloLayout = measureTextboxLayout(
      { text: 'hello', fontFamily: 'sans', fontSize: 24, bold: false, italic: false },
      ctx,
    );
    expect(helloLayout.height).toBeCloseTo(17.9, 2);
    expect(helloLayout.height).toBeLessThan(21 + 6);

    const descenderLayout = measureTextboxLayout(
      { text: 'gyp', fontFamily: 'sans', fontSize: 24, bold: false, italic: false },
      ctx,
    );
    expect(descenderLayout.height).toBeCloseTo(17.9, 2);
  });

  it('draws committed textboxes directly at the airtight baseline and hit-tests cleanly', () => {
    const ctx = createMockMeasureCtx();
    const tb: Textbox = {
      id: 'tb-1',
      x: 100,
      y: 200,
      text: 'hello',
      fontFamily: 'sans',
      fontSize: 24,
      bold: false,
      italic: false,
      color: '#1E293B',
      createdAt: 1,
      updatedAt: 1,
    };

    drawCommittedTextbox(ctx, tb);
    expect(ctx.fillText).toHaveBeenCalledWith('hello', 100, 217.5);

    expect(hitTestTextbox(110, 205, [tb])?.id).toBe('tb-1');
    expect(hitTestTextbox(300, 300, [tb])).toBeNull();
  });
});
