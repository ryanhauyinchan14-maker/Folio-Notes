import type { PaperPattern } from '../types/notes';

const GEMINI_API_KEY_STORAGE_KEY = 'goodnotes_gemini_api_key';
const HANDWRITING_CORRECTION_KEY = 'goodnotes_handwriting_correction';
const WORKSPACE_PREFS_STORAGE_KEY = 'folio_workspace_preferences_v1';

export type DeskBackdropPresetId =
  | 'cool-gray'
  | 'seal-mist'
  | 'dot-mat'
  | 'midnight-navy'
  | 'warm-linen'
  | 'custom';

export type DockPosition = 'bottom' | 'top' | 'left';
export type DefaultZoomMode = 'fit-width' | '100';
export type DefaultToolPreference = 'pan' | 'pen';

export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
export const FAST_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const IMAGE_GEMINI_MODEL = 'gemini-nano-banana-2.1';
export const GEMINI_API_STUDIO_URL = 'https://aistudio.google.com/apikey';

export type GeminiModelPresetId =
  | 'gemini-4-hydrogen'
  | 'gemini-3.5-flash-lite'
  | 'custom';

export interface PenFavoriteSlot {
  id: string;
  name: string;
  tool: 'pen' | 'highlighter';
  color: string;
  size: number;
}

export interface WorkspacePreferences {
  penSlots: PenFavoriteSlot[];
  deskBackdrop: DeskBackdropPresetId;
  deskCustomColor: string;
  darkPaperView: boolean;
  highContrastUi: boolean;
  dockPosition: DockPosition;
  heroHeadline: string;
  defaultZoomMode: DefaultZoomMode;
  defaultTool: DefaultToolPreference;
  defaultPaperPattern: PaperPattern;
  geminiModelPreset: GeminiModelPresetId;
  geminiCustomModelId: string;
  blockAiOnVaultLocked: boolean;
}

export const DEFAULT_HERO_HEADLINE = 'Your Notes, Ready.';

export const DEFAULT_PEN_SLOTS: PenFavoriteSlot[] = [
  {
    id: 'slot-1',
    name: 'Navy 0.4mm Fineliner',
    tool: 'pen',
    color: '#072D59',
    size: 2,
  },
  {
    id: 'slot-2',
    name: 'Coral Pink 0.6mm Pen',
    tool: 'pen',
    color: '#FD6E88',
    size: 4,
  },
  {
    id: 'slot-3',
    name: 'Cobalt 0.8mm Gel',
    tool: 'pen',
    color: '#2563EB',
    size: 6.5,
  },
  {
    id: 'slot-4',
    name: 'Pastel Sun Highlighter',
    tool: 'highlighter',
    color: '#FEF08A',
    size: 22,
  },
  {
    id: 'slot-5',
    name: 'Rose Tint Highlighter',
    tool: 'highlighter',
    color: '#FBCFE8',
    size: 22,
  },
];

export const DESK_BACKDROP_PRESETS: Array<{
  id: Exclude<DeskBackdropPresetId, 'custom'>;
  label: string;
  previewColor: string;
  className?: string;
}> = [
  { id: 'cool-gray', label: 'Cool Studio Gray', previewColor: '#E2E8F0' },
  { id: 'seal-mist', label: 'Seal Blue Mist', previewColor: '#EBF4FA' },
  {
    id: 'dot-mat',
    label: 'Dot-Matrix Desk Mat',
    previewColor: '#E4EDF4',
    className: 'folio-desk-dotmat',
  },
  { id: 'midnight-navy', label: 'Midnight Navy Slate', previewColor: '#0F1D32' },
  { id: 'warm-linen', label: 'Warm Linen', previewColor: '#F4EFE6' },
];

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  penSlots: DEFAULT_PEN_SLOTS.map((s) => ({ ...s })),
  deskBackdrop: 'cool-gray',
  deskCustomColor: '#DCEAF4',
  darkPaperView: false,
  highContrastUi: false,
  dockPosition: 'bottom',
  heroHeadline: DEFAULT_HERO_HEADLINE,
  defaultZoomMode: '100',
  defaultTool: 'pen',
  defaultPaperPattern: 'ruled',
  geminiModelPreset: DEFAULT_GEMINI_MODEL,
  geminiCustomModelId: '',
  blockAiOnVaultLocked: true,
};

const VALID_BACKDROPS = new Set<DeskBackdropPresetId>([
  'cool-gray',
  'seal-mist',
  'dot-mat',
  'midnight-navy',
  'warm-linen',
  'custom',
]);
const VALID_DOCK_POSITIONS = new Set<DockPosition>(['bottom', 'top', 'left']);
const VALID_PATTERNS = new Set<PaperPattern>([
  'blank',
  'ruled',
  'grid',
  'dotted',
  'cornell',
]);
const VALID_GEMINI_PRESETS = new Set<GeminiModelPresetId>([
  'gemini-4-hydrogen',
  'gemini-3.5-flash-lite',
  'custom',
]);

