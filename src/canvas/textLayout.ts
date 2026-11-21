import type { Textbox, TextboxFontFamily } from '../types/notes';
import { resolveSmartDarkInkColor } from './paperRenderer';

export const TEXTBOX_FONT_STACKS: Record<TextboxFontFamily, string> = {
  sans: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  handwriting: '"Comic Sans MS", "Bradley Hand", "Segoe Print", cursive',
};

export interface MeasuredLine {
  text: string;
  ascent: number;
  descent: number;
  leftOverhang: number;
  rightExtent: number;
}

export interface TextboxLayout {
  lines: MeasuredLine[];
  width: number;
  height: number;
  firstAscent: number;
  lastDescent: number;
  lineStep: number;
  leftOffset: number;
  fontAscent: number;
  fontDescent: number;
  cssLineHeight: number;
  /** Vertical offset applied to DOM textarea so baseline matches Canvas 2D sub-pixel exactly */
  domMarginTop: number;
  fontString: string;
}

let sharedMeasureCtx: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (sharedMeasureCtx) return sharedMeasureCtx;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  sharedMeasureCtx = canvas.getContext('2d');
  return sharedMeasureCtx;
}

export function buildTextboxFontString(
  tb: Pick<Textbox, 'fontFamily' | 'fontSize' | 'bold' | 'italic'>,
): string {
  const stack = TEXTBOX_FONT_STACKS[tb.fontFamily] ?? TEXTBOX_FONT_STACKS.sans;
  const italic = tb.italic ? 'italic ' : '';
  const weight = tb.bold ? '700 ' : '400 ';
  return `${italic}${weight}${tb.fontSize}px ${stack}`;
}

export function wrapTextboxLines(
  text: string,
  wrapWidth: number | undefined,
  measureWidth: (s: string) => number,
): string[] {
  const paragraphs = text.split('\n');
  if (!wrapWidth || wrapWidth <= 0) {
    return paragraphs;
  }

  const result: string[] = [];
  for (const para of paragraphs) {
    if (!para) {
      result.push('');
      continue;
    }

    const tokens = para.split(/(\s+)/);
    let currentLine = '';

    for (const token of tokens) {
      if (!token) continue;
      const candidate = currentLine + token;
      if (currentLine && measureWidth(candidate.trimEnd()) > wrapWidth) {
        result.push(currentLine.trimEnd());
        currentLine = token.trimStart();
      } else {
        currentLine = candidate;
      }
    }
    if (currentLine.length > 0 || para.length === 0) {
      result.push(currentLine);
    }
  }

  return result.length > 0 ? result : [''];
}

/**
 * Computes airtight glyph-ink bounding metrics for a Textbox using Canvas 2D TextMetrics
 * (`actualBoundingBoxAscent`, `actualBoundingBoxDescent`, `actualBoundingBoxLeft`,
 * `actualBoundingBoxRight`), eliminating dead ascender/descender/line-height whitespace.
 */
