import type { PaperConfig } from '../types/notes';

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
): void {
  const { width, height, pattern } = paper;
  const spacing = Math.max(12, Math.min(96, paper.spacing || 32));
  const colors = resolvePaperLineColors(paper);

  ctx.save();

  // Base paper fill
  ctx.fillStyle = paper.paperColor || '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  if (pattern === 'ruled') {
    const topStart = Math.max(spacing * 2.25, 68);
    const bottomLimit = height - Math.max(spacing, 28);

    ctx.strokeStyle = colors.primaryLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = topStart; y <= bottomLimit; y += spacing) {
      const alignedY = Math.round(y) + 0.5;
      ctx.moveTo(0, alignedY);
      ctx.lineTo(width, alignedY);
    }
    ctx.stroke();
  } else if (pattern === 'grid') {
    ctx.strokeStyle = colors.primaryLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = spacing; x < width; x += spacing) {
      const alignedX = Math.round(x) + 0.5;
      ctx.moveTo(alignedX, 0);
      ctx.lineTo(alignedX, height);
    }
    for (let y = spacing; y < height; y += spacing) {
      const alignedY = Math.round(y) + 0.5;
      ctx.moveTo(0, alignedY);
      ctx.lineTo(width, alignedY);
    }
    ctx.stroke();
  } else if (pattern === 'dotted') {
    ctx.fillStyle = colors.dotColor;
    const radius = Math.max(1, Math.min(1.8, spacing * 0.045));
    for (let x = spacing; x <= width - spacing * 0.5; x += spacing) {
      for (let y = spacing; y <= height - spacing * 0.5; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (pattern === 'cornell') {
    const topHeaderY = Math.round(Math.max(72, Math.min(110, height * 0.095)));
    const summaryY = Math.round(height - Math.max(140, Math.min(200, height * 0.175)));
    const cueX = Math.round(Math.max(150, Math.min(240, width * 0.275)));

    // Ruled lines inside notes area (and subtle lines inside summary section)
    ctx.strokeStyle = colors.primaryLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = topHeaderY + spacing; y < summaryY - 4; y += spacing) {
      const alignedY = Math.round(y) + 0.5;
      ctx.moveTo(cueX, alignedY);
      ctx.lineTo(width - 24, alignedY);
    }
    for (let y = summaryY + spacing; y < height - 20; y += spacing) {
      const alignedY = Math.round(y) + 0.5;
      ctx.moveTo(24, alignedY);
      ctx.lineTo(width - 24, alignedY);
    }
    ctx.stroke();

    // Structural Cornell dividers
    ctx.strokeStyle = colors.accentLine;
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    // Header divider
    ctx.moveTo(24, topHeaderY + 0.5);
    ctx.lineTo(width - 24, topHeaderY + 0.5);
    // Summary divider
    ctx.moveTo(24, summaryY + 0.5);
    ctx.lineTo(width - 24, summaryY + 0.5);
    // Cue column vertical divider
    ctx.moveTo(cueX + 0.5, topHeaderY + 0.5);
    ctx.lineTo(cueX + 0.5, summaryY + 0.5);
    ctx.stroke();
  }

  // Optional vertical margin line (applicable across Blank, Ruled, Grid, Dotted, or Cornell if toggled)
  if (paper.marginLine) {
    const marginX = Math.round(paper.marginOffset ?? Math.min(96, width * 0.12)) + 0.5;
    ctx.strokeStyle = colors.marginLine;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(marginX, 0);
    ctx.lineTo(marginX, height);
    ctx.stroke();
  }

  ctx.restore();
}
