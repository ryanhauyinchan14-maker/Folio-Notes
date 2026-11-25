// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPaperBackground } from '../../canvas/paperRenderer';
import { generatePageThumbnail } from '../../canvas/thumbnail';
import { ExportModal } from '../../components/modals/ExportModal';
import { COVER_PRESETS } from '../../constants/covers';
import {
  DEFAULT_PAPER_CONFIG,
  MAX_CUSTOM_PAGE_DIMENSION,
  MIN_CUSTOM_PAGE_DIMENSION,
  resolvePageDimensions,
} from '../../constants/papers';
import type { Notebook, Page, PageImage, Stroke, Textbox } from '../../types/notes';
import {
  buildFolioNotebookExport,
  computeContentCropRect,
  exportNotebookToPdf,
  exportPagesToImages,
  exportPageToSvg,
  MAX_EXPORT_CANVAS_DIMENSION,
  MAX_EXPORT_CANVAS_PIXELS,
  MAX_PDF_PAGE_PT,
  parseFolioNotebookExport,
  parseFolioWorkspaceBackup,
  parsePageRange,
  renderPageToCanvas,
  resolveImageExportMetrics,
  sanitizeExportFilename,
} from '../exportNotebook';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VALID_1PX_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function decodeBase64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

const SAMPLE_STROKE: Stroke = {
  id: 'stroke-1',
  tool: 'pen',
  color: '#2563EB',
  size: 5,
  opacity: 1,
  simulatePressure: true,
  points: [
    { x: 100, y: 120, pressure: 0.5 },
    { x: 160, y: 140, pressure: 0.6 },
    { x: 240, y: 125, pressure: 0.5 },
  ],
  bounds: { minX: 95, minY: 115, maxX: 245, maxY: 145 },
  createdAt: 1700000000000,
};

const SAMPLE_HIGHLIGHTER: Stroke = {
  id: 'stroke-hi-1',
  tool: 'highlighter',
  color: '#FDE047',
  size: 20,
  opacity: 0.45,
  simulatePressure: false,
  points: [
    { x: 100, y: 200, pressure: 0.5 },
    { x: 260, y: 200, pressure: 0.5 },
  ],
  bounds: { minX: 90, minY: 185, maxX: 270, maxY: 215 },
  createdAt: 1700000000001,
};

const SAMPLE_TEXTBOX: Textbox = {
  id: 'tb-1',
  x: 120,
  y: 280,
  text: 'Folio & Notes <Export>',
  fontFamily: 'sans',
  fontSize: 22,
  bold: true,
  italic: false,
  color: '#0F172A',
  createdAt: 1700000000002,
  updatedAt: 1700000000002,
};

const SAMPLE_IMAGE: PageImage = {
  id: 'img-1',
  dataUrl: `data:image/png;base64,${VALID_1PX_PNG_BASE64}`,
  naturalWidth: 200,
  naturalHeight: 150,
  x: 320,
  y: 150,
  width: 180,
  height: 135,
  crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  opacity: 0.9,
  borderRadius: 12,
  flipX: true,
  flipY: false,
  zIndex: 0,
  createdAt: 1700000000003,
  updatedAt: 1700000000003,
};

function makeSampleNotebook(): { notebook: Notebook; pages: Page[] } {
  const pages: Page[] = [
    {
      id: 'page-1',
      notebookId: 'nb-1',
      paper: { ...DEFAULT_PAPER_CONFIG, pattern: 'ruled', paperColor: '#FFFDF7' },
      strokes: [SAMPLE_STROKE, SAMPLE_HIGHLIGHTER],
      textboxes: [SAMPLE_TEXTBOX],
      images: [SAMPLE_IMAGE],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    },
    {
      id: 'page-2',
      notebookId: 'nb-1',
      paper: { ...DEFAULT_PAPER_CONFIG, pattern: 'grid', paperColor: '#FFFFFF' },
      strokes: [SAMPLE_STROKE],
      textboxes: [],
      images: [],
      createdAt: 1700000000010,
      updatedAt: 1700000000010,
    },
  ];
  const notebook: Notebook = {
    id: 'nb-1',
    title: 'Physics / Optics Notes',
    folderId: null,
    cover: COVER_PRESETS[0].cover,
    defaultPaper: { ...DEFAULT_PAPER_CONFIG },
    pageOrder: ['page-1', 'page-2'],
    lastOpenedPageId: 'page-1',
    isLocked: false,
    createdAt: 1700000000000,
    updatedAt: 1700000000010,
  };
  return { notebook, pages };
}

