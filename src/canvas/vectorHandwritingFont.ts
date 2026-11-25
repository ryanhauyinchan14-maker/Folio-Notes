import type { BoundingBox, Stroke, StrokePoint } from '../types/notes';
import { createId } from '../utils/id';
import { computeBoundsFromPoints } from './geometry';

export interface TextToHandwritingStrokesParams {
  text: string;
  bounds: BoundingBox;
  color: string;
  strokeSize: number;
  groupId?: string;
  createdAt?: number;
}

interface GlyphStroke {
  pts: Array<[number, number]>;
  isDot?: boolean;
}

interface GlyphDef {
  advance: number;
  strokes: GlyphStroke[];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Densely samples a straight line so `perfect-freehand` retains crisp corners/endpoints.
 */
function seg(x1: number, y1: number, x2: number, y2: number, steps = 8): GlyphStroke {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([lerp(x1, x2, t), lerp(y1, y2, t)]);
  }
  return { pts };
}

/**
 * Multi-vertex polyline with subtle corner anchoring so angular strokes stay sharp.
 */
function poly(vertices: Array<[number, number]>, stepsPerSeg = 6): GlyphStroke {
  const pts: Array<[number, number]> = [];
  for (let s = 0; s < vertices.length - 1; s++) {
    const [x1, y1] = vertices[s];
    const [x2, y2] = vertices[s + 1];
    for (let i = 0; i <= stepsPerSeg; i++) {
      if (s > 0 && i === 0) {
        // Double-tap internal corner vertex to resist streamline corner-rounding
        pts.push([x1, y1]);
        continue;
      }
      const t = i / stepsPerSeg;
      pts.push([lerp(x1, x2, t), lerp(y1, y2, t)]);
    }
  }
  return { pts };
}

/**
 * Smooth quadratic Bezier curve in normalized glyph coordinates.
 */
function quad(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  steps = 10,
): GlyphStroke {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    pts.push([
      mt * mt * x0 + 2 * mt * t * cx + t * t * x1,
      mt * mt * y0 + 2 * mt * t * cy + t * t * y1,
    ]);
  }
  return { pts };
}

/**
 * Smooth cubic Bezier curve in normalized glyph coordinates.
 */
function cubic(
  x0: number,
  y0: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x1: number,
  y1: number,
  steps = 12,
): GlyphStroke {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    pts.push([
      mt2 * mt * x0 + 3 * mt2 * t * c1x + 3 * mt * t2 * c2x + t2 * t * x1,
      mt2 * mt * y0 + 3 * mt2 * t * c1y + 3 * mt * t2 * c2y + t2 * t * y1,
    ]);
  }
  return { pts };
}

/**
 * Elliptical arc in degrees (0 = right, 90 = down, 180 = left, 270 = up).
 */
function ellipseArc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startDeg: number,
  endDeg: number,
  steps = 14,
): GlyphStroke {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const deg = lerp(startDeg, endDeg, i / steps);
    const rad = (deg * Math.PI) / 180;
    pts.push([cx + Math.cos(rad) * rx, cy + Math.sin(rad) * ry]);
  }
  return { pts };
}

/**
 * 7-point closed micro-loop so dots (`i`, `j`, `.`, `!`, `?`, etc.) render visibly
 * despite `perfect-freehand` endpoint tapering.
 */
function dot(cx: number, cy: number, r = 0.036): GlyphStroke {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 7; i++) {
    const rad = (i / 6) * Math.PI * 2;
    pts.push([cx + Math.cos(rad) * r, cy + Math.sin(rad) * r]);
  }
  return { pts, isDot: true };
}

/**
 * Merges consecutive connected glyph segments into one continuous stroke
 * so curves render without internal end-cap pinches or bowtie seams.
 */
function chain(...parts: GlyphStroke[]): GlyphStroke {
  const pts: Array<[number, number]> = [];
  for (const part of parts) {
    for (const pt of part.pts) {
      const prev = pts[pts.length - 1];
      if (
        prev &&
        Math.abs(prev[0] - pt[0]) < 1e-4 &&
        Math.abs(prev[1] - pt[1]) < 1e-4
      ) {
        continue;
      }
      pts.push(pt);
    }
  }
  return { pts };
}

