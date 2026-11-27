import type {
  BrushPresetId,
  NotePageStyle,
  PaperPattern,
  SlideSizePresetId,
} from '../types/notes';
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  type KeyboardShortcutsMap,
  sanitizeKeyboardShortcuts,
} from './shortcuts';
import { clampUiScale, DEFAULT_UI_SCALE } from './uiZoom';
import {
  DEFAULT_INTERFACE_FONT_ID,
  isValidInterfaceFontId,
  sanitizeCustomFontName,
} from './uiFonts';

const GEMINI_API_KEY_STORAGE_KEY = 'goodnotes_gemini_api_key';
const AI_PROVIDER_KEYS_STORAGE_KEY = 'folio_ai_provider_keys_v1';
const HANDWRITING_CORRECTION_KEY = 'goodnotes_handwriting_correction';
const WORKSPACE_PREFS_STORAGE_KEY = 'folio_workspace_preferences_v1';
export const CTRL_SCROLL_SMART_MIGRATED_KEY = 'folio_ctrl_scroll_smart_migrated_v12';
export const UI_SCALE_DEFAULT_135_MIGRATED_KEY = 'folio_ui_scale_default_135_migrated_v132';

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
export type CtrlScrollBehavior = 'smart' | 'gui-scale' | 'paper-zoom';
export type EraserMode = 'precision' | 'stroke';
export type AiProviderId = 'gemini' | 'grok' | 'openai' | 'anthropic' | 'custom';

export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash';
export const FAST_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const IMAGE_GEMINI_MODEL = 'gemini-nano-banana-2.1';
export const GEMINI_API_STUDIO_URL = 'https://aistudio.google.com/apikey';

export type GeminiModelPresetId =
  | 'gemini-3-flash'
  | 'gemini-3.5-flash-lite'
  | 'gemini-4-hydrogen'
  | 'custom';

export interface AiProviderMeta {
  id: AiProviderId;
  label: string;
  shortLabel: string;
  defaultModel: string;
  defaultBaseUrl?: string;
  modelPresets?: string[];
  keyPlaceholder: string;
  keyConsoleUrl: string;
  keyConsoleLabel: string;
  requiresApiKey: boolean;
}

export const AI_PROVIDER_ORDER: AiProviderId[] = [
  'gemini',
  'grok',
  'openai',
  'anthropic',
  'custom',
];

export const AI_PROVIDER_META: Record<AiProviderId, AiProviderMeta> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    shortLabel: 'Gemini',
    defaultModel: 'gemini-3-flash',
    modelPresets: ['gemini-3-flash', 'gemini-3.5-flash-lite'],
    keyPlaceholder: 'Paste your AIza... Google AI Studio key',
    keyConsoleUrl: GEMINI_API_STUDIO_URL,
    keyConsoleLabel: 'Google AI Studio',
    requiresApiKey: true,
  },
  grok: {
    id: 'grok',
    label: 'xAI (Grok)',
    shortLabel: 'Grok',
    defaultModel: 'grok-4.7',
    defaultBaseUrl: 'https://api.x.ai/v1',
    modelPresets: ['grok-4.7'],
    keyPlaceholder: 'Paste your xai-... API key',
    keyConsoleUrl: 'https://console.x.ai/',
    keyConsoleLabel: 'xAI Console',
    requiresApiKey: true,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    defaultModel: 'gpt-5',
    defaultBaseUrl: 'https://api.openai.com/v1',
    modelPresets: ['gpt-5', 'gpt-4o'],
    keyPlaceholder: 'Paste your sk-... OpenAI key',
    keyConsoleUrl: 'https://platform.openai.com/api-keys',
    keyConsoleLabel: 'OpenAI API Keys',
    requiresApiKey: true,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    shortLabel: 'Claude',
    defaultModel: 'claude-sonnet-5-5',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    modelPresets: ['claude-sonnet-5-5'],
    keyPlaceholder: 'Paste your sk-ant-... Claude key',
    keyConsoleUrl: 'https://console.anthropic.com/settings/keys',
    keyConsoleLabel: 'Anthropic Console',
    requiresApiKey: true,
  },
  custom: {
    id: 'custom',
    label: 'OpenRouter / Custom',
    shortLabel: 'Custom',
    defaultModel: 'openai/gpt-4o-mini',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyPlaceholder: 'sk-or-... (optional for localhost Ollama/LM Studio)',
    keyConsoleUrl: 'https://openrouter.ai/keys',
    keyConsoleLabel: 'OpenRouter Keys',
    requiresApiKey: false,
  },
};

