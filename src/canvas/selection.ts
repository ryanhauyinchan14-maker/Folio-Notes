import type {
  BoundingBox,
  Page,
  PageImage,
  PaperConfig,
  Stroke,
  Textbox,
} from '../types/notes';
import { createId } from '../utils/id';
import { getCombinedBounds, translateStroke } from './geometry';
import { getImageBounds } from './imageRenderer';
import { measureTextboxLayout } from './textLayout';

export interface PageElementSelection {
  strokeIds: string[];
  textboxIds: string[];
  imageIds: string[];
}

export type ElementAlignment =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom';

export interface SelectionSummary {
  totalCount: number;
  strokeCount: number;
  textboxCount: number;
  imageCount: number;
  groupIds: string[];
  isSingleGroup: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  allLocked: boolean;
  anyLocked: boolean;
  combinedBounds: BoundingBox | null;
}

export function getTextboxBounds(tb: Textbox): BoundingBox {
  const layout = measureTextboxLayout(tb);
  return {
    minX: tb.x,
    minY: tb.y,
    maxX: tb.x + layout.width,
    maxY: tb.y + layout.height,
  };
}

export function mergeBounds(boxes: BoundingBox[]): BoundingBox | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Expands a page selection so selecting any member of a group selects every
 * member sharing that `groupId` across strokes, textboxes, and images.
 */
export function expandSelectionWithGroups(
  page: Pick<Page, 'strokes' | 'textboxes' | 'images'>,
  sel: PageElementSelection,
): PageElementSelection {
  const strokeSet = new Set(sel.strokeIds);
  const tbSet = new Set(sel.textboxIds);
  const imgSet = new Set(sel.imageIds);
  const groupIds = new Set<string>();

  for (const s of page.strokes) {
    if (strokeSet.has(s.id) && s.groupId) groupIds.add(s.groupId);
  }
  for (const tb of page.textboxes ?? []) {
    if (tbSet.has(tb.id) && tb.groupId) groupIds.add(tb.groupId);
  }
  for (const im of page.images ?? []) {
    if (imgSet.has(im.id) && im.groupId) groupIds.add(im.groupId);
  }

  if (groupIds.size > 0) {
    for (const s of page.strokes) {
      if (s.groupId && groupIds.has(s.groupId)) strokeSet.add(s.id);
    }
    for (const tb of page.textboxes ?? []) {
      if (tb.groupId && groupIds.has(tb.groupId)) tbSet.add(tb.id);
    }
    for (const im of page.images ?? []) {
      if (im.groupId && groupIds.has(im.groupId)) imgSet.add(im.id);
    }
  }

  return {
    strokeIds: page.strokes.filter((s) => strokeSet.has(s.id)).map((s) => s.id),
    textboxIds: (page.textboxes ?? []).filter((t) => tbSet.has(t.id)).map((t) => t.id),
    imageIds: (page.images ?? []).filter((i) => imgSet.has(i.id)).map((i) => i.id),
  };
}

/**
 * Summarizes counts, group state, lock flags, and combined bounds for a page selection.
 */