// Normalized vertical metrics:
// y = 0.00 : cap & ascender top
// y = 0.36 : x-height
// y = 1.00 : baseline
// y = 1.32 : descender bottom
const GLYPH_MAP: Record<string, GlyphDef> = {
  // Uppercase A-Z
  A: {
    advance: 0.68,
    strokes: [
      poly([[0.05, 1.0], [0.34, 0.0], [0.63, 1.0]]),
      seg(0.15, 0.65, 0.53, 0.65),
    ],
  },
  B: {
    advance: 0.62,
    strokes: [
      seg(0.08, 0.0, 0.08, 1.0),
      chain(
        poly([[0.08, 0.0], [0.34, 0.0]]),
        quad(0.34, 0.0, 0.58, 0.02, 0.54, 0.24),
        quad(0.54, 0.24, 0.52, 0.46, 0.08, 0.47),
      ),
      chain(
        quad(0.08, 0.47, 0.60, 0.47, 0.58, 0.74),
        quad(0.58, 0.74, 0.56, 1.0, 0.08, 1.0),
      ),
    ],
  },
  C: {
    advance: 0.62,
    strokes: [
      chain(
        cubic(0.56, 0.16, 0.42, -0.05, 0.06, 0.02, 0.06, 0.50, 14),
        cubic(0.06, 0.50, 0.06, 0.98, 0.44, 1.06, 0.56, 0.84, 14),
      ),
    ],
  },
  D: {
    advance: 0.64,
    strokes: [
      seg(0.08, 0.0, 0.08, 1.0),
      cubic(0.08, 0.0, 0.64, -0.02, 0.64, 1.02, 0.08, 1.0, 18),
    ],
  },
  E: {
    advance: 0.56,
    strokes: [
      poly([[0.50, 0.0], [0.08, 0.0], [0.08, 1.0], [0.52, 1.0]]),
      seg(0.08, 0.48, 0.44, 0.48),
    ],
  },
  F: {
    advance: 0.52,
    strokes: [
      poly([[0.48, 0.0], [0.08, 0.0], [0.08, 1.0]]),
      seg(0.08, 0.48, 0.42, 0.48),
    ],
  },
  G: {
    advance: 0.66,
    strokes: [
      chain(
        cubic(0.58, 0.16, 0.42, -0.06, 0.06, 0.04, 0.06, 0.50, 14),
        cubic(0.06, 0.50, 0.06, 0.98, 0.50, 1.05, 0.58, 0.82, 14),
      ),
      poly([[0.36, 0.55], [0.58, 0.55], [0.58, 1.0]]),
    ],
  },
  H: {
    advance: 0.64,
    strokes: [
      seg(0.08, 0.0, 0.08, 1.0),
      seg(0.56, 0.0, 0.56, 1.0),
      seg(0.08, 0.48, 0.56, 0.48),
    ],
  },
  I: {
    advance: 0.36,
    strokes: [
      seg(0.08, 0.0, 0.28, 0.0),
      seg(0.18, 0.0, 0.18, 1.0),
      seg(0.08, 1.0, 0.28, 1.0),
    ],
  },
  J: {
    advance: 0.50,
    strokes: [
      seg(0.14, 0.0, 0.46, 0.0),
      chain(
        seg(0.38, 0.0, 0.38, 0.72),
        quad(0.38, 0.72, 0.38, 1.04, 0.10, 0.98, 10),
        quad(0.10, 0.98, 0.04, 0.94, 0.05, 0.82, 6),
      ),
    ],
  },
  K: {
    advance: 0.62,
    strokes: [
      seg(0.08, 0.0, 0.08, 1.0),
      seg(0.54, 0.0, 0.08, 0.54),
      seg(0.18, 0.44, 0.56, 1.0),
    ],
  },
  L: {
    advance: 0.52,
    strokes: [poly([[0.08, 0.0], [0.08, 1.0], [0.48, 1.0]])],
  },
  M: {
    advance: 0.82,
    strokes: [poly([[0.08, 1.0], [0.08, 0.0], [0.41, 0.66], [0.74, 0.0], [0.74, 1.0]])],
  },
  N: {
    advance: 0.66,
    strokes: [poly([[0.08, 1.0], [0.08, 0.0], [0.58, 1.0], [0.58, 0.0]])],
  },
  O: {
    advance: 0.70,
    strokes: [ellipseArc(0.35, 0.50, 0.29, 0.50, -90, 270, 24)],
  },
  P: {
    advance: 0.58,
    strokes: [
      seg(0.08, 0.0, 0.08, 1.0),
      cubic(0.08, 0.0, 0.62, -0.04, 0.62, 0.56, 0.08, 0.54, 16),
    ],
  },
  Q: {
    advance: 0.70,
    strokes: [
      ellipseArc(0.35, 0.50, 0.29, 0.50, -90, 270, 24),
      seg(0.38, 0.74, 0.64, 1.08),
    ],
  },
  R: {
    advance: 0.62,
    strokes: [
      seg(0.08, 0.0, 0.08, 1.0),
      cubic(0.08, 0.0, 0.60, -0.04, 0.60, 0.52, 0.08, 0.52, 16),
      seg(0.28, 0.52, 0.56, 1.0),
    ],
  },
  S: {
    advance: 0.58,
    strokes: [
      chain(
        cubic(0.52, 0.14, 0.42, -0.06, 0.06, -0.02, 0.08, 0.26, 12),
        cubic(0.08, 0.26, 0.10, 0.52, 0.54, 0.48, 0.54, 0.76, 12),
        cubic(0.54, 0.76, 0.54, 1.02, 0.12, 1.05, 0.06, 0.84, 12),
      ),
    ],
  },
  T: {
    advance: 0.58,
    strokes: [
      seg(0.04, 0.0, 0.54, 0.0),
      seg(0.29, 0.0, 0.29, 1.0),
    ],
  },
  U: {
    advance: 0.66,
    strokes: [
      chain(
        seg(0.08, 0.0, 0.08, 0.66),
        cubic(0.08, 0.66, 0.08, 1.08, 0.58, 1.08, 0.58, 0.66, 12),
        seg(0.58, 0.66, 0.58, 0.0),
      ),
    ],
  },
  V: {
    advance: 0.64,
    strokes: [poly([[0.05, 0.0], [0.32, 1.0], [0.59, 0.0]])],
  },
  W: {
    advance: 0.86,
    strokes: [poly([[0.05, 0.0], [0.23, 1.0], [0.43, 0.28], [0.63, 1.0], [0.81, 0.0]])],
  },
  X: {
    advance: 0.62,
    strokes: [
      seg(0.06, 0.0, 0.56, 1.0),
      seg(0.56, 0.0, 0.06, 1.0),
    ],
  },
  Y: {
    advance: 0.60,
    strokes: [
      poly([[0.06, 0.0], [0.30, 0.50], [0.54, 0.0]]),
      seg(0.30, 0.50, 0.30, 1.0),
    ],
  },
  Z: {
    advance: 0.58,
    strokes: [poly([[0.06, 0.0], [0.52, 0.0], [0.06, 1.0], [0.54, 1.0]])],
  },

  // Lowercase a-z
  a: {
    advance: 0.54,
    strokes: [
      chain(
        cubic(0.42, 0.44, 0.14, 0.28, 0.04, 0.52, 0.05, 0.72, 10),
        cubic(0.05, 0.72, 0.06, 1.02, 0.34, 1.06, 0.43, 0.76, 10),
      ),
      chain(
        seg(0.43, 0.38, 0.43, 0.90),
        quad(0.43, 0.90, 0.44, 1.01, 0.49, 1.0, 5),
      ),
    ],
  },
  b: {
    advance: 0.54,
    strokes: [
      seg(0.08, 0.0, 0.08, 1.0),
      chain(
        cubic(0.08, 0.52, 0.24, 0.30, 0.48, 0.38, 0.48, 0.68, 12),
        cubic(0.48, 0.68, 0.48, 0.98, 0.20, 1.06, 0.08, 0.88, 10),
      ),
    ],
  },
  c: {
    advance: 0.46,
    strokes: [
      chain(
        cubic(0.42, 0.46, 0.30, 0.32, 0.06, 0.38, 0.06, 0.68, 10),
        cubic(0.06, 0.68, 0.06, 0.98, 0.30, 1.04, 0.42, 0.88, 10),
      ),
    ],
  },
  d: {
    advance: 0.54,
    strokes: [
      chain(
        cubic(0.44, 0.52, 0.28, 0.30, 0.06, 0.40, 0.06, 0.70, 10),
        cubic(0.06, 0.70, 0.06, 1.0, 0.30, 1.05, 0.44, 0.84, 10),
      ),
      seg(0.44, 0.0, 0.44, 1.0),
    ],
  },
  e: {
    advance: 0.50,
    strokes: [
      seg(0.07, 0.64, 0.44, 0.64),
      chain(
        cubic(0.44, 0.64, 0.46, 0.36, 0.08, 0.34, 0.06, 0.68, 12),
        cubic(0.06, 0.68, 0.06, 1.0, 0.30, 1.04, 0.43, 0.90, 10),
      ),
    ],
  },
  f: {
    advance: 0.38,
    strokes: [
      chain(
        quad(0.35, 0.06, 0.22, -0.05, 0.16, 0.14, 8),
        seg(0.16, 0.14, 0.16, 1.0),
      ),
      seg(0.04, 0.42, 0.32, 0.42),
    ],
  },
  g: {
    advance: 0.54,
    strokes: [
      ellipseArc(0.25, 0.68, 0.19, 0.30, -30, 330, 22),
      chain(
        seg(0.44, 0.38, 0.44, 1.08),
        cubic(0.44, 1.08, 0.44, 1.35, 0.12, 1.36, 0.06, 1.18, 10),
      ),
    ],
  },
  h: {
    advance: 0.54,
    strokes: [
      seg(0.08, 0.0, 0.08, 1.0),
      chain(
        cubic(0.08, 0.58, 0.14, 0.34, 0.44, 0.32, 0.45, 0.62, 12),
        seg(0.45, 0.62, 0.45, 1.0),
      ),
    ],
  },
  i: {
    advance: 0.26,
    strokes: [seg(0.13, 0.38, 0.13, 1.0), dot(0.13, 0.14)],
  },
  j: {
    advance: 0.30,
    strokes: [
      chain(
        seg(0.20, 0.38, 0.20, 1.08),
        quad(0.20, 1.08, 0.19, 1.34, 0.03, 1.26, 8),
      ),
      dot(0.20, 0.14),
    ],
  },
  k: {
    advance: 0.50,
    strokes: [
      seg(0.08, 0.0, 0.08, 1.0),
      seg(0.44, 0.38, 0.08, 0.70),
      seg(0.18, 0.61, 0.45, 1.0),
    ],
  },
  l: {
    advance: 0.26,
    strokes: [chain(seg(0.13, 0.0, 0.13, 0.94), quad(0.13, 0.94, 0.14, 1.01, 0.20, 1.0, 5))],
  },
  m: {
    advance: 0.78,
    strokes: [
      seg(0.07, 0.38, 0.07, 1.0),
      chain(
        cubic(0.07, 0.56, 0.13, 0.34, 0.39, 0.34, 0.39, 0.60, 10),
        seg(0.39, 0.60, 0.39, 1.0),
      ),
      chain(
        cubic(0.39, 0.56, 0.45, 0.34, 0.71, 0.34, 0.71, 0.60, 10),
        seg(0.71, 0.60, 0.71, 1.0),
      ),
    ],
  },
  n: {
    advance: 0.54,
    strokes: [
      seg(0.08, 0.38, 0.08, 1.0),
      chain(
        cubic(0.08, 0.58, 0.14, 0.34, 0.44, 0.34, 0.45, 0.62, 10),
        seg(0.45, 0.62, 0.45, 1.0),
      ),
    ],
  },
  o: {
    advance: 0.54,
    strokes: [ellipseArc(0.27, 0.68, 0.21, 0.31, -90, 270, 24)],
  },
  p: {
    advance: 0.54,
    strokes: [
      seg(0.08, 0.38, 0.08, 1.32),
      chain(
        cubic(0.08, 0.52, 0.24, 0.30, 0.48, 0.38, 0.48, 0.68, 12),
        cubic(0.48, 0.68, 0.48, 0.98, 0.20, 1.04, 0.08, 0.88, 10),
      ),
    ],
  },
  q: {
    advance: 0.54,
    strokes: [
      ellipseArc(0.25, 0.68, 0.19, 0.30, -25, 335, 22),
      seg(0.44, 0.38, 0.44, 1.32),
    ],
  },
  r: {
    advance: 0.38,
    strokes: [
      seg(0.08, 0.38, 0.08, 1.0),
      quad(0.08, 0.58, 0.16, 0.34, 0.34, 0.40, 8),
    ],
  },
  s: {
    advance: 0.46,
    strokes: [
      chain(
        cubic(0.40, 0.46, 0.32, 0.33, 0.07, 0.36, 0.08, 0.54, 10),
        cubic(0.08, 0.54, 0.10, 0.70, 0.42, 0.66, 0.42, 0.84, 10),
        cubic(0.42, 0.84, 0.42, 1.02, 0.12, 1.04, 0.06, 0.88, 10),
      ),
    ],
  },
  t: {
    advance: 0.36,
    strokes: [
      chain(
        seg(0.16, 0.06, 0.16, 0.88),
        quad(0.16, 0.88, 0.18, 1.02, 0.31, 0.96, 6),
      ),
      seg(0.04, 0.38, 0.31, 0.38),
    ],
  },
  u: {
    advance: 0.54,
    strokes: [
      chain(
        seg(0.08, 0.38, 0.08, 0.76),
        cubic(0.08, 0.76, 0.08, 1.05, 0.38, 1.05, 0.44, 0.78, 10),
      ),
      seg(0.44, 0.38, 0.44, 1.0),
    ],
  },
  v: {
    advance: 0.50,
    strokes: [poly([[0.05, 0.38], [0.25, 1.0], [0.45, 0.38]])],
  },
  w: {
    advance: 0.72,
    strokes: [poly([[0.05, 0.38], [0.19, 1.0], [0.36, 0.52], [0.53, 1.0], [0.67, 0.38]])],
  },
  x: {
    advance: 0.48,
    strokes: [
      seg(0.06, 0.38, 0.42, 1.0),
      seg(0.42, 0.38, 0.06, 1.0),
    ],
  },
  y: {
    advance: 0.50,
    strokes: [
      seg(0.06, 0.38, 0.25, 0.98),
      chain(
        seg(0.44, 0.38, 0.16, 1.24),
        quad(0.16, 1.24, 0.11, 1.32, 0.05, 1.30, 5),
      ),
    ],
  },
  z: {
    advance: 0.46,
    strokes: [poly([[0.06, 0.38], [0.40, 0.38], [0.06, 1.0], [0.42, 1.0]])],
  },

  // Digits 0-9
  '0': {
    advance: 0.58,
    strokes: [ellipseArc(0.29, 0.50, 0.23, 0.50, -90, 270, 24)],
  },
  '1': {
    advance: 0.42,
    strokes: [
      poly([[0.10, 0.18], [0.25, 0.0], [0.25, 1.0]]),
      seg(0.10, 1.0, 0.38, 1.0),
    ],
  },
  '2': {
    advance: 0.56,
    strokes: [
      chain(
        cubic(0.08, 0.22, 0.12, -0.04, 0.50, -0.04, 0.48, 0.28, 12),
        seg(0.48, 0.28, 0.06, 1.0, 8),
      ),
      seg(0.06, 1.0, 0.52, 1.0),
    ],
  },
  '3': {
    advance: 0.54,
    strokes: [
      chain(
        cubic(0.08, 0.14, 0.18, -0.04, 0.50, -0.02, 0.46, 0.24, 10),
        quad(0.46, 0.24, 0.44, 0.45, 0.22, 0.47, 8),
      ),
      chain(
        cubic(0.22, 0.47, 0.52, 0.47, 0.54, 0.98, 0.24, 1.0, 12),
        quad(0.24, 1.0, 0.12, 1.0, 0.06, 0.86, 6),
      ),
    ],
  },
  '4': {
    advance: 0.56,
    strokes: [
      poly([[0.38, 1.0], [0.38, 0.0], [0.06, 0.66], [0.52, 0.66]]),
    ],
  },
  '5': {
    advance: 0.54,
    strokes: [
      poly([[0.46, 0.0], [0.12, 0.0], [0.10, 0.42]]),
      chain(
        cubic(0.10, 0.42, 0.36, 0.34, 0.52, 0.54, 0.48, 0.78, 10),
        cubic(0.48, 0.78, 0.44, 1.02, 0.16, 1.04, 0.06, 0.86, 10),
      ),
    ],
  },
  '6': {
    advance: 0.56,
    strokes: [
      chain(
        cubic(0.46, 0.10, 0.30, -0.06, 0.06, 0.14, 0.06, 0.64, 14),
        cubic(0.06, 0.64, 0.06, 1.04, 0.48, 1.04, 0.48, 0.72, 12),
        cubic(0.48, 0.72, 0.48, 0.44, 0.12, 0.44, 0.07, 0.66, 10),
      ),
    ],
  },
  '7': {
    advance: 0.54,
    strokes: [poly([[0.06, 0.0], [0.50, 0.0], [0.20, 1.0]])],
  },
  '8': {
    advance: 0.56,
    strokes: [
      ellipseArc(0.28, 0.24, 0.19, 0.24, -90, 270, 20),
      ellipseArc(0.28, 0.74, 0.22, 0.26, -90, 270, 20),
    ],
  },
  '9': {
    advance: 0.56,
    strokes: [
      ellipseArc(0.27, 0.28, 0.20, 0.28, -25, 335, 22),
      cubic(0.47, 0.28, 0.48, 0.72, 0.38, 1.04, 0.12, 0.94, 12),
    ],
  },

  // Punctuation & Math Symbols
  '.': { advance: 0.24, strokes: [dot(0.12, 0.94)] },
  ',': { advance: 0.26, strokes: [dot(0.13, 0.94), quad(0.14, 0.94, 0.14, 1.08, 0.06, 1.15, 5)] },
  ':': { advance: 0.26, strokes: [dot(0.13, 0.48), dot(0.13, 0.94)] },
  ';': {
    advance: 0.26,
    strokes: [dot(0.13, 0.48), dot(0.13, 0.94), quad(0.14, 0.94, 0.14, 1.08, 0.06, 1.15, 5)],
  },
  '!': { advance: 0.28, strokes: [seg(0.14, 0.02, 0.14, 0.74), dot(0.14, 0.94)] },
  '?': {
    advance: 0.46,
    strokes: [
      chain(
        cubic(0.06, 0.20, 0.10, -0.04, 0.42, -0.04, 0.40, 0.26, 12),
        quad(0.40, 0.26, 0.38, 0.46, 0.22, 0.54, 8),
        seg(0.22, 0.54, 0.22, 0.74),
      ),
      dot(0.22, 0.94),
    ],
  },
  "'": { advance: 0.22, strokes: [seg(0.11, 0.0, 0.09, 0.24)] },
  '"': { advance: 0.36, strokes: [seg(0.10, 0.0, 0.08, 0.24), seg(0.24, 0.0, 0.22, 0.24)] },
  '`': { advance: 0.26, strokes: [seg(0.08, 0.02, 0.18, 0.22)] },
  '-': { advance: 0.42, strokes: [seg(0.06, 0.62, 0.36, 0.62)] },
  '–': { advance: 0.52, strokes: [seg(0.06, 0.62, 0.46, 0.62)] },
  '—': { advance: 0.66, strokes: [seg(0.04, 0.62, 0.62, 0.62)] },
  _: { advance: 0.52, strokes: [seg(0.04, 1.06, 0.48, 1.06)] },
  '+': { advance: 0.54, strokes: [seg(0.06, 0.56, 0.48, 0.56), seg(0.27, 0.34, 0.27, 0.78)] },
  '=': { advance: 0.54, strokes: [seg(0.06, 0.46, 0.48, 0.46), seg(0.06, 0.68, 0.48, 0.68)] },
  '*': {
    advance: 0.48,
    strokes: [
      seg(0.24, 0.14, 0.24, 0.56),
      seg(0.06, 0.24, 0.42, 0.46),
      seg(0.42, 0.24, 0.06, 0.46),
    ],
  },
  '×': { advance: 0.52, strokes: [seg(0.08, 0.38, 0.44, 0.76), seg(0.44, 0.38, 0.08, 0.76)] },
  '÷': {
    advance: 0.54,
    strokes: [seg(0.06, 0.56, 0.48, 0.56), dot(0.27, 0.34), dot(0.27, 0.78)],
  },
  '/': { advance: 0.42, strokes: [seg(0.36, 0.0, 0.06, 1.08)] },
  '\\': { advance: 0.42, strokes: [seg(0.06, 0.0, 0.36, 1.08)] },
  '|': { advance: 0.26, strokes: [seg(0.13, -0.04, 0.13, 1.16)] },
  '~': { advance: 0.54, strokes: [cubic(0.04, 0.58, 0.18, 0.40, 0.36, 0.76, 0.50, 0.54, 12)] },
  '(': { advance: 0.34, strokes: [quad(0.26, -0.04, 0.04, 0.54, 0.26, 1.14, 12)] },
  ')': { advance: 0.34, strokes: [quad(0.08, -0.04, 0.30, 0.54, 0.08, 1.14, 12)] },
  '[': { advance: 0.34, strokes: [poly([[0.26, -0.04], [0.10, -0.04], [0.10, 1.14], [0.26, 1.14]])] },
  ']': { advance: 0.34, strokes: [poly([[0.08, -0.04], [0.24, -0.04], [0.24, 1.14], [0.08, 1.14]])] },
  '{': {
    advance: 0.38,
    strokes: [
      chain(
        cubic(0.30, -0.04, 0.14, -0.04, 0.20, 0.48, 0.06, 0.55, 10),
        cubic(0.06, 0.55, 0.20, 0.62, 0.14, 1.14, 0.30, 1.14, 10),
      ),
    ],
  },
  '}': {
    advance: 0.38,
    strokes: [
      chain(
        cubic(0.08, -0.04, 0.24, -0.04, 0.18, 0.48, 0.32, 0.55, 10),
        cubic(0.32, 0.55, 0.18, 0.62, 0.24, 1.14, 0.08, 1.14, 10),
      ),
    ],
  },
  '<': { advance: 0.54, strokes: [poly([[0.46, 0.30], [0.08, 0.56], [0.46, 0.82]])] },
  '>': { advance: 0.54, strokes: [poly([[0.08, 0.30], [0.46, 0.56], [0.08, 0.82]])] },
  '≤': {
    advance: 0.54,
    strokes: [poly([[0.46, 0.22], [0.08, 0.46], [0.46, 0.70]]), seg(0.08, 0.88, 0.46, 0.88)],
  },
  '≥': {
    advance: 0.54,
    strokes: [poly([[0.08, 0.22], [0.46, 0.46], [0.08, 0.70]]), seg(0.08, 0.88, 0.46, 0.88)],
  },
  '≈': {
    advance: 0.56,
    strokes: [
      cubic(0.06, 0.46, 0.18, 0.30, 0.38, 0.62, 0.50, 0.44, 12),
      cubic(0.06, 0.70, 0.18, 0.54, 0.38, 0.86, 0.50, 0.68, 12),
    ],
  },
  '≠': {
    advance: 0.54,
    strokes: [seg(0.06, 0.46, 0.48, 0.46), seg(0.06, 0.68, 0.48, 0.68), seg(0.42, 0.24, 0.12, 0.90)],
  },
  '±': {
    advance: 0.54,
    strokes: [seg(0.08, 0.46, 0.46, 0.46), seg(0.27, 0.24, 0.27, 0.68), seg(0.08, 0.86, 0.46, 0.86)],
  },
  '^': { advance: 0.46, strokes: [poly([[0.08, 0.34], [0.23, 0.04], [0.38, 0.34]])] },
  '%': {
    advance: 0.72,
    strokes: [
      ellipseArc(0.18, 0.20, 0.11, 0.14, -90, 270, 18),
      seg(0.60, 0.02, 0.12, 1.0),
      ellipseArc(0.54, 0.82, 0.11, 0.14, -90, 270, 18),
    ],
  },
  '&': {
    advance: 0.66,
    strokes: [
      chain(
        cubic(0.52, 0.96, 0.06, 0.50, 0.06, 0.04, 0.28, 0.04, 14),
        cubic(0.28, 0.04, 0.46, 0.04, 0.42, 0.34, 0.14, 0.52, 10),
        cubic(0.14, 0.52, 0.02, 0.68, 0.08, 1.0, 0.30, 1.0, 10),
        quad(0.30, 1.0, 0.48, 1.0, 0.56, 0.66, 8),
      ),
    ],
  },
  '@': {
    advance: 0.76,
    strokes: [
      ellipseArc(0.38, 0.52, 0.16, 0.18, -30, 325, 22),
      chain(
        seg(0.54, 0.36, 0.54, 0.68),
        cubic(0.54, 0.68, 0.70, 0.70, 0.72, 0.16, 0.38, 0.12, 14),
        cubic(0.38, 0.12, 0.06, 0.12, 0.04, 0.94, 0.48, 0.96, 14),
      ),
    ],
  },
  '#': {
    advance: 0.60,
    strokes: [
      seg(0.22, 0.06, 0.14, 0.94),
      seg(0.46, 0.06, 0.38, 0.94),
      seg(0.06, 0.36, 0.54, 0.36),
      seg(0.04, 0.66, 0.52, 0.66),
    ],
  },
  '$': {
    advance: 0.56,
    strokes: [
      chain(
        cubic(0.48, 0.18, 0.36, 0.02, 0.08, 0.06, 0.10, 0.28, 10),
        cubic(0.10, 0.28, 0.12, 0.52, 0.50, 0.48, 0.50, 0.74, 10),
        cubic(0.50, 0.74, 0.50, 0.98, 0.14, 1.0, 0.08, 0.80, 10),
      ),
      seg(0.29, -0.04, 0.29, 1.08),
    ],
  },
  '·': { advance: 0.28, strokes: [dot(0.14, 0.56)] },
  '°': { advance: 0.34, strokes: [ellipseArc(0.17, 0.16, 0.10, 0.11, -90, 270, 18)] },
  '√': { advance: 0.60, strokes: [poly([[0.05, 0.58], [0.16, 0.58], [0.28, 1.02], [0.46, 0.0], [0.56, 0.0]])] },
  π: {
    advance: 0.60,
    strokes: [
      seg(0.06, 0.38, 0.54, 0.38),
      seg(0.20, 0.38, 0.16, 1.0),
      chain(
        seg(0.40, 0.38, 0.42, 0.94),
        quad(0.42, 0.94, 0.44, 1.02, 0.52, 0.98, 5),
      ),
    ],
  },
  '∞': {
    advance: 0.76,
    strokes: [
      chain(
        cubic(0.38, 0.64, 0.22, 0.34, 0.04, 0.44, 0.06, 0.68, 10),
        cubic(0.06, 0.68, 0.06, 0.92, 0.24, 0.96, 0.38, 0.64, 10),
        cubic(0.38, 0.64, 0.52, 0.34, 0.70, 0.44, 0.70, 0.68, 10),
        cubic(0.70, 0.68, 0.70, 0.92, 0.52, 0.96, 0.38, 0.64, 10),
      ),
    ],
  },
  '∂': {
    advance: 0.56,
    strokes: [
      cubic(0.14, 0.12, 0.36, -0.06, 0.52, 0.14, 0.48, 0.68, 12),
      ellipseArc(0.28, 0.72, 0.20, 0.28, -30, 330, 22),
    ],
  },
  '∑': { advance: 0.60, strokes: [poly([[0.52, 0.0], [0.06, 0.0], [0.34, 0.50], [0.06, 1.0], [0.52, 1.0]])] },
  '∫': {
    advance: 0.38,
    strokes: [
      chain(
        quad(0.32, 0.04, 0.22, -0.06, 0.20, 0.22, 8),
        seg(0.20, 0.22, 0.18, 0.94),
        quad(0.18, 0.94, 0.16, 1.24, 0.06, 1.14, 8),
      ),
    ],
  },
  θ: {
    advance: 0.54,
    strokes: [ellipseArc(0.27, 0.52, 0.20, 0.48, -90, 270, 24), seg(0.08, 0.52, 0.46, 0.52)],
  },
  α: {
    advance: 0.58,
    strokes: [
      chain(
        cubic(0.50, 0.40, 0.34, 0.94, 0.10, 1.06, 0.08, 0.70, 12),
        cubic(0.08, 0.70, 0.08, 0.32, 0.36, 0.34, 0.50, 1.0, 12),
      ),
    ],
  },
  β: {
    advance: 0.56,
    strokes: [
      seg(0.10, 0.02, 0.10, 1.28),
      chain(
        cubic(0.10, 0.18, 0.18, -0.04, 0.48, 0.02, 0.44, 0.28, 10),
        quad(0.44, 0.28, 0.42, 0.46, 0.18, 0.48, 8),
        cubic(0.18, 0.48, 0.52, 0.50, 0.54, 1.0, 0.10, 0.96, 12),
      ),
    ],
  },
  γ: {
    advance: 0.52,
    strokes: [
      seg(0.06, 0.38, 0.28, 0.96),
      seg(0.46, 0.38, 0.22, 1.28),
    ],
  },
  δ: {
    advance: 0.54,
    strokes: [
      quad(0.40, 0.04, 0.16, -0.02, 0.26, 0.32, 8),
      ellipseArc(0.27, 0.70, 0.20, 0.30, -90, 270, 24),
    ],
  },
  Δ: { advance: 0.68, strokes: [poly([[0.06, 1.0], [0.34, 0.0], [0.62, 1.0], [0.06, 1.0]])] },
  Ω: {
    advance: 0.68,
    strokes: [
      seg(0.06, 1.0, 0.22, 1.0),
      chain(
        cubic(0.22, 1.0, 0.02, 0.56, 0.10, 0.0, 0.34, 0.0, 12),
        cubic(0.34, 0.0, 0.58, 0.0, 0.66, 0.56, 0.46, 1.0, 12),
      ),
      seg(0.46, 1.0, 0.62, 1.0),
    ],
  },
  '→': {
    advance: 0.72,
    strokes: [seg(0.06, 0.58, 0.66, 0.58), poly([[0.48, 0.38], [0.66, 0.58], [0.48, 0.78]])],
  },
  '←': {
    advance: 0.72,
    strokes: [seg(0.06, 0.58, 0.66, 0.58), poly([[0.24, 0.38], [0.06, 0.58], [0.24, 0.78]])],
  },
  '↔': {
    advance: 0.76,
    strokes: [
      seg(0.06, 0.58, 0.70, 0.58),
      poly([[0.22, 0.38], [0.06, 0.58], [0.22, 0.78]]),
      poly([[0.54, 0.38], [0.70, 0.58], [0.54, 0.78]]),
    ],
  },
};

