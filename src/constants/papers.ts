import type {
  BuiltInPaperPreset,
  NotebookMode,
  PageOrientation,
  PageSizePresetId,
  PaperConfig,
  PaperPattern,
} from '../types/notes';

export function formatPaperPatternLabel(pattern: PaperPattern): string {
  switch (pattern) {
    case 'blank':
      return 'Blank';
    case 'ruled':
      return 'Lined';
    case 'grid':
      return 'Graph';
    case 'dotted':
      return 'Dotted';
    case 'cornell':
      return 'Study Notes';
    default:
      return pattern;
  }
}

export interface PageSizeDefinition {
  id: PageSizePresetId;
  label: string;
  subtitle: string;
  width: number;
  height: number;
}

export const PAGE_SIZE_DEFINITIONS: PageSizeDefinition[] = [
  { id: 'letter', label: 'Standard Letter', subtitle: '8.5 × 11 in', width: 816, height: 1056 },
  { id: 'a4', label: 'A4', subtitle: '210 × 297 mm', width: 794, height: 1123 },
  { id: 'legal', label: 'Tall (Legal)', subtitle: '8.5 × 14 in', width: 816, height: 1344 },
  { id: 'tabloid', label: 'Large (Poster)', subtitle: '11 × 17 in', width: 1056, height: 1632 },
  { id: 'custom', label: 'Custom Size', subtitle: 'Enter any width and height', width: 816, height: 1056 },
];

export const MIN_CUSTOM_PAGE_DIMENSION = 320;
export const MAX_CUSTOM_PAGE_DIMENSION = 24000;

export function resolvePageDimensions(
  preset: PageSizePresetId,
  orientation: PageOrientation,
  customWidth?: number,
  customHeight?: number,
): { width: number; height: number } {
  if (preset === 'custom') {
    const w = Math.max(
      MIN_CUSTOM_PAGE_DIMENSION,
      Math.min(MAX_CUSTOM_PAGE_DIMENSION, Math.round(customWidth || 816)),
    );
    const h = Math.max(
      MIN_CUSTOM_PAGE_DIMENSION,
      Math.min(MAX_CUSTOM_PAGE_DIMENSION, Math.round(customHeight || 1056)),
    );
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
  { id: 'white', label: 'White', color: '#FFFFFF' },
  { id: 'cream', label: 'Cream', color: '#FDF8EC' },
  { id: 'yellow', label: 'Yellow', color: '#FEF7C3' },
  { id: 'mint', label: 'Light Green', color: '#F0FDF4' },
  { id: 'dark', label: 'Dark', color: '#1E293B' },
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
    name: 'Lined Paper',
    paper: {
      ...DEFAULT_PAPER_CONFIG,
      pattern: 'ruled',
      spacing: 32,
      marginLine: true,
      paperColor: '#FFFFFF',
    },
    variants: [
      {
        id: 'builtin-ruled-letter',
        label: 'White',
        fullName: 'Lined Paper',
        swatchColor: '#FFFFFF',
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
        label: 'Wide Cream',
        fullName: 'Wide Lined (Cream)',
        swatchColor: '#FDF8EC',
        paper: {
          ...DEFAULT_PAPER_CONFIG,
          pattern: 'ruled',
          spacing: 42,
          marginLine: true,
          paperColor: '#FDF8EC',
        },
      },
      {
        id: 'builtin-legal-pad',
        label: 'Yellow',
        fullName: 'Yellow Lined Pad',
        swatchColor: '#FEF7C3',
        paper: {
          ...DEFAULT_PAPER_CONFIG,
          pattern: 'ruled',
          spacing: 32,
          marginLine: true,
          paperColor: '#FEF7C3',
        },
      },
    ],
  },
  {
    id: 'builtin-grid',
    name: 'Graph Paper',
    paper: {
      ...DEFAULT_PAPER_CONFIG,
      pattern: 'grid',
      spacing: 24,
      marginLine: false,
      paperColor: '#FFFFFF',
    },
    variants: [
      {
        id: 'builtin-grid',
        label: 'Light',
        fullName: 'Graph Paper',
        swatchColor: '#FFFFFF',
        paper: {
          ...DEFAULT_PAPER_CONFIG,
          pattern: 'grid',
          spacing: 24,
          marginLine: false,
          paperColor: '#FFFFFF',
        },
      },
      {
        id: 'builtin-dark-grid',
        label: 'Dark',
        fullName: 'Dark Graph Paper',
        swatchColor: '#1E293B',
        paper: {
          ...DEFAULT_PAPER_CONFIG,
          pattern: 'grid',
          spacing: 24,
          marginLine: false,
          paperColor: '#1E293B',
        },
      },
    ],
  },
  {
    id: 'builtin-dotted',
    name: 'Dotted Paper',
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
    name: 'Study Notes (Cornell)',
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
    name: 'Blank Paper',
    paper: {
      ...DEFAULT_PAPER_CONFIG,
      pattern: 'blank',
      spacing: 32,
      marginLine: false,
      paperColor: '#FFFFFF',
    },
    variants: [
      {
        id: 'builtin-blank',
        label: 'Portrait',
        fullName: 'Blank Paper',
        paper: {
          ...DEFAULT_PAPER_CONFIG,
          pattern: 'blank',
          spacing: 32,
          marginLine: false,
          paperColor: '#FFFFFF',
        },
      },
      {
        id: 'builtin-landscape-sketch',
        label: 'Wide',
        fullName: 'Wide Blank Page',
        paper: {
          ...DEFAULT_PAPER_CONFIG,
          sizePreset: 'letter',
          orientation: 'landscape',
          width: 1056,
          height: 816,
          pattern: 'blank',
          spacing: 32,
          marginLine: false,
          paperColor: '#FFFFFF',
        },
      },
    ],
  },
];

