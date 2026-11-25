import { db } from '../db/database';
import type { CustomFontRecord, UploadedInterfaceFontMeta } from '../types/notes';

export const DEFAULT_INTERFACE_FONT_ID = 'folio-default';

export const DEFAULT_FONT_SANS_STACK =
  '"Switzer", -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif';
export const DEFAULT_FONT_DISPLAY_STACK =
  '"Zodiak", Georgia, Cambria, "Times New Roman", serif';
export const DEFAULT_FONT_MONO_STACK =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const FALLBACK_SANS_TAIL =
  '-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif';
const FALLBACK_SERIF_TAIL = 'Georgia, Cambria, "Times New Roman", serif';
const FALLBACK_MONO_TAIL =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

export type InterfaceFontCategory = 'sans' | 'serif' | 'accessible' | 'mono';

export interface InterfaceFontPreset {
  id: string;
  name: string;
  category: InterfaceFontCategory;
  subtitle: string;
  sansStack: string;
  displayStack: string;
  monoStack?: string;
  previewStack: string;
  googleFamilySpec?: string;
  fontshareSlug?: string;
}

export const INTERFACE_FONT_PRESETS: InterfaceFontPreset[] = [
  {
    id: 'folio-default',
    name: 'Folio Default',
    category: 'sans',
    subtitle: 'Switzer + Zodiak editorial',
    sansStack: DEFAULT_FONT_SANS_STACK,
    displayStack: DEFAULT_FONT_DISPLAY_STACK,
    monoStack: DEFAULT_FONT_MONO_STACK,
    previewStack: DEFAULT_FONT_SANS_STACK,
  },
  {
    id: 'inter',
    name: 'Inter',
    category: 'sans',
    subtitle: 'Crisp studio neutral',
    sansStack: `"Inter", ${FALLBACK_SANS_TAIL}`,
    displayStack: `"Inter", ${FALLBACK_SANS_TAIL}`,
    previewStack: `"Inter", ${FALLBACK_SANS_TAIL}`,
    googleFamilySpec: 'Inter:wght@400;500;600;700',
  },
  {
    id: 'satoshi',
    name: 'Satoshi',
    category: 'sans',
    subtitle: 'Modern Swiss geometric',
    sansStack: `"Satoshi", ${FALLBACK_SANS_TAIL}`,
    displayStack: `"Satoshi", ${FALLBACK_SANS_TAIL}`,
    previewStack: `"Satoshi", ${FALLBACK_SANS_TAIL}`,
    fontshareSlug: 'satoshi@400,500,600,700',
  },
  {
    id: 'general-sans',
    name: 'General Sans',
    category: 'sans',
    subtitle: 'Architectural minimalist',
    sansStack: `"General Sans", ${FALLBACK_SANS_TAIL}`,
    displayStack: `"General Sans", ${FALLBACK_SANS_TAIL}`,
    previewStack: `"General Sans", ${FALLBACK_SANS_TAIL}`,
    fontshareSlug: 'general-sans@400,500,600,700',
  },
  {
    id: 'plus-jakarta-sans',
    name: 'Plus Jakarta Sans',
    category: 'sans',
    subtitle: 'Warm geometric modern',
    sansStack: `"Plus Jakarta Sans", ${FALLBACK_SANS_TAIL}`,
    displayStack: `"Plus Jakarta Sans", ${FALLBACK_SANS_TAIL}`,
    previewStack: `"Plus Jakarta Sans", ${FALLBACK_SANS_TAIL}`,
    googleFamilySpec: 'Plus+Jakarta+Sans:wght@400;500;600;700',
  },
  {
    id: 'dm-sans',
    name: 'DM Sans',
    category: 'sans',
    subtitle: 'Low contrast clean UI',
    sansStack: `"DM Sans", ${FALLBACK_SANS_TAIL}`,
    displayStack: `"DM Sans", ${FALLBACK_SANS_TAIL}`,
    previewStack: `"DM Sans", ${FALLBACK_SANS_TAIL}`,
    googleFamilySpec: 'DM+Sans:wght@400;500;600;700',
  },
  {
    id: 'manrope',
    name: 'Manrope',
    category: 'sans',
    subtitle: 'Refined modern grotesque',
    sansStack: `"Manrope", ${FALLBACK_SANS_TAIL}`,
    displayStack: `"Manrope", ${FALLBACK_SANS_TAIL}`,
    previewStack: `"Manrope", ${FALLBACK_SANS_TAIL}`,
    googleFamilySpec: 'Manrope:wght@400;500;600;700',
  },
  {
    id: 'outfit',
    name: 'Outfit',
    category: 'sans',
    subtitle: 'Sleek rounded geometric',
    sansStack: `"Outfit", ${FALLBACK_SANS_TAIL}`,
    displayStack: `"Outfit", ${FALLBACK_SANS_TAIL}`,
    previewStack: `"Outfit", ${FALLBACK_SANS_TAIL}`,
    googleFamilySpec: 'Outfit:wght@400;500;600;700',
  },
  {
    id: 'bricolage-grotesque',
    name: 'Bricolage Grotesque',
    category: 'sans',
    subtitle: 'Expressive editorial sans',
    sansStack: `"Bricolage Grotesque", ${FALLBACK_SANS_TAIL}`,
    displayStack: `"Bricolage Grotesque", ${FALLBACK_SANS_TAIL}`,
    previewStack: `"Bricolage Grotesque", ${FALLBACK_SANS_TAIL}`,
    googleFamilySpec: 'Bricolage+Grotesque:wght@400;500;600;700',
  },
  {
    id: 'space-grotesk',
    name: 'Space Grotesk',
    category: 'sans',
    subtitle: 'Sharp technical grotesque',
    sansStack: `"Space Grotesk", ${FALLBACK_SANS_TAIL}`,
    displayStack: `"Space Grotesk", ${FALLBACK_SANS_TAIL}`,
    previewStack: `"Space Grotesk", ${FALLBACK_SANS_TAIL}`,
    googleFamilySpec: 'Space+Grotesk:wght@400;500;600;700',
  },
  {
    id: 'nunito',
    name: 'Nunito',
    category: 'sans',
    subtitle: 'Soft friendly rounded',
    sansStack: `"Nunito", ${FALLBACK_SANS_TAIL}`,
    displayStack: `"Nunito", ${FALLBACK_SANS_TAIL}`,
    previewStack: `"Nunito", ${FALLBACK_SANS_TAIL}`,
    googleFamilySpec: 'Nunito:wght@400;500;600;700',
  },
  {
    id: 'system-ui',
    name: 'System UI',
    category: 'sans',
    subtitle: 'Native desktop look',
    sansStack: `system-ui, ${FALLBACK_SANS_TAIL}`,
    displayStack: `system-ui, ${FALLBACK_SANS_TAIL}`,
    previewStack: `system-ui, ${FALLBACK_SANS_TAIL}`,
  },
  {
    id: 'newsreader',
    name: 'Newsreader',
    category: 'serif',
    subtitle: 'Refined literary serif',
    sansStack: `"Newsreader", ${FALLBACK_SERIF_TAIL}`,
    displayStack: `"Newsreader", ${FALLBACK_SERIF_TAIL}`,
    previewStack: `"Newsreader", ${FALLBACK_SERIF_TAIL}`,
    googleFamilySpec: 'Newsreader:wght@400;500;600;700',
  },
  {
    id: 'lora',
    name: 'Lora',
    category: 'serif',
    subtitle: 'Soft brushed journal',
    sansStack: `"Lora", ${FALLBACK_SERIF_TAIL}`,
    displayStack: `"Lora", ${FALLBACK_SERIF_TAIL}`,
    previewStack: `"Lora", ${FALLBACK_SERIF_TAIL}`,
    googleFamilySpec: 'Lora:wght@400;500;600;700',
  },
  {
    id: 'fraunces',
    name: 'Fraunces',
    category: 'serif',
    subtitle: 'Warm expressive serif',
    sansStack: `"Fraunces", ${FALLBACK_SERIF_TAIL}`,
    displayStack: `"Fraunces", ${FALLBACK_SERIF_TAIL}`,
    previewStack: `"Fraunces", ${FALLBACK_SERIF_TAIL}`,
    googleFamilySpec: 'Fraunces:wght@400;500;600;700',
  },
  {
    id: 'source-serif-4',
    name: 'Source Serif 4',
    category: 'serif',
    subtitle: 'Clean academic reading',
    sansStack: `"Source Serif 4", ${FALLBACK_SERIF_TAIL}`,
    displayStack: `"Source Serif 4", ${FALLBACK_SERIF_TAIL}`,
    previewStack: `"Source Serif 4", ${FALLBACK_SERIF_TAIL}`,
    googleFamilySpec: 'Source+Serif+4:wght@400;500;600;700',
  },
  {
    id: 'atkinson-hyperlegible',
    name: 'Atkinson Hyperlegible',
    category: 'accessible',
    subtitle: 'High clarity distinct glyphs',
    sansStack: `"Atkinson Hyperlegible", ${FALLBACK_SANS_TAIL}`,
    displayStack: `"Atkinson Hyperlegible", ${FALLBACK_SANS_TAIL}`,
    previewStack: `"Atkinson Hyperlegible", ${FALLBACK_SANS_TAIL}`,
    googleFamilySpec: 'Atkinson+Hyperlegible:wght@400;700',
  },
  {
    id: 'lexend',
    name: 'Lexend',
    category: 'accessible',
    subtitle: 'Calm wide reading rhythm',
    sansStack: `"Lexend", ${FALLBACK_SANS_TAIL}`,
    displayStack: `"Lexend", ${FALLBACK_SANS_TAIL}`,
    previewStack: `"Lexend", ${FALLBACK_SANS_TAIL}`,
    googleFamilySpec: 'Lexend:wght@400;500;600;700',
  },
  {
    id: 'jetbrains-mono',
    name: 'JetBrains Mono',
    category: 'mono',
    subtitle: 'Studio developer monospace',
    sansStack: `"JetBrains Mono", ${FALLBACK_MONO_TAIL}`,
    displayStack: `"JetBrains Mono", ${FALLBACK_MONO_TAIL}`,
    monoStack: `"JetBrains Mono", ${FALLBACK_MONO_TAIL}`,
    previewStack: `"JetBrains Mono", ${FALLBACK_MONO_TAIL}`,
  },
  {
    id: 'ibm-plex-mono',
    name: 'IBM Plex Mono',
    category: 'mono',
    subtitle: 'Precision technical mono',
    sansStack: `"IBM Plex Mono", ${FALLBACK_MONO_TAIL}`,
    displayStack: `"IBM Plex Mono", ${FALLBACK_MONO_TAIL}`,
    monoStack: `"IBM Plex Mono", ${FALLBACK_MONO_TAIL}`,
    previewStack: `"IBM Plex Mono", ${FALLBACK_MONO_TAIL}`,
    googleFamilySpec: 'IBM+Plex+Mono:wght@400;500;600;700',
  },
  {
    id: 'kalam',
    name: 'Kalam',
    category: 'mono',
    subtitle: 'Neat notebook handwriting',
    sansStack: `"Kalam", cursive, ${FALLBACK_SANS_TAIL}`,
    displayStack: `"Kalam", cursive, ${FALLBACK_SANS_TAIL}`,
    previewStack: `"Kalam", cursive, ${FALLBACK_SANS_TAIL}`,
  },
  {
    id: 'caveat',
    name: 'Caveat',
    category: 'mono',
    subtitle: 'Casual pen script',
    sansStack: `"Caveat", cursive, ${FALLBACK_SANS_TAIL}`,
    displayStack: `"Caveat", cursive, ${FALLBACK_SANS_TAIL}`,
    previewStack: `"Caveat", cursive, ${FALLBACK_SANS_TAIL}`,
  },
];