function buildDiacriticStrokes(
  combiningMark: string,
  baseAdvance: number,
  isTallBase: boolean,
): GlyphStroke[] {
  const cx = baseAdvance * 0.5;
  const yBase = isTallBase ? -0.14 : 0.18;
  switch (combiningMark) {
    case '\u0301': // acute
      return [seg(cx - 0.05, yBase + 0.05, cx + 0.08, yBase - 0.08, 5)];
    case '\u0300': // grave
      return [seg(cx - 0.08, yBase - 0.08, cx + 0.05, yBase + 0.05, 5)];
    case '\u0302': // circumflex
      return [poly([[cx - 0.11, yBase + 0.03], [cx, yBase - 0.08], [cx + 0.11, yBase + 0.03]], 4)];
    case '\u0303': // tilde
      return [cubic(cx - 0.13, yBase, cx - 0.04, yBase - 0.10, cx + 0.04, yBase + 0.08, cx + 0.13, yBase - 0.02, 8)];
    case '\u0308': // diaeresis
      return [dot(cx - 0.08, yBase - 0.02, 0.032), dot(cx + 0.08, yBase - 0.02, 0.032)];
    default:
      return [];
  }
}

function resolveGlyphDef(char: string): GlyphDef {
  if (char in GLYPH_MAP) {
    return GLYPH_MAP[char];
  }

  const nfd = char.normalize('NFD');
  const base = nfd[0];
  if (base && base in GLYPH_MAP) {
    const baseDef = GLYPH_MAP[base];
    const isTall = /[A-Z0-9bdfhklt]/.test(base);
    const marks: GlyphStroke[] = [];
    for (let i = 1; i < nfd.length; i++) {
      marks.push(...buildDiacriticStrokes(nfd[i], baseDef.advance, isTall));
    }
    return {
      advance: baseDef.advance,
      strokes: [...baseDef.strokes, ...marks],
    };
  }

  // Graceful visible fallback for uncommon symbols
  return {
    advance: 0.48,
    strokes: [seg(0.10, 0.64, 0.38, 0.64, 6)],
  };
}