export function measureTextboxLayout(
  tb: Pick<Textbox, 'text' | 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'wrapWidth'>,
  explicitCtx?: CanvasRenderingContext2D | null,
): TextboxLayout {
  const ctx = explicitCtx ?? getMeasureContext();
  const fontString = buildTextboxFontString(tb);
  const fontSize = Math.max(8, tb.fontSize || 20);

  if (!ctx) {
    const rawLines = (tb.text || '').split('\n');
    const firstAscent = fontSize * 0.72;
    const lastDescent = /[gjpqy]/i.test(rawLines[rawLines.length - 1] || '')
      ? fontSize * 0.2
      : fontSize * 0.02;
    const emHeight = fontSize * 1.1;
    const lineStep = rawLines.length > 1 ? fontSize * 1.2 : emHeight;
    const maxChars = Math.max(1, ...rawLines.map((l) => l.length));
    const width = Math.max(10, maxChars * fontSize * 0.56);
    const height = Math.max(
      8,
      firstAscent + (rawLines.length - 1) * lineStep + lastDescent,
    );
    return {
      lines: rawLines.map((text) => ({
        text,
        ascent: firstAscent,
        descent: lastDescent,
        leftOverhang: 0,
        rightExtent: Math.max(8, text.length * fontSize * 0.56),
      })),
      width,
      height,
      firstAscent,
      lastDescent,
      lineStep,
      leftOffset: 0,
      fontAscent: fontSize * 0.88,
      fontDescent: fontSize * 0.22,
      cssLineHeight: lineStep,
      domMarginTop: firstAscent - fontSize * 0.88,
      fontString,
    };
  }

  ctx.save();
  ctx.font = fontString;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const wrapped = wrapTextboxLines(
    tb.text,
    tb.wrapWidth,
    (s) => ctx.measureText(s).width,
  );

  const refMetrics = ctx.measureText('Hg');
  const fontAscent =
    typeof refMetrics.fontBoundingBoxAscent === 'number' && refMetrics.fontBoundingBoxAscent > 0
      ? refMetrics.fontBoundingBoxAscent
      : fontSize * 0.88;
  const fontDescent =
    typeof refMetrics.fontBoundingBoxDescent === 'number' && refMetrics.fontBoundingBoxDescent >= 0
      ? refMetrics.fontBoundingBoxDescent
      : fontSize * 0.22;
  const emHeight = fontAscent + fontDescent;
  const lineStep = wrapped.length > 1 ? Math.max(emHeight, fontSize * 1.2) : emHeight;

  const measuredLines: MeasuredLine[] = wrapped.map((lineText) => {
    const sample = lineText.length > 0 ? lineText : 'x';
    const m = ctx.measureText(sample);
    const ascent =
      typeof m.actualBoundingBoxAscent === 'number' && m.actualBoundingBoxAscent > 0
        ? m.actualBoundingBoxAscent
        : fontSize * 0.65;
    const descent =
      typeof m.actualBoundingBoxDescent === 'number' && m.actualBoundingBoxDescent >= 0
        ? m.actualBoundingBoxDescent
        : 0;
    const leftOverhang =
      lineText.length > 0 && typeof m.actualBoundingBoxLeft === 'number'
        ? Math.max(0, m.actualBoundingBoxLeft)
        : 0;
    const rightExtent =
      lineText.length > 0
        ? Math.max(
            typeof m.actualBoundingBoxRight === 'number' ? m.actualBoundingBoxRight : 0,
            m.width,
          )
        : Math.max(8, fontSize * 0.45);

    return {
      text: lineText,
      ascent,
      descent,
      leftOverhang,
      rightExtent,
    };
  });

  ctx.restore();

  const firstAscent = measuredLines[0]?.ascent ?? fontSize * 0.65;
  const lastLine = measuredLines[measuredLines.length - 1];
  const lastDescent = lastLine?.descent ?? 0;

  const leftOffset = Math.max(0, ...measuredLines.map((l) => l.leftOverhang));
  const maxRight = Math.max(8, ...measuredLines.map((l) => l.rightExtent));

  const tightWidth = Math.max(10, leftOffset + maxRight);
  const tightHeight = Math.max(
    8,
    firstAscent + (measuredLines.length - 1) * lineStep + lastDescent,
  );

  // Compute CSS baseline position inside DOM textarea/editable with lineHeight = cssLineHeight
  const cssLineHeight = lineStep;
  const halfLeading = (cssLineHeight - emHeight) / 2;
  const cssBaselineFromTop = halfLeading + fontAscent;
  const domMarginTop = firstAscent - cssBaselineFromTop;

  return {
    lines: measuredLines,
    width: tightWidth,
    height: tightHeight,
    firstAscent,
    lastDescent,
    lineStep,
    leftOffset,
    fontAscent,
    fontDescent,
    cssLineHeight,
    domMarginTop,
    fontString,
  };
}

export function drawCommittedTextbox(
  ctx: CanvasRenderingContext2D,
  tb: Textbox,
  darkPaperActive = false,
): void {
  if (!tb.text) return;
  const layout = measureTextboxLayout(tb, ctx);

  ctx.save();
  ctx.font = layout.fontString;
  ctx.fillStyle = resolveSmartDarkInkColor(tb.color, darkPaperActive, false);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const drawX = tb.x + layout.leftOffset;
  for (let i = 0; i < layout.lines.length; i++) {
    const line = layout.lines[i];
    if (!line.text) continue;
    const baselineY = tb.y + layout.firstAscent + i * layout.lineStep;
    ctx.fillText(line.text, drawX, baselineY);
  }
  ctx.restore();
}

export function hitTestTextbox(
  x: number,
  y: number,
  textboxes: Textbox[],
  pad = 4,
): Textbox | null {
  for (let i = textboxes.length - 1; i >= 0; i--) {
    const tb = textboxes[i];
    const layout = measureTextboxLayout(tb);
    if (
      x >= tb.x - pad &&
      x <= tb.x + layout.width + pad &&
      y >= tb.y - pad &&
      y <= tb.y + layout.height + pad
    ) {
      return tb;
    }
  }
  return null;
}
