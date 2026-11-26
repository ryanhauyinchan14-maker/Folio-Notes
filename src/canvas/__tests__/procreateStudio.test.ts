// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Path2D as NapiPath2D } from '@napi-rs/canvas';
import { BRUSH_PRESETS, getBrushPreset } from '../brushEngine';
import { getColorHarmonies, hexToHsv, hsvToHex } from '../colorMath';
import { computeBoundsFromPoints, flipStroke, rotateStroke } from '../geometry';
import { getFreehandStrokeOutline } from '../strokeRenderer';
import { getSymmetryBranches } from '../symmetry';
import { DEFAULT_PAPER_CONFIG } from '../../constants/papers';
import { COVER_PRESETS } from '../../constants/covers';
import { db } from '../../db/database';
import { useAppStore } from '../../store/useAppStore';
import type { Stroke } from '../../types/notes';
import { generateRecoveryKey } from '../../utils/vaultCrypto';
import { BrushStudioPopover } from '../../components/editor/BrushStudioPopover';
import { LayersPopover } from '../../components/editor/LayersPopover';
import { ColorStudioPopover } from '../../components/editor/ColorStudioPopover';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as unknown as { Path2D: unknown }).Path2D = NapiPath2D;
}

async function resetDbAndStore() {
  await db.folders.clear();
  await db.notebooks.clear();
  await db.pages.clear();
  await db.templates.clear();
  await db.pdfAssets.clear();
  await db.trashedNotebooks.clear();
  useAppStore.setState({
    activeNotebook: null,
    pages: [],
    activePageId: null,
    undoStack: [],
    redoStack: [],
    unlockedMasterKey: null,
    activeBrushId: 'technical',
    brushOpacity: 1,
    brushStreamline: 0.45,
    symmetryMode: 'off',
    activeLayerIdByPage: {},
  });
}

