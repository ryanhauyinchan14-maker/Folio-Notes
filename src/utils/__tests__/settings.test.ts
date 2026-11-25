// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isSmartDarkApplicable,
  resolveEffectivePaperConfig,
  resolveSmartDarkInkColor,
  SMART_DARK_INK_COLOR,
  SMART_DARK_PAPER_COLOR,
} from '../../canvas/paperRenderer';
import {
  HIGHLIGHTER_DEFAULT_SWATCHES,
  PEN_DEFAULT_SWATCHES,
  UNIFIED_INK_SWATCHES,
} from '../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../constants/papers';
import {
  clearAiProviderKey,
  CTRL_SCROLL_SMART_MIGRATED_KEY,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_HERO_HEADLINE,
  DEFAULT_PEN_SLOTS,
  getAllAiProviderKeys,
  getGeminiApiKey,
  getWorkspacePreferences,
  resolveActiveAiConfig,
  resolveActiveGeminiModel,
  sanitizeWorkspacePreferences,
  saveAiProviderKey,
  saveWorkspacePreferences,
  UI_SCALE_DEFAULT_135_MIGRATED_KEY,
} from '../settings';
import { applyUiScaleToRuntime, clampUiScale, stepUiScale } from '../uiZoom';

describe('workspace preferences, multi-provider keys, UI scale & smart dark paper utilities', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.style.zoom = '';
    delete document.documentElement.dataset.uiScale;
    delete window.folioDesktop;
  });

  it('provides 5 pre-seeded favorite pen/highlighter slots and round-trips workspace prefs cleanly', () => {
    expect(UNIFIED_INK_SWATCHES).toHaveLength(10);
    expect(PEN_DEFAULT_SWATCHES).toEqual(UNIFIED_INK_SWATCHES);
    expect(HIGHLIGHTER_DEFAULT_SWATCHES).toEqual(UNIFIED_INK_SWATCHES);
    expect(UNIFIED_INK_SWATCHES).toContain('#FACC15');
    expect(DEFAULT_PEN_SLOTS).toHaveLength(5);
    expect(DEFAULT_PEN_SLOTS[0]).toMatchObject({ tool: 'pen', color: '#072D59' });
    expect(DEFAULT_PEN_SLOTS[1]).toMatchObject({ tool: 'pen', color: '#FD6E88' });
    expect(DEFAULT_PEN_SLOTS[3]).toMatchObject({ tool: 'highlighter', color: '#FEF08A' });

    const defaults = sanitizeWorkspacePreferences(null);
    expect(defaults.geminiModelPreset).toBe(DEFAULT_GEMINI_MODEL);
    expect(defaults.blockAiOnVaultLocked).toBe(true);
    expect(defaults.highContrastUi).toBe(false);
    expect(defaults.uiSoundsEnabled).toBe(false);
    expect(defaults.uiScale).toBe(1.35);
    expect(defaults.ctrlScrollBehavior).toBe('smart');
    expect(defaults.eraserMode).toBe('precision');
    expect(defaults.activeAiProvider).toBe('gemini');
    expect(defaults.keyboardShortcuts.toolPen).toBe('p');
    expect(resolveActiveGeminiModel(defaults)).toBe('gemini-3-flash');

    const custom = sanitizeWorkspacePreferences({
      penSlots: [
        { id: 'slot-1', name: 'Custom Ink', tool: 'pen', color: '#112233', size: 5 },
        ...DEFAULT_PEN_SLOTS.slice(1),
      ],
      deskBackdrop: 'midnight-navy',
      deskCustomColor: '#123456',
      darkPaperView: true,
      highContrastUi: true,
      uiSoundsEnabled: true,
      dockPosition: 'left',
      heroHeadline: 'Spring Term Notes',
      defaultZoomMode: 'fit-width',
      defaultTool: 'pan',
      defaultPaperPattern: 'cornell',
      uiScale: 1.25,
      ctrlScrollBehavior: 'paper-zoom',
      eraserMode: 'stroke',
      handwritingOfflineFallback: true,
      activeAiProvider: 'grok',
      aiProviderModels: {
        gemini: 'gemini-3.5-flash-lite',
        grok: 'grok-4.7',
        openai: 'gpt-5',
        anthropic: 'claude-sonnet-5-5',
        custom: 'meta-llama/llama-3.3-70b',
      },
      aiCustomBaseUrl: 'https://openrouter.ai/api/v1',
      geminiModelPreset: 'custom',
      geminiCustomModelId: '  gemini-2.5-pro  ',
      blockAiOnVaultLocked: false,
    } as Record<string, unknown>);
    saveWorkspacePreferences(custom);
    const loaded = getWorkspacePreferences();

    expect(loaded.penSlots[0].color).toBe('#112233');
    expect(loaded.deskBackdrop).toBe('midnight-navy');
    expect(loaded.darkPaperView).toBe(false);
    expect(loaded.highContrastUi).toBe(false);
    expect(loaded.uiSoundsEnabled).toBe(true);
    expect(loaded.dockPosition).toBe('left');
    expect(loaded.heroHeadline).toBe('Spring Term Notes');
    expect(loaded.defaultZoomMode).toBe('fit-width');
    expect(loaded.defaultTool).toBe('pan');
    expect(loaded.defaultPaperPattern).toBe('cornell');
    expect(loaded.uiScale).toBe(1.25);
    expect(loaded.ctrlScrollBehavior).toBe('paper-zoom');
    expect(loaded.eraserMode).toBe('stroke');
    expect('handwritingOfflineFallback' in loaded).toBe(false);
    expect(loaded.activeAiProvider).toBe('grok');
    expect(loaded.aiProviderModels.grok).toBe('grok-4.7');
    expect(loaded.geminiModelPreset).toBe('custom');
    expect(loaded.geminiCustomModelId).toBe('gemini-2.5-pro');
    expect(loaded.blockAiOnVaultLocked).toBe(false);
    expect(resolveActiveGeminiModel(loaded)).toBe('gemini-2.5-pro');

    expect(
      resolveActiveGeminiModel({
        geminiModelPreset: 'custom',
        geminiCustomModelId: '   ',
      }),
    ).toBe('gemini-3-flash');

    const corrupted = sanitizeWorkspacePreferences({
      deskBackdrop: 'invalid-backdrop',
      uiSoundsEnabled: 'loud' as unknown as boolean,
      dockPosition: 'bottom-right-weird',
      heroHeadline: '   ',
      uiScale: 9.9,
      ctrlScrollBehavior: 'unknown-mode',
      eraserMode: 'vaporize' as unknown as 'precision',
      activeAiProvider: 'invalid-provider',
      geminiModelPreset: 'nonexistent-model',
    });
    expect(corrupted.deskBackdrop).toBe('cool-gray');
    expect(corrupted.uiSoundsEnabled).toBe(false);
    expect(corrupted.dockPosition).toBe('bottom');
    expect(corrupted.heroHeadline).toBe(DEFAULT_HERO_HEADLINE);
    expect(corrupted.uiScale).toBe(1.5);
    expect(corrupted.ctrlScrollBehavior).toBe('smart');
    expect(corrupted.eraserMode).toBe('precision');
    expect(corrupted.activeAiProvider).toBe('gemini');
    expect(corrupted.geminiModelPreset).toBe('gemini-3-flash');
    expect(corrupted.blockAiOnVaultLocked).toBe(true);
  });

  it('stores independent keys per AI provider without cross-wiping and resolves localhost/custom configs', () => {
    saveAiProviderKey('gemini', 'AIza-gemini-key');
    saveAiProviderKey('grok', 'xai-grok-key');
    saveAiProviderKey('openai', 'sk-openai-key');
    saveAiProviderKey('anthropic', 'sk-ant-claude-key');
    saveAiProviderKey('custom', 'sk-or-custom-key');

    const keys = getAllAiProviderKeys();
    expect(keys).toEqual({
      gemini: 'AIza-gemini-key',
      grok: 'xai-grok-key',
      openai: 'sk-openai-key',
      anthropic: 'sk-ant-claude-key',
      custom: 'sk-or-custom-key',
    });
    expect(getGeminiApiKey()).toBe('AIza-gemini-key');

    // Clearing OpenAI key leaves every other provider key intact
    clearAiProviderKey('openai');
    const afterClear = getAllAiProviderKeys();
    expect(afterClear.openai).toBe('');
    expect(afterClear.gemini).toBe('AIza-gemini-key');
    expect(afterClear.grok).toBe('xai-grok-key');
    expect(afterClear.anthropic).toBe('sk-ant-claude-key');
    expect(afterClear.custom).toBe('sk-or-custom-key');

    // Custom provider with OpenRouter URL requires an API key; localhost Ollama does not
    const openRouterNoKey = resolveActiveAiConfig({
      activeAiProvider: 'custom',
      aiProviderKeys: { ...afterClear, custom: '' },
      aiProviderModels: {
        gemini: 'gemini-3-flash',
        grok: 'grok-4.7',
        openai: 'gpt-5',
        anthropic: 'claude-sonnet-5-5',
        custom: 'llama3.2-vision',
      },
      aiCustomBaseUrl: 'https://openrouter.ai/api/v1',
    });
    expect(openRouterNoKey.configured).toBe(false);

    const localOllamaNoKey = resolveActiveAiConfig({
      activeAiProvider: 'custom',
      aiProviderKeys: { ...afterClear, custom: '' },
      aiProviderModels: {
        gemini: 'gemini-3-flash',
        grok: 'grok-4.7',
        openai: 'gpt-5',
        anthropic: 'claude-sonnet-5-5',
        custom: 'llama3.2-vision',
      },
      aiCustomBaseUrl: 'http://localhost:11434/v1',
    });
    expect(localOllamaNoKey.configured).toBe(true);
    expect(localOllamaNoKey.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('clamps UI zoom bounds to [0.75, 1.50] and uses Electron bridge when present or CSS fallback', () => {
    expect(clampUiScale(0.2)).toBe(0.75);
    expect(clampUiScale(2.5)).toBe(1.5);
    expect(clampUiScale(Number.NaN)).toBe(1.35);
    expect(stepUiScale(1, 0.1)).toBe(1.1);
    expect(stepUiScale(0.75, -0.1)).toBe(0.75);

    // Browser CSS fallback mode
    expect(applyUiScaleToRuntime(1.15)).toBe(1.15);
    expect(document.documentElement.style.zoom).toBe('1.15');
    expect(document.documentElement.dataset.uiScale).toBe('1.15');

    // Electron webFrame bridge mode
    const setUiZoomFactorMock = vi.fn((f: number) => Math.max(0.75, Math.min(1.5, f)));
    window.folioDesktop = {
      isElectron: true,
      platform: 'win32',
      setUiZoomFactor: setUiZoomFactorMock,
      getUiZoomFactor: () => 1.25,
      aiFetch: vi.fn(),
    };
    expect(applyUiScaleToRuntime(1.3)).toBe(1.3);
    expect(setUiZoomFactorMock).toHaveBeenCalledWith(1.3);
    expect(document.documentElement.style.zoom).toBe('');
  });

  it('transforms light paper to dark slate and near-black ink to crisp off-white while keeping hues', () => {
    expect(isSmartDarkApplicable('#FFFFFF', false)).toBe(false);
    expect(isSmartDarkApplicable('#FFFFFF', true)).toBe(true);
    expect(isSmartDarkApplicable('#FDF8EC', true)).toBe(true);
    expect(isSmartDarkApplicable('#1E293B', true)).toBe(false); // already dark

    const darkEffective = resolveEffectivePaperConfig(DEFAULT_PAPER_CONFIG, true);
    expect(darkEffective.paperColor).toBe(SMART_DARK_PAPER_COLOR);

    // Near-black inks flip cleanly to crisp off-white
    expect(resolveSmartDarkInkColor('#000000', true, false)).toBe(SMART_DARK_INK_COLOR);
    expect(resolveSmartDarkInkColor('#072D59', true, false)).toBe(SMART_DARK_INK_COLOR);
    expect(resolveSmartDarkInkColor('#1E293B', true, false)).toBe(SMART_DARK_INK_COLOR);

    // Rich colored inks & highlighters preserve their hues cleanly
    expect(resolveSmartDarkInkColor('#2563EB', true, false)).toBe('#2563EB');
    expect(resolveSmartDarkInkColor('#DC2626', true, false)).toBe('#DC2626');
    expect(resolveSmartDarkInkColor('#FD6E88', true, false)).toBe('#FD6E88');
    expect(resolveSmartDarkInkColor('#FDE047', true, true)).toBe('#FDE047');

    // Light paper mode never alters dark inks
    expect(resolveSmartDarkInkColor('#072D59', false, false)).toBe('#072D59');
  });

  it('migrates legacy v1.1.x gui-scale preference once to smart while respecting explicit user overrides thereafter', () => {
    const legacyPrefs = sanitizeWorkspacePreferences(null);
    legacyPrefs.ctrlScrollBehavior = 'gui-scale';
    saveWorkspacePreferences(legacyPrefs);
    expect(window.localStorage.getItem(CTRL_SCROLL_SMART_MIGRATED_KEY)).toBeNull();

    // First read in v1.2.0 migrates legacy 'gui-scale' -> 'smart'
    const migrated = getWorkspacePreferences();
    expect(migrated.ctrlScrollBehavior).toBe('smart');
    expect(window.localStorage.getItem(CTRL_SCROLL_SMART_MIGRATED_KEY)).toBe('1');

    // Subsequent explicit override to 'gui-scale' is preserved
    saveWorkspacePreferences({ ...migrated, ctrlScrollBehavior: 'gui-scale' });
    expect(getWorkspacePreferences().ctrlScrollBehavior).toBe('gui-scale');

    // Legacy 'paper-zoom' preference stays untouched even before migration key is set
    window.localStorage.clear();
    saveWorkspacePreferences({ ...legacyPrefs, ctrlScrollBehavior: 'paper-zoom' });
    expect(getWorkspacePreferences().ctrlScrollBehavior).toBe('paper-zoom');
    expect(window.localStorage.getItem(CTRL_SCROLL_SMART_MIGRATED_KEY)).toBe('1');
  });

  it('migrates legacy 100% default uiScale once to 135% while respecting explicit overrides and fresh profiles', () => {
    const legacyPrefs = sanitizeWorkspacePreferences(null);
    legacyPrefs.uiScale = 1;
    saveWorkspacePreferences(legacyPrefs);
    expect(window.localStorage.getItem(UI_SCALE_DEFAULT_135_MIGRATED_KEY)).toBeNull();

    // First read in v1.3.2 migrates legacy 1 -> 1.35
    const migrated = getWorkspacePreferences();
    expect(migrated.uiScale).toBe(1.35);
    expect(window.localStorage.getItem(UI_SCALE_DEFAULT_135_MIGRATED_KEY)).toBe('1');

    // Subsequent explicit override to 1 (100%) is preserved
    saveWorkspacePreferences({ ...migrated, uiScale: 1 });
    expect(getWorkspacePreferences().uiScale).toBe(1);

    // Legacy custom scale (e.g., 1.15) stays untouched during migration
    window.localStorage.clear();
    saveWorkspacePreferences({ ...legacyPrefs, uiScale: 1.15 });
    expect(getWorkspacePreferences().uiScale).toBe(1.15);
    expect(window.localStorage.getItem(UI_SCALE_DEFAULT_135_MIGRATED_KEY)).toBe('1');

    // Fresh profile starts at 1.35 and keeps an explicit choice of 1 immediately on reload
    window.localStorage.clear();
    const fresh = getWorkspacePreferences();
    expect(fresh.uiScale).toBe(1.35);
    expect(window.localStorage.getItem(UI_SCALE_DEFAULT_135_MIGRATED_KEY)).toBe('1');
    saveWorkspacePreferences({ ...fresh, uiScale: 1 });
    expect(getWorkspacePreferences().uiScale).toBe(1);
  });
});