export const BUILT_IN_WHITEBOARD_PRESETS: BuiltInPaperPreset[] = [
  {
    id: 'builtin-wb-dotted',
    name: 'Dotted Whiteboard',
    mode: 'whiteboard',
    paper: {
      sizePreset: 'custom',
      orientation: 'landscape',
      width: 1200,
      height: 800,
      pattern: 'dotted',
      spacing: 32,
      marginLine: false,
      paperColor: '#FFFFFF',
    },
    variants: [
      {
        id: 'builtin-wb-dotted',
        label: 'Light',
        fullName: 'Dotted Whiteboard',
        swatchColor: '#FFFFFF',
        paper: {
          sizePreset: 'custom',
          orientation: 'landscape',
          width: 1200,
          height: 800,
          pattern: 'dotted',
          spacing: 32,
          marginLine: false,
          paperColor: '#FFFFFF',
        },
      },
      {
        id: 'builtin-wb-dark-dots',
        label: 'Dark',
        fullName: 'Dark Whiteboard',
        swatchColor: '#1E293B',
        paper: {
          sizePreset: 'custom',
          orientation: 'landscape',
          width: 1200,
          height: 800,
          pattern: 'dotted',
          spacing: 32,
          marginLine: false,
          paperColor: '#1E293B',
        },
      },
    ],
  },
  {
    id: 'builtin-wb-grid',
    name: 'Grid Whiteboard',
    mode: 'whiteboard',
    paper: {
      sizePreset: 'custom',
      orientation: 'landscape',
      width: 1200,
      height: 800,
      pattern: 'grid',
      spacing: 28,
      marginLine: false,
      paperColor: '#FFFFFF',
    },
  },
  {
    id: 'builtin-wb-blank',
    name: 'Blank Whiteboard',
    mode: 'whiteboard',
    paper: {
      sizePreset: 'custom',
      orientation: 'landscape',
      width: 1200,
      height: 800,
      pattern: 'blank',
      spacing: 32,
      marginLine: false,
      paperColor: '#FFFFFF',
    },
  },
];

export interface FlatBuiltInPreset {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  variantLabel?: string;
  mode: NotebookMode;
  paper: PaperConfig;
}

export function flattenBuiltInPresets(presets: BuiltInPaperPreset[]): FlatBuiltInPreset[] {
  return presets.flatMap((preset) => {
    const mode: NotebookMode = preset.mode ?? 'notebook';
    if (!preset.variants || preset.variants.length === 0) {
      return [
        {
          id: preset.id,
          name: preset.name,
          groupId: preset.id,
          groupName: preset.name,
          mode,
          paper: preset.paper,
        },
      ];
    }
    return preset.variants.map((variant) => ({
      id: variant.id,
      name: variant.fullName,
      groupId: preset.id,
      groupName: preset.name,
      variantLabel: variant.label,
      mode,
      paper: variant.paper,
    }));
  });
}

export const ALL_BUILT_IN_PAPER_VARIANTS: FlatBuiltInPreset[] =
  flattenBuiltInPresets(BUILT_IN_PAPER_PRESETS);

export const ALL_BUILT_IN_WHITEBOARD_VARIANTS: FlatBuiltInPreset[] =
  flattenBuiltInPresets(BUILT_IN_WHITEBOARD_PRESETS);
