import type { Textbox, TextboxFontFamily } from '../types/notes';
import { resolveSmartDarkInkColor } from './paperRenderer';

export const MIN_TEXTBOX_FONT_SIZE = 4;
export const MAX_TEXTBOX_FONT_SIZE = 2000;
export const MIN_ELEMENT_DIMENSION = 4;
export const MAX_ELEMENT_DIMENSION = 24000;

export const TEXTBOX_FONT_STACKS: Record<TextboxFontFamily, string> = {
  sans: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  handwriting: '"Caveat", "Kalam", "Segoe Print", "Bradley Hand", cursive',
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

export interface TextboxGlyphRect {
  lineIndex: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  text: string;
}

function createWidthMeasurer(
  fontString: string,
  fontSize: number,
  explicitCtx?: CanvasRenderingContext2D | null,
): (s: string) => number {
  const ctx = explicitCtx ?? getMeasureContext();
  if (!ctx) {
    return (s: string) => s.length * fontSize * 0.56;
  }
  ctx.save();
  ctx.font = fontString;
  return (s: string) => {
    // Re-apply font in case callers interleaved canvas ops; cheap string assignment
    ctx.font = fontString;
    return ctx.measureText(s).width;
  };
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
  const fontSize = Math.max(MIN_TEXTBOX_FONT_SIZE, tb.fontSize || 20);

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

/**
 * Returns local-space bounding rectangles for each non-empty visual text line inside `tb`.
 * Blank lines and empty trailing horizontal space do not produce glyph rects so callers can
 * cleanly distinguish hovering actual text (`cursor-text`) from empty box background (`cursor-move`).
 */
export function getTextboxLineGlyphRects(
  tb: Pick<Textbox, 'text' | 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'wrapWidth'>,
  explicitLayout?: TextboxLayout,
  explicitCtx?: CanvasRenderingContext2D | null,
): TextboxGlyphRect[] {
  const layout = explicitLayout ?? measureTextboxLayout(tb, explicitCtx);
  const fontSize = Math.max(MIN_TEXTBOX_FONT_SIZE, tb.fontSize || 20);
  const ctx = explicitCtx ?? getMeasureContext();
  const measureWidth = createWidthMeasurer(layout.fontString, fontSize, ctx);
  const rects: TextboxGlyphRect[] = [];

  try {
    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      if (!line.text || line.text.trim().length === 0) continue;

      const leadingMatch = /^(\s*)/.exec(line.text);
      const leadingWs = leadingMatch?.[1] ?? '';
      const trimmedRight = line.text.replace(/\s+$/, '');
      const leadW = leadingWs.length > 0 ? measureWidth(leadingWs) : 0;
      const rightW =
        trimmedRight.length === line.text.length
          ? line.rightExtent
          : Math.max(leadW + 4, measureWidth(trimmedRight));

      const minX = Math.max(
        0,
        layout.leftOffset + leadW - (leadW === 0 ? line.leftOverhang : 0),
      );
      const maxX = Math.min(layout.width, Math.max(minX + 4, layout.leftOffset + rightW));

      const baselineY = layout.firstAscent + i * layout.lineStep;
      const glyphTop = Math.min(
        Math.max(line.ascent, layout.fontAscent * 0.72),
        layout.lineStep * 0.78,
      );
      const glyphBottom = Math.min(
        Math.max(line.descent, layout.fontDescent * 0.65),
        layout.lineStep * 0.34,
      );
      const minY = Math.max(0, baselineY - glyphTop);
      const maxY = Math.min(layout.height, baselineY + glyphBottom);

      rects.push({
        lineIndex: i,
        minX,
        minY,
        maxX,
        maxY,
        text: line.text,
      });
    }
  } finally {
    ctx?.restore();
  }

  return rects;
}

/**
 * Returns `true` when `(localX, localY)` (relative to `tb.x, tb.y` in unzoomed logical units)
 * lands directly over rendered text glyphs rather than blank lines, blank right-hand space,
 * or outside the textbox box border.
 */
export function isPointOnTextboxText(
  localX: number,
  localY: number,
  tb: Pick<Textbox, 'text' | 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'wrapWidth'>,
  explicitLayout?: TextboxLayout,
  padX = 3,
  padY = 2,
  explicitCtx?: CanvasRenderingContext2D | null,
): boolean {
  const layout = explicitLayout ?? measureTextboxLayout(tb, explicitCtx);
  if (localX < 0 || localY < 0 || localX > layout.width || localY > layout.height) {
    return false;
  }
  const rects = getTextboxLineGlyphRects(tb, layout, explicitCtx);
  for (const r of rects) {
    if (
      localX >= r.minX - padX &&
      localX <= r.maxX + padX &&
      localY >= r.minY - padY &&
      localY <= r.maxY + padY
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the character index inside `tb.text` closest to `(localX, localY)` so clicking
 * directly on a word/line opens active text editing with the caret right where the user clicked.
 */
export function resolveTextboxCaretOffsetAtPoint(
  localX: number,
  localY: number,
  tb: Pick<Textbox, 'text' | 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'wrapWidth'>,
  explicitLayout?: TextboxLayout,
  explicitCtx?: CanvasRenderingContext2D | null,
): number {
  if (!tb.text) return 0;
  const layout = explicitLayout ?? measureTextboxLayout(tb, explicitCtx);
  const fontSize = Math.max(MIN_TEXTBOX_FONT_SIZE, tb.fontSize || 20);
  const ctx = explicitCtx ?? getMeasureContext();
  const measureWidth = createWidthMeasurer(layout.fontString, fontSize, ctx);

  try {
    // Map each visual line back to its starting offset in `tb.text`
    const lineStartOffsets: number[] = [];
    let cursor = 0;
    for (let i = 0; i < layout.lines.length; i++) {
      const lt = layout.lines[i].text;
      if (i > 0) {
        if (tb.text[cursor] === '\n') {
          cursor += 1;
        } else {
          while (cursor < tb.text.length && tb.text[cursor] === ' ') {
            cursor += 1;
          }
          if (tb.text[cursor] === '\n') {
            cursor += 1;
          }
        }
      }
      if (lt.length > 0 && tb.text.slice(cursor, cursor + lt.length) !== lt) {
        const foundIdx = tb.text.indexOf(lt, cursor);
        if (foundIdx >= 0) cursor = foundIdx;
      }
      lineStartOffsets.push(Math.min(tb.text.length, cursor));
      cursor = Math.min(tb.text.length, cursor + lt.length);
    }

    let bestLineIdx = 0;
    let bestLineDist = Infinity;
    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      const midY = layout.firstAscent + i * layout.lineStep - line.ascent * 0.4;
      const dist = Math.abs(localY - midY);
      if (dist < bestLineDist) {
        bestLineDist = dist;
        bestLineIdx = i;
      }
    }

    const chosenLine = layout.lines[bestLineIdx];
    const lineStart = lineStartOffsets[bestLineIdx] ?? 0;
    if (!chosenLine || chosenLine.text.length === 0) {
      return lineStart;
    }

    let bestCol = 0;
    let bestColDist = Infinity;
    for (let k = 0; k <= chosenLine.text.length; k++) {
      const charX = layout.leftOffset + measureWidth(chosenLine.text.slice(0, k));
      const dist = Math.abs(localX - charX);
      if (dist < bestColDist) {
        bestColDist = dist;
        bestCol = k;
      }
    }

    return Math.max(0, Math.min(tb.text.length, lineStart + bestCol));
  } finally {
    ctx?.restore();
  }
}

/**
 * Computes the proportional `fontSize` (and optional `wrapWidth`) needed for a Textbox's
 * rendered width or height to match `targetPx` within `<= 1px`.
 */
export function computeTextboxScaleForDimension(
  tb: Pick<Textbox, 'text' | 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'wrapWidth'>,
  axis: 'width' | 'height',
  targetPx: number,
  explicitCtx?: CanvasRenderingContext2D | null,
): { fontSize: number; wrapWidth?: number } {
  const safeTarget = Math.max(
    MIN_ELEMENT_DIMENSION,
    Math.min(MAX_ELEMENT_DIMENSION, targetPx),
  );
  const baseFont = Math.max(MIN_TEXTBOX_FONT_SIZE, tb.fontSize || 20);
  const currentLayout = measureTextboxLayout(tb, explicitCtx);
  const currentVal = Math.max(
    1,
    axis === 'width' ? currentLayout.width : currentLayout.height,
  );

  let nextFontSize = Math.max(
    MIN_TEXTBOX_FONT_SIZE,
    Math.min(MAX_TEXTBOX_FONT_SIZE, baseFont * (safeTarget / currentVal)),
  );
  let nextWrap =
    tb.wrapWidth && tb.wrapWidth > 0
      ? Math.max(
          24,
          Math.min(MAX_ELEMENT_DIMENSION, Math.round(tb.wrapWidth * (nextFontSize / baseFont))),
        )
      : undefined;

  const trialLayout = measureTextboxLayout(
    { ...tb, fontSize: nextFontSize, wrapWidth: nextWrap },
    explicitCtx,
  );
  const trialVal = axis === 'width' ? trialLayout.width : trialLayout.height;
  if (trialVal > 0 && Math.abs(trialVal - safeTarget) > 0.5) {
    nextFontSize = Math.max(
      MIN_TEXTBOX_FONT_SIZE,
      Math.min(MAX_TEXTBOX_FONT_SIZE, nextFontSize * (safeTarget / trialVal)),
    );
    if (tb.wrapWidth && tb.wrapWidth > 0) {
      nextWrap = Math.max(
        24,
        Math.min(MAX_ELEMENT_DIMENSION, Math.round(tb.wrapWidth * (nextFontSize / baseFont))),
      );
    }
  }

  const intFontSize = Math.max(
    MIN_TEXTBOX_FONT_SIZE,
    Math.min(MAX_TEXTBOX_FONT_SIZE, Math.round(nextFontSize)),
  );
  const intWrap =
    tb.wrapWidth && tb.wrapWidth > 0
      ? Math.max(
          24,
          Math.min(MAX_ELEMENT_DIMENSION, Math.round(tb.wrapWidth * (intFontSize / baseFont))),
        )
      : undefined;
  const intLayout = measureTextboxLayout(
    { ...tb, fontSize: intFontSize, wrapWidth: intWrap },
    explicitCtx,
  );
  const intVal = axis === 'width' ? intLayout.width : intLayout.height;
  if (Math.abs(Math.round(intVal) - Math.round(safeTarget)) <= 1) {
    return {
      fontSize: intFontSize,
      ...(intWrap !== undefined ? { wrapWidth: intWrap } : {}),
    };
  }

  const roundedOneDecimal = Math.max(
    MIN_TEXTBOX_FONT_SIZE,
    Math.min(MAX_TEXTBOX_FONT_SIZE, Number(nextFontSize.toFixed(1))),
  );
  const finalWrap =
    tb.wrapWidth && tb.wrapWidth > 0
      ? Math.max(
          24,
          Math.min(
            MAX_ELEMENT_DIMENSION,
            Math.round(tb.wrapWidth * (roundedOneDecimal / baseFont)),
          ),
        )
      : undefined;
  return {
    fontSize: roundedOneDecimal,
    ...(finalWrap !== undefined ? { wrapWidth: finalWrap } : {}),
  };
}