export const DEFAULT_AI_PROVIDER_MODELS: Record<AiProviderId, string> = {
  gemini: AI_PROVIDER_META.gemini.defaultModel,
  grok: AI_PROVIDER_META.grok.defaultModel,
  openai: AI_PROVIDER_META.openai.defaultModel,
  anthropic: AI_PROVIDER_META.anthropic.defaultModel,
  custom: AI_PROVIDER_META.custom.defaultModel,
};

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
  uiSoundsEnabled: boolean;
  dockPosition: DockPosition;
  heroHeadline: string;
  interfaceFontId: string;
  interfaceCustomFont: string;
  defaultZoomMode: DefaultZoomMode;
  defaultTool: DefaultToolPreference;
  defaultPaperPattern: PaperPattern;
  defaultBrushId: BrushPresetId;
  defaultNotePageStyle: NotePageStyle;
  defaultSlideSizePreset: Exclude<SlideSizePresetId, 'custom'>;
  uiScale: number;
  ctrlScrollBehavior: CtrlScrollBehavior;
  eraserMode: EraserMode;
  activeAiProvider: AiProviderId;
  aiProviderModels: Record<AiProviderId, string>;
  aiCustomBaseUrl: string;
  geminiModelPreset: GeminiModelPresetId;
  geminiCustomModelId: string;
  blockAiOnVaultLocked: boolean;
  keyboardShortcuts: KeyboardShortcutsMap;
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

export function resolveDeskBackdropProps(
  deskBackdrop: DeskBackdropPresetId,
  deskCustomColor: string,
): { className: string; style?: { backgroundColor: string } } {
  if (deskBackdrop === 'dot-mat') {
    return { className: 'folio-desk-dotmat' };
  }
  const colorMap: Record<Exclude<DeskBackdropPresetId, 'dot-mat' | 'custom'>, string> = {
    'cool-gray': '#E2E8F0',
    'seal-mist': '#EBF4FA',
    'midnight-navy': '#0F1D32',
    'warm-linen': '#F4EFE6',
  };
  return {
    className: '',
    style: {
      backgroundColor:
        deskBackdrop === 'custom' ? deskCustomColor : colorMap[deskBackdrop] ?? '#E2E8F0',
    },
  };
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  penSlots: DEFAULT_PEN_SLOTS.map((s) => ({ ...s })),
  deskBackdrop: 'cool-gray',
  deskCustomColor: '#DCEAF4',
  darkPaperView: false,
  highContrastUi: false,
  uiSoundsEnabled: false,
  dockPosition: 'bottom',
  heroHeadline: DEFAULT_HERO_HEADLINE,
  interfaceFontId: DEFAULT_INTERFACE_FONT_ID,
  interfaceCustomFont: '',
  defaultZoomMode: '100',
  defaultTool: 'pen',
  defaultPaperPattern: 'ruled',
  defaultBrushId: 'technical',
  defaultNotePageStyle: 'paginated',
  defaultSlideSizePreset: '16:9',
  uiScale: DEFAULT_UI_SCALE,
  ctrlScrollBehavior: 'smart',
  eraserMode: 'precision',
  activeAiProvider: 'gemini',
  aiProviderModels: { ...DEFAULT_AI_PROVIDER_MODELS },
  aiCustomBaseUrl: AI_PROVIDER_META.custom.defaultBaseUrl!,
  geminiModelPreset: DEFAULT_GEMINI_MODEL,
  geminiCustomModelId: '',
  blockAiOnVaultLocked: true,
  keyboardShortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS },
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
const VALID_BRUSH_IDS = new Set<BrushPresetId>([
  'technical',
  'fountain',
  'pencil',
  'airbrush',
  'watercolor',
  'marker',
  'monoline',
]);
const VALID_SLIDE_SIZE_PRESETS = new Set<Exclude<SlideSizePresetId, 'custom'>>([
  '16:9',
  '4:3',
  '1:1',
  '9:16',
  'a4-landscape',
]);
const VALID_GEMINI_PRESETS = new Set<GeminiModelPresetId>([
  'gemini-3-flash',
  'gemini-3.5-flash-lite',
  'gemini-4-hydrogen',
  'custom',
]);
const VALID_AI_PROVIDERS = new Set<AiProviderId>(AI_PROVIDER_ORDER);

