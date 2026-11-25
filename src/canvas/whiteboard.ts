import type {
  BoundingBox,
  Page,
  PageImage,
  PaperConfig,
  ShapeGeometry,
  Stroke,
  Textbox,
} from '../types/notes';
import { getImageBounds } from './imageRenderer';
import { getTextboxBounds } from './selection';

export const WHITEBOARD_MIN_ZOOM = 0.05;
export const WHITEBOARD_MAX_ZOOM = 5.0;
export const NOTEBOOK_MIN_ZOOM = 0.35;
export const NOTEBOOK_ABSOLUTE_MIN_ZOOM = 0.01;
export const NOTEBOOK_MAX_ZOOM = 3.5;
export const WHITEBOARD_EXPORT_MARGIN = 48;
const NOTEBOOK_FIT_OVERVIEW_PX = 400;

export const DEFAULT_WHITEBOARD_PAPER: PaperConfig = {
  sizePreset: 'custom',
  orientation: 'landscape',
  width: 1200,
  height: 800,
  pattern: 'dotted',
  spacing: 32,
  marginLine: false,
  paperColor: '#FFFFFF',
};

export interface WhiteboardCamera {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

/**
 * Computes the lowest zoom factor allowed for a single page so standard Letter/A4
 * sheets stay floored at 35%, while oversized sheets (up to 24,000 px) can zoom out
 * proportionally until the whole page fits within ~400 px overview span.
 */
export function getNotebookMinZoomForPaper(
  paper?: Pick<PaperConfig, 'width' | 'height'> | null,
): number {
  if (!paper) return NOTEBOOK_MIN_ZOOM;
  const maxDim = Math.max(Number(paper.width) || 0, Number(paper.height) || 0);
  if (maxDim <= 0) return NOTEBOOK_MIN_ZOOM;
  const dynamicMin = NOTEBOOK_FIT_OVERVIEW_PX / maxDim;
  const clamped = Math.max(NOTEBOOK_ABSOLUTE_MIN_ZOOM, Math.min(NOTEBOOK_MIN_ZOOM, dynamicMin));
  return Number(clamped.toFixed(4));
}

/**
 * Computes the lowest zoom factor across a paper config or all pages in a notebook
 * so zooming out on multi-page notebooks accommodates the largest sheet.
 */
export function getNotebookMinZoom(
  pagesOrPaper?: Pick<PaperConfig, 'width' | 'height'> | readonly Pick<Page, 'paper'>[] | null,
): number {
  if (!pagesOrPaper) return NOTEBOOK_MIN_ZOOM;
  if (Array.isArray(pagesOrPaper)) {
    let maxDim = 0;
    for (const entry of pagesOrPaper) {
      const p = entry?.paper;
      if (!p) continue;
      const candidate = Math.max(Number(p.width) || 0, Number(p.height) || 0);
      if (candidate > maxDim) maxDim = candidate;
    }
    return maxDim > 0
      ? getNotebookMinZoomForPaper({ width: maxDim, height: maxDim })
      : NOTEBOOK_MIN_ZOOM;
  }
  return getNotebookMinZoomForPaper(pagesOrPaper as Pick<PaperConfig, 'width' | 'height'>);
}

/**
 * Computes the next discrete zoom step (+ / - button or Ctrl+=/−), switching to
 * proportional stepping below ~50% so deep zoom ranges (e.g., 2%–25%) remain smooth.
 */
export function stepCanvasZoom(
  currentZoom: number,
  direction: 1 | -1,
  minZoom: number,
  maxZoom: number,
): number {
  const safeCurrent = Number.isFinite(currentZoom) ? currentZoom : 1;
  const safeMin = Number.isFinite(minZoom) ? Math.max(NOTEBOOK_ABSOLUTE_MIN_ZOOM, minZoom) : NOTEBOOK_MIN_ZOOM;
  const safeMax = Number.isFinite(maxZoom) ? Math.max(safeMin, maxZoom) : NOTEBOOK_MAX_ZOOM;
  const rawNext =
    direction < 0
      ? safeCurrent > 0.55
        ? safeCurrent - 0.15
        : Math.min(safeCurrent - 0.005, safeCurrent * 0.8)
      : safeCurrent >= 0.45
        ? safeCurrent + 0.15
        : Math.max(safeCurrent + 0.005, safeCurrent * 1.25);
  const clamped = Math.max(safeMin, Math.min(safeMax, rawNext));
  return Number(clamped.toFixed(4));
}

export function clampWhiteboardZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  const clamped = Math.max(WHITEBOARD_MIN_ZOOM, Math.min(WHITEBOARD_MAX_ZOOM, zoom));
  return Number(clamped.toFixed(4));
}

export function clampNotebookZoom(zoom: number, minZoom = NOTEBOOK_MIN_ZOOM): number {
  if (!Number.isFinite(zoom)) return 1;
  const safeMin = Number.isFinite(minZoom)
    ? Math.max(NOTEBOOK_ABSOLUTE_MIN_ZOOM, Math.min(NOTEBOOK_MAX_ZOOM, minZoom))
    : NOTEBOOK_MIN_ZOOM;
  const clamped = Math.max(safeMin, Math.min(NOTEBOOK_MAX_ZOOM, zoom));
  return Number(clamped.toFixed(4));
}

export function screenToWorld(
  sx: number,
  sy: number,
  camera: WhiteboardCamera,
): { x: number; y: number } {
  const safeZoom = Math.max(0.005, camera.zoom || 1);
  return {
    x: (sx - camera.offsetX) / safeZoom,
    y: (sy - camera.offsetY) / safeZoom,
  };
}