function normalizeCharForMetricCheck(char: string): string {
  return char.normalize('NFD')[0] || char;
}

type ScriptKind = 'normal' | 'sup' | 'sub';

interface ScriptRun {
  text: string;
  script: ScriptKind;
}

const SUPERSCRIPT_CHAR_MAP: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁺': '+',
  '⁻': '-',
  '⁼': '=',
  '⁽': '(',
  '⁾': ')',
  'ⁿ': 'n',
  'ⁱ': 'i',
  'ᵃ': 'a',
  'ᵇ': 'b',
  'ᶜ': 'c',
  'ᵈ': 'd',
  'ᵉ': 'e',
  'ᶠ': 'f',
  'ᵍ': 'g',
  'ʰ': 'h',
  'ʲ': 'j',
  'ᵏ': 'k',
  'ˡ': 'l',
  'ᵐ': 'm',
  'ᵒ': 'o',
  'ᵖ': 'p',
  'ʳ': 'r',
  'ˢ': 's',
  'ᵗ': 't',
  'ᵘ': 'u',
  'ᵛ': 'v',
  'ʷ': 'w',
  'ˣ': 'x',
  'ʸ': 'y',
  'ᶻ': 'z',
  'ᴬ': 'A',
  'ᴮ': 'B',
  'ᴰ': 'D',
  'ᴱ': 'E',
  'ᴳ': 'G',
  'ᴴ': 'H',
  'ᴵ': 'I',
  'ᴶ': 'J',
  'ᴷ': 'K',
  'ᴸ': 'L',
  'ᴹ': 'M',
  'ᴺ': 'N',
  'ᴼ': 'O',
  'ᴾ': 'P',
  'ᴿ': 'R',
  'ᵀ': 'T',
  'ᵁ': 'U',
  'ⱽ': 'V',
  'ᵂ': 'W',
};

