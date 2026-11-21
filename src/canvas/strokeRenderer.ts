import getStroke from 'perfect-freehand';
import type { ShapeGeometry, Stroke, StrokePoint } from '../types/notes';
import { resolveSmartDarkInkColor } from './paperRenderer';

interface CachedStrokePath {
  pointsLen: number;
  size: number;
  simulatePressure: boolean;
  path: Path2D;
}

const strokePathCache = new WeakMap<Stroke, CachedStrokePath>();

function average(a: number, b: number): number {
  return (a + b) / 2;
}

function fmtCoord(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/**
 * Converts perfect-freehand outline vertices into an SVG `<path d="...">` string
 * using quadratic Bezier midpoint interpolation matching `buildPath2DFromOutline`.
 */
export function outlineToSvgPath(outline: number[][]): string {
  const len = outline.length;
  if (len === 0) return '';

  if (len < 3) {
    const parts = [`M ${fmtCoord(outline[0][0])} ${fmtCoord(outline[0][1])}`];
    for (let i = 1; i < len; i++) {
      parts.push(`L ${fmtCoord(outline[i][0])} ${fmtCoord(outline[i][1])}`);
    }
    parts.push('Z');
    return parts.join(' ');
  }

  let a = outline[0];
  let b = outline[1];
  const c = outline[2];
  const parts: string[] = [
    `M ${fmtCoord(a[0])} ${fmtCoord(a[1])}`,
    `Q ${fmtCoord(b[0])} ${fmtCoord(b[1])} ${fmtCoord(average(b[0], c[0]))} ${fmtCoord(average(b[1], c[1]))}`,
  ];

  for (let i = 2; i < len - 1; i++) {
    a = outline[i];
    b = outline[i + 1];
    parts.push(
      `Q ${fmtCoord(a[0])} ${fmtCoord(a[1])} ${fmtCoord(average(a[0], b[0]))} ${fmtCoord(average(a[1], b[1]))}`,
    );
  }
  parts.push('Z');
  return parts.join(' ');
}

/**
 * Converts perfect-freehand outline vertices into a smooth closed Path2D
 * using quadratic Bezier midpoint interpolation.
 */
export function buildPath2DFromOutline(outline: number[][]): Path2D {
  const path = new Path2D();
  const len = outline.length;
  if (len === 0) return path;

  if (len < 3) {
    path.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < len; i++) {
      path.lineTo(outline[i][0], outline[i][1]);
    }
    path.closePath();
    return path;
  }

  let a = outline[0];
  let b = outline[1];
  const c = outline[2];

  path.moveTo(a[0], a[1]);
  path.quadraticCurveTo(b[0], b[1], average(b[0], c[0]), average(b[1], c[1]));

  for (let i = 2; i < len - 1; i++) {
    a = outline[i];
    b = outline[i + 1];
    path.quadraticCurveTo(a[0], a[1], average(a[0], b[0]), average(a[1], b[1]));
  }

  path.closePath();
  return path;
}

export function getFreehandStrokeOutline(
  points: StrokePoint[],
  tool: 'pen' | 'highlighter',
  size: number,
  simulatePressure: boolean,
  isLast = true,
): number[][] {
  const pfInput = points.map((p) => [p.x, p.y, p.pressure] as [number, number, number]);

  return getStroke(pfInput, {
    size,
    thinning: tool === 'highlighter' ? 0.04 : 0.52,
    smoothing: tool === 'highlighter' ? 0.45 : 0.5,
    streamline: tool === 'highlighter' ? 0.55 : 0.45,
    simulatePressure: tool === 'highlighter' ? false : simulatePressure,
    easing: (t) => t,
    start: {
      taper: tool === 'highlighter' ? 0 : Math.min(size * 0.8, 4),
      cap: true,
    },
    end: {
      taper: tool === 'highlighter' ? 0 : Math.min(size * 0.8, 4),
      cap: true,
    },
    last: isLast,
  });
}