export const INTERFACE_FONT_PRESET_MAP = new Map<string, InterfaceFontPreset>(
  INTERFACE_FONT_PRESETS.map((p) => [p.id, p]),
);

const MAX_FONT_FILE_BYTES = 8 * 1024 * 1024;
const FONT_EXT_REGEX = /\.(?:ttf|otf|woff|woff2)$/i;

const loadedGoogleCustomFonts = new Map<string, 'google'>();
const failedGoogleCustomFonts = new Set<string>();
const registeredUploadedFaces = new Map<string, string>();
let curatedPreviewInjected = false;

export function sanitizeCustomFontName(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/["'`{};\\<>()\r\n\t]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function isValidInterfaceFontId(id: string): boolean {
  if (typeof id !== 'string') return false;
  if (id === 'custom') return true;
  if (INTERFACE_FONT_PRESET_MAP.has(id)) return true;
  return /^uploaded:[a-zA-Z0-9_-]{1,64}$/.test(id);
}

export function isSupportedFontFile(
  file: Pick<File, 'name' | 'size'>,
): { ok: boolean; error?: string } {
  if (!FONT_EXT_REGEX.test(file.name)) {
    return {
      ok: false,
      error: 'Unsupported font format. Please choose a .ttf, .otf, .woff, or .woff2 file.',
    };
  }
  if (file.size <= 0) {
    return { ok: false, error: 'Selected font file is empty.' };
  }
  if (file.size > MAX_FONT_FILE_BYTES) {
    return { ok: false, error: 'Font file exceeds the 8 MB limit.' };
  }
  return { ok: true };
}

export function deriveFontDisplayNameFromFile(fileName: string): string {
  const base = fileName.replace(FONT_EXT_REGEX, '');
  const spaced = base
    .replace(/[_-]+/g, ' ')
    .replace(/\b(?:Regular|VariableFont|opsz|wght)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const clean = sanitizeCustomFontName(spaced);
  return clean || 'Imported Font';
}

function appendStylesheetOnce(key: string, href: string): void {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.head.querySelector(`link[data-folio-font-sheet="${key}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-folio-font-sheet', key);
  document.head.appendChild(link);
}

/**
 * Loads batched Google Fonts & Fontshare preview stylesheets only when the user opens
 * Preferences -> Appearance so startup makes zero extra network requests by default.
 */
export function ensureCuratedPreviewFontsLoaded(): void {
  if (typeof document === 'undefined' || !document.head) return;
  if (curatedPreviewInjected) return;
  curatedPreviewInjected = true;

  const googleSpecs = INTERFACE_FONT_PRESETS.map((p) => p.googleFamilySpec).filter(
    (spec): spec is string => Boolean(spec),
  );
  if (googleSpecs.length > 0) {
    const query = googleSpecs.map((s) => `family=${s}`).join('&');
    appendStylesheetOnce(
      'curated-google',
      `https://fonts.googleapis.com/css2?${query}&display=swap`,
    );
  }

  const fontshareSlugs = INTERFACE_FONT_PRESETS.map((p) => p.fontshareSlug).filter(
    (slug): slug is string => Boolean(slug),
  );
  if (fontshareSlugs.length > 0) {
    const query = fontshareSlugs.map((s) => `f[]=${s}`).join('&');
    appendStylesheetOnce(
      'curated-fontshare',
      `https://api.fontshare.com/v2/css?${query}&display=swap`,
    );
  }
}

export function ensurePresetStylesheetLoaded(preset: InterfaceFontPreset): void {
  if (typeof document === 'undefined' || !document.head) return;
  if (curatedPreviewInjected) return;
  if (preset.googleFamilySpec) {
    appendStylesheetOnce(
      `preset-${preset.id}`,
      `https://fonts.googleapis.com/css2?family=${preset.googleFamilySpec}&display=swap`,
    );
  } else if (preset.fontshareSlug) {
    appendStylesheetOnce(
      `preset-${preset.id}`,
      `https://api.fontshare.com/v2/css?f[]=${preset.fontshareSlug}&display=swap`,
    );
  }
}

export async function ensureCustomGoogleFontLoaded(
  rawFamilyName: string,
): Promise<'google' | 'local'> {
  const familyName = sanitizeCustomFontName(rawFamilyName);
  if (!familyName) return 'local';

  const key = familyName.toLowerCase();
  if (loadedGoogleCustomFonts.has(key)) return 'google';
  if (failedGoogleCustomFonts.has(key)) return 'local';
  if (typeof fetch !== 'function' || typeof document === 'undefined' || !document.head) {
    return 'local';
  }

  const encodedPlus = encodeURIComponent(familyName).replace(/%20/g, '+');
  const urls = [
    `https://fonts.googleapis.com/css2?family=${encodedPlus}:wght@400;500;600;700&display=swap`,
    `https://fonts.googleapis.com/css2?family=${encodedPlus}&display=swap`,
  ];

  for (const url of urls) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const css = await resp.text();
      if (!css || !css.includes('@font-face')) continue;

      const existing = document.head.querySelector(`style[data-folio-custom-google-font="${key}"]`);
      if (!existing) {
        const styleEl = document.createElement('style');
        styleEl.setAttribute('data-folio-custom-google-font', key);
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
      }
      loadedGoogleCustomFonts.set(key, 'google');
      return 'google';
    } catch {
      // Offline or blocked network: fall back cleanly to local OS/installed font without noisy logs
      failedGoogleCustomFonts.add(key);
      return 'local';
    }
  }

  failedGoogleCustomFonts.add(key);
  return 'local';
}

