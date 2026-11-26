import type {
  SlideData,
  SlideImageElement,
  SlideShapeElement,
  SlideShapeKind,
  SlideTextElement,
} from '../types/notes';
import { createId } from '../utils/id';

export type SlideLayoutId =
  | 'title'
  | 'section'
  | 'bullets'
  | 'two-column'
  | 'stat-quote'
  | 'cards-3'
  | 'blank';

export interface SlideLayoutOption {
  id: SlideLayoutId;
  name: string;
  description: string;
}

export const SLIDE_LAYOUT_OPTIONS: SlideLayoutOption[] = [
  { id: 'title', name: 'Title Hero', description: 'Accent bar + headline + subtitle' },
  { id: 'section', name: 'Section Header', description: 'Deep navy statement banner' },
  { id: 'bullets', name: 'Title & Bullets', description: 'Header + structured list points' },
  { id: 'two-column', name: 'Two Columns', description: 'Side-by-side comparison cards' },
  { id: 'stat-quote', name: 'Big Stat / Quote', description: 'Editorial focal callout' },
  { id: 'cards-3', name: 'Three Cards', description: '3-column feature layout' },
  { id: 'blank', name: 'Blank Slide', description: 'Clean canvas from scratch' },
];

export const SLIDE_BACKGROUND_SOLIDS: string[] = [
  '#FFFFFF',
  '#F2F7FB',
  '#DBF2FC',
  '#FFF5F7',
  '#F4EFE6',
  '#072D59',
  '#0F1D32',
  '#1E293B',
];

export const SLIDE_BACKGROUND_GRADIENTS: Array<{ label: string; gradient: string }> = [
  { label: 'Seal Sky', gradient: 'linear-gradient(135deg, #DBF2FC 0%, #FFFFFF 55%, #FCE7EE 100%)' },
  { label: 'Ocean Depth', gradient: 'linear-gradient(135deg, #072D59 0%, #0F4C81 55%, #1E6FA8 100%)' },
  { label: 'Crimson Dawn', gradient: 'linear-gradient(135deg, #FFF1F3 0%, #FDE2E8 50%, #DBF2FC 100%)' },
  { label: 'Midnight Slate', gradient: 'linear-gradient(135deg, #052142 0%, #0F172A 60%, #1E293B 100%)' },
  { label: 'Warm Sand', gradient: 'linear-gradient(135deg, #FDFBF7 0%, #F4EFE6 60%, #E7F3FA 100%)' },
  { label: 'Aurora Mint', gradient: 'linear-gradient(135deg, #ECFDF5 0%, #DBEAFE 55%, #FCE7F3 100%)' },
];

export const SLIDE_SHAPE_CATALOG: Array<{ shape: SlideShapeKind; label: string }> = [
  { shape: 'rect', label: 'Rectangle' },
  { shape: 'rounded-rect', label: 'Rounded Box' },
  { shape: 'circle', label: 'Circle' },
  { shape: 'triangle', label: 'Triangle' },
  { shape: 'arrow', label: 'Arrow' },
  { shape: 'line', label: 'Line' },
  { shape: 'star', label: 'Star' },
  { shape: 'pill', label: 'Pill Badge' },
  { shape: 'speech-bubble', label: 'Callout' },
  { shape: 'divider', label: 'Divider' },
];