const SUBSCRIPT_CHAR_MAP: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
  '₊': '+',
  '₋': '-',
  '₌': '=',
  '₍': '(',
  '₎': ')',
  'ₐ': 'a',
  'ₑ': 'e',
  'ₒ': 'o',
  'ₓ': 'x',
  'ₕ': 'h',
  'ₖ': 'k',
  'ₗ': 'l',
  'ₘ': 'm',
  'ₙ': 'n',
  'ₚ': 'p',
  'ₛ': 's',
  'ₜ': 't',
  'ᵢ': 'i',
  'ⱼ': 'j',
  'ᵣ': 'r',
  'ᵤ': 'u',
  'ᵥ': 'v',
};

const LATEX_COMMAND_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\\times\b/g, '×'],
  [/\\cdot\b/g, '·'],
  [/\\div\b/g, '÷'],
  [/\\pm\b/g, '±'],
  [/\\pi\b/g, 'π'],
  [/\\theta\b/g, 'θ'],
  [/\\alpha\b/g, 'α'],
  [/\\beta\b/g, 'β'],
  [/\\gamma\b/g, 'γ'],
  [/\\delta\b/g, 'δ'],
  [/\\Delta\b/g, 'Δ'],
  [/\\Omega\b/g, 'Ω'],
  [/\\sqrt\b/g, '√'],
  [/\\leq\b/g, '≤'],
  [/\\le\b/g, '≤'],
  [/\\geq\b/g, '≥'],
  [/\\ge\b/g, '≥'],
  [/\\neq\b/g, '≠'],
  [/\\ne\b/g, '≠'],
  [/\\approx\b/g, '≈'],
  [/\\infty\b/g, '∞'],
  [/\\rightarrow\b/g, '→'],
  [/\\to\b/g, '→'],
  [/\\leftarrow\b/g, '←'],
  [/\\leftrightarrow\b/g, '↔'],
  [/\\sum\b/g, '∑'],
  [/\\int\b/g, '∫'],
  [/\\partial\b/g, '∂'],
];