export function resolveActiveGeminiModel(
  prefs: Pick<WorkspacePreferences, 'geminiModelPreset' | 'geminiCustomModelId'>,
): string {
  if (prefs.geminiModelPreset === 'custom') {
    const trimmed = (prefs.geminiCustomModelId ?? '').trim();
    return trimmed || DEFAULT_GEMINI_MODEL;
  }
  return VALID_GEMINI_PRESETS.has(prefs.geminiModelPreset)
    ? prefs.geminiModelPreset
    : DEFAULT_GEMINI_MODEL;
}

export function sanitizeWorkspacePreferences(
  raw: unknown,
): WorkspacePreferences {
  const base: WorkspacePreferences = {
    ...DEFAULT_WORKSPACE_PREFERENCES,
    penSlots: DEFAULT_PEN_SLOTS.map((s) => ({ ...s })),
  };
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Partial<WorkspacePreferences>;

  if (Array.isArray(obj.penSlots) && obj.penSlots.length === 5) {
    base.penSlots = obj.penSlots.map((slot, idx) => {
      const def = DEFAULT_PEN_SLOTS[idx];
      if (!slot || typeof slot !== 'object') return { ...def };
      const tool = slot.tool === 'highlighter' ? 'highlighter' : 'pen';
      const color =
        typeof slot.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(slot.color)
          ? slot.color
          : def.color;
      const size =
        typeof slot.size === 'number' && Number.isFinite(slot.size)
          ? Math.max(1, Math.min(48, slot.size))
          : def.size;
      const name =
        typeof slot.name === 'string' && slot.name.trim() ? slot.name.trim() : def.name;
      return { id: def.id, name, tool, color, size };
    });
  }

  if (obj.deskBackdrop && VALID_BACKDROPS.has(obj.deskBackdrop)) {
    base.deskBackdrop = obj.deskBackdrop;
  }
  if (
    typeof obj.deskCustomColor === 'string' &&
    /^#[0-9a-f]{3,8}$/i.test(obj.deskCustomColor)
  ) {
    base.deskCustomColor = obj.deskCustomColor;
  }
  if (typeof obj.darkPaperView === 'boolean') {
    base.darkPaperView = obj.darkPaperView;
  }
  if (typeof obj.highContrastUi === 'boolean') {
    base.highContrastUi = obj.highContrastUi;
  }
  if (obj.dockPosition && VALID_DOCK_POSITIONS.has(obj.dockPosition)) {
    base.dockPosition = obj.dockPosition;
  }
  if (typeof obj.heroHeadline === 'string' && obj.heroHeadline.trim()) {
    base.heroHeadline = obj.heroHeadline.trim().slice(0, 80);
  }
  if (obj.defaultZoomMode === 'fit-width' || obj.defaultZoomMode === '100') {
    base.defaultZoomMode = obj.defaultZoomMode;
  }
  if (obj.defaultTool === 'pan' || obj.defaultTool === 'pen') {
    base.defaultTool = obj.defaultTool;
  }
  if (obj.defaultPaperPattern && VALID_PATTERNS.has(obj.defaultPaperPattern)) {
    base.defaultPaperPattern = obj.defaultPaperPattern;
  }
  if (obj.geminiModelPreset && VALID_GEMINI_PRESETS.has(obj.geminiModelPreset)) {
    base.geminiModelPreset = obj.geminiModelPreset;
  }
  if (typeof obj.geminiCustomModelId === 'string') {
    base.geminiCustomModelId = obj.geminiCustomModelId.trim().slice(0, 100);
  }
  if (typeof obj.blockAiOnVaultLocked === 'boolean') {
    base.blockAiOnVaultLocked = obj.blockAiOnVaultLocked;
  }

  return base;
}

export function getWorkspacePreferences(): WorkspacePreferences {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY);
    if (!raw) return sanitizeWorkspacePreferences(null);
    return sanitizeWorkspacePreferences(JSON.parse(raw));
  } catch {
    return sanitizeWorkspacePreferences(null);
  }
}

export function saveWorkspacePreferences(prefs: WorkspacePreferences): void {
  try {
    window.localStorage.setItem(
      WORKSPACE_PREFS_STORAGE_KEY,
      JSON.stringify(sanitizeWorkspacePreferences(prefs)),
    );
  } catch {
    // Ignore storage quota / security errors in restricted environments
  }
}

export function getGeminiApiKey(): string {
  try {
    return window.localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveGeminiApiKey(apiKey: string): void {
  try {
    const trimmed = apiKey.trim();
    if (trimmed) {
      window.localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, trimmed);
    } else {
      window.localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota / security errors in restricted environments
  }
}

export function clearGeminiApiKey(): void {
  try {
    window.localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function getHandwritingCorrectionEnabled(): boolean {
  try {
    return window.localStorage.getItem(HANDWRITING_CORRECTION_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveHandwritingCorrectionEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(HANDWRITING_CORRECTION_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage errors
  }
}
