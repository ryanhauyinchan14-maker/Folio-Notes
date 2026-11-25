export type PrintPaperSize = 'Letter' | 'A4' | 'Legal' | 'Tabloid';
export type PrintMarginsMode = 'none' | 'default';
export type PrintFitMode = 'fit' | 'actual';

export interface FolioPrinterInfo {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
}

export interface FolioPrintSheetsRequest {
  title: string;
  sheetDataUrls: string[];
  deviceName?: string;
  silent: boolean;
  landscape: boolean;
  color: boolean;
  copies: number;
  pageSize: PrintPaperSize;
  margins: PrintMarginsMode;
  fitMode: PrintFitMode;
}

export interface FolioPrintResult {
  ok: boolean;
  error?: string;
}

export const PRINT_PAPER_DIMENSIONS: Record<
  PrintPaperSize,
  { width: string; height: string; aspectRatio: number }
> = {
  Letter: { width: '8.5in', height: '11in', aspectRatio: 8.5 / 11 },
  A4: { width: '210mm', height: '297mm', aspectRatio: 210 / 297 },
  Legal: { width: '8.5in', height: '14in', aspectRatio: 8.5 / 14 },
  Tabloid: { width: '11in', height: '17in', aspectRatio: 11 / 17 },
};

const MAX_PRINT_SHEETS = 300;
const DATA_URL_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

export function validatePrintSheetsRequest(raw: unknown): FolioPrintSheetsRequest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid print request payload.');
  }
  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.sheetDataUrls) || obj.sheetDataUrls.length === 0) {
    throw new Error('At least one rendered sheet is required to print.');
  }
  if (obj.sheetDataUrls.length > MAX_PRINT_SHEETS) {
    throw new Error(`Cannot print more than ${MAX_PRINT_SHEETS} sheets in a single job.`);
  }

  const sheetDataUrls: string[] = [];
  for (let i = 0; i < obj.sheetDataUrls.length; i++) {
    const item = obj.sheetDataUrls[i];
    if (typeof item !== 'string' || !DATA_URL_RE.test(item)) {
      throw new Error(`Invalid raster sheet data at index ${i}.`);
    }
    sheetDataUrls.push(item);
  }

  const rawSize = typeof obj.pageSize === 'string' ? obj.pageSize : '';
  const pageSize: PrintPaperSize =
    rawSize === 'Letter' || rawSize === 'A4' || rawSize === 'Legal' || rawSize === 'Tabloid'
      ? rawSize
      : 'Letter';

  const margins: PrintMarginsMode = obj.margins === 'none' ? 'none' : 'default';
  const fitMode: PrintFitMode = obj.fitMode === 'actual' ? 'actual' : 'fit';
  const silent = Boolean(obj.silent);
  const landscape = Boolean(obj.landscape);
  const color = typeof obj.color === 'boolean' ? obj.color : true;

  const rawCopies = typeof obj.copies === 'number' && Number.isFinite(obj.copies) ? Math.round(obj.copies) : 1;
  const copies = Math.max(1, Math.min(99, rawCopies));

  const deviceName =
    typeof obj.deviceName === 'string' && obj.deviceName.trim().length > 0
      ? obj.deviceName.trim()
      : undefined;

  const rawTitle = typeof obj.title === 'string' ? obj.title.trim() : '';
  const title = (rawTitle || 'Folio Notes').slice(0, 160);

  return {
    title,
    sheetDataUrls,
    deviceName,
    silent,
    landscape,
    color,
    copies,
    pageSize,
    margins,
    fitMode,
  };
}

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildPrintDocumentHtml(req: FolioPrintSheetsRequest): string {
  const dims = PRINT_PAPER_DIMENSIONS[req.pageSize] ?? PRINT_PAPER_DIMENSIONS.Letter;
  const sheetWidth = req.landscape ? dims.height : dims.width;
  const rawHeight = req.landscape ? dims.width : dims.height;
  const heightTolerance = rawHeight.endsWith('mm') ? '0.5mm' : '0.02in';
  const sheetHeight = `calc(${rawHeight} - ${heightTolerance})`;
  const orientation = req.landscape ? 'landscape' : 'portrait';
  const paddingCss = req.margins === 'default' ? '0.4in' : '0';
  const filterCss = req.color ? 'none' : 'grayscale(100%)';
  const imgSizeCss =
    req.fitMode === 'actual'
      ? 'max-width: none; max-height: none; width: auto; height: auto;'
      : 'max-width: 100%; max-height: 100%; width: 100%; height: 100%; object-fit: contain;';

  const sheetsHtml = req.sheetDataUrls
    .map(
      (url, index) =>
        `  <div class="sheet" data-sheet-index="${index}"><img src="${url}" alt="Sheet ${index + 1}" /></div>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtmlText(req.title)}</title>
  <style>
    @page {
      size: ${req.pageSize} ${orientation};
      margin: 0;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      box-sizing: border-box;
      width: ${sheetWidth};
      height: ${sheetHeight};
      padding: ${paddingCss};
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: #ffffff;
      page-break-after: always;
      break-after: page;
    }
    .sheet:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .sheet img {
      display: block;
      ${imgSizeCss}
      filter: ${filterCss};
    }
  </style>
</head>
<body>
${sheetsHtml}
</body>
</html>
`;
}
