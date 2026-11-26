export interface HsvColor {
  h: number;
  s: number;
  v: number;
}

export interface ColorPalettePreset {
  id: string;
  name: string;
  colors: string[];
}

export const DEFAULT_COLOR_PALETTES: ColorPalettePreset[] = [
  {
    id: 'folio-studio',
    name: 'Folio Studio',
    colors: ['#072D59', '#FD6E88', '#38BDF8', '#10B981', '#F59E0B', '#A855F7', '#1E293B', '#EF4444'],
  },
  {
    id: 'pastel-gouache',
    name: 'Pastel Gouache',
    colors: ['#FDE68A', '#FCA5A5', '#A7F3D0', '#BFDBFE', '#DDD6FE', '#FBCFE8', '#FED7AA', '#E2E8F0'],
  },
  {
    id: 'midnight-ink',
    name: 'Midnight Ink',
    colors: ['#0F172A', '#1E3A8A', '#7C2D12', '#14532D', '#581C87', '#831843', '#334155', '#000000'],
  },
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function normalizeHex(hex: string): string {
  const cleaned = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return (
      '#' +
      cleaned
        .split('')
        .map((c) => c + c)
        .join('')
        .toUpperCase()
    );
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return '#' + cleaned.toUpperCase();
  }
  return '#072D59';
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const norm = normalizeHex(hex).slice(1);
  return {
    r: Number.parseInt(norm.slice(0, 2), 16),
    g: Number.parseInt(norm.slice(2, 4), 16),
    b: Number.parseInt(norm.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function hsvToHex(h: number, s: number, v: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const vv = clamp(v, 0, 100) / 100;

  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hh < 60) {
    r1 = c;
    g1 = x;
  } else if (hh < 120) {
    r1 = x;
    g1 = c;
  } else if (hh < 180) {
    g1 = c;
    b1 = x;
  } else if (hh < 240) {
    g1 = x;
    b1 = c;
  } else if (hh < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  return rgbToHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255);
}

export function hexToHsv(hex: string): HsvColor {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta > 1e-6) {
    if (max === rn) {
      h = 60 * (((gn - bn) / delta) % 6);
    } else if (max === gn) {
      h = 60 * ((bn - rn) / delta + 2);
    } else {
      h = 60 * ((rn - gn) / delta + 4);
    }
  }
  if (h < 0) h += 360;

  const s = max <= 1e-6 ? 0 : (delta / max) * 100;
  const v = max * 100;

  return {
    h: Math.round(h),
    s: Math.round(s),
    v: Math.round(v),
  };
}

export function getColorHarmonies(hex: string): {
  complementary: string[];
  analogous: string[];
  triadic: string[];
  splitComplementary: string[];
} {
  const { h, s, v } = hexToHsv(hex);
  const normS = Math.max(s, 35);
  const normV = Math.max(v, 40);
  return {
    complementary: [hsvToHex((h + 180) % 360, normS, normV)],
    analogous: [
      hsvToHex((h + 330) % 360, normS, normV),
      hsvToHex((h + 30) % 360, normS, normV),
    ],
    triadic: [
      hsvToHex((h + 120) % 360, normS, normV),
      hsvToHex((h + 240) % 360, normS, normV),
    ],
    splitComplementary: [
      hsvToHex((h + 150) % 360, normS, normV),
      hsvToHex((h + 210) % 360, normS, normV),
    ],
  };
}
