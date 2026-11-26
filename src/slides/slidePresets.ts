import type { PaperConfig, SlideData, SlideSizePresetId } from '../types/notes';
import { createId } from '../utils/id';

export interface SlideSizePresetOption {
  id: Exclude<SlideSizePresetId, 'custom'>;
  label: string;
  subtitle: string;
  width: number;
  height: number;
}

export const DEFAULT_SLIDE_SIZE_PRESET: SlideSizePresetId = '16:9';

export const SLIDE_SIZE_PRESETS: SlideSizePresetOption[] = [
  { id: '16:9', label: '16:9 Widescreen', subtitle: '1920 × 1080 (Default)', width: 1920, height: 1080 },
  { id: '4:3', label: '4:3 Classic', subtitle: '1440 × 1080', width: 1440, height: 1080 },
  { id: '1:1', label: '1:1 Square', subtitle: '1080 × 1080', width: 1080, height: 1080 },
  { id: '9:16', label: '9:16 Vertical', subtitle: '1080 × 1920', width: 1080, height: 1920 },
  { id: 'a4-landscape', label: 'A4 Landscape', subtitle: '1754 × 1240', width: 1754, height: 1240 },
];

export const DEFAULT_SLIDE_PAPER: PaperConfig = {
  sizePreset: 'custom',
  orientation: 'landscape',
  width: 1920,
  height: 1080,
  pattern: 'blank',
  spacing: 32,
  marginLine: false,
  paperColor: '#FFFFFF',
};

export function resolveSlidePaperConfig(
  preset: SlideSizePresetId = DEFAULT_SLIDE_SIZE_PRESET,
  customWidth?: number,
  customHeight?: number,
): PaperConfig {
  if (preset === 'custom') {
    const width = Math.max(320, Math.min(4096, Math.round(customWidth || 1920)));
    const height = Math.max(320, Math.min(4096, Math.round(customHeight || 1080)));
    return {
      ...DEFAULT_SLIDE_PAPER,
      orientation: width >= height ? 'landscape' : 'portrait',
      width,
      height,
    };
  }
  const found = SLIDE_SIZE_PRESETS.find((p) => p.id === preset) ?? SLIDE_SIZE_PRESETS[0];
  return {
    ...DEFAULT_SLIDE_PAPER,
    orientation: found.width >= found.height ? 'landscape' : 'portrait',
    width: found.width,
    height: found.height,
  };
}

export function createStarterSlideData(
  width = 1920,
  height = 1080,
  deckTitle = 'Untitled Presentation',
): SlideData {
  const titleW = Math.round(width * 0.72);
  const titleH = Math.round(height * 0.22);
  const subW = Math.round(width * 0.56);
  const subH = Math.round(height * 0.12);
  return {
    background: {
      kind: 'solid',
      color: '#FFFFFF',
    },
    speakerNotes: '',
    transition: 'fade',
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
        width: titleW,
        height: titleH,
        rotation: 0,
        opacity: 1,
        zIndex: 2,
        text: deckTitle || 'Untitled Presentation',
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
        width: subW,
        height: subH,
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
    inkStrokes: [],
  };
}
