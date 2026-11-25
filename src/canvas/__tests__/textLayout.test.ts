import { describe, expect, it, vi } from 'vitest';
import type { Textbox } from '../../types/notes';
import {
  computeTextboxScaleForDimension,
  drawCommittedTextbox,
  getTextboxLineGlyphRects,
  hitTestTextbox,
  isPointOnTextboxText,
  MAX_TEXTBOX_FONT_SIZE,
  measureTextboxLayout,
  MIN_TEXTBOX_FONT_SIZE,
  resolveTextboxCaretOffsetAtPoint,
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

  it('distinguishes glyph text regions from blank box regions and resolves exact click caret offsets', () => {
    const ctx = createMockMeasureCtx();
    const multiTb: Textbox = {
      id: 'tb-multi',
      x: 100,
      y: 120,
      text: 'dwdwdwa\nwdw\nd\nd\nd\n\n\ndwdwd',
      fontFamily: 'sans',
      fontSize: 24,
      bold: false,
      italic: false,
      color: '#072D59',
      createdAt: 1,
      updatedAt: 1,
    };

    const layout = measureTextboxLayout(multiTb, ctx);
    const rects = getTextboxLineGlyphRects(multiTb, layout, ctx);
    // Lines 5 and 6 (0-based) are blank "" lines so only 6 non-empty lines produce glyph rects
    expect(rects).toHaveLength(6);
    expect(rects.map((r) => r.lineIndex)).toEqual([0, 1, 2, 3, 4, 7]);

    const line5Rect = rects.find((r) => r.lineIndex === 4)!;
    // Hovering directly over 'd' on line 5 -> text zone (I-beam)
    expect(
      isPointOnTextboxText(
        (line5Rect.minX + line5Rect.maxX) / 2,
        (line5Rect.minY + line5Rect.maxY) / 2,
        multiTb,
        layout,
        3,
        2,
        ctx,
      ),
    ).toBe(true);

    // Blank area to the right of short line 'd' -> move zone
    expect(
      isPointOnTextboxText(
        layout.width - 4,
        (line5Rect.minY + line5Rect.maxY) / 2,
        multiTb,
        layout,
        3,
        2,
        ctx,
      ),
    ).toBe(false);

    // Blank empty lines (lineIndex 5 and 6) -> move zone even at x = 4
    const blankLineY = layout.firstAscent + 5 * layout.lineStep - 4;
    expect(isPointOnTextboxText(4, blankLineY, multiTb, layout, 3, 2, ctx)).toBe(false);

    // Outside box / outer border rim -> move zone
    expect(isPointOnTextboxText(-2, 8, multiTb, layout, 3, 2, ctx)).toBe(false);
    expect(isPointOnTextboxText(layout.width + 2, 8, multiTb, layout, 3, 2, ctx)).toBe(false);

    // Caret offset resolution picks exact line & character index
    const line1StartOffset = resolveTextboxCaretOffsetAtPoint(0, 6, multiTb, layout, ctx);
    expect(line1StartOffset).toBe(0);

    // Line 5 ('d') starts at index 16 ("dwdwdwa\n" = 8 + "wdw\n" = 4 + "d\n" = 2 + "d\n" = 2)
    const line5Left = resolveTextboxCaretOffsetAtPoint(
      0,
      (line5Rect.minY + line5Rect.maxY) / 2,
      multiTb,
      layout,
      ctx,
    );
    const line5Right = resolveTextboxCaretOffsetAtPoint(
      line5Rect.maxX,
      (line5Rect.minY + line5Rect.maxY) / 2,
      multiTb,
      layout,
      ctx,
    );
    expect(line5Left).toBe(16);
    expect(line5Right).toBe(17);

    // Final line ('dwdwd') starts at index 20
    const finalRect = rects.find((r) => r.lineIndex === 7)!;
    const finalEnd = resolveTextboxCaretOffsetAtPoint(
      finalRect.maxX + 4,
      (finalRect.minY + finalRect.maxY) / 2,
      multiTb,
      layout,
      ctx,
    );
    expect(finalEnd).toBe(multiTb.text.length);
  });

  it('scales textbox fontSize cleanly beyond 96pt / 560x72 to match target numeric width & height', () => {
    const scalableCtxObj = {
      font: '24px sans-serif',
      textBaseline: 'alphabetic',
      textAlign: 'left',
      save: vi.fn(),
      restore: vi.fn(),
      measureText(txt: string) {
        const m = /(\d+(?:\.\d+)?)px/.exec(scalableCtxObj.font);
        const fs = m ? Number.parseFloat(m[1]) : 24;
        const charW = fs * 0.62;
        return {
          width: txt.length * charW,
          fontBoundingBoxAscent: fs * 0.88,
          fontBoundingBoxDescent: fs * 0.22,
          actualBoundingBoxAscent: fs * 0.72,
          actualBoundingBoxDescent: fs * 0.03,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: txt.length * charW,
        } as TextMetrics;
      },
    };
    const scalableCtx = scalableCtxObj as unknown as CanvasRenderingContext2D;

    const tb: Textbox = {
      id: 'tb-scale',
      x: 50,
      y: 80,
      text: 'bdwdwwdwd',
      fontFamily: 'sans',
      fontSize: 57,
      bold: false,
      italic: false,
      color: '#072D59',
      wrapWidth: 333,
      createdAt: 1,
      updatedAt: 1,
    };

    // Scale well past old 560px / 96pt cap -> W = 1200px
    const wScaled = computeTextboxScaleForDimension(tb, 'width', 1200, scalableCtx);
    expect(wScaled.fontSize).toBeGreaterThan(96);
    expect(wScaled.fontSize).toBeLessThanOrEqual(MAX_TEXTBOX_FONT_SIZE);
    expect(wScaled.wrapWidth).toBeGreaterThan(1000);
    const wLayout = measureTextboxLayout(
      { ...tb, fontSize: wScaled.fontSize, wrapWidth: wScaled.wrapWidth },
      scalableCtx,
    );
    expect(Math.abs(Math.round(wLayout.width) - 1200)).toBeLessThanOrEqual(2);

    // Scale height well past old 72px cap -> H = 240px
    const hScaled = computeTextboxScaleForDimension(tb, 'height', 240, scalableCtx);
    expect(hScaled.fontSize).toBeGreaterThan(96);
    const hLayout = measureTextboxLayout(
      { ...tb, fontSize: hScaled.fontSize, wrapWidth: hScaled.wrapWidth },
      scalableCtx,
    );
    expect(Math.abs(Math.round(hLayout.height) - 240)).toBeLessThanOrEqual(2);

    // Clamping boundaries
    expect(computeTextboxScaleForDimension(tb, 'width', 999999, scalableCtx).fontSize).toBe(
      MAX_TEXTBOX_FONT_SIZE,
    );
    expect(computeTextboxScaleForDimension(tb, 'height', 1, scalableCtx).fontSize).toBe(
      MIN_TEXTBOX_FONT_SIZE,
    );
  });
});
