// @vitest-environment jsdom
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COVER_PRESETS } from '../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../constants/papers';
import type { Notebook, Page, PageImage, Stroke, Textbox } from '../../types/notes';
import {
  buildFolioNotebookExport,
  exportNotebookToPdf,
  exportPagesToImages,
  exportPageToSvg,
  parseFolioNotebookExport,
  parseFolioWorkspaceBackup,
  parsePageRange,
  sanitizeExportFilename,
} from '../exportNotebook';

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
});