export function createSlideTextElement(
  variant: 'heading' | 'subheading' | 'body' | 'badge',
  slideW: number,
  slideH: number,
  zIndex: number,
): SlideTextElement {
  if (variant === 'heading') {
    return {
      id: createId(),
      kind: 'text',
      x: Math.round(slideW * 0.1),
      y: Math.round(slideH * 0.18),
      width: Math.round(slideW * 0.65),
      height: Math.max(90, Math.round(slideH * 0.16)),
      rotation: 0,
      opacity: 1,
      zIndex,
      text: 'Slide Heading',
      fontFamily: 'Plus Jakarta Sans, sans-serif',
      fontSize: Math.max(36, Math.round(slideH * 0.062)),
      bold: true,
      italic: false,
      color: '#072D59',
      align: 'left',
      lineHeight: 1.15,
      padding: 12,
    };
  }
  if (variant === 'subheading') {
    return {
      id: createId(),
      kind: 'text',
      x: Math.round(slideW * 0.1),
      y: Math.round(slideH * 0.36),
      width: Math.round(slideW * 0.55),
      height: Math.max(70, Math.round(slideH * 0.11)),
      rotation: 0,
      opacity: 1,
      zIndex,
      text: 'Concise subheading or key takeaway',
      fontFamily: 'Plus Jakarta Sans, sans-serif',
      fontSize: Math.max(22, Math.round(slideH * 0.032)),
      bold: true,
      italic: false,
      color: '#3B5C82',
      align: 'left',
      lineHeight: 1.25,
      padding: 10,
    };
  }
  if (variant === 'badge') {
    return {
      id: createId(),
      kind: 'text',
      x: Math.round(slideW * 0.1),
      y: Math.round(slideH * 0.1),
      width: Math.max(220, Math.round(slideW * 0.18)),
      height: 54,
      rotation: 0,
      opacity: 1,
      zIndex,
      text: 'KEY INSIGHT',
      fontFamily: 'Plus Jakarta Sans, sans-serif',
      fontSize: 20,
      bold: true,
      italic: false,
      color: '#FFFFFF',
      backgroundColor: '#FD6E88',
      align: 'center',
      lineHeight: 1.2,
      padding: 10,
      borderRadius: 999,
    };
  }
  return {
    id: createId(),
    kind: 'text',
    x: Math.round(slideW * 0.1),
    y: Math.round(slideH * 0.45),
    width: Math.round(slideW * 0.52),
    height: Math.max(120, Math.round(slideH * 0.2)),
    rotation: 0,
    opacity: 1,
    zIndex,
    text: 'Double-click to edit body text. Drag corners to resize or use the handle to rotate.',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: Math.max(18, Math.round(slideH * 0.026)),
    bold: false,
    italic: false,
    color: '#072D59',
    align: 'left',
    lineHeight: 1.45,
    padding: 12,
  };
}

export function createSlideShapeElement(
  shape: SlideShapeKind,
  slideW: number,
  slideH: number,
  zIndex: number,
): SlideShapeElement {
  const isThin = shape === 'line' || shape === 'divider';
  const defaultW = Math.round(slideW * (isThin ? 0.38 : 0.22));
  const defaultH = isThin
    ? 8
    : shape === 'pill'
      ? 72
      : shape === 'arrow'
        ? 96
        : Math.round(slideW * 0.22);

  return {
    id: createId(),
    kind: 'shape',
    shape,
    x: Math.round((slideW - defaultW) / 2),
    y: Math.round((slideH - defaultH) / 2),
    width: defaultW,
    height: defaultH,
    rotation: 0,
    opacity: 1,
    zIndex,
    fillColor: shape === 'pill' ? '#FD6E88' : isThin ? '#072D59' : '#DBF2FC',
    strokeColor: '#072D59',
    strokeWidth: isThin ? 4 : 3,
    cornerRadius: shape === 'rounded-rect' ? 24 : shape === 'pill' ? 999 : 0,
    shadow: false,
  };
}

export function createSlideImageElement(
  img: { dataUrl: string; naturalWidth: number; naturalHeight: number },
  slideW: number,
  slideH: number,
  zIndex: number,
): SlideImageElement {
  const maxW = Math.round(slideW * 0.45);
  const maxH = Math.round(slideH * 0.55);
  const ratio = Math.min(
    maxW / Math.max(1, img.naturalWidth),
    maxH / Math.max(1, img.naturalHeight),
    1,
  );
  const width = Math.max(80, Math.round(img.naturalWidth * ratio));
  const height = Math.max(80, Math.round(img.naturalHeight * ratio));

  return {
    id: createId(),
    kind: 'image',
    x: Math.round((slideW - width) / 2),
    y: Math.round((slideH - height) / 2),
    width,
    height,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    borderRadius: 16,
    rotation: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
    objectFit: 'cover',
    shadow: true,
    zIndex,
    dataUrl: img.dataUrl,
  };
}