export function resolveActiveGeminiModel(
  prefs: Pick<WorkspacePreferences, 'geminiModelPreset' | 'geminiCustomModelId'>,
): string {
  if (prefs.geminiModelPreset === 'custom') {
    const trimmed = (prefs.geminiCustomModelId ?? '').trim();
    return trimmed || DEFAULT_GEMINI_MODEL;
  }
  if (prefs.geminiModelPreset === 'gemini-4-hydrogen') {
    return DEFAULT_GEMINI_MODEL;
  }
  return VALID_GEMINI_PRESETS.has(prefs.geminiModelPreset)
    ? prefs.geminiModelPreset
    : DEFAULT_GEMINI_MODEL;
}

export function isLocalhostUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1' ||
      parsed.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

export function isProviderConfigured(
  provider: AiProviderId,
  config: { apiKey: string; model: string; baseUrl?: string },
): boolean {
  const keyOk = config.apiKey.trim().length > 0;
  if (provider === 'custom') {
    const hasUrl = Boolean(config.baseUrl?.trim());
    const hasModel = config.model.trim().length > 0;
    return hasUrl && hasModel && (keyOk || isLocalhostUrl(config.baseUrl ?? ''));
  }
  return keyOk;
}

export interface ResolvedAiConfig {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
  label: string;
  shortLabel: string;
  configured: boolean;
}

export function resolveActiveAiConfig(state: {
  activeAiProvider: AiProviderId;
  aiProviderKeys: Record<AiProviderId, string>;
  aiProviderModels: Record<AiProviderId, string>;
  aiCustomBaseUrl: string;
  geminiApiKey?: string;
  geminiModelPreset?: GeminiModelPresetId;
  geminiCustomModelId?: string;
}): ResolvedAiConfig {
  const provider = VALID_AI_PROVIDERS.has(state.activeAiProvider)
    ? state.activeAiProvider
    : 'gemini';
  const meta = AI_PROVIDER_META[provider];

  const apiKey =
    provider === 'gemini'
      ? (state.aiProviderKeys.gemini || state.geminiApiKey || '').trim()
      : (state.aiProviderKeys[provider] || '').trim();

  let model = (state.aiProviderModels[provider] || '').trim();
  if (provider === 'gemini' && state.geminiModelPreset) {
    model =
      model ||
      resolveActiveGeminiModel({
        geminiModelPreset: state.geminiModelPreset,
        geminiCustomModelId: state.geminiCustomModelId ?? '',
      });
  }
  if (!model) {
    model = meta.defaultModel;
  }

  const baseUrl =
    provider === 'custom'
      ? (state.aiCustomBaseUrl || meta.defaultBaseUrl || '').trim()
      : meta.defaultBaseUrl;

  return {
    provider,
    apiKey,
    model,
    baseUrl,
    label: meta.label,
    shortLabel: meta.shortLabel,
    configured: isProviderConfigured(provider, { apiKey, model, baseUrl }),
  };
}