export function worldToScreen(
  wx: number,
  wy: number,
  camera: WhiteboardCamera,
): { x: number; y: number } {
  const safeZoom = Math.max(0.005, camera.zoom || 1);
  return {
    x: wx * safeZoom + camera.offsetX,
    y: wy * safeZoom + camera.offsetY,
  };
}

export function zoomCameraAtPoint(
  camera: WhiteboardCamera,
  rawNextZoom: number,
  pivotX: number,
  pivotY: number,
): WhiteboardCamera {
  const nextZoom = clampWhiteboardZoom(rawNextZoom);
  const worldPivot = screenToWorld(pivotX, pivotY, camera);
  return {
    zoom: nextZoom,
    offsetX: pivotX - worldPivot.x * nextZoom,
    offsetY: pivotY - worldPivot.y * nextZoom,
  };
}

export function createOriginCamera(
  viewportWidth: number,
  viewportHeight: number,
  zoom = 1,
): WhiteboardCamera {
  const safeZoom = clampWhiteboardZoom(zoom);
  return {
    offsetX: Math.round((Math.max(300, viewportWidth) / 2) * 100) / 100,
    offsetY: Math.round((Math.max(200, viewportHeight) / 2) * 100) / 100,
    zoom: safeZoom,
  };
}

export function getPageContentBounds(
  page: Pick<Page, 'strokes' | 'textboxes' | 'images'>,
): BoundingBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasAny = false;

  const expand = (b: BoundingBox) => {
    hasAny = true;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  };

  for (const s of page.strokes) {
    if (s.bounds) {
      expand(s.bounds);
    }
  }
  for (const tb of page.textboxes ?? []) {
    expand(getTextboxBounds(tb));
  }
  for (const im of page.images ?? []) {
    expand(getImageBounds(im));
  }

  return hasAny ? { minX, minY, maxX, maxY } : null;
}

export function computeFitContentCamera(
  bounds: BoundingBox | null,
  viewportWidth: number,
  viewportHeight: number,
  padding = 72,
): WhiteboardCamera {
  const vw = Math.max(300, viewportWidth);
  const vh = Math.max(200, viewportHeight);
  if (!bounds) {
    return createOriginCamera(vw, vh, 1);
  }

  const contentW = Math.max(40, bounds.maxX - bounds.minX);
  const contentH = Math.max(40, bounds.maxY - bounds.minY);
  const availW = Math.max(120, vw - padding * 2);
  const availH = Math.max(120, vh - padding * 2);
  const fitZoom = clampWhiteboardZoom(Math.min(2.0, Math.min(availW / contentW, availH / contentH)));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  return {
    zoom: fitZoom,
    offsetX: vw / 2 - centerX * fitZoom,
    offsetY: vh / 2 - centerY * fitZoom,
  };
}

function shiftShape(shape: ShapeGeometry, dx: number, dy: number): ShapeGeometry {
  if (shape.kind === 'line') {
    return {
      ...shape,
      x1: shape.x1 + dx,
      y1: shape.y1 + dy,
      x2: shape.x2 + dx,
      y2: shape.y2 + dy,
    };
  }
  if (shape.kind === 'rect') {
    return {
      ...shape,
      x: shape.x + dx,
      y: shape.y + dy,
    };
  }
  return {
    ...shape,
    cx: shape.cx + dx,
    cy: shape.cy + dy,
  };
}

function shiftStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  return {
    ...stroke,
    points: stroke.points.map((p) => ({
      ...p,
      x: p.x + dx,
      y: p.y + dy,
    })),
    shape: stroke.shape ? shiftShape(stroke.shape, dx, dy) : undefined,
    bounds: {
      minX: stroke.bounds.minX + dx,
      minY: stroke.bounds.minY + dy,
      maxX: stroke.bounds.maxX + dx,
      maxY: stroke.bounds.maxY + dy,
    },
  };
}

function shiftTextbox(tb: Textbox, dx: number, dy: number): Textbox {
  return {
    ...tb,
    x: tb.x + dx,
    y: tb.y + dy,
  };
}

function shiftImage(im: PageImage, dx: number, dy: number): PageImage {
  return {
    ...im,
    x: im.x + dx,
    y: im.y + dy,
  };
}

/**
 * Normalizes an unbounded whiteboard page onto a tight positive paper canvas
 * framed around its element bounding box (+`margin` px padding on each side)
 * for PDF, PNG, JPG, SVG exports and Home Shelf thumbnails.
 */
export function normalizeWhiteboardPageForExport(
  page: Page,
  margin = WHITEBOARD_EXPORT_MARGIN,
): Page {
  const bounds = getPageContentBounds(page);
  if (!bounds) {
    return {
      ...page,
      paper: {
        ...page.paper,
        sizePreset: 'custom',
        width: 1200,
        height: 800,
        marginLine: false,
      },
      strokes: [],
      textboxes: [],
      images: [],
    };
  }

  const originX = bounds.minX - margin;
  const originY = bounds.minY - margin;
  const width = Math.max(120, Math.ceil(bounds.maxX - bounds.minX + margin * 2));
  const height = Math.max(120, Math.ceil(bounds.maxY - bounds.minY + margin * 2));
  const dx = -originX;
  const dy = -originY;

  return {
    ...page,
    paper: {
      ...page.paper,
      sizePreset: 'custom',
      orientation: width >= height ? 'landscape' : 'portrait',
      width,
      height,
      marginLine: false,
    },
    strokes: page.strokes.map((s) => shiftStroke(s, dx, dy)),
    textboxes: (page.textboxes ?? []).map((tb) => shiftTextbox(tb, dx, dy)),
    images: (page.images ?? []).map((im) => shiftImage(im, dx, dy)),
  };
}
