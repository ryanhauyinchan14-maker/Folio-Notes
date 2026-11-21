import type { CoverPreset } from '../types/notes';

export const COVER_PRESETS: CoverPreset[] = [
  {
    id: 'classic-navy',
    name: 'Classic Navy',
    cover: {
      styleId: 'classic-navy',
      primaryColor: '#1E3A5F',
      accentColor: '#60A5FA',
      pattern: 'spine-band',
    },
  },
  {
    id: 'sage-linen',
    name: 'Sage Linen',
    cover: {
      styleId: 'sage-linen',
      primaryColor: '#3F6251',
      accentColor: '#A7F3D0',
      pattern: 'dots',
    },
  },
  {
    id: 'terracotta',
    name: 'Terracotta',
    cover: {
      styleId: 'terracotta',
      primaryColor: '#B4533C',
      accentColor: '#FED7AA',
      pattern: 'spine-band',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight Ink',
    cover: {
      styleId: 'midnight',
      primaryColor: '#18181B',
      accentColor: '#A1A1AA',
      pattern: 'solid',
    },
  },
  {
    id: 'kraft',
    name: 'Kraft Paper',
    cover: {
      styleId: 'kraft',
      primaryColor: '#B68D5E',
      accentColor: '#451A03',
      pattern: 'grid',
    },
  },
  {
    id: 'lavender-grid',
    name: 'Lavender Grid',
    cover: {
      styleId: 'lavender-grid',
      primaryColor: '#5B4B8A',
      accentColor: '#DDD6FE',
      pattern: 'grid',
    },
  },
  {
    id: 'sunrise-gradient',
    name: 'Sunrise Coral',
    cover: {
      styleId: 'sunrise-gradient',
      primaryColor: '#E11D48',
      accentColor: '#F59E0B',
      pattern: 'gradient',
    },
  },
  {
    id: 'emerald',
    name: 'Deep Emerald',
    cover: {
      styleId: 'emerald',
      primaryColor: '#065F46',
      accentColor: '#34D399',
      pattern: 'dots',
    },
  },
];

export const FOLDER_COLORS = [
  '#3B82F6', // Sky/Blue
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#F43F5E', // Rose
  '#8B5CF6', // Violet
  '#64748B', // Slate
];

export const PEN_DEFAULT_SWATCHES = [
  '#072D59', // Ink Navy
  '#1E293B', // Graphite
  '#E11D48', // Crimson
  '#FD6E88', // Coral Pink
  '#2563EB', // Cobalt
  '#0D9488', // Teal
  '#15803D', // Forest
  '#D97706', // Warm Ochre
  '#7C3AED', // Plum
];

export const PEN_SWATCH_NAMES: Record<string, string> = {
  '#072D59': 'Ink Navy',
  '#1E293B': 'Graphite',
  '#E11D48': 'Crimson',
  '#FD6E88': 'Coral Pink',
  '#2563EB': 'Cobalt',
  '#0D9488': 'Teal',
  '#15803D': 'Forest',
  '#D97706': 'Warm Ochre',
  '#7C3AED': 'Plum',
};

export const HIGHLIGHTER_DEFAULT_SWATCHES = [
  '#FEF08A', // Pastel Sun
  '#A7F3D0', // Mint Glow
  '#BAE6FD', // Sky Wash
  '#FBCFE8', // Rose Tint
  '#FED7AA', // Apricot
  '#DDD6FE', // Lavender
];

export const HIGHLIGHTER_SWATCH_NAMES: Record<string, string> = {
  '#FEF08A': 'Pastel Sun',
  '#A7F3D0': 'Mint Glow',
  '#BAE6FD': 'Sky Wash',
  '#FBCFE8': 'Rose Tint',
  '#FED7AA': 'Apricot',
  '#DDD6FE': 'Lavender',
};

export const PEN_THICKNESS_PRESETS = [2, 4.5, 8];
export const HIGHLIGHTER_THICKNESS_PRESETS = [14, 22, 34];