function normalizeMathMarkup(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return lines
    .map((line) => {
      let next = line
        .replace(/\\\((.+?)\\\)/g, '$1')
        .replace(/\\\[(.+?)\\\]/g, '$1');
      const dollarWrapped = /^\$\$(.+)\$\$$/.exec(next.trim());
      if (dollarWrapped) {
        next = dollarWrapped[1];
      } else {
        const singleDollarWrapped = /^\$([^$]+)\$$/.exec(next.trim());
        if (singleDollarWrapped) {
          next = singleDollarWrapped[1];
        }
      }
      for (const [pattern, replacement] of LATEX_COMMAND_REPLACEMENTS) {
        next = next.replace(pattern, replacement);
      }
      return next;
    })
    .join('\n');
}

function findBalancedGroupEnd(line: string, openIdx: number, openChar: string, closeChar: string): number {
  let depth = 0;
  for (let i = openIdx; i < line.length; i++) {
    if (line[i] === openChar) depth += 1;
    else if (line[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const MATH_BASE_CHAR_RE = /[A-Za-z0-9)\]}πθαβγδΔΩ°]/;

function tokenizeScriptRuns(line: string): ScriptRun[] {
  const runs: ScriptRun[] = [];
  const pushRun = (script: ScriptKind, text: string) => {
    if (!text) return;
    const prev = runs[runs.length - 1];
    if (prev && prev.script === script) {
      prev.text += text;
    } else {
      runs.push({ script, text });
    }
  };

  let hasMathBase = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];

    if (ch in SUPERSCRIPT_CHAR_MAP) {
      pushRun('sup', SUPERSCRIPT_CHAR_MAP[ch]);
      hasMathBase = true;
      i += 1;
      continue;
    }

    if (ch in SUBSCRIPT_CHAR_MAP) {
      pushRun('sub', SUBSCRIPT_CHAR_MAP[ch]);
      hasMathBase = true;
      i += 1;
      continue;
    }

    if (ch === '^' && hasMathBase && i + 1 < line.length) {
      const next = line[i + 1];
      if (next === '{') {
        const closeIdx = findBalancedGroupEnd(line, i + 1, '{', '}');
        if (closeIdx > i + 1) {
          const inner = line.slice(i + 2, closeIdx);
          if (inner.length > 0) {
            pushRun('sup', inner);
            i = closeIdx + 1;
            continue;
          }
        }
      } else if (next === '(') {
        const closeIdx = findBalancedGroupEnd(line, i + 1, '(', ')');
        if (closeIdx > i + 1) {
          pushRun('sup', line.slice(i + 1, closeIdx + 1));
          i = closeIdx + 1;
          continue;
        }
      } else {
        const rest = line.slice(i + 1);
        const numMatch = /^([+-]?\d+(?:\.\d+)?)/.exec(rest);
        if (numMatch) {
          pushRun('sup', numMatch[1]);
          i += 1 + numMatch[1].length;
          continue;
        }
        const varMatch = /^([+-]?[A-Za-zπθαβγδΔΩ])/.exec(rest);
        if (varMatch) {
          pushRun('sup', varMatch[1]);
          i += 1 + varMatch[1].length;
          continue;
        }
      }
    }

    if (ch === '_' && hasMathBase && i + 1 < line.length) {
      const next = line[i + 1];
      if (next === '{') {
        const closeIdx = findBalancedGroupEnd(line, i + 1, '{', '}');
        if (closeIdx > i + 1) {
          const inner = line.slice(i + 2, closeIdx);
          if (inner.length > 0) {
            pushRun('sub', inner);
            i = closeIdx + 1;
            continue;
          }
        }
      } else {
        const digitMatch = /^(\d+)/.exec(line.slice(i + 1));
        if (digitMatch) {
          pushRun('sub', digitMatch[1]);
          i += 1 + digitMatch[1].length;
          continue;
        }
      }
    }

    pushRun('normal', ch);
    hasMathBase = MATH_BASE_CHAR_RE.test(ch);
    i += 1;
  }

  return runs;
}

