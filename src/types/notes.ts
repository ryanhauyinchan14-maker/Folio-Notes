export type PaperPattern = 'blank' | 'ruled' | 'grid' | 'dotted' | 'cornell';

export type PageSizePresetId = 'letter' | 'a4' | 'legal' | 'tabloid' | 'custom';

export type PageOrientation = 'portrait' | 'landscape';

export interface PaperConfig {
  sizePreset: PageSizePresetId;
  orientation: PageOrientation;
  width: number;
  height: number;
  pattern: PaperPattern;
  spacing: number;
  marginLine: boolean;
  marginColor?: string;
  marginOffset?: number;
  paperColor: string;
  lineColor?: string;
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  t?: number;
}

export type ShapeGeometry =
  | {
      kind: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      kind: 'circle';
      cx: number;
      cy: number;
      r: number;
    };

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Stroke {
  id: string;
  tool: 'pen' | 'highlighter';
  color: string;
  size: number;
  opacity: number;
  simulatePressure: boolean;
  points: StrokePoint[];
  shape?: ShapeGeometry;
  bounds: BoundingBox;
  isTidied?: boolean;
  groupId?: string;
  locked?: boolean;
  createdAt: number;
}

export type TextboxFontFamily = 'sans' | 'serif' | 'mono' | 'handwriting';

export interface Textbox {
  id: string;
  x: number;
  y: number;
  text: string;
  fontFamily: TextboxFontFamily;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  wrapWidth?: number;
  groupId?: string;
  locked?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type CoverStyleId =
  | 'classic-navy'
  | 'sage-linen'
  | 'terracotta'
  | 'midnight'
  | 'kraft'
  | 'lavender-grid'
  | 'sunrise-gradient'
  | 'emerald'
  | 'custom-color'
  | 'custom-image';

export interface CoverConfig {
  styleId: CoverStyleId;
  primaryColor: string;
  accentColor: string;
  pattern: 'solid' | 'spine-band' | 'dots' | 'grid' | 'gradient';
  customImageDataUrl?: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface EncryptedPayload {
  iv: string;
  ciphertext: string;
  cipherBuffer?: ArrayBuffer;
}

export interface WrappedKeyBlob {
  salt: string;
  iv: string;
  wrappedKey: string;
  iterations: number;
}

export interface VaultMetadata {
  version: 1;
  createdAt: number;
  updatedAt: number;
  passwordWrapped: WrappedKeyBlob;
  recoveryWrapped: WrappedKeyBlob;
}

export interface Notebook {
  id: string;
  title: string;
  folderId: string | null;
  cover: CoverConfig;
  defaultPaper: PaperConfig;
  pageOrder: string[];
  lastOpenedPageId: string | null;
  isLocked?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ImageCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageImage {
  id: string;
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  crop: ImageCropRect;
  borderRadius: number;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
  zIndex: number;
  groupId?: string;
  locked?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PdfPageBackground {
  assetId: string;
  pageNumber: number;
}

export interface PdfAsset {
  id: string;
  notebookId: string;
  name: string;
  data: ArrayBuffer | Blob | null;
  encryptedData?: EncryptedPayload | null;
  pageCount: number;
  createdAt: number;
}

export interface Page {
  id: string;
  notebookId: string;
  paper: PaperConfig;
  strokes: Stroke[];
  textboxes?: Textbox[];
  images?: PageImage[];
  pdfBackground?: PdfPageBackground | null;
  encryptedStrokes?: EncryptedPayload | null;
  thumbnailDataUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PaperTemplate {
  id: string;
  name: string;
  category: 'paper-preset' | 'page-template';
  paper: PaperConfig;
  strokes: Stroke[];
  textboxes?: Textbox[];
  images?: PageImage[];
  thumbnailDataUrl: string;
  createdAt: number;
  updatedAt: number;
}

export type ToolType = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'text' | 'pan';

export interface BuiltInPaperPreset {
  id: string;
  name: string;
  description: string;
  paper: PaperConfig;
}

export interface CoverPreset {
  id: CoverStyleId;
  name: string;
  cover: CoverConfig;
}