export function getSelectionSummary(
  page: Pick<Page, 'strokes' | 'textboxes' | 'images'>,
  sel: PageElementSelection,
): SelectionSummary {
  const strokeSet = new Set(sel.strokeIds);
  const tbSet = new Set(sel.textboxIds);
  const imgSet = new Set(sel.imageIds);

  const selectedStrokes = page.strokes.filter((s) => strokeSet.has(s.id));
  const selectedTextboxes = (page.textboxes ?? []).filter((t) => tbSet.has(t.id));
  const selectedImages = (page.images ?? []).filter((i) => imgSet.has(i.id));

  const groupIdSet = new Set<string>();
  let allShareSingleGroup = true;
  let sharedGroupCandidate: string | null = null;
  let lockedCount = 0;

  const inspectItem = (groupId?: string, locked?: boolean) => {
    if (locked) lockedCount++;
    if (groupId) {
      groupIdSet.add(groupId);
      if (sharedGroupCandidate === null) {
        sharedGroupCandidate = groupId;
      } else if (sharedGroupCandidate !== groupId) {
        allShareSingleGroup = false;
      }
    } else {
      allShareSingleGroup = false;
    }
  };

  for (const s of selectedStrokes) inspectItem(s.groupId, s.locked);
  for (const tb of selectedTextboxes) inspectItem(tb.groupId, tb.locked);
  for (const im of selectedImages) inspectItem(im.groupId, im.locked);

  const totalCount =
    selectedStrokes.length + selectedTextboxes.length + selectedImages.length;
  const groupIds = Array.from(groupIdSet);
  const isSingleGroup =
    totalCount >= 2 && groupIds.length === 1 && allShareSingleGroup;
  const canGroup = totalCount >= 2 && !isSingleGroup;
  const canUngroup = groupIds.length > 0;
  const allLocked = totalCount > 0 && lockedCount === totalCount;
  const anyLocked = lockedCount > 0;

  const boxes: BoundingBox[] = [];
  const strokeBounds = getCombinedBounds(selectedStrokes);
  if (strokeBounds) boxes.push(strokeBounds);
  for (const tb of selectedTextboxes) boxes.push(getTextboxBounds(tb));
  for (const im of selectedImages) boxes.push(getImageBounds(im));

  return {
    totalCount,
    strokeCount: selectedStrokes.length,
    textboxCount: selectedTextboxes.length,
    imageCount: selectedImages.length,
    groupIds,
    isSingleGroup,
    canGroup,
    canUngroup,
    allLocked,
    anyLocked,
    combinedBounds: mergeBounds(boxes),
  };
}

/**
 * Re-maps `groupId` values consistently across cloned strokes, textboxes, and images
 * so duplicated, pasted, or cloned groups stay independent of originals.
 */
export function remapGroupIdsForClones(
  strokes: Stroke[],
  textboxes: Textbox[],
  images: PageImage[],
  clearLock = true,
): { strokes: Stroke[]; textboxes: Textbox[]; images: PageImage[] } {
  const map = new Map<string, string>();
  const mapGroup = (gid?: string): string | undefined => {
    if (!gid) return undefined;
    let next = map.get(gid);
    if (!next) {
      next = createId();
      map.set(gid, next);
    }
    return next;
  };

  return {
    strokes: strokes.map((s) => ({
      ...s,
      groupId: mapGroup(s.groupId),
      locked: clearLock ? undefined : s.locked,
    })),
    textboxes: textboxes.map((t) => ({
      ...t,
      groupId: mapGroup(t.groupId),
      locked: clearLock ? undefined : t.locked,
    })),
    images: images.map((im) => ({
      ...im,
      groupId: mapGroup(im.groupId),
      locked: clearLock ? undefined : im.locked,
    })),
  };
}

interface AlignmentUnit {
  strokeIds: Set<string>;
  textboxIds: Set<string>;
  imageIds: Set<string>;
  bounds: BoundingBox;
}

/**
 * Aligns unlocked selected elements horizontally or vertically. Group members move together;
 * 2+ units align to their shared bounds, while 1 unit aligns to page margins/center.
 */