describe('Procreate Studio Engines, Layers & Popovers', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await resetDbAndStore();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('produces valid freehand outlines across all Drawing Board brush presets', () => {
    const samplePts = [
      { x: 20, y: 20, pressure: 0.3 },
      { x: 45, y: 35, pressure: 0.6 },
      { x: 80, y: 28, pressure: 0.8 },
      { x: 120, y: 50, pressure: 0.5 },
    ];
    expect(BRUSH_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(getBrushPreset('fountain').name).toBe('Fountain Nib');
    for (const preset of BRUSH_PRESETS) {
      const outline = getFreehandStrokeOutline(
        samplePts,
        preset.id === 'highlighter' ? 'highlighter' : 'pen',
        6,
        true,
        true,
        false,
        preset.id,
      );
      expect(outline.length).toBeGreaterThan(4);
    }
  });

  it('converts HSB <-> Hex and computes harmonious swatches accurately', () => {
    const cyanHex = hsvToHex(195, 80, 95);
    expect(cyanHex).toMatch(/^#[0-9A-F]{6}$/);
    const roundTrip = hexToHsv(cyanHex);
    expect(Math.abs(roundTrip.h - 195)).toBeLessThanOrEqual(3);
    expect(Math.abs(roundTrip.s - 80)).toBeLessThanOrEqual(3);
    expect(Math.abs(roundTrip.v - 95)).toBeLessThanOrEqual(3);

    const harmonies = getColorHarmonies('#FD6E88');
    expect(harmonies.complementary).toHaveLength(1);
    expect(harmonies.analogous).toHaveLength(2);
    expect(harmonies.triadic).toHaveLength(2);
    for (const color of [
      ...harmonies.complementary,
      ...harmonies.analogous,
      ...harmonies.triadic,
    ]) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('generates exact symmetry branches and rotates/flips strokes cleanly', () => {
    const pts = [{ x: 150, y: 120, pressure: 0.5 }];
    expect(getSymmetryBranches(pts, 'off', 100, 100)).toHaveLength(1);
    const vert = getSymmetryBranches(pts, 'vertical', 100, 100);
    expect(vert).toHaveLength(2);
    expect(vert[1][0].x).toBe(50);
    expect(vert[1][0].y).toBe(120);

    const horiz = getSymmetryBranches(pts, 'horizontal', 100, 100);
    expect(horiz).toHaveLength(2);
    expect(horiz[1][0].y).toBe(80);

    expect(getSymmetryBranches(pts, 'quadrant', 100, 100)).toHaveLength(4);
    expect(getSymmetryBranches(pts, 'radial', 100, 100)).toHaveLength(8);

    const stroke: Stroke = {
      id: 's-rot',
      tool: 'pen',
      color: '#072D59',
      size: 3,
      opacity: 1,
      simulatePressure: false,
      points: [
        { x: 100, y: 50, pressure: 0.5 },
        { x: 120, y: 50, pressure: 0.5 },
      ],
      bounds: computeBoundsFromPoints(
        [
          { x: 100, y: 50, pressure: 0.5 },
          { x: 120, y: 50, pressure: 0.5 },
        ],
        2,
      ),
      createdAt: 1,
    };

    const rotated = rotateStroke(stroke, Math.PI / 2, 100, 100);
    expect(Math.round(rotated.points[0].x)).toBe(150);
    expect(Math.round(rotated.points[0].y)).toBe(100);

    const flipped = flipStroke(stroke, 'x', 100, 100);
    expect(flipped.points[1].x).toBe(80);
  });

  it('manages drawing layers and persists encrypted layer metadata under Vault lock', async () => {
    const store = useAppStore.getState();
    const nb = await store.createNotebook({
      title: 'Illustration Study',
      mode: 'notebook',
      folderId: null,
      cover: COVER_PRESETS[0].cover,
      paper: DEFAULT_PAPER_CONFIG,
      openImmediately: true,
    });

    const pageId = useAppStore.getState().pages[0].id;
    useAppStore.getState().addDrawingLayer(pageId);
    let page = useAppStore.getState().pages[0];
    expect(page.layers).toHaveLength(2);
    const layer2 = page.layers![1];

    useAppStore.getState().commitNewStroke(pageId, {
      id: 'st-l2',
      tool: 'pen',
      color: '#FD6E88',
      size: 4,
      opacity: 1,
      simulatePressure: false,
      layerId: layer2.id,
      brushId: 'watercolor',
      points: [
        { x: 10, y: 10, pressure: 0.5 },
        { x: 40, y: 40, pressure: 0.5 },
      ],
      bounds: { minX: 8, minY: 8, maxX: 42, maxY: 42 },
      createdAt: Date.now(),
    });

    useAppStore.getState().updateDrawingLayer(pageId, layer2.id, {
      blendMode: 'multiply',
      opacity: 0.7,
    });
    useAppStore.getState().duplicateDrawingLayer(pageId, layer2.id);
    page = useAppStore.getState().pages[0];
    expect(page.layers).toHaveLength(3);
    expect(page.strokes).toHaveLength(2);

    const copyLayerId = page.layers![2].id;
    useAppStore.getState().mergeDrawingLayerDown(pageId, copyLayerId);
    page = useAppStore.getState().pages[0];
    expect(page.layers).toHaveLength(2);

    // Wait briefly for debounced/async layer persistence before locking
    await new Promise((r) => setTimeout(r, 30));

    // Vault lock + unlock persistence round-trip
    const recoveryKey = generateRecoveryKey();
    await useAppStore.getState().setupVaultAndMaybeLockNotebook('TestPass123!', recoveryKey, nb.id);
    await useAppStore.getState().closeNotebook();
    await useAppStore.getState().unlockNotebookWithPassword(nb.id, 'TestPass123!', 'open');

    const unlockedPage = useAppStore.getState().pages[0];
    expect(unlockedPage.layers).toHaveLength(2);
    expect(unlockedPage.layers![1].blendMode).toBe('multiply');
    expect(unlockedPage.strokes[0].brushId).toBe('watercolor');
  });

  it('renders and interacts with BrushStudioPopover, LayersPopover, and ColorStudioPopover', async () => {
    const store = useAppStore.getState();
    await store.createNotebook({
      title: 'Popovers Test',
      mode: 'notebook',
      folderId: null,
      cover: COVER_PRESETS[0].cover,
      paper: DEFAULT_PAPER_CONFIG,
      openImmediately: true,
    });
    const activePage = useAppStore.getState().pages[0];

    await act(async () => {
      root.render(React.createElement(BrushStudioPopover, { onClose: () => {} }));
    });
    const pencilBtn = container.querySelector('[data-testid="brush-preset-pencil"]') as HTMLButtonElement;
    expect(pencilBtn).not.toBeNull();
    await act(async () => {
      pencilBtn.click();
    });
    expect(useAppStore.getState().activeBrushId).toBe('pencil');

    await act(async () => {
      root.render(React.createElement(LayersPopover, { activePage, onClose: () => {} }));
    });
    const addLayerBtn = container.querySelector('[data-testid="add-layer-btn"]') as HTMLButtonElement;
    expect(addLayerBtn).not.toBeNull();
    await act(async () => {
      addLayerBtn.click();
    });
    expect(useAppStore.getState().pages[0].layers).toHaveLength(2);

    await act(async () => {
      root.render(React.createElement(ColorStudioPopover, { onClose: () => {} }));
    });
    const hexInput = container.querySelector('[data-testid="color-studio-hex-input"]') as HTMLInputElement;
    expect(hexInput).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(hexInput, '#10B981');
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(useAppStore.getState().inkColor).toBe('#10B981');
  });
});