export function getFreehandStrokePath(
  points: StrokePoint[],
  tool: 'pen' | 'highlighter',
  size: number,
  simulatePressure: boolean,
  isLast = true,
): Path2D {
  const outline = getFreehandStrokeOutline(points, tool, size, simulatePressure, isLast);
  return buildPath2DFromOutline(outline);
}

function getCachedStrokePath(stroke: Stroke): Path2D {
  const cached = strokePathCache.get(stroke);
  if (
    cached &&
    cached.pointsLen === stroke.points.length &&
    cached.size === stroke.size &&
    cached.simulatePressure === stroke.simulatePressure
  ) {
    return cached.path;
  }

  const path = getFreehandStrokePath(
    stroke.points,
    stroke.tool,
    stroke.size,
    stroke.simulatePressure,
    true,
  );
  strokePathCache.set(stroke, {
    pointsLen: stroke.points.length,
    size: stroke.size,
    simulatePressure: stroke.simulatePressure,
    path,
  });
  return path;
}

export function drawShapeGeometry(
  ctx: CanvasRenderingContext2D,
  shape: ShapeGeometry,
  color: string,
  size: number,
  opacity: number,
  useMultiply: boolean,
  darkPaperActive = false,
  isHighlighter = false,
): void {
  const resolvedColor = resolveSmartDarkInkColor(color, darkPaperActive, isHighlighter);
  ctx.save();
  if (useMultiply) {
    ctx.globalCompositeOperation = darkPaperActive ? 'screen' : 'multiply';
  }
  ctx.globalAlpha = darkPaperActive && isHighlighter ? Math.min(opacity, 0.36) : opacity;
  ctx.strokeStyle = resolvedColor;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  if (shape.kind === 'line') {
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(shape.x2, shape.y2);
  } else if (shape.kind === 'rect') {
    ctx.rect(shape.x, shape.y, shape.width, shape.height);
  } else {
    ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawCommittedStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  applyMultiply = true,
  darkPaperActive = false,
): void {
  const isHighlighter = stroke.tool === 'highlighter';
  if (stroke.shape) {
    drawShapeGeometry(
      ctx,
      stroke.shape,
      stroke.color,
      stroke.size,
      stroke.opacity,
      applyMultiply && isHighlighter,
      darkPaperActive,
      isHighlighter,
    );
    return;
  }

  if (stroke.points.length === 0) return;

  const resolvedColor = resolveSmartDarkInkColor(stroke.color, darkPaperActive, isHighlighter);
  ctx.save();
  if (applyMultiply && isHighlighter) {
    ctx.globalCompositeOperation = darkPaperActive ? 'screen' : 'multiply';
  }
  ctx.globalAlpha = darkPaperActive && isHighlighter ? Math.min(stroke.opacity, 0.36) : stroke.opacity;
  ctx.fillStyle = resolvedColor;

  const path = getCachedStrokePath(stroke);
  ctx.fill(path);
  ctx.restore();
}

export function drawActiveFreehandStroke(
  ctx: CanvasRenderingContext2D,
  points: StrokePoint[],
  tool: 'pen' | 'highlighter',
  color: string,
  size: number,
  opacity: number,
  simulatePressure: boolean,
  darkPaperActive = false,
): void {
  if (points.length === 0) return;
  const isHighlighter = tool === 'highlighter';
  const resolvedColor = resolveSmartDarkInkColor(color, darkPaperActive, isHighlighter);
  ctx.save();
  ctx.globalAlpha = darkPaperActive && isHighlighter ? Math.min(opacity, 0.36) : opacity;
  ctx.fillStyle = resolvedColor;
  // On the top active canvas, CSS `mix-blend-mode` handles highlighter live blend cleanly
  const path = getFreehandStrokePath(points, tool, size, simulatePressure, false);
  ctx.fill(path);
  ctx.restore();
}