export async function registerUploadedFontFace(
  record: Pick<CustomFontRecord, 'id' | 'data'>,
): Promise<string> {
  const safeId = record.id.replace(/[^a-zA-Z0-9_-]/g, '') || 'custom';
  const cssFamily = `FolioUploaded_${safeId}`;

  if (registeredUploadedFaces.has(cssFamily)) {
    return cssFamily;
  }

  if (typeof FontFace !== 'undefined' && typeof document !== 'undefined' && document.fonts) {
    try {
      const face = new FontFace(cssFamily, record.data.slice(0));
      const loaded = await face.load();
      document.fonts.add(loaded);
      registeredUploadedFaces.set(cssFamily, cssFamily);
    } catch {
      // Keep fallback stack safely if FontFace fails in synthetic environments
    }
  }

  return cssFamily;
}

function setRootFontVars(
  sans: string,
  display: string,
  mono: string,
  fontId: string,
  fontName: string,
): void {
  if (typeof document === 'undefined') return;
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--font-sans', sans);
  rootStyle.setProperty('--font-display', display);
  rootStyle.setProperty('--font-mono', mono);
  document.documentElement.dataset.interfaceFont = fontId;
  document.documentElement.dataset.interfaceFontName = fontName;
}

export async function applyInterfaceFontToRuntime(
  fontId: string,
  customFontName = '',
  opts?: { skipGoogleLookup?: boolean; uploadedRecord?: CustomFontRecord | null },
): Promise<{
  source: 'default' | 'preset' | 'google' | 'local' | 'uploaded';
  label: string;
}> {
  if (fontId.startsWith('uploaded:')) {
    const uploadedId = fontId.slice('uploaded:'.length);
    let record: CustomFontRecord | null | undefined = opts?.uploadedRecord;
    if (!record && uploadedId) {
      try {
        record = await db.customFonts.get(uploadedId);
      } catch {
        record = null;
      }
    }
    if (record) {
      const cssFamily = await registerUploadedFontFace(record);
      const stack = `"${cssFamily}", "${sanitizeCustomFontName(record.name)}", ${FALLBACK_SANS_TAIL}`;
      setRootFontVars(stack, stack, DEFAULT_FONT_MONO_STACK, fontId, record.name);
      return { source: 'uploaded', label: record.name };
    }
  }

  if (fontId === 'custom') {
    const cleanName = sanitizeCustomFontName(customFontName);
    if (cleanName) {
      const stack = `"${cleanName}", ${FALLBACK_SANS_TAIL}`;
      setRootFontVars(stack, stack, DEFAULT_FONT_MONO_STACK, 'custom', cleanName);
      if (opts?.skipGoogleLookup) {
        return { source: 'local', label: cleanName };
      }
      const source = await ensureCustomGoogleFontLoaded(cleanName);
      return { source, label: cleanName };
    }
  }

  const preset = INTERFACE_FONT_PRESET_MAP.get(fontId);
  if (preset && preset.id !== DEFAULT_INTERFACE_FONT_ID) {
    ensurePresetStylesheetLoaded(preset);
    setRootFontVars(
      preset.sansStack,
      preset.displayStack,
      preset.monoStack ?? DEFAULT_FONT_MONO_STACK,
      preset.id,
      preset.name,
    );
    return { source: 'preset', label: preset.name };
  }

  // Default Folio styling (Switzer + Zodiak + JetBrains Mono)
  if (typeof document !== 'undefined') {
    const rootStyle = document.documentElement.style;
    rootStyle.removeProperty('--font-sans');
    rootStyle.removeProperty('--font-display');
    rootStyle.removeProperty('--font-mono');
    document.documentElement.dataset.interfaceFont = DEFAULT_INTERFACE_FONT_ID;
    document.documentElement.dataset.interfaceFontName = 'Folio Default';
  }
  return { source: 'default', label: 'Folio Default' };
}

export function getActiveInterfaceFontLabel(
  fontId: string,
  customFontName: string,
  uploadedFonts: UploadedInterfaceFontMeta[],
): string {
  if (fontId.startsWith('uploaded:')) {
    const uploadedId = fontId.slice('uploaded:'.length);
    const match = uploadedFonts.find((f) => f.id === uploadedId);
    if (match) return match.name;
    const clean = sanitizeCustomFontName(customFontName);
    return clean || 'Imported Font';
  }
  if (fontId === 'custom') {
    return sanitizeCustomFontName(customFontName) || 'Folio Default';
  }
  return INTERFACE_FONT_PRESET_MAP.get(fontId)?.name ?? 'Folio Default';
}
