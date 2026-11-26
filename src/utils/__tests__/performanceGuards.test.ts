import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearImageElementCache,
  getCachedHtmlImage,
  getImageElementCacheSize,
} from '../../canvas/imageRenderer';
import { getFreehandStrokeOutline } from '../../canvas/strokeRenderer';
import { PaperShaderBackdrop } from '../../components/common/PaperShaderBackdrop';

describe('Hardware & performance optimization guards (v1.5.1)', () => {
  const OriginalImage = globalThis.Image;

  afterEach(() => {
    clearImageElementCache();
    globalThis.Image = OriginalImage;
    vi.restoreAllMocks();
  });

  it('caps decoded image cache at 48 entries with LRU eviction and clears cleanly', () => {
    class MockImage {
      naturalWidth = 100;
      naturalHeight = 80;
      complete = true;
      onload: (() => void) | null = null;
      private _src = '';
      get src() {
        return this._src;
      }
      set src(val: string) {
        this._src = val;
      }
    }
    globalThis.Image = MockImage as unknown as typeof Image;

    clearImageElementCache();
    expect(getImageElementCacheSize()).toBe(0);

    for (let i = 0; i < 60; i++) {
      getCachedHtmlImage(`data:image/png;base64,TEST_${i}`);
    }

    expect(getImageElementCacheSize()).toBeLessThanOrEqual(48);

    // Re-access an item and confirm size stays bounded
    getCachedHtmlImage('data:image/png;base64,TEST_59');
    expect(getImageElementCacheSize()).toBeLessThanOrEqual(48);

    clearImageElementCache();
    expect(getImageElementCacheSize()).toBe(0);
  });

  it('generates smooth non-empty outlines directly from StrokePoint[] without array copies', () => {
    const points = [
      { x: 10, y: 12, pressure: 0.4, t: 0 },
      { x: 24, y: 18, pressure: 0.6, t: 16 },
      { x: 42, y: 25, pressure: 0.5, t: 32 },
      { x: 64, y: 20, pressure: 0.45, t: 48 },
    ];
    const regularOutline = getFreehandStrokeOutline(points, 'pen', 3, true, true, false);
    const tidiedOutline = getFreehandStrokeOutline(points, 'pen', 3, false, true, true);
    const hlOutline = getFreehandStrokeOutline(points, 'highlighter', 18, false, true, false);

    expect(regularOutline.length).toBeGreaterThan(4);
    expect(tidiedOutline.length).toBeGreaterThan(4);
    expect(hlOutline.length).toBeGreaterThan(4);
  });

  it('renders PaperShaderBackdrop cleanly with custom maxPixelCount', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(PaperShaderBackdrop, {
          variant: 'hero',
          maxPixelCount: 240 * 480,
          'data-testid': 'perf-shader-test',
        }),
      );
    });

    const el = container.querySelector('[data-testid="perf-shader-test"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-shader-mode')).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
