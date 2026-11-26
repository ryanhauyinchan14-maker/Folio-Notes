import type { StrokePoint } from '../types/notes';

export type SymmetryMode = 'off' | 'vertical' | 'horizontal' | 'quadrant' | 'radial';

export const SYMMETRY_MODES: Array<{
  id: SymmetryMode;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  { id: 'off', label: 'Off', shortLabel: 'Off', description: 'Standard freehand drawing' },
  { id: 'vertical', label: 'Vertical Mirror', shortLabel: 'Vert', description: 'Mirror left and right across center' },
  { id: 'horizontal', label: 'Horizontal Mirror', shortLabel: 'Horiz', description: 'Mirror top and bottom across center' },
  { id: 'quadrant', label: 'Quadrant Mirror', shortLabel: 'Quad', description: '4-way mirror across both axes' },
  { id: 'radial', label: 'Radial Kaleidoscope', shortLabel: 'Radial', description: '8-way radial mandala symmetry' },
];

export function getSymmetryBranches(
  points: StrokePoint[],
  mode: SymmetryMode,
  cx: number,
  cy: number,
): StrokePoint[][] {
  if (mode === 'off' || points.length === 0) {
    return [points];
  }

  if (mode === 'vertical') {
    return [
      points,
      points.map((p) => ({ ...p, x: 2 * cx - p.x })),
    ];
  }

  if (mode === 'horizontal') {
    return [
      points,
      points.map((p) => ({ ...p, y: 2 * cy - p.y })),
    ];
  }

  if (mode === 'quadrant') {
    return [
      points,
      points.map((p) => ({ ...p, x: 2 * cx - p.x })),
      points.map((p) => ({ ...p, y: 2 * cy - p.y })),
      points.map((p) => ({ ...p, x: 2 * cx - p.x, y: 2 * cy - p.y })),
    ];
  }

  // Radial 8-fold rotational symmetry around (cx, cy)
  const branches: StrokePoint[][] = [points];
  for (let k = 1; k < 8; k++) {
    const angle = (k * Math.PI) / 4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    branches.push(
      points.map((p) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        return {
          ...p,
          x: cx + dx * cos - dy * sin,
          y: cy + dx * sin + dy * cos,
        };
      }),
    );
  }
  return branches;
}

export function drawSymmetryGuides(
  ctx: CanvasRenderingContext2D,
  mode: SymmetryMode,
  cx: number,
  cy: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  invZoom = 1,
): void {
  if (mode === 'off') return;
  ctx.save();
  ctx.strokeStyle = 'rgba(253, 110, 136, 0.48)';
  ctx.lineWidth = Math.max(0.75, 1.4 * invZoom);
  ctx.setLineDash([6 * invZoom, 5 * invZoom]);

  const drawVertical = mode === 'vertical' || mode === 'quadrant' || mode === 'radial';
  const drawHorizontal = mode === 'horizontal' || mode === 'quadrant' || mode === 'radial';

  ctx.beginPath();
  if (drawVertical) {
    ctx.moveTo(cx, minY);
    ctx.lineTo(cx, maxY);
  }
  if (drawHorizontal) {
    ctx.moveTo(minX, cy);
    ctx.lineTo(maxX, cy);
  }
  if (mode === 'radial') {
    const reach = Math.hypot(maxX - minX, maxY - minY);
    ctx.moveTo(cx - reach, cy - reach);
    ctx.lineTo(cx + reach, cy + reach);
    ctx.moveTo(cx - reach, cy + reach);
    ctx.lineTo(cx + reach, cy - reach);
  }
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(253, 110, 136, 0.72)';
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, 3.5 * invZoom), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