export function sanitizeWorkspacePreferences(raw: unknown): WorkspacePreferences {
  const base: WorkspacePreferences = {
    ...DEFAULT_WORKSPACE_PREFERENCES,
    penSlots: DEFAULT_PEN_SLOTS.map((s) => ({ ...s })),
    aiProviderModels: { ...DEFAULT_AI_PROVIDER_MODELS },
    keyboardShortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS },
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
  if (typeof obj.uiSoundsEnabled === 'boolean') {
    base.uiSoundsEnabled = obj.uiSoundsEnabled;
  }
  if (obj.dockPosition && VALID_DOCK_POSITIONS.has(obj.dockPosition)) {
    base.dockPosition = obj.dockPosition;
  }
  if (typeof obj.heroHeadline === 'string' && obj.heroHeadline.trim()) {
    base.heroHeadline = obj.heroHeadline.trim().slice(0, 80);
  }
  if (typeof obj.interfaceCustomFont === 'string') {
    base.interfaceCustomFont = sanitizeCustomFontName(obj.interfaceCustomFont);
  }
  if (typeof obj.interfaceFontId === 'string' && isValidInterfaceFontId(obj.interfaceFontId)) {
    if (obj.interfaceFontId === 'custom' && !base.interfaceCustomFont) {
      base.interfaceFontId = DEFAULT_INTERFACE_FONT_ID;
    } else {
      base.interfaceFontId = obj.interfaceFontId;
    }
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
  if (obj.defaultBrushId && VALID_BRUSH_IDS.has(obj.defaultBrushId)) {
    base.defaultBrushId = obj.defaultBrushId;
  }
  if (obj.defaultNotePageStyle === 'paginated' || obj.defaultNotePageStyle === 'pageless') {
    base.defaultNotePageStyle = obj.defaultNotePageStyle;
  }
  if (obj.defaultSlideSizePreset && VALID_SLIDE_SIZE_PRESETS.has(obj.defaultSlideSizePreset)) {
    base.defaultSlideSizePreset = obj.defaultSlideSizePreset;
  }
  if (typeof obj.uiScale === 'number' && Number.isFinite(obj.uiScale)) {
    base.uiScale = clampUiScale(obj.uiScale);
  }
  if (
    obj.ctrlScrollBehavior === 'smart' ||
    obj.ctrlScrollBehavior === 'gui-scale' ||
    obj.ctrlScrollBehavior === 'paper-zoom'
  ) {
    base.ctrlScrollBehavior = obj.ctrlScrollBehavior;
  }
  if (obj.eraserMode === 'precision' || obj.eraserMode === 'stroke') {
    base.eraserMode = obj.eraserMode;
  }
  if (obj.activeAiProvider && VALID_AI_PROVIDERS.has(obj.activeAiProvider)) {
    base.activeAiProvider = obj.activeAiProvider;
  }
  if (obj.geminiModelPreset && VALID_GEMINI_PRESETS.has(obj.geminiModelPreset)) {
    base.geminiModelPreset =
      obj.geminiModelPreset === 'gemini-4-hydrogen'
        ? DEFAULT_GEMINI_MODEL
        : obj.geminiModelPreset;
  }
  if (typeof obj.geminiCustomModelId === 'string') {
    base.geminiCustomModelId = obj.geminiCustomModelId.trim().slice(0, 100);
  }
  if (obj.aiProviderModels && typeof obj.aiProviderModels === 'object') {
    for (const p of AI_PROVIDER_ORDER) {
      const val = (obj.aiProviderModels as Record<string, unknown>)[p];
      if (typeof val === 'string' && val.trim()) {
        base.aiProviderModels[p] =
          p === 'gemini' && val.trim() === 'gemini-4-hydrogen'
            ? DEFAULT_GEMINI_MODEL
            : val.trim().slice(0, 120);
      }
    }
  } else {
    base.aiProviderModels.gemini = resolveActiveGeminiModel(base);
  }
  if (typeof obj.aiCustomBaseUrl === 'string' && obj.aiCustomBaseUrl.trim()) {
    base.aiCustomBaseUrl = obj.aiCustomBaseUrl.trim().slice(0, 300);
  }
  if (typeof obj.blockAiOnVaultLocked === 'boolean') {
    base.blockAiOnVaultLocked = obj.blockAiOnVaultLocked;
  }
  if (obj.keyboardShortcuts && typeof obj.keyboardShortcuts === 'object') {
    base.keyboardShortcuts = sanitizeKeyboardShortcuts(obj.keyboardShortcuts);
  }

  return base;
}

export function getWorkspacePreferences(): WorkspacePreferences {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_PREFS_STORAGE_KEY);
    if (!raw) {
      window.localStorage.setItem(UI_SCALE_DEFAULT_135_MIGRATED_KEY, '1');
      return sanitizeWorkspacePreferences(null);
    }
    const parsed = JSON.parse(raw) as Partial<WorkspacePreferences> | null;
    const sanitized = sanitizeWorkspacePreferences(parsed);

    const alreadyMigrated =
      window.localStorage.getItem(CTRL_SCROLL_SMART_MIGRATED_KEY) === '1';
    if (!alreadyMigrated) {
      if (parsed && parsed.ctrlScrollBehavior === 'gui-scale') {
        sanitized.ctrlScrollBehavior = 'smart';
        saveWorkspacePreferences(sanitized);
      }
      window.localStorage.setItem(CTRL_SCROLL_SMART_MIGRATED_KEY, '1');
    }

    const uiScaleMigrated =
      window.localStorage.getItem(UI_SCALE_DEFAULT_135_MIGRATED_KEY) === '1';
    if (!uiScaleMigrated) {
      if (parsed && (parsed.uiScale === undefined || parsed.uiScale === 1)) {
        sanitized.uiScale = DEFAULT_UI_SCALE;
        saveWorkspacePreferences(sanitized);
      }
      window.localStorage.setItem(UI_SCALE_DEFAULT_135_MIGRATED_KEY, '1');
    }

    return sanitized;
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

export function getAllAiProviderKeys(): Record<AiProviderId, string> {
  const empty: Record<AiProviderId, string> = {
    gemini: '',
    grok: '',
    openai: '',
    anthropic: '',
    custom: '',
  };
  try {
    const raw = window.localStorage.getItem(AI_PROVIDER_KEYS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const p of AI_PROVIDER_ORDER) {
        if (typeof parsed?.[p] === 'string') {
          empty[p] = parsed[p].trim();
        }
      }
    }
    const legacyGemini = window.localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY)?.trim() ?? '';
    if (!empty.gemini && legacyGemini) {
      empty.gemini = legacyGemini;
    }
  } catch {
    // Ignore storage errors
  }
  return empty;
}

export function saveAiProviderKey(provider: AiProviderId, apiKey: string): void {
  try {
    const current = getAllAiProviderKeys();
    const trimmed = apiKey.trim();
    current[provider] = trimmed;
    window.localStorage.setItem(AI_PROVIDER_KEYS_STORAGE_KEY, JSON.stringify(current));
    if (provider === 'gemini') {
      if (trimmed) {
        window.localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, trimmed);
      } else {
        window.localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage quota / security errors in restricted environments
  }
}

export function clearAiProviderKey(provider: AiProviderId): void {
  saveAiProviderKey(provider, '');
}

export function getGeminiApiKey(): string {
  return getAllAiProviderKeys().gemini;
}

export function saveGeminiApiKey(apiKey: string): void {
  saveAiProviderKey('gemini', apiKey);
}

export function clearGeminiApiKey(): void {
  clearAiProviderKey('gemini');
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
