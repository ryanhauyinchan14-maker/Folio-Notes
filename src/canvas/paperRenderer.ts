import type { BoundingBox, PaperConfig } from '../types/notes';

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace('#', '').trim();
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16);
    const g = parseInt(cleaned[1] + cleaned[1], 16);
    const b = parseInt(cleaned[2] + cleaned[2], 16);
    return Number.isNaN(r) ? null : { r, g, b };
  }
  if (cleaned.length === 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    return Number.isNaN(r) ? null : { r, g, b };
  }
  return null;
}

export const SMART_DARK_PAPER_COLOR = '#131B2E';
export const SMART_DARK_INK_COLOR = '#F1F5F9';

export function getColorLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

export function isDarkColor(hex: string): boolean {
  const luminance = getColorLuminance(hex);
  return luminance !== null ? luminance < 0.45 : false;
}

export function isSmartDarkApplicable(paperColor: string, darkPaperView: boolean): boolean {
  return darkPaperView && !isDarkColor(paperColor || '#FFFFFF');
}

export function resolveEffectivePaperConfig(
  paper: PaperConfig,
  darkPaperView: boolean,
): PaperConfig {
  if (!isSmartDarkApplicable(paper.paperColor, darkPaperView)) {
    return paper;
  }
  return {
    ...paper,
    paperColor: SMART_DARK_PAPER_COLOR,
  };
}

export function resolveSmartDarkInkColor(
  color: string,
  darkPaperActive: boolean,
  isHighlighter = false,
): string {
  if (!darkPaperActive || isHighlighter) return color;
  const lum = getColorLuminance(color);
  if (lum !== null && lum < 0.26) {
    return SMART_DARK_INK_COLOR;
  }
  return color;
}

export function resolvePaperLineColors(paper: PaperConfig): {
  primaryLine: string;
  accentLine: string;
  dotColor: string;
  marginLine: string;
} {
  const dark = isDarkColor(paper.paperColor);
  if (paper.lineColor) {
    return {
      primaryLine: paper.lineColor,
      accentLine: paper.lineColor,
      dotColor: paper.lineColor,
      marginLine: paper.marginColor ?? (dark ? 'rgba(251, 113, 133, 0.55)' : 'rgba(244, 63, 94, 0.45)'),
    };
  }
  return dark
    ? {
        primaryLine: 'rgba(148, 163, 184, 0.25)',
        accentLine: 'rgba(148, 163, 184, 0.48)',
        dotColor: 'rgba(203, 213, 225, 0.45)',
        marginLine: paper.marginColor ?? 'rgba(251, 113, 133, 0.5)',
      }
    : {
        primaryLine: 'rgba(148, 163, 184, 0.45)',
        accentLine: 'rgba(100, 116, 139, 0.6)',
        dotColor: 'rgba(100, 116, 139, 0.55)',
        marginLine: paper.marginColor ?? 'rgba(244, 63, 94, 0.45)',
      };
}

/**
 * Renders the paper background, grid/ruled/dot/Cornell lines, and margin line
 * in canonical logical page coordinates (0..paper.width, 0..paper.height).
 * Caller is responsible for applying DPR + zoom scaling to ctx prior to invocation.
 */
