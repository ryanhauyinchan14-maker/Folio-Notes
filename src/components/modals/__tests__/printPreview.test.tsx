import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPrintDocumentHtml,
  validatePrintSheetsRequest,
} from '../../../../electron/printCore';
import { useAppStore } from '../../../store/useAppStore';
import { NotebookEditor } from '../../editor/NotebookEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VALID_PNG_BYTES = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 11, 73, 68, 65, 84,
  120, 156, 99, 96, 0, 0, 0, 2, 0, 1, 226, 33, 188, 51, 0, 0, 0, 0, 73, 69,
  78, 68, 174, 66, 96, 130,
]);

const VALID_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

function createMock2dContext(): CanvasRenderingContext2D {
  const base: Record<string, unknown> = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    globalAlpha: 1,
    font: '16px sans-serif',
    textBaseline: 'alphabetic',
    textAlign: 'left',
    measureText: (t: string) => ({
      width: t.length * 9,
      actualBoundingBoxAscent: 12,
      actualBoundingBoxDescent: 4,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: t.length * 9,
      fontBoundingBoxAscent: 14,
      fontBoundingBoxDescent: 4,
    }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => null,
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return () => {};
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

describe('printCore validation & HTML builder', () => {
  it('validates PNG/JPEG data URLs, clamps copies, and rejects invalid or script payloads', () => {
    const valid = validatePrintSheetsRequest({
      title: '   Chemistry Notes <Unit 1>  ',
      sheetDataUrls: [VALID_PNG_DATA_URL],
      deviceName: '  HP LaserJet  ',
      silent: true,
      landscape: true,
      color: false,
      copies: 500,
      pageSize: 'A4',
      margins: 'none',
      fitMode: 'actual',
    });

    expect(valid).toEqual({
      title: 'Chemistry Notes <Unit 1>',
      sheetDataUrls: [VALID_PNG_DATA_URL],
      deviceName: 'HP LaserJet',
      silent: true,
      landscape: true,
      color: false,
      copies: 99,
      pageSize: 'A4',
      margins: 'none',
      fitMode: 'actual',
    });

    expect(() =>
      validatePrintSheetsRequest({
        title: 'Bad',
        sheetDataUrls: [],
      }),
    ).toThrow(/At least one rendered sheet/i);

    expect(() =>
      validatePrintSheetsRequest({
        title: 'XSS',
        sheetDataUrls: ['javascript:alert(1)'],
      }),
    ).toThrow(/Invalid raster sheet data/i);

    expect(() =>
      validatePrintSheetsRequest({
        title: 'SVG',
        sheetDataUrls: ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
      }),
    ).toThrow(/Invalid raster sheet data/i);
  });

  it('builds escaped print HTML with @page dimensions, margins, grayscale filter, and no trailing break', () => {
    const html = buildPrintDocumentHtml({
      title: 'Physics <script>alert(1)</script>',
      sheetDataUrls: [VALID_PNG_DATA_URL, VALID_PNG_DATA_URL],
      silent: true,
      landscape: true,
      color: false,
      copies: 1,
      pageSize: 'Letter',
      margins: 'default',
      fitMode: 'fit',
    });

    expect(html).toContain('<title>Physics &lt;script&gt;alert(1)&lt;/script&gt;</title>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('size: Letter landscape;');
    expect(html).toContain('padding: 0.4in;');
    expect(html).toContain('filter: grayscale(100%);');
    expect(html).toContain('.sheet:last-child {\n      page-break-after: auto;\n      break-after: auto;\n    }');
    expect(html).toContain('data-sheet-index="0"');
    expect(html).toContain('data-sheet-index="1"');
  });
});

describe('PrintPreviewModal & NotebookEditor integration', () => {
  let container: HTMLDivElement;
  let root: Root;
  const origPath2D = globalThis.Path2D;
  const origPrint = window.print;
  const origCreateObjectURL = URL.createObjectURL;
  const origRevokeObjectURL = URL.revokeObjectURL;
  const origFolioDesktop = window.folioDesktop;

  beforeEach(async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.setPointerCapture = vi.fn();
    globalThis.Path2D = class MockPath2D {
      moveTo() {}
      lineTo() {}
      quadraticCurveTo() {}
      bezierCurveTo() {}
      closePath() {}
      arc() {}
      rect() {}
    } as unknown as typeof Path2D;

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() =>
      createMock2dContext(),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(VALID_PNG_DATA_URL);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: BlobCallback,
      type?: string,
    ) {
      const copy = new Uint8Array(VALID_PNG_BYTES.length);
      copy.set(VALID_PNG_BYTES);
      cb(new Blob([copy.buffer], { type: type ?? 'image/png' }));
    });

    URL.createObjectURL = vi.fn(() => 'blob:mock-print-pdf');
    URL.revokeObjectURL = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      await useAppStore.getState().initApp();
      await useAppStore.getState().createNotebook({
        title: 'Printable Bio Notes',
        folderId: null,
        cover: {
          styleId: 'classic-navy',
          primaryColor: '#072D59',
          accentColor: '#DBF2FC',
          pattern: 'spine-band',
        },
        paper: {
          sizePreset: 'letter',
          orientation: 'portrait',
          width: 816,
          height: 1056,
          pattern: 'ruled',
          spacing: 32,
          marginLine: true,
          paperColor: '#FFFFFF',
        },
        openImmediately: true,
      });
      await useAppStore.getState().addPageFromTemplate(
        useAppStore.getState().activeNotebook!.defaultPaper,
      );
    });
  });

  afterEach(async () => {
    try {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      document.body.classList.remove('folio-printing-sheets');
      document
        .querySelectorAll('[data-folio-print-container="true"], [data-folio-print-page-style="true"]')
        .forEach((el) => el.remove());
      await useAppStore.getState().closeNotebook();
    } finally {
      globalThis.Path2D = origPath2D;
      window.print = origPrint;
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
      window.folioDesktop = origFolioDesktop;
      vi.restoreAllMocks();
    }
  });

  it('opens PrintPreviewModal on Ctrl+P, previews sheets live, prints via Electron IPC, supports System Dialog & Save as PDF', async () => {
    const getPrinters = vi.fn(async () => [
      {
        name: 'Office_Printer',
        displayName: 'Office Printer',
        description: 'LaserJet',
        isDefault: false,
      },
      {
        name: 'Default_Desk_Printer',
        displayName: 'Desk Color Printer',
        description: 'Inkjet',
        isDefault: true,
      },
    ]);
    const printSheets = vi.fn(async () => ({ ok: true }));
    window.folioDesktop = {
      isElectron: true,
      platform: 'win32',
      setUiZoomFactor: (f) => f,
      getUiZoomFactor: () => 1.35,
      aiFetch: vi.fn(),
      print: { getPrinters, printSheets },
    };

    const windowPrintSpy = vi.fn();
    window.print = windowPrintSpy;

    await act(async () => {
      root.render(<NotebookEditor />);
    });

    // Pressing Ctrl+P opens PrintPreviewModal instead of bare window.print()
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(windowPrintSpy).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="print-preview-modal"]')).not.toBeNull();
    expect(getPrinters).toHaveBeenCalledTimes(1);

    const destSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="print-destination-select"]',
    )!;
    expect(destSelect.value).toBe('Default_Desk_Printer');
    expect(
      container.querySelector('[data-testid="print-preview-sheet-counter"]')?.textContent,
    ).toContain('Sheet 1 of 2');
    expect(container.querySelector('[data-testid="print-preview-sheet-0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="print-preview-sheet-1"]')).not.toBeNull();

    // Update Orientation -> Landscape, Color -> B&W, Page Range -> Current (1 sheet)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="print-orientation-landscape"]')!.click();
      container.querySelector<HTMLButtonElement>('[data-testid="print-color-bw"]')!.click();
      container.querySelector<HTMLButtonElement>('[data-testid="print-range-current"]')!.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    const sheet0 = container.querySelector<HTMLElement>('[data-testid="print-preview-sheet-0"]')!;
    expect(sheet0.getAttribute('data-orientation')).toBe('landscape');
    expect(sheet0.getAttribute('data-color-mode')).toBe('bw');
    expect(container.querySelector('[data-testid="print-preview-sheet-1"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="print-preview-sheet-counter"]')?.textContent,
    ).toContain('Sheet 1 of 1');

    // Click System Dialog... -> calls printSheets with silent: false
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="print-system-dialog-btn"]')!.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(printSheets).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Printable Bio Notes',
        deviceName: 'Default_Desk_Printer',
        silent: false,
        landscape: true,
        color: false,
        copies: 1,
        pageSize: 'Letter',
        margins: 'default',
        fitMode: 'fit',
        sheetDataUrls: [VALID_PNG_DATA_URL],
      }),
    );

    // Re-open via Page -> Print menu button and submit silent print
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="page-menu-button"]')?.click();
    });
    const menuPrintBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="page-menu-print-btn"]',
    );
    expect(menuPrintBtn).not.toBeNull();
    await act(async () => {
      menuPrintBtn!.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    const copiesInput = container.querySelector<HTMLInputElement>(
      '[data-testid="print-copies-input"]',
    )!;
    const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      inputSetter.call(copiesInput, '3');
      copiesInput.dispatchEvent(new Event('change', { bubbles: true }));
      container.querySelector<HTMLButtonElement>('[data-testid="print-confirm-btn"]')!.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(printSheets).toHaveBeenLastCalledWith(
      expect.objectContaining({
        deviceName: 'Default_Desk_Printer',
        silent: true,
        copies: 3,
        landscape: false,
        color: true,
        sheetDataUrls: [VALID_PNG_DATA_URL, VALID_PNG_DATA_URL],
      }),
    );

    // Re-open and switch destination to Save as PDF
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });

    const selectEl = container.querySelector<HTMLSelectElement>(
      '[data-testid="print-destination-select"]',
    )!;
    const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    await act(async () => {
      selectSetter.call(selectEl, '__save_pdf__');
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="print-confirm-btn"]')?.textContent,
    ).toContain('Save PDF');
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="print-confirm-btn"]')!.click();
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-testid="print-preview-notice"]')?.textContent,
    ).toContain('Saved Printable Bio Notes.pdf');
  });

  it('mounts clean print sheets for browser fallback and cleans up on afterprint', async () => {
    delete window.folioDesktop;
    const windowPrintSpy = vi.fn();
    window.print = windowPrintSpy;

    await act(async () => {
      root.render(<NotebookEditor />);
    });

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }),
      );
      await new Promise((r) => setTimeout(r, 30));
    });

    const destSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="print-destination-select"]',
    )!;
    expect(destSelect.value).toBe('__browser_print__');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="print-confirm-btn"]')!.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(windowPrintSpy).toHaveBeenCalledTimes(1);
    const sheetContainer = document.querySelector('[data-folio-print-container="true"]');
    expect(sheetContainer).not.toBeNull();
    expect(sheetContainer?.querySelectorAll('.folio-print-sheet')).toHaveLength(2);
    expect(document.body.classList.contains('folio-printing-sheets')).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event('afterprint'));
    });

    expect(document.querySelector('[data-folio-print-container="true"]')).toBeNull();
    expect(document.body.classList.contains('folio-printing-sheets')).toBe(false);
  });
});
