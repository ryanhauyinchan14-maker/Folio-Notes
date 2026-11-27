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

export type BrushPresetId =
  | 'technical'
  | 'fountain'
  | 'pencil'
  | 'airbrush'
  | 'watercolor'
  | 'marker'
  | 'monoline'
  | 'highlighter';

export type LayerBlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten';

export interface DrawingLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: LayerBlendMode;
  locked: boolean;
  alphaLock: boolean;
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
  layerId?: string;
  brushId?: BrushPresetId;
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
  imagePresentation?: 'inset' | 'full';
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

export type NotebookMode = 'notebook' | 'whiteboard' | 'notes' | 'slides';

export type WorkspaceCategory = 'drawing' | 'notes' | 'slides';

export function getWorkspaceCategory(mode?: NotebookMode): WorkspaceCategory {
  if (mode === 'notes') return 'notes';
  if (mode === 'slides') return 'slides';
  return 'drawing';
}

export type SlideSizePresetId =
  | '16:9'
  | '4:3'
  | '1:1'
  | '9:16'
  | 'a4-landscape'
  | 'custom';

export interface Notebook {
  id: string;
  title: string;
  mode?: NotebookMode;
  slideSizePreset?: SlideSizePresetId;
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

export type NotePageStyle = 'paginated' | 'pageless';
export type NotePageMargins = 'narrow' | 'normal' | 'wide';

export interface NoteDocumentData {
  contentJson: Record<string, unknown>;
  contentHtml: string;
  plainText: string;
  pageStyle: NotePageStyle;
  pageMargins: NotePageMargins;
  defaultFont: string;
  headerText?: string;
  footerText?: string;
  showPageNumbers?: boolean;
}

export interface SlideBackground {
  kind: 'solid' | 'gradient' | 'image';
  color?: string;
  gradient?: string;
  imageDataUrl?: string;
}

export type SlideTransition = 'none' | 'fade' | 'slide' | 'zoom';

export type SlideShapeKind =
  | 'rect'
  | 'rounded-rect'
  | 'circle'
  | 'triangle'
  | 'arrow'
  | 'line'
  | 'star'
  | 'pill'
  | 'speech-bubble'
  | 'divider';

export interface SlideElementBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  locked?: boolean;
  groupId?: string;
}

export interface SlideTextElement extends SlideElementBase {
  kind: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color: string;
  backgroundColor?: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  padding: number;
  borderRadius?: number;
}

export interface SlideShapeElement extends SlideElementBase {
  kind: 'shape';
  shape: SlideShapeKind;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  cornerRadius: number;
  shadow?: boolean;
}

export interface SlideImageElement extends SlideElementBase {
  kind: 'image';
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  crop: ImageCropRect;
  borderRadius: number;
  flipX: boolean;
  flipY: boolean;
  objectFit: 'cover' | 'contain' | 'fill';
  shadow?: boolean;
}

export type SlideElement = SlideTextElement | SlideShapeElement | SlideImageElement;

export interface SlideData {
  elements: SlideElement[];
  background: SlideBackground;
  speakerNotes: string;
  transition: SlideTransition;
  inkStrokes?: Stroke[];
}

export interface Page {
  id: string;
  notebookId: string;
  paper: PaperConfig;
  strokes: Stroke[];
  layers?: DrawingLayer[];
  textboxes?: Textbox[];
  images?: PageImage[];
  noteData?: NoteDocumentData | null;
  slideData?: SlideData | null;
  pdfBackground?: PdfPageBackground | null;
  encryptedStrokes?: EncryptedPayload | null;
  thumbnailDataUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TrashedNotebookRecord {
  id: string;
  notebook: Notebook;
  pages: Page[];
  pdfAssets: PdfAsset[];
  originalFolderName?: string | null;
  deletedAt: number;
  expiresAt: number;
}

export interface PaperTemplate {
  id: string;
  name: string;
  mode?: NotebookMode;
  category: 'paper-preset' | 'page-template';
  paper: PaperConfig;
  strokes: Stroke[];
  textboxes?: Textbox[];
  images?: PageImage[];
  thumbnailDataUrl: string;
  createdAt: number;
  updatedAt: number;
}

export type ToolType =
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'lasso'
  | 'text'
  | 'pan'
  | 'fill'
  | 'eyedropper';

export interface BuiltInPaperVariant {
  id: string;
  label: string;
  fullName: string;
  swatchColor?: string;
  paper: PaperConfig;
}

export interface BuiltInPaperPreset {
  id: string;
  name: string;
  mode?: NotebookMode;
  paper: PaperConfig;
  variants?: BuiltInPaperVariant[];
}

export interface CoverPreset {
  id: CoverStyleId;
  name: string;
  cover: CoverConfig;
}

export interface CustomFontRecord {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
  createdAt: number;
}

export interface UploadedInterfaceFontMeta {
  id: string;
  name: string;
  fileName: string;
  createdAt: number;
}
