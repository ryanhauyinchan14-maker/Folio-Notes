import type { BrushPresetId } from '../types/notes';

export interface BrushPresetSpec {
  id: BrushPresetId;
  name: string;
  category: 'Inking' | 'Sketching' | 'Painting' | 'Marker';
  description: string;
  thinning: number;
  smoothing: number;
  streamline: number;
  taperStart: number;
  taperEnd: number;
  opacityMultiplier: number;
  shadowBlurFactor: number;
  grainAlpha: number;
  defaultSize: number;
  blendHint?: GlobalCompositeOperation;
  previewPath: string;
}

export const BRUSH_PRESETS: BrushPresetSpec[] = [
  {
    id: 'technical',
    name: 'Technical Pen',
    category: 'Inking',
    description: 'Crisp everyday studio pen with balanced pressure taper.',
    thinning: 0.52,
    smoothing: 0.5,
    streamline: 0.45,
    taperStart: 4,
    taperEnd: 4,
    opacityMultiplier: 1,
    shadowBlurFactor: 0,
    grainAlpha: 0,
    defaultSize: 3,
    previewPath: 'M 8 24 C 28 8, 52 34, 78 16 C 98 4, 118 28, 144 18',
  },
  {
    id: 'fountain',
    name: 'Fountain Nib',
    category: 'Inking',
    description: 'Expressive calligraphic line weight with long tapered nibs.',
    thinning: 0.76,
    smoothing: 0.58,
    streamline: 0.52,
    taperStart: 12,
    taperEnd: 16,
    opacityMultiplier: 1,
    shadowBlurFactor: 0,
    grainAlpha: 0,
    defaultSize: 4,
    previewPath: 'M 8 22 C 26 6, 54 32, 78 14 C 102 6, 122 30, 144 14',
  },
  {
    id: 'pencil',
    name: 'Graphite Pencil',
    category: 'Sketching',
    description: 'Textured toothy sketch stroke for shading and underdrawing.',
    thinning: 0.35,
    smoothing: 0.35,
    streamline: 0.28,
    taperStart: 4,
    taperEnd: 6,
    opacityMultiplier: 0.84,
    shadowBlurFactor: 0,
    grainAlpha: 0.35,
    defaultSize: 3.5,
    previewPath: 'M 8 20 C 32 10, 56 30, 82 18 C 106 8, 124 24, 144 20',
  },
  {
    id: 'airbrush',
    name: 'Soft Airbrush',
    category: 'Painting',
    description: 'Feathered radial mist for soft gradients and ambient glow.',
    thinning: 0.15,
    smoothing: 0.65,
    streamline: 0.55,
    taperStart: 10,
    taperEnd: 10,
    opacityMultiplier: 0.55,
    shadowBlurFactor: 0.95,
    grainAlpha: 0,
    defaultSize: 12,
    previewPath: 'M 10 20 C 38 12, 66 28, 96 18 C 118 10, 132 22, 144 18',
  },
  {
    id: 'watercolor',
    name: 'Watercolor Wash',
    category: 'Painting',
    description: 'Soft pigment glazing that builds lush translucent washes.',
    thinning: 0.3,
    smoothing: 0.6,
    streamline: 0.5,
    taperStart: 8,
    taperEnd: 8,
    opacityMultiplier: 0.48,
    shadowBlurFactor: 0.38,
    grainAlpha: 0,
    defaultSize: 10,
    blendHint: 'multiply',
    previewPath: 'M 8 20 C 34 8, 60 32, 88 18 C 112 10, 128 28, 144 16',
  },
  {
    id: 'marker',
    name: 'Studio Marker',
    category: 'Marker',
    description: 'Bold illustration felt-tip with smooth uniform ink coverage.',
    thinning: 0.12,
    smoothing: 0.45,
    streamline: 0.48,
    taperStart: 2,
    taperEnd: 2,
    opacityMultiplier: 0.82,
    shadowBlurFactor: 0,
    grainAlpha: 0,
    defaultSize: 8,
    previewPath: 'M 8 20 C 36 10, 62 28, 92 18 C 114 10, 130 24, 144 18',
  },
  {
    id: 'monoline',
    name: 'Monoline',
    category: 'Inking',
    description: 'Clean uniform vector-feel contour line with heavy stabilization.',
    thinning: 0.02,
    smoothing: 0.62,
    streamline: 0.6,
    taperStart: 0,
    taperEnd: 0,
    opacityMultiplier: 1,
    shadowBlurFactor: 0,
    grainAlpha: 0,
    defaultSize: 3.5,
    previewPath: 'M 8 20 C 36 10, 64 30, 92 18 C 116 8, 130 24, 144 18',
  },
  {
    id: 'highlighter',
    name: 'Highlighter',
    category: 'Marker',
    description: 'Translucent flat marker engineered for luminous layering.',
    thinning: 0.04,
    smoothing: 0.45,
    streamline: 0.55,
    taperStart: 0,
    taperEnd: 0,
    opacityMultiplier: 1,
    shadowBlurFactor: 0,
    grainAlpha: 0,
    defaultSize: 18,
    previewPath: 'M 8 20 L 144 20',
  },
];

const BRUSH_MAP = new Map<BrushPresetId, BrushPresetSpec>(
  BRUSH_PRESETS.map((preset) => [preset.id, preset]),
);

export function getBrushPreset(id?: BrushPresetId): BrushPresetSpec {
  return (id && BRUSH_MAP.get(id)) || BRUSH_PRESETS[0];
}
