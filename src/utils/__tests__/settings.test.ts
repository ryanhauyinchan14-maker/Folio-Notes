// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  isSmartDarkApplicable,
  resolveEffectivePaperConfig,
  resolveSmartDarkInkColor,
  SMART_DARK_INK_COLOR,
  SMART_DARK_PAPER_COLOR,
} from '../../canvas/paperRenderer';
import { HIGHLIGHTER_DEFAULT_SWATCHES, PEN_DEFAULT_SWATCHES } from '../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../constants/papers';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_HERO_HEADLINE,
  DEFAULT_PEN_SLOTS,
  getWorkspacePreferences,
  resolveActiveGeminiModel,
  sanitizeWorkspacePreferences,
  saveWorkspacePreferences,
} from '../settings';

describe('workspace preferences & smart dark paper utilities', () => {
  it('provides 5 pre-seeded favorite pen/highlighter slots and round-trips workspace prefs cleanly', () => {
    expect(PEN_DEFAULT_SWATCHES).toHaveLength(9);
    expect(HIGHLIGHTER_DEFAULT_SWATCHES).toHaveLength(6);
    expect(DEFAULT_PEN_SLOTS).toHaveLength(5);
    expect(DEFAULT_PEN_SLOTS[0]).toMatchObject({ tool: 'pen', color: '#072D59' });
    expect(DEFAULT_PEN_SLOTS[1]).toMatchObject({ tool: 'pen', color: '#FD6E88' });
    expect(DEFAULT_PEN_SLOTS[3]).toMatchObject({ tool: 'highlighter', color: '#FEF08A' });

    const defaults = sanitizeWorkspacePreferences(null);
    expect(defaults.geminiModelPreset).toBe(DEFAULT_GEMINI_MODEL);
    expect(defaults.blockAiOnVaultLocked).toBe(true);
    expect(defaults.highContrastUi).toBe(false);
    expect(resolveActiveGeminiModel(defaults)).toBe('gemini-4-hydrogen');

    const custom = sanitizeWorkspacePreferences({
      penSlots: [
        { id: 'slot-1', name: 'Custom Ink', tool: 'pen', color: '#112233', size: 5 },
        ...DEFAULT_PEN_SLOTS.slice(1),
      ],
      deskBackdrop: 'midnight-navy',
      deskCustomColor: '#123456',
      darkPaperView: true,
      highContrastUi: true,
      dockPosition: 'left',
      heroHeadline: 'Spring Term Notes',
      defaultZoomMode: 'fit-width',
      defaultTool: 'pan',
      defaultPaperPattern: 'cornell',
      geminiModelPreset: 'custom',
      geminiCustomModelId: '  gemini-2.5-pro  ',
      blockAiOnVaultLocked: false,
    });
    saveWorkspacePreferences(custom);
    const loaded = getWorkspacePreferences();

    expect(loaded.penSlots[0].color).toBe('#112233');
    expect(loaded.deskBackdrop).toBe('midnight-navy');
    expect(loaded.darkPaperView).toBe(true);
    expect(loaded.highContrastUi).toBe(true);
    expect(loaded.dockPosition).toBe('left');
    expect(loaded.heroHeadline).toBe('Spring Term Notes');
    expect(loaded.defaultZoomMode).toBe('fit-width');
    expect(loaded.defaultTool).toBe('pan');
    expect(loaded.defaultPaperPattern).toBe('cornell');
    expect(loaded.geminiModelPreset).toBe('custom');
    expect(loaded.geminiCustomModelId).toBe('gemini-2.5-pro');
    expect(loaded.blockAiOnVaultLocked).toBe(false);
    expect(resolveActiveGeminiModel(loaded)).toBe('gemini-2.5-pro');

    expect(
      resolveActiveGeminiModel({
        geminiModelPreset: 'custom',
        geminiCustomModelId: '   ',
      }),
    ).toBe('gemini-4-hydrogen');

    const corrupted = sanitizeWorkspacePreferences({
      deskBackdrop: 'invalid-backdrop',
      dockPosition: 'bottom-right-weird',
      heroHeadline: '   ',
      geminiModelPreset: 'nonexistent-model',
    });
    expect(corrupted.deskBackdrop).toBe('cool-gray');
    expect(corrupted.dockPosition).toBe('bottom');
    expect(corrupted.heroHeadline).toBe(DEFAULT_HERO_HEADLINE);
    expect(corrupted.geminiModelPreset).toBe('gemini-4-hydrogen');
    expect(corrupted.blockAiOnVaultLocked).toBe(true);
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
});