describe('exportNotebook pipeline', () => {
  const pngBytes = decodeBase64Bytes(VALID_1PX_PNG_BASE64);
  let ctxCalls: Array<{ method: string; args: unknown[] }> = [];
  const origImage = globalThis.Image;
  const origPath2D = globalThis.Path2D;

  beforeEach(() => {
    ctxCalls = [];

    // Lightweight 2D context mock so canvas rendering & PNG embedding run cleanly in jsdom
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const mockCtx: Record<string, unknown> = {
        fillStyle: '#FFFFFF',
        strokeStyle: '#000000',
        lineWidth: 1,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        font: '16px sans-serif',
        textBaseline: 'alphabetic',
        textAlign: 'left',
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        translate: vi.fn(),
        clearRect: vi.fn((...args: unknown[]) => ctxCalls.push({ method: 'clearRect', args })),
        fillRect: vi.fn((...args: unknown[]) => ctxCalls.push({ method: 'fillRect', args })),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        arc: vi.fn(),
        clip: vi.fn(),
        roundRect: vi.fn(),
        drawImage: vi.fn(),
        setLineDash: vi.fn(),
        fillText: vi.fn((...args: unknown[]) => ctxCalls.push({ method: 'fillText', args })),
        measureText: vi.fn((text: string) => ({
          width: text.length * 10,
          actualBoundingBoxAscent: 14,
          actualBoundingBoxDescent: 4,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: text.length * 10,
          fontBoundingBoxAscent: 16,
          fontBoundingBoxDescent: 4,
        })),
      };
      return mockCtx as unknown as CanvasRenderingContext2D;
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: BlobCallback,
      type?: string,
    ) {
      const copy = new Uint8Array(pngBytes.length);
      copy.set(pngBytes);
      cb(new Blob([copy.buffer], { type: type ?? 'image/png' }));
    });

    globalThis.Path2D = class MockPath2D {
      moveTo() {}
      lineTo() {}
      quadraticCurveTo() {}
      closePath() {}
    } as unknown as typeof Path2D;

    globalThis.Image = class MockImage {
      complete = true;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.complete = true;
        this.onload?.();
      }
    } as unknown as typeof Image;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.Image = origImage;
    globalThis.Path2D = origPath2D;
  });

  it('sanitizes filenames and parses valid & invalid page ranges', () => {
    expect(sanitizeExportFilename('Notes: Chapter 1/2?')).toBe('Notes Chapter 1 2');
    expect(sanitizeExportFilename('   ', 'Fallback')).toBe('Fallback');

    expect(parsePageRange('current', '', 1, 5)).toEqual({ valid: true, indices: [1] });
    expect(parsePageRange('all', '', 0, 3)).toEqual({ valid: true, indices: [0, 1, 2] });
    expect(parsePageRange('custom', '3, 1-2, 2, 5', 0, 5)).toEqual({
      valid: true,
      indices: [2, 0, 1, 4],
    });

    expect(parsePageRange('custom', '', 0, 4).valid).toBe(false);
    expect(parsePageRange('custom', '3-1', 0, 4).valid).toBe(false);
    expect(parsePageRange('custom', '1-5', 0, 4).valid).toBe(false);
    expect(parsePageRange('custom', 'abc', 0, 4).valid).toBe(false);
  });

  it('exports a valid, watermark-free multi-page PDF via pdf-lib', async () => {
    const { notebook, pages } = makeSampleNotebook();
    const progress: Array<[number, number]> = [];

    const pdfBytes = await exportNotebookToPdf({
      title: notebook.title,
      pages,
      selectedIndices: [0, 1],
      includeBackground: true,
      includeAnnotations: true,
      scale: 1.5,
      onProgress: (c, t) => progress.push([c, t]),
    });

    const header = new TextDecoder().decode(pdfBytes.slice(0, 5));
    expect(header).toBe('%PDF-');
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);

    const loaded = await PDFDocument.load(pdfBytes);
    expect(loaded.getPageCount()).toBe(2);
    expect(loaded.getTitle()).toBe('Physics / Optics Notes');
    expect(loaded.getCreator()).toBe('Folio Notes');
  });

  it('exports single PNG (with transparent background clearRect) and multi-page ZIP bundles', async () => {
    const { notebook, pages } = makeSampleNotebook();

    const singlePng = await exportPagesToImages({
      baseName: notebook.title,
      pages,
      selectedIndices: [1],
      format: 'png',
      includeBackground: true,
      includeAnnotations: true,
      transparentBackground: true,
      jpgQuality: 0.92,
      scale: 2,
    });
    expect(singlePng.isZip).toBe(false);
    expect(singlePng.filename).toBe('Physics Optics Notes - Page 2.png');
    expect(ctxCalls.some((c) => c.method === 'clearRect')).toBe(true);

    const multiZip = await exportPagesToImages({
      baseName: notebook.title,
      pages,
      selectedIndices: [0, 1],
      format: 'jpg',
      includeBackground: true,
      includeAnnotations: true,
      transparentBackground: false,
      jpgQuality: 0.92,
      scale: 2,
    });
    expect(multiZip.isZip).toBe(true);
    expect(multiZip.filename).toBe('Physics Optics Notes - Pages.zip');

    const loadedZip = await JSZip.loadAsync(await multiZip.blob.arrayBuffer());
    const entryNames = Object.keys(loadedZip.files).sort();
    expect(entryNames).toEqual([
      'Physics Optics Notes - Page 01.jpg',
      'Physics Optics Notes - Page 02.jpg',
    ]);
  });

  it('generates Vector SVG containing paper pattern geometry, clipped flipped images, stroke paths, and XML-escaped text', () => {
    const { pages } = makeSampleNotebook();
    const svg = exportPageToSvg({
      page: pages[0],
      includeBackground: true,
      includeAnnotations: true,
    });

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(
      `width="${pages[0].paper.width}" height="${pages[0].paper.height}"`,
    );
    expect(svg).toContain('<clipPath id="img-clip-img-1">');
    expect(svg).toContain('scale(-1, 1)');
    expect(svg).toContain('mix-blend-mode: multiply');
    expect(svg).toContain('Folio &amp; Notes &lt;Export&gt;');

    const noBgSvg = exportPageToSvg({
      page: pages[0],
      includeBackground: false,
      includeAnnotations: false,
    });
    expect(noBgSvg).not.toContain('Folio &amp; Notes');
    expect(noBgSvg).not.toContain('<clipPath');
  });

  it('builds and validates .folio.json and .folio-workspace.json schemas', () => {
    const { notebook, pages } = makeSampleNotebook();
    const archive = buildFolioNotebookExport(notebook, pages);
    const json = JSON.stringify(archive);
    const parsed = parseFolioNotebookExport(json);

    expect(parsed.format).toBe('folio-notebook');
    expect(parsed.notebook.title).toBe('Physics / Optics Notes');
    expect(parsed.pages).toHaveLength(2);
    expect(parsed.pages[0].strokes).toHaveLength(2);
    expect(parsed.pages[0].images).toHaveLength(1);

    expect(() => parseFolioNotebookExport('not json')).toThrow();
    expect(() => parseFolioNotebookExport('{"format":"other"}')).toThrow();
    expect(() => parseFolioWorkspaceBackup('{"format":"folio-workspace","version":2}')).toThrow();
  });

  it('flattens annotations onto PDF-backed mixed-size pages while preserving source dimensions and includeBackground toggle', async () => {
    const sourceDoc = await PDFDocument.create();
    const p1 = sourceDoc.addPage([612, 792]);
    p1.drawText('Contract Section 1');
    const p2 = sourceDoc.addPage([960, 540]);
    p2.drawText('Architecture Slide');
    const sourceBytes = await sourceDoc.save();
    const sourceAb = sourceBytes.buffer.slice(
      sourceBytes.byteOffset,
      sourceBytes.byteOffset + sourceBytes.byteLength,
    ) as ArrayBuffer;

    const pdfPages: Page[] = [
      {
        id: 'pdf-pg-1',
        notebookId: 'nb-pdf-1',
        paper: {
          sizePreset: 'custom',
          orientation: 'portrait',
          width: 816,
          height: 1056,
          pattern: 'blank',
          spacing: 32,
          marginLine: false,
          paperColor: '#FFFFFF',
        },
        strokes: [SAMPLE_STROKE],
        textboxes: [SAMPLE_TEXTBOX],
        images: [],
        pdfBackground: { assetId: 'asset-1', pageNumber: 1 },
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
      {
        id: 'pdf-pg-2',
        notebookId: 'nb-pdf-1',
        paper: {
          sizePreset: 'custom',
          orientation: 'landscape',
          width: 1280,
          height: 720,
          pattern: 'blank',
          spacing: 32,
          marginLine: false,
          paperColor: '#FFFFFF',
        },
        strokes: [],
        textboxes: [],
        images: [],
        pdfBackground: { assetId: 'asset-1', pageNumber: 2 },
        createdAt: 1700000000010,
        updatedAt: 1700000000010,
      },
    ];

    const exportedBytes = await exportNotebookToPdf({
      title: 'Annotated Deck',
      pages: pdfPages,
      selectedIndices: [0, 1],
      includeBackground: true,
      includeAnnotations: true,
      scale: 1.5,
      resolvePdfBytes: async (id) => (id === 'asset-1' ? sourceAb : null),
    });

    expect(new TextDecoder().decode(exportedBytes.slice(0, 5))).toBe('%PDF-');
    const reloaded = await PDFDocument.load(exportedBytes);
    expect(reloaded.getPageCount()).toBe(2);
    expect(Math.round(reloaded.getPage(0).getWidth())).toBe(612);
    expect(Math.round(reloaded.getPage(0).getHeight())).toBe(792);
    expect(Math.round(reloaded.getPage(1).getWidth())).toBe(960);
    expect(Math.round(reloaded.getPage(1).getHeight())).toBe(540);

    // Clear white background toggle exports annotations cleanly without calling PDF copyPages
    const annotationsOnlyBytes = await exportNotebookToPdf({
      title: 'Annotations Only',
      pages: pdfPages,
      selectedIndices: [0],
      includeBackground: false,
      includeAnnotations: true,
      scale: 1.5,
      resolvePdfBytes: async () => sourceAb,
    });
    const reloadedNoBg = await PDFDocument.load(annotationsOnlyBytes);
    expect(reloadedNoBg.getPageCount()).toBe(1);
    expect(Math.round(reloadedNoBg.getPage(0).getWidth())).toBe(612);
  });

  it('supports up to 24000x24000 custom pages with batched/clipped patterns, bounded thumbnails, compact SVG <pattern>, and safe raster/PDF caps', async () => {
    expect(MIN_CUSTOM_PAGE_DIMENSION).toBe(320);
    expect(MAX_CUSTOM_PAGE_DIMENSION).toBe(24000);
    expect(resolvePageDimensions('custom', 'portrait', 24000, 24000)).toEqual({
      width: 24000,
      height: 24000,
    });
    expect(resolvePageDimensions('custom', 'landscape', 50000, 100)).toEqual({
      width: 24000,
      height: 320,
    });

    const hugeDottedPaper = {
      ...DEFAULT_PAPER_CONFIG,
      sizePreset: 'custom' as const,
      width: 24000,
      height: 24000,
      pattern: 'dotted' as const,
      spacing: 24,
      marginLine: false,
    };

    // 1. Batched dotted paper rendering runs cleanly & performs only 1 fill() pass
    const fakeCanvas = document.createElement('canvas');
    const mockCtx = fakeCanvas.getContext('2d')!;
    const fillSpy = vi.spyOn(mockCtx, 'fill');
    const arcSpy = vi.spyOn(mockCtx, 'arc');
    renderPaperBackground(mockCtx, hugeDottedPaper);
    expect(fillSpy).toHaveBeenCalledTimes(1);
    expect(arcSpy.mock.calls.length).toBeLessThanOrEqual(6500);

    // 2. Extreme aspect thumbnail (320 x 24000) bounds both width & height cleanly
    const createdCanvases: HTMLCanvasElement[] = [];
    const origCreateElement = document.createElement.bind(document);
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tagName: string) => {
        const el = origCreateElement(tagName);
        if (tagName.toLowerCase() === 'canvas') {
          createdCanvases.push(el as HTMLCanvasElement);
        }
        return el;
      });
    try {
      generatePageThumbnail(
        {
          ...DEFAULT_PAPER_CONFIG,
          sizePreset: 'custom',
          width: 320,
          height: 24000,
          pattern: 'ruled',
        },
        [],
        240,
      );
      const thumbCanvas = createdCanvases[createdCanvases.length - 1];
      expect(thumbCanvas.width).toBeGreaterThanOrEqual(48);
      expect(thumbCanvas.width).toBeLessThanOrEqual(384);
      expect(thumbCanvas.height).toBeLessThanOrEqual(384);
    } finally {
      createSpy.mockRestore();
    }

    // 3. Raster canvas export clamps 24000x24000 cleanly inside MAX_EXPORT_CANVAS_DIMENSION & pixel cap
    const hugePage: Page = {
      id: 'huge-1',
      notebookId: 'nb-huge',
      paper: hugeDottedPaper,
      strokes: [SAMPLE_STROKE],
      textboxes: [SAMPLE_TEXTBOX],
      images: [],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    const renderedCanvas = await renderPageToCanvas(hugePage, {
      scale: 2,
      includeBackground: true,
      includeAnnotations: true,
    });
    expect(renderedCanvas.width).toBeLessThanOrEqual(MAX_EXPORT_CANVAS_DIMENSION);
    expect(renderedCanvas.height).toBeLessThanOrEqual(MAX_EXPORT_CANVAS_DIMENSION);
    expect(renderedCanvas.width * renderedCanvas.height).toBeLessThanOrEqual(
      MAX_EXPORT_CANVAS_PIXELS,
    );

    // 4. SVG export on 24000x24000 dotted page uses SVG <pattern> (compact vector output)
    const svg = exportPageToSvg({
      page: hugePage,
      includeBackground: true,
      includeAnnotations: true,
    });
    expect(svg).toContain('width="24000" height="24000"');
    expect(svg).toContain('<pattern id="folio-dot-grid-24"');
    expect(svg.length).toBeLessThan(20000);

    // 5. PDF export clamps 24000x24000 page points safely within 14400pt standard limit
    const hugePdfBytes = await exportNotebookToPdf({
      title: 'Oversized Architectural Canvas',
      pages: [hugePage],
      selectedIndices: [0],
      includeBackground: true,
      includeAnnotations: true,
      scale: 2,
    });
    const hugePdf = await PDFDocument.load(hugePdfBytes);
    expect(hugePdf.getPage(0).getWidth()).toBeLessThanOrEqual(MAX_PDF_PAGE_PT);
    expect(hugePdf.getPage(0).getHeight()).toBeLessThanOrEqual(MAX_PDF_PAGE_PT);
  });

  it('supports Export Area cropping, max condensed size presets, region culling, and live ExportModal area/sharpness previews', async () => {
    // 1. Resolution metrics across 2048 / 4096 / 8192 condensed full page vs sharp small crop
    const condensed8k = resolveImageExportMetrics({
      sourceWidth: 24000,
      sourceHeight: 24000,
      scale: 2,
      maxDimension: 8192,
    });
    expect(condensed8k.outputWidth).toBe(8192);
    expect(condensed8k.outputHeight).toBe(8192);
    expect(condensed8k.isCondensed).toBe(true);
    expect(condensed8k.scalePercent).toBe(34);

    const condensed4k = resolveImageExportMetrics({
      sourceWidth: 24000,
      sourceHeight: 24000,
      scale: 2,
      maxDimension: 4096,
    });
    expect(condensed4k.outputWidth).toBe(4096);
    expect(condensed4k.outputHeight).toBe(4096);
    expect(condensed4k.scalePercent).toBe(17);

    const sharpArea = resolveImageExportMetrics({
      sourceWidth: 1200,
      sourceHeight: 800,
      scale: 2,
      maxDimension: 8192,
    });
    expect(sharpArea.outputWidth).toBe(2400);
    expect(sharpArea.outputHeight).toBe(1600);
    expect(sharpArea.isCondensed).toBe(false);
    expect(sharpArea.effectiveScale).toBe(2);

    // 2. computeContentCropRect trims margins & returns null on blank sheet
    const blankPage: Page = {
      id: 'blank-1',
      notebookId: 'nb-area',
      paper: { ...DEFAULT_PAPER_CONFIG, sizePreset: 'custom', width: 24000, height: 24000 },
      strokes: [],
      textboxes: [],
      images: [],
      createdAt: 1,
      updatedAt: 1,
    };
    expect(computeContentCropRect(blankPage)).toBeNull();

    const farStroke: Stroke = {
      ...SAMPLE_STROKE,
      id: 'stroke-far',
      points: [
        { x: 18000, y: 18000, pressure: 0.5 },
        { x: 18200, y: 18100, pressure: 0.5 },
      ],
      bounds: { minX: 18000, minY: 18000, maxX: 18200, maxY: 18100 },
    };
    const hugePage: Page = {
      ...blankPage,
      id: 'huge-area-1',
      strokes: [SAMPLE_STROKE, farStroke],
      textboxes: [SAMPLE_TEXTBOX],
    };

    const contentRect = computeContentCropRect(hugePage, 48);
    expect(contentRect).toEqual({
      x: 47,
      y: 67,
      width: 18201,
      height: 18081,
    });

    // 3. Cropped render on 24000x24000 renders full 2x without downscaling & culls far annotations
    const croppedCanvas = await renderPageToCanvas(hugePage, {
      scale: 2,
      includeBackground: true,
      includeAnnotations: true,
      cropRect: { x: 80, y: 100, width: 600, height: 400 },
    });
    expect(croppedCanvas.width).toBe(1200);
    expect(croppedCanvas.height).toBe(800);

    // 4. Negative-coordinate whiteboard area crop renders crisply without clamping >= 0
    const negStroke: Stroke = {
      ...SAMPLE_STROKE,
      id: 'wb-neg',
      points: [
        { x: -500, y: -300, pressure: 0.5 },
        { x: -200, y: -150, pressure: 0.5 },
      ],
      bounds: { minX: -500, minY: -300, maxX: -200, maxY: -150 },
    };
    const wbCanvas = await renderPageToCanvas(
      { ...blankPage, strokes: [negStroke] },
      {
        scale: 2,
        includeBackground: true,
        includeAnnotations: true,
        isWhiteboard: true,
        cropRect: { x: -600, y: -400, width: 500, height: 350 },
      },
    );
    expect(wbCanvas.width).toBe(1000);
    expect(wbCanvas.height).toBe(700);

    // 5. exportPagesToImages names & respects areaMode and maxDimension
    const screenExport = await exportPagesToImages({
      baseName: 'Architectural Board',
      pages: [hugePage],
      selectedIndices: [0],
      format: 'png',
      includeBackground: true,
      includeAnnotations: true,
      transparentBackground: false,
      jpgQuality: 0.92,
      scale: 2,
      areaMode: 'screen',
      cropRect: { x: 100, y: 100, width: 900, height: 600 },
    });
    expect(screenExport.filename).toBe('Architectural Board - Page 1 (Screen).png');

    const areaExport = await exportPagesToImages({
      baseName: 'Architectural Board',
      pages: [hugePage],
      selectedIndices: [0],
      format: 'jpg',
      includeBackground: true,
      includeAnnotations: true,
      transparentBackground: false,
      jpgQuality: 0.9,
      scale: 2,
      areaMode: 'custom',
      cropRect: { x: 100, y: 100, width: 900, height: 600 },
    });
    expect(areaExport.filename).toBe('Architectural Board - Page 1 (Area).jpg');

    const croppedExport = await exportPagesToImages({
      baseName: 'Architectural Board',
      pages: [hugePage],
      selectedIndices: [0],
      format: 'png',
      includeBackground: true,
      includeAnnotations: true,
      transparentBackground: false,
      jpgQuality: 0.92,
      scale: 2,
      areaMode: 'content',
      maxDimension: 4096,
    });
    expect(croppedExport.filename).toBe('Architectural Board - Page 1 (Cropped).png');

    // 6. ExportModal UI test: switches PNG area modes, max size presets, area picker, and 1:1 sample
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      `data:image/png;base64,${VALID_1PX_PNG_BASE64}`,
    );

    const { notebook } = makeSampleNotebook();
    const modalContainer = document.createElement('div');
    document.body.appendChild(modalContainer);
    const root: Root = createRoot(modalContainer);

    await act(async () => {
      root.render(
        createElement(ExportModal, {
          open: true,
          notebook: { ...notebook, title: 'Giant Sheet' },
          pages: [hugePage],
          currentPageIndex: 0,
          visibleRegion: { x: 80, y: 100, width: 1000, height: 700 },
          onClose: () => {},
        }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });

    await act(async () => {
      modalContainer.querySelector<HTMLButtonElement>('[data-testid="export-tab-png"]')!.click();
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(modalContainer.querySelector('[data-testid="export-area-section"]')).not.toBeNull();
    expect(
      modalContainer.querySelector('[data-testid="export-output-dimensions"]')?.textContent,
    ).toContain('8,192 × 8,192');
    expect(
      modalContainer.querySelector('[data-testid="export-sharpness-badge"]')?.textContent,
    ).toContain('Condensed');
    expect(modalContainer.querySelector('[data-testid="export-detail-sample"]')).not.toBeNull();

    // Switch Max Size to 4,096 px -> updates condensed output resolution
    await act(async () => {
      modalContainer.querySelector<HTMLButtonElement>('[data-testid="export-max-4096"]')!.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      modalContainer.querySelector('[data-testid="export-output-dimensions"]')?.textContent,
    ).toContain('4,096 × 4,096');
    expect(
      modalContainer.querySelector('[data-testid="export-sharpness-badge"]')?.textContent,
    ).toContain('17%');

    // Switch to Current Screen -> switches to crisp Full Sharpness (2.0x)
    await act(async () => {
      modalContainer.querySelector<HTMLButtonElement>('[data-testid="export-area-screen"]')!.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(
      modalContainer.querySelector('[data-testid="export-output-dimensions"]')?.textContent,
    ).toContain('2,000 × 1,400');
    expect(
      modalContainer.querySelector('[data-testid="export-sharpness-badge"]')?.textContent,
    ).toContain('Full Sharpness');
    expect(
      modalContainer.querySelector('[data-testid="export-output-filename"]')?.textContent,
    ).toContain('(Screen).png');

    // Switch to Select Area -> shows interactive drag area picker map
    await act(async () => {
      modalContainer.querySelector<HTMLButtonElement>('[data-testid="export-area-custom"]')!.click();
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(modalContainer.querySelector('[data-testid="export-area-picker"]')).not.toBeNull();
    expect(
      modalContainer.querySelector('[data-testid="export-area-selection-box"]'),
    ).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
    modalContainer.remove();
  });
});