export function computeAlignedElements(
  page: Pick<Page, 'strokes' | 'textboxes' | 'images'> & {
    paper: Pick<PaperConfig, 'width' | 'height'>;
  },
  sel: PageElementSelection,
  alignment: ElementAlignment,
): { strokes: Stroke[]; textboxes: Textbox[]; images: PageImage[]; changed: boolean } {
  const strokeSet = new Set(sel.strokeIds);
  const tbSet = new Set(sel.textboxIds);
  const imgSet = new Set(sel.imageIds);

  const unitMap = new Map<
    string,
    { strokeIds: Set<string>; textboxIds: Set<string>; imageIds: Set<string>; boxes: BoundingBox[] }
  >();

  const pushToUnit = (
    key: string,
    kind: 'stroke' | 'textbox' | 'image',
    id: string,
    bounds: BoundingBox,
  ) => {
    let unit = unitMap.get(key);
    if (!unit) {
      unit = {
        strokeIds: new Set(),
        textboxIds: new Set(),
        imageIds: new Set(),
        boxes: [],
      };
      unitMap.set(key, unit);
    }
    if (kind === 'stroke') unit.strokeIds.add(id);
    else if (kind === 'textbox') unit.textboxIds.add(id);
    else unit.imageIds.add(id);
    unit.boxes.push(bounds);
  };

  for (const s of page.strokes) {
    if (!strokeSet.has(s.id) || s.locked) continue;
    pushToUnit(s.groupId ? `group:${s.groupId}` : `s:${s.id}`, 'stroke', s.id, s.bounds);
  }
  for (const tb of page.textboxes ?? []) {
    if (!tbSet.has(tb.id) || tb.locked) continue;
    pushToUnit(
      tb.groupId ? `group:${tb.groupId}` : `tb:${tb.id}`,
      'textbox',
      tb.id,
      getTextboxBounds(tb),
    );
  }
  for (const im of page.images ?? []) {
    if (!imgSet.has(im.id) || im.locked) continue;
    pushToUnit(
      im.groupId ? `group:${im.groupId}` : `img:${im.id}`,
      'image',
      im.id,
      getImageBounds(im),
    );
  }

  const units: AlignmentUnit[] = [];
  for (const u of unitMap.values()) {
    const merged = mergeBounds(u.boxes);
    if (merged) {
      units.push({
        strokeIds: u.strokeIds,
        textboxIds: u.textboxIds,
        imageIds: u.imageIds,
        bounds: merged,
      });
    }
  }

  if (units.length === 0) {
    return {
      strokes: page.strokes,
      textboxes: page.textboxes ?? [],
      images: page.images ?? [],
      changed: false,
    };
  }

  const targetBounds: BoundingBox =
    units.length >= 2
      ? mergeBounds(units.map((u) => u.bounds))!
      : {
          minX: 48,
          minY: 48,
          maxX: Math.max(96, page.paper.width - 48),
          maxY: Math.max(96, page.paper.height - 48),
        };

  const targetCenterX = (targetBounds.minX + targetBounds.maxX) / 2;
  const targetCenterY = (targetBounds.minY + targetBounds.maxY) / 2;

  const strokeDelta = new Map<string, { dx: number; dy: number }>();
  const tbDelta = new Map<string, { dx: number; dy: number }>();
  const imgDelta = new Map<string, { dx: number; dy: number }>();
  let changed = false;

  for (const u of units) {
    let dx = 0;
    let dy = 0;
    const b = u.bounds;
    if (alignment === 'left') dx = targetBounds.minX - b.minX;
    else if (alignment === 'center') dx = targetCenterX - (b.minX + b.maxX) / 2;
    else if (alignment === 'right') dx = targetBounds.maxX - b.maxX;
    else if (alignment === 'top') dy = targetBounds.minY - b.minY;
    else if (alignment === 'middle') dy = targetCenterY - (b.minY + b.maxY) / 2;
    else if (alignment === 'bottom') dy = targetBounds.maxY - b.maxY;

    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
    changed = true;
    for (const id of u.strokeIds) strokeDelta.set(id, { dx, dy });
    for (const id of u.textboxIds) tbDelta.set(id, { dx, dy });
    for (const id of u.imageIds) imgDelta.set(id, { dx, dy });
  }

  if (!changed) {
    return {
      strokes: page.strokes,
      textboxes: page.textboxes ?? [],
      images: page.images ?? [],
      changed: false,
    };
  }

  const now = Date.now();
  const nextStrokes = page.strokes.map((s) => {
    const d = strokeDelta.get(s.id);
    return d ? translateStroke(s, d.dx, d.dy) : s;
  });
  const nextTextboxes = (page.textboxes ?? []).map((tb) => {
    const d = tbDelta.get(tb.id);
    return d
      ? {
          ...tb,
          x: Math.max(4, Math.min(page.paper.width - 20, tb.x + d.dx)),
          y: Math.max(4, Math.min(page.paper.height - 16, tb.y + d.dy)),
          updatedAt: now,
        }
      : tb;
  });
  const nextImages = (page.images ?? []).map((im) => {
    const d = imgDelta.get(im.id);
    return d
      ? {
          ...im,
          x: Math.max(-im.width + 20, Math.min(page.paper.width - 20, im.x + d.dx)),
          y: Math.max(-im.height + 20, Math.min(page.paper.height - 20, im.y + d.dy)),
          updatedAt: now,
        }
      : im;
  });

  return {
    strokes: nextStrokes,
    textboxes: nextTextboxes,
    images: nextImages,
    changed: true,
  };
}