/**
 * Converts recognized text into neat, natural vector handwriting `Stroke[]` drawings
 * so AI handwriting correction keeps user notes as editable/erasable ink strokes.
 */
export function textToHandwritingStrokes(params: TextToHandwritingStrokesParams): Stroke[] {
  const { text, bounds, color, strokeSize, groupId } = params;
  const trimmed = text.trim();
  if (!trimmed) return [];

  const createdAt = params.createdAt ?? Date.now();
  const normalizedText = normalizeMathMarkup(text);
  const lines = normalizedText.split('\n');
  const tokenizedLines = lines.map((line) => tokenizeScriptRuns(line));

  let hasAscenderOrCap = false;
  let hasDescender = false;
  let hasSuperscript = false;
  let hasSubscript = false;

  for (const runs of tokenizedLines) {
    for (const run of runs) {
      if (run.script === 'sup') {
        hasSuperscript = true;
        hasAscenderOrCap = true;
        continue;
      }
      if (run.script === 'sub') {
        hasSubscript = true;
        continue;
      }
      for (const ch of run.text) {
        const base = normalizeCharForMetricCheck(ch);
        if (/[A-Z0-9bdfhklt!?'`"()[\]{}|/\\#$%&*+=<>≤≥≈≠±°√∞∂∑∫ΔΩ]/.test(base)) {
          hasAscenderOrCap = true;
        }
        if (/[gjpqy,;()[\]{}|/_]/.test(base)) {
          hasDescender = true;
        }
      }
    }
  }

  const topRef = hasSuperscript ? -0.10 : hasAscenderOrCap ? 0.0 : 0.36;
  const botRef = hasDescender ? 1.28 : hasSubscript ? 1.12 : 1.0;
  const rawPerLineHeight = Math.max(
    14,
    (bounds.maxY - bounds.minY) / Math.max(1, lines.length),
  );
  const capHeight = Math.max(
    20,
    Math.min(160, rawPerLineHeight / Math.max(0.5, botRef - topRef)),
  );
  const originY = bounds.minY - topRef * capHeight;
  const lineStep = capHeight * 1.45;
  const finalSize = Math.max(
    1.8,
    Math.min(capHeight * 0.15, Math.max(strokeSize || 3, capHeight * 0.075)),
  );
  const roundedSize = Number(finalSize.toFixed(2));
  const scriptScale = capHeight * 0.54;
  const scriptSize = Number(Math.max(1.6, roundedSize * 0.8).toFixed(2));
  const slantFactor = 0.065;
  const letterGap = 0.08;
  const scriptLetterGap = 0.06;
  const spaceAdvance = 0.38;

  const strokes: Stroke[] = [];

  for (let lineIdx = 0; lineIdx < tokenizedLines.length; lineIdx++) {
    const runs = tokenizedLines[lineIdx];
    const lineOriginY = originY + lineIdx * lineStep;
    let cursorX = bounds.minX;
    let prevScript: ScriptKind = 'normal';

    for (const run of runs) {
      if (run.script !== 'normal' && prevScript === 'normal') {
        cursorX -= capHeight * 0.02;
      }

      const charScale = run.script === 'normal' ? capHeight : scriptScale;
      const charOriginY =
        run.script === 'sup'
          ? lineOriginY - capHeight * 0.12
          : run.script === 'sub'
            ? lineOriginY + capHeight * 0.56
            : lineOriginY;
      const charStrokeSize = run.script === 'normal' ? roundedSize : scriptSize;
      const charGap = run.script === 'normal' ? letterGap : scriptLetterGap;

      for (const ch of run.text) {
        if (ch === ' ' || ch === '\t') {
          cursorX += (ch === '\t' ? spaceAdvance * 2 : spaceAdvance) * charScale;
          continue;
        }

        const glyph = resolveGlyphDef(ch);
        for (const gs of glyph.strokes) {
          if (gs.pts.length === 0) continue;
          const total = gs.pts.length;
          const points: StrokePoint[] = gs.pts.map(([nx, ny], idx) => {
            const slantOffset = (0.55 - ny) * slantFactor * charScale;
            const x = cursorX + nx * charScale + slantOffset;
            const y = charOriginY + ny * charScale;
            const u = total <= 1 ? 0.5 : idx / (total - 1);
            const pressure = gs.isDot
              ? 0.62
              : 0.46 + 0.1 * Math.sin(u * Math.PI);
            return {
              x: Number(x.toFixed(2)),
              y: Number(y.toFixed(2)),
              pressure: Number(pressure.toFixed(3)),
            };
          });

          strokes.push({
            id: createId(),
            tool: 'pen',
            color,
            size: charStrokeSize,
            opacity: 1,
            simulatePressure: false,
            points,
            bounds: computeBoundsFromPoints(points, charStrokeSize * 0.6),
            isTidied: true,
            ...(groupId ? { groupId } : {}),
            createdAt,
          });
        }

        cursorX += (glyph.advance + charGap) * charScale;
      }

      prevScript = run.script;
    }
  }

  return strokes;
}