export function createSlideLayout(
  layoutId: SlideLayoutId,
  width: number,
  height: number,
): Pick<SlideData, 'background' | 'elements'> {
  if (layoutId === 'blank') {
    return { background: { kind: 'solid', color: '#FFFFFF' }, elements: [] };
  }

  if (layoutId === 'section') {
    return {
      background: { kind: 'solid', color: '#072D59' },
      elements: [
        {
          id: createId(),
          kind: 'shape',
          shape: 'pill',
          x: Math.round(width * 0.1),
          y: Math.round(height * 0.28),
          width: Math.round(width * 0.14),
          height: 14,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          fillColor: '#FD6E88',
          strokeColor: 'transparent',
          strokeWidth: 0,
          cornerRadius: 999,
        },
        {
          id: createId(),
          kind: 'text',
          x: Math.round(width * 0.1),
          y: Math.round(height * 0.34),
          width: Math.round(width * 0.78),
          height: Math.round(height * 0.24),
          rotation: 0,
          opacity: 1,
          zIndex: 2,
          text: 'Section Overview',
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: Math.max(40, Math.round(height * 0.072)),
          bold: true,
          italic: false,
          color: '#FFFFFF',
          align: 'left',
          lineHeight: 1.15,
          padding: 8,
        },
      ],
    };
  }

  if (layoutId === 'bullets') {
    return {
      background: { kind: 'solid', color: '#FFFFFF' },
      elements: [
        {
          id: createId(),
          kind: 'text',
          x: Math.round(width * 0.08),
          y: Math.round(height * 0.1),
          width: Math.round(width * 0.84),
          height: Math.round(height * 0.14),
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          text: 'Key Takeaways',
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: Math.max(32, Math.round(height * 0.056)),
          bold: true,
          italic: false,
          color: '#072D59',
          align: 'left',
          lineHeight: 1.2,
          padding: 8,
        },
        {
          id: createId(),
          kind: 'text',
          x: Math.round(width * 0.08),
          y: Math.round(height * 0.28),
          width: Math.round(width * 0.84),
          height: Math.round(height * 0.58),
          rotation: 0,
          opacity: 1,
          zIndex: 2,
          text: '• First primary concept with clear context\n• Supporting evidence or core formula\n• Practical example and closing insight',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: Math.max(20, Math.round(height * 0.032)),
          bold: false,
          italic: false,
          color: '#0F2B4D',
          backgroundColor: '#F2F7FB',
          align: 'left',
          lineHeight: 1.65,
          padding: 28,
          borderRadius: 24,
        },
      ],
    };
  }

  if (layoutId === 'two-column') {
    const colW = Math.round(width * 0.4);
    const colH = Math.round(height * 0.56);
    const colY = Math.round(height * 0.28);
    return {
      background: { kind: 'solid', color: '#FFFFFF' },
      elements: [
        {
          id: createId(),
          kind: 'text',
          x: Math.round(width * 0.08),
          y: Math.round(height * 0.1),
          width: Math.round(width * 0.84),
          height: Math.round(height * 0.14),
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          text: 'Side-by-Side Comparison',
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: Math.max(32, Math.round(height * 0.054)),
          bold: true,
          italic: false,
          color: '#072D59',
          align: 'left',
          lineHeight: 1.2,
          padding: 8,
        },
        {
          id: createId(),
          kind: 'shape',
          shape: 'rounded-rect',
          x: Math.round(width * 0.08),
          y: colY,
          width: colW,
          height: colH,
          rotation: 0,
          opacity: 1,
          zIndex: 2,
          fillColor: '#DBF2FC',
          strokeColor: '#9AD7F7',
          strokeWidth: 2,
          cornerRadius: 24,
        },
        {
          id: createId(),
          kind: 'text',
          x: Math.round(width * 0.1),
          y: colY + 24,
          width: colW - 48,
          height: colH - 48,
          rotation: 0,
          opacity: 1,
          zIndex: 3,
          text: 'Option A\n\nAdd strengths, metrics, or summary notes here.',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: Math.max(18, Math.round(height * 0.028)),
          bold: false,
          italic: false,
          color: '#072D59',
          align: 'left',
          lineHeight: 1.45,
          padding: 12,
        },
        {
          id: createId(),
          kind: 'shape',
          shape: 'rounded-rect',
          x: Math.round(width * 0.52),
          y: colY,
          width: colW,
          height: colH,
          rotation: 0,
          opacity: 1,
          zIndex: 4,
          fillColor: '#FFF1F3',
          strokeColor: '#FBCFE8',
          strokeWidth: 2,
          cornerRadius: 24,
        },
        {
          id: createId(),
          kind: 'text',
          x: Math.round(width * 0.54),
          y: colY + 24,
          width: colW - 48,
          height: colH - 48,
          rotation: 0,
          opacity: 1,
          zIndex: 5,
          text: 'Option B\n\nAdd contrast points, results, or next steps.',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: Math.max(18, Math.round(height * 0.028)),
          bold: false,
          italic: false,
          color: '#072D59',
          align: 'left',
          lineHeight: 1.45,
          padding: 12,
        },
      ],
    };
  }

  if (layoutId === 'stat-quote') {
    return {
      background: {
        kind: 'gradient',
        gradient: SLIDE_BACKGROUND_GRADIENTS[0].gradient,
      },
      elements: [
        {
          id: createId(),
          kind: 'text',
          x: Math.round(width * 0.12),
          y: Math.round(height * 0.25),
          width: Math.round(width * 0.76),
          height: Math.round(height * 0.28),
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          text: '“Simplicity is about subtracting the obvious and adding the meaningful.”',
          fontFamily: 'Georgia, serif',
          fontSize: Math.max(30, Math.round(height * 0.05)),
          bold: true,
          italic: true,
          color: '#072D59',
          align: 'center',
          lineHeight: 1.3,
          padding: 16,
        },
        {
          id: createId(),
          kind: 'text',
          x: Math.round(width * 0.25),
          y: Math.round(height * 0.58),
          width: Math.round(width * 0.5),
          height: 64,
          rotation: 0,
          opacity: 0.85,
          zIndex: 2,
          text: '— JOHN MAEDA',
          fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontSize: Math.max(16, Math.round(height * 0.024)),
          bold: true,
          italic: false,
          color: '#FD6E88',
          align: 'center',
          lineHeight: 1.2,
          padding: 8,
        },
      ],
    };
  }

  if (layoutId === 'cards-3') {
    const cardW = Math.round(width * 0.25);
    const cardH = Math.round(height * 0.52);
    const cardY = Math.round(height * 0.3);
    const xs = [Math.round(width * 0.08), Math.round(width * 0.375), Math.round(width * 0.67)];
    const elements: SlideData['elements'] = [
      {
        id: createId(),
        kind: 'text',
        x: Math.round(width * 0.08),
        y: Math.round(height * 0.1),
        width: Math.round(width * 0.84),
        height: Math.round(height * 0.14),
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        text: 'Three Core Pillars',
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: Math.max(32, Math.round(height * 0.052)),
        bold: true,
        italic: false,
        color: '#072D59',
        align: 'left',
        lineHeight: 1.2,
        padding: 8,
      },
    ];
    xs.forEach((x, idx) => {
      elements.push({
        id: createId(),
        kind: 'shape',
        shape: 'rounded-rect',
        x,
        y: cardY,
        width: cardW,
        height: cardH,
        rotation: 0,
        opacity: 1,
        zIndex: 2 + idx * 2,
        fillColor: '#F2F7FB',
        strokeColor: '#CBD5E1',
        strokeWidth: 2,
        cornerRadius: 24,
        shadow: true,
      });
      elements.push({
        id: createId(),
        kind: 'text',
        x: x + 20,
        y: cardY + 24,
        width: cardW - 40,
        height: cardH - 48,
        rotation: 0,
        opacity: 1,
        zIndex: 3 + idx * 2,
        text: `0${idx + 1}. Pillar ${idx + 1}\n\nShort summary goes here.`,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: Math.max(18, Math.round(height * 0.026)),
        bold: false,
        italic: false,
        color: '#072D59',
        align: 'left',
        lineHeight: 1.45,
        padding: 10,
      });
    });
    return { background: { kind: 'solid', color: '#FFFFFF' }, elements };
  }

  // Default: 'title'
  return {
    background: { kind: 'solid', color: '#FFFFFF' },
    elements: [
      {
        id: createId(),
        kind: 'shape',
        shape: 'rounded-rect',
        x: Math.round(width * 0.08),
        y: Math.round(height * 0.28),
        width: 12,
        height: Math.round(height * 0.36),
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        fillColor: '#FD6E88',
        strokeColor: 'transparent',
        strokeWidth: 0,
        cornerRadius: 6,
      },
      {
        id: createId(),
        kind: 'text',
        x: Math.round(width * 0.12),
        y: Math.round(height * 0.3),
        width: Math.round(width * 0.72),
        height: Math.round(height * 0.22),
        rotation: 0,
        opacity: 1,
        zIndex: 2,
        text: 'Presentation Title',
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: Math.max(36, Math.round(height * 0.068)),
        bold: true,
        italic: false,
        color: '#072D59',
        align: 'left',
        lineHeight: 1.15,
        padding: 12,
      },
      {
        id: createId(),
        kind: 'text',
        x: Math.round(width * 0.12),
        y: Math.round(height * 0.54),
        width: Math.round(width * 0.56),
        height: Math.round(height * 0.12),
        rotation: 0,
        opacity: 0.85,
        zIndex: 3,
        text: 'Click to add subtitle or presenter details',
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: Math.max(20, Math.round(height * 0.028)),
        bold: false,
        italic: false,
        color: '#3B5C82',
        align: 'left',
        lineHeight: 1.3,
        padding: 10,
      },
    ],
  };
}
