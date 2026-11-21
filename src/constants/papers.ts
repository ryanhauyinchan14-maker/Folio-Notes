import type {
  BuiltInPaperPreset,
  PageOrientation,
  PageSizePresetId,
  PaperConfig,
} from '../types/notes';

export interface PageSizeDefinition {
  id: PageSizePresetId;
  label: string;
  subtitle: string;
  width: number;
  height: number;
}

export const PAGE_SIZE_DEFINITIONS: PageSizeDefinition[] = [
  { id: 'letter', label: 'US Letter', subtitle: '816 × 1056 px (8.5 × 11 in)', width: 816, height: 1056 },
  { id: 'a4', label: 'A4', subtitle: '794 × 1123 px (210 × 297 mm)', width: 794, height: 1123 },
  { id: 'legal', label: 'Legal', subtitle: '816 × 1344 px (8.5 × 14 in)', width: 816, height: 1344 },
  { id: 'tabloid', label: 'Tabloid', subtitle: '1056 × 1632 px (11 × 17 in)', width: 1056, height: 1632 },
  { id: 'custom', label: 'Custom', subtitle: 'User-defined dimensions', width: 816, height: 1056 },
];

export function resolvePageDimensions(
  preset: PageSizePresetId,
  orientation: PageOrientation,
  customWidth?: number,
  customHeight?: number,
): { width: number; height: number } {
  if (preset === 'custom') {
    const w = Math.max(320, Math.min(2400, Math.round(customWidth || 816)));
    const h = Math.max(320, Math.min(2400, Math.round(customHeight || 1056)));
    if (orientation === 'landscape' && h > w) {
      return { width: h, height: w };
    }
    if (orientation === 'portrait' && w > h) {
      return { width: h, height: w };
    }
    return { width: w, height: h };
  }

  const def = PAGE_SIZE_DEFINITIONS.find((d) => d.id === preset) ?? PAGE_SIZE_DEFINITIONS[0];
  return orientation === 'landscape'
    ? { width: def.height, height: def.width }
    : { width: def.width, height: def.height };
}

export const PAPER_COLOR_PRESETS = [
  { id: 'white', label: 'Crisp White', color: '#FFFFFF' },
  { id: 'cream', label: 'Warm Cream', color: '#FDF8EC' },
  { id: 'yellow', label: 'Legal Yellow', color: '#FEF7C3' },
  { id: 'mint', label: 'Soft Mint', color: '#F0FDF4' },
  { id: 'dark', label: 'Midnight Slate', color: '#1E293B' },
];

export const DEFAULT_PAPER_CONFIG: PaperConfig = {
  sizePreset: 'letter',
  orientation: 'portrait',
  width: 816,
  height: 1056,
  pattern: 'ruled',
  spacing: 32,
  marginLine: true,
  marginColor: '#F43F5E',
  marginOffset: 96,
  paperColor: '#FFFFFF',
};

export const BUILT_IN_PAPER_PRESETS: BuiltInPaperPreset[] = [
  {
    id: 'builtin-ruled-letter',
    name: 'College Ruled',
    description: 'Classic ruled paper with left margin',
    paper: {
      ...DEFAULT_PAPER_CONFIG,
      pattern: 'ruled',
      spacing: 32,
      marginLine: true,
      paperColor: '#FFFFFF',
    },
  },
  {
    id: 'builtin-wide-ruled',
    name: 'Wide Ruled',
    description: 'Generous 42px line spacing on warm cream',
    paper: {
      ...DEFAULT_PAPER_CONFIG,
      pattern: 'ruled',
      spacing: 42,
      marginLine: true,
      paperColor: '#FDF8EC',
    },
  },
  {
    id: 'builtin-grid',
    name: 'Square Grid',
    description: 'Clean engineering & math grid (24px)',
    paper: {
      ...DEFAULT_PAPER_CONFIG,
      pattern: 'grid',
      spacing: 24,
      marginLine: false,
      paperColor: '#FFFFFF',
    },
  },
  {
    id: 'builtin-dotted',
    name: 'Dot Grid',
    description: 'Minimalist bullet-journal dot grid',
    paper: {
      ...DEFAULT_PAPER_CONFIG,
      pattern: 'dotted',
      spacing: 24,
      marginLine: false,
      paperColor: '#FDF8EC',
    },
  },
  {
    id: 'builtin-cornell',
    name: 'Cornell Notes',
    description: 'Cue column, notes area, and summary footer',
    paper: {
      ...DEFAULT_PAPER_CONFIG,
      pattern: 'cornell',
      spacing: 32,
      marginLine: false,
      paperColor: '#FFFFFF',
    },
  },
  {
    id: 'builtin-blank',
    name: 'Blank Sheet',
    description: 'Clean unruled canvas for sketching',
    paper: {
      ...DEFAULT_PAPER_CONFIG,
      pattern: 'blank',
      spacing: 32,
      marginLine: false,
      paperColor: '#FFFFFF',
    },
  },
];
