import { describe, expect, it } from 'vitest';
import { computeDragAlignment } from '../alignment';

describe('alignment (magnetic guides, Shift axis-lock, Ctrl bypass)', () => {
  const paper = { width: 816, height: 1056 };

  it('snaps moving bounds within 5px to page center and emits magenta guide', () => {
    const res = computeDragAlignment({
      originBounds: { minX: 300, minY: 200, maxX: 400, maxY: 220 },
      rawDx: 55, // candidate center X = 350 + 55 = 405 (within 5px of 408)
      rawDy: 10,
      paper,
      otherTextboxBounds: [],
      axisLock: false,
      bypassSnap: false,
      snapThreshold: 5,
    });

    expect(res.dx).toBe(58); // 350 + 58 = 408 (exact horizontal center of 816)
    expect(res.dy).toBe(10);
    expect(res.guides).toContainEqual({
      orientation: 'vertical',
      pos: 408,
      start: 0,
      end: 1056,
      kind: 'snap',
    });
  });

  it('snaps to 48px page margins and other textbox edges/centers', () => {
    const res = computeDragAlignment({
      originBounds: { minX: 100, minY: 100, maxX: 180, maxY: 120 },
      rawDx: -50, // candidate minX = 50 (within 5px of 48px margin)
      rawDy: 102, // candidate minY = 202 (within 5px of other minY = 200)
      paper,
      otherTextboxBounds: [{ minX: 250, minY: 200, maxX: 330, maxY: 230 }],
      axisLock: false,
      bypassSnap: false,
      snapThreshold: 5,
    });

    expect(res.dx).toBe(-52); // 100 - 52 = 48
    expect(res.dy).toBe(100); // 100 + 100 = 200
    expect(res.guides.filter((g) => g.kind === 'snap')).toHaveLength(2);
  });

  it('bypasses magnetic snapping when Ctrl/Cmd is held', () => {
    const res = computeDragAlignment({
      originBounds: { minX: 300, minY: 200, maxX: 400, maxY: 220 },
      rawDx: 55,
      rawDy: 10,
      paper,
      otherTextboxBounds: [],
      axisLock: false,
      bypassSnap: true,
      snapThreshold: 5,
    });

    expect(res.dx).toBe(55);
    expect(res.dy).toBe(10);
    expect(res.guides).toHaveLength(0);
  });

  it('locks drag strictly to horizontal or vertical axis when Shift is held', () => {
    const horiz = computeDragAlignment({
      originBounds: { minX: 100, minY: 100, maxX: 160, maxY: 120 },
      rawDx: 80,
      rawDy: 24,
      paper,
      otherTextboxBounds: [],
      axisLock: true,
      bypassSnap: true,
    });
    expect(horiz.dx).toBe(80);
    expect(horiz.dy).toBe(0);
    expect(horiz.guides[0]).toMatchObject({ orientation: 'horizontal', kind: 'axis' });

    const vert = computeDragAlignment({
      originBounds: { minX: 100, minY: 100, maxX: 160, maxY: 120 },
      rawDx: 15,
      rawDy: 90,
      paper,
      otherTextboxBounds: [],
      axisLock: true,
      bypassSnap: true,
    });
    expect(vert.dx).toBe(0);
    expect(vert.dy).toBe(90);
    expect(vert.guides[0]).toMatchObject({ orientation: 'vertical', kind: 'axis' });
  });
});