export function renderPaperBackground(
  ctx: CanvasRenderingContext2D,
  paper: PaperConfig,
  clipBounds?: BoundingBox,
): void {
  const { width, height, pattern } = paper;
  const spacing = Math.max(12, Math.min(96, paper.spacing || 32));
  const colors = resolvePaperLineColors(paper);

  const clipMinX = Math.max(0, clipBounds ? clipBounds.minX : 0);
  const clipMinY = Math.max(0, clipBounds ? clipBounds.minY : 0);
  const clipMaxX = Math.min(width, clipBounds ? clipBounds.maxX : width);
  const clipMaxY = Math.min(height, clipBounds ? clipBounds.maxY : height);
  if (clipMaxX <= clipMinX || clipMaxY <= clipMinY) return;

  ctx.save();

  // Base paper fill across clipped region
  ctx.fillStyle = paper.paperColor || '#FFFFFF';
  ctx.fillRect(clipMinX, clipMinY, clipMaxX - clipMinX, clipMaxY - clipMinY);

  if (pattern === 'ruled') {
    const topStart = Math.max(spacing * 2.25, 68);
    const bottomLimit = height - Math.max(spacing, 28);
    const yEnd = Math.min(bottomLimit, clipMaxY);
    if (yEnd >= topStart) {
      let lineStep = spacing;
      while ((yEnd - Math.max(topStart, clipMinY)) / lineStep > 1200) {
        lineStep *= 2;
      }
      const firstIndex = Math.max(0, Math.ceil((clipMinY - topStart) / lineStep));
      const firstY = topStart + firstIndex * lineStep;

      ctx.strokeStyle = colors.primaryLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = firstY; y <= yEnd; y += lineStep) {
        const alignedY = Math.round(y) + 0.5;
        ctx.moveTo(clipMinX, alignedY);
        ctx.lineTo(clipMaxX, alignedY);
      }
      ctx.stroke();
    }
  } else if (pattern === 'grid') {
    let lineStep = spacing;
    while ((clipMaxX - clipMinX) / lineStep + (clipMaxY - clipMinY) / lineStep > 1200) {
      lineStep *= 2;
    }
    const startX = Math.max(lineStep, Math.ceil(clipMinX / lineStep) * lineStep);
    const endX = Math.min(width - 0.001, clipMaxX);
    const startY = Math.max(lineStep, Math.ceil(clipMinY / lineStep) * lineStep);
    const endY = Math.min(height - 0.001, clipMaxY);

    ctx.strokeStyle = colors.primaryLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += lineStep) {
      const alignedX = Math.round(x) + 0.5;
      ctx.moveTo(alignedX, clipMinY);
      ctx.lineTo(alignedX, clipMaxY);
    }
    for (let y = startY; y <= endY; y += lineStep) {
      const alignedY = Math.round(y) + 0.5;
      ctx.moveTo(clipMinX, alignedY);
      ctx.lineTo(clipMaxX, alignedY);
    }
    ctx.stroke();
  } else if (pattern === 'dotted') {
    let dotStep = spacing;
    while (((clipMaxX - clipMinX) / dotStep) * ((clipMaxY - clipMinY) / dotStep) > 6000) {
      dotStep *= 2;
    }
    const startX = Math.max(dotStep, Math.ceil(clipMinX / dotStep) * dotStep);
    const endX = Math.min(width - dotStep * 0.5, clipMaxX);
    const startY = Math.max(dotStep, Math.ceil(clipMinY / dotStep) * dotStep);
    const endY = Math.min(height - dotStep * 0.5, clipMaxY);

    if (endX >= startX && endY >= startY) {
      ctx.fillStyle = colors.dotColor;
      const radius = Math.max(1, Math.min(1.8, spacing * 0.045));
      ctx.beginPath();
      for (let x = startX; x <= endX; x += dotStep) {
        for (let y = startY; y <= endY; y += dotStep) {
          ctx.moveTo(x + radius, y);
          ctx.arc(x, y, radius, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    }
  } else if (pattern === 'cornell') {
    const topHeaderY = Math.round(Math.max(72, Math.min(110, height * 0.095)));
    const summaryY = Math.round(height - Math.max(140, Math.min(200, height * 0.175)));
    const cueX = Math.round(Math.max(150, Math.min(240, width * 0.275)));

    let lineStep = spacing;
    while ((clipMaxY - clipMinY) / lineStep > 1200) {
      lineStep *= 2;
    }

    // Ruled lines inside notes area & summary section
    ctx.strokeStyle = colors.primaryLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const notesStart = topHeaderY + spacing;
    const notesEnd = Math.min(summaryY - 4, clipMaxY);
    const notesLineX1 = Math.max(cueX, clipMinX);
    const notesLineX2 = Math.min(width - 24, clipMaxX);
    if (notesLineX2 > notesLineX1 && notesEnd > notesStart) {
      const idx0 = Math.max(0, Math.ceil((clipMinY - notesStart) / lineStep));
      for (let y = notesStart + idx0 * lineStep; y < notesEnd; y += lineStep) {
        const alignedY = Math.round(y) + 0.5;
        ctx.moveTo(notesLineX1, alignedY);
        ctx.lineTo(notesLineX2, alignedY);
      }
    }

    const sumStart = summaryY + spacing;
    const sumEnd = Math.min(height - 20, clipMaxY);
    const sumLineX1 = Math.max(24, clipMinX);
    const sumLineX2 = Math.min(width - 24, clipMaxX);
    if (sumLineX2 > sumLineX1 && sumEnd > sumStart) {
      const idx0 = Math.max(0, Math.ceil((clipMinY - sumStart) / lineStep));
      for (let y = sumStart + idx0 * lineStep; y < sumEnd; y += lineStep) {
        const alignedY = Math.round(y) + 0.5;
        ctx.moveTo(sumLineX1, alignedY);
        ctx.lineTo(sumLineX2, alignedY);
      }
    }
    ctx.stroke();

    // Structural Cornell dividers
    ctx.strokeStyle = colors.accentLine;
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    ctx.moveTo(24, topHeaderY + 0.5);
    ctx.lineTo(width - 24, topHeaderY + 0.5);
    ctx.moveTo(24, summaryY + 0.5);
    ctx.lineTo(width - 24, summaryY + 0.5);
    ctx.moveTo(cueX + 0.5, topHeaderY + 0.5);
    ctx.lineTo(cueX + 0.5, summaryY + 0.5);
    ctx.stroke();
  }

  // Optional vertical margin line (applicable across Blank, Ruled, Grid, Dotted, or Cornell if toggled)
  if (paper.marginLine) {
    const marginX = Math.round(paper.marginOffset ?? Math.min(96, width * 0.12)) + 0.5;
    if (marginX >= clipMinX - 2 && marginX <= clipMaxX + 2) {
      ctx.strokeStyle = colors.marginLine;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(marginX, clipMinY);
      ctx.lineTo(marginX, clipMaxY);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Renders an unbounded camera-tracked background pattern (`dotted`, `grid`, `ruled`,
 * or `blank`) across `visibleWorld` in world coordinates (supports positive and negative coords).
 */
export function renderWhiteboardBackground(
  ctx: CanvasRenderingContext2D,
  paper: PaperConfig,
  visibleWorld: BoundingBox,
  zoom: number,
): void {
  const safeZoom = Math.max(0.02, zoom || 1);
  const baseSpacing = Math.max(12, Math.min(96, paper.spacing || 32));
  const step =
    safeZoom < 0.1
      ? baseSpacing * 8
      : safeZoom < 0.25
        ? baseSpacing * 4
        : safeZoom < 0.5
          ? baseSpacing * 2
          : baseSpacing;
  const colors = resolvePaperLineColors(paper);

  const minX = visibleWorld.minX;
  const minY = visibleWorld.minY;
  const width = Math.max(1, visibleWorld.maxX - visibleWorld.minX);
  const height = Math.max(1, visibleWorld.maxY - visibleWorld.minY);

  ctx.save();
  ctx.fillStyle = paper.paperColor || '#FFFFFF';
  ctx.fillRect(minX, minY, width, height);

  const startX = Math.floor(minX / step) * step;
  const endX = Math.ceil(visibleWorld.maxX / step) * step;
  const startY = Math.floor(minY / step) * step;
  const endY = Math.ceil(visibleWorld.maxY / step) * step;

  if (paper.pattern === 'dotted') {
    const radius = Math.max(1.1, Math.min(2.2, baseSpacing * 0.045)) / safeZoom;
    ctx.fillStyle = colors.dotColor;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += step) {
      for (let y = startY; y <= endY; y += step) {
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  } else if (paper.pattern === 'grid') {
    ctx.strokeStyle = colors.primaryLine;
    ctx.lineWidth = 1 / safeZoom;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += step) {
      ctx.moveTo(x, minY);
      ctx.lineTo(x, visibleWorld.maxY);
    }
    for (let y = startY; y <= endY; y += step) {
      ctx.moveTo(minX, y);
      ctx.lineTo(visibleWorld.maxX, y);
    }
    ctx.stroke();
  } else if (paper.pattern === 'ruled') {
    ctx.strokeStyle = colors.primaryLine;
    ctx.lineWidth = 1 / safeZoom;
    ctx.beginPath();
    for (let y = startY; y <= endY; y += step) {
      ctx.moveTo(minX, y);
      ctx.lineTo(visibleWorld.maxX, y);
    }
    ctx.stroke();
  }

  // Subtle world-origin (0, 0) crosshair when visible on dotted or grid boards
  if (
    (paper.pattern === 'dotted' || paper.pattern === 'grid') &&
    minX <= 16 &&
    visibleWorld.maxX >= -16 &&
    minY <= 16 &&
    visibleWorld.maxY >= -16
  ) {
    const arm = 10 / safeZoom;
    ctx.strokeStyle = colors.accentLine;
    ctx.lineWidth = 1.5 / safeZoom;
    ctx.beginPath();
    ctx.moveTo(-arm, 0);
    ctx.lineTo(arm, 0);
    ctx.moveTo(0, -arm);
    ctx.lineTo(0, arm);
    ctx.stroke();
  }

  ctx.restore();
}
