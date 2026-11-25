// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseWindowsFontRegistryOutput } from '../../../electron/systemFontsCore';
import { db } from '../../db/database';
import { useAppStore } from '../../store/useAppStore';
import { SettingsModal } from '../../components/modals/SettingsModal';
import {
  getWorkspacePreferences,
  sanitizeWorkspacePreferences,
  saveWorkspacePreferences,
} from '../settings';
import {
  applyInterfaceFontToRuntime,
  DEFAULT_INTERFACE_FONT_ID,
  INTERFACE_FONT_PRESETS,
  sanitizeCustomFontName,
} from '../uiFonts';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('v1.4.17 Interface Font system, presets, Google/OS custom fonts & local font file import', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    window.localStorage.clear();
    delete window.folioDesktop;
    document.documentElement.style.removeProperty('--font-sans');
    document.documentElement.style.removeProperty('--font-display');
    document.documentElement.style.removeProperty('--font-mono');
    delete document.documentElement.dataset.interfaceFont;
    delete document.documentElement.dataset.interfaceFontName;
    document.head
      .querySelectorAll('link[data-folio-font-sheet], style[data-folio-custom-google-font]')
      .forEach((el) => el.remove());

    await db.customFonts.clear();
    useAppStore.setState({
      interfaceFontId: DEFAULT_INTERFACE_FONT_ID,
      interfaceCustomFont: '',
      uploadedFonts: [],
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('parses Windows font registry output into clean, deduplicated family names', () => {
    const sample = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts
    Arial (TrueType)    REG_SZ    arial.ttf
    Arial Bold (TrueType)    REG_SZ    arialbd.ttf
    Arial Bold Italic (TrueType)    REG_SZ    arialbi.ttf
    Arial Black (TrueType)    REG_SZ    ariblk.ttf
    Cambria & Cambria Math (TrueType)    REG_SZ    cambria.ttc
    Segoe UI Semibold (TrueType)    REG_SZ    seguisb.ttf
    Cascadia Code Regular (TrueType)    REG_SZ    CascadiaCode.ttf
    @Yu Gothic UI (TrueType)    REG_SZ    YuGothR.ttf
    Wingdings (TrueType)    REG_SZ    wingding.ttf
`;
    const parsed = parseWindowsFontRegistryOutput([sample]);
    expect(parsed).toContain('Arial');
    expect(parsed).toContain('Arial Black');
    expect(parsed).toContain('Cambria');
    expect(parsed).toContain('Cambria Math');
    expect(parsed).toContain('Segoe UI');
    expect(parsed).toContain('Cascadia Code');
    expect(parsed.some((f) => f.startsWith('@'))).toBe(false);
    expect(parsed.includes('Wingdings')).toBe(false);
    // Deduplicates Arial / Bold / Bold Italic
    expect(parsed.filter((f) => f === 'Arial')).toHaveLength(1);
  });

  it('sanitizes and persists interfaceFontId and interfaceCustomFont safely', () => {
    expect(sanitizeCustomFontName('  "Fira Code"; background: red  ')).toBe('Fira Code background: red');

    const saved = sanitizeWorkspacePreferences({
      interfaceFontId: 'custom',
      interfaceCustomFont: '  "Poppins"  ',
    });
    expect(saved.interfaceFontId).toBe('custom');
    expect(saved.interfaceCustomFont).toBe('Poppins');

    saveWorkspacePreferences(saved);
    const loaded = getWorkspacePreferences();
    expect(loaded.interfaceFontId).toBe('custom');
    expect(loaded.interfaceCustomFont).toBe('Poppins');

    // Custom with empty name falls back to default
    const emptyCustom = sanitizeWorkspacePreferences({
      interfaceFontId: 'custom',
      interfaceCustomFont: '   ""   ',
    });
    expect(emptyCustom.interfaceFontId).toBe(DEFAULT_INTERFACE_FONT_ID);

    const invalidId = sanitizeWorkspacePreferences({
      interfaceFontId: 'malicious<script>',
    });
    expect(invalidId.interfaceFontId).toBe(DEFAULT_INTERFACE_FONT_ID);
  });

  it('applies default, preset, Google custom, local offline custom, and uploaded font variables cleanly', async () => {
    // 1. Default
    await applyInterfaceFontToRuntime(DEFAULT_INTERFACE_FONT_ID);
    expect(document.documentElement.dataset.interfaceFont).toBe('folio-default');
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe('');

    // 2. Curated preset (Inter)
    await applyInterfaceFontToRuntime('inter');
    expect(document.documentElement.dataset.interfaceFont).toBe('inter');
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain('"Inter"');
    expect(
      document.head.querySelector('link[data-folio-font-sheet="preset-inter"]'),
    ).not.toBeNull();

    // 3. Custom font loaded from Google Fonts CSS
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response("@font-face { font-family: 'Poppins'; src: url(https://example.com/p.woff2); }", {
        status: 200,
      }),
    );
    const gRes = await applyInterfaceFontToRuntime('custom', 'Poppins');
    expect(gRes.source).toBe('google');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain('"Poppins"');
    expect(
      document.head.querySelector('style[data-folio-custom-google-font="poppins"]'),
    ).not.toBeNull();

    // 4. Offline / unknown custom font falls back smoothly without throwing
    fetchSpy.mockRejectedValueOnce(new Error('Offline'));
    const localRes = await applyInterfaceFontToRuntime('custom', 'MyLocalFont');
    expect(localRes.source).toBe('local');
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain('"MyLocalFont"');

    // 5. Uploaded font stored in Dexie
    const rec = {
      id: 'font-1',
      name: 'Custom Studio',
      fileName: 'CustomStudio.ttf',
      mimeType: 'font/ttf',
      data: new ArrayBuffer(16),
      createdAt: Date.now(),
    };
    await db.customFonts.put(rec);
    const upRes = await applyInterfaceFontToRuntime('uploaded:font-1', 'Custom Studio');
    expect(upRes.source).toBe('uploaded');
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain(
      '"FolioUploaded_font-1"',
    );
  });

  it('lets users browse 22 curated fonts, apply any typed/system font, import a local font file, and reset in SettingsModal', async () => {
    window.folioDesktop = {
      isElectron: true,
      platform: 'win32',
      setUiZoomFactor: (f) => f,
      getUiZoomFactor: () => 1.35,
      aiFetch: vi.fn(),
      fonts: {
        listSystemFonts: vi.fn(async () => ['Bahnschrift', 'Georgia', 'Verdana']),
      },
    };
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline test'));

    await act(async () => {
      root.render(
        <SettingsModal open initialTab="appearance" onClose={() => {}} />,
      );
      await Promise.resolve();
    });

    // All 22 curated presets render
    expect(INTERFACE_FONT_PRESETS).toHaveLength(22);
    for (const preset of INTERFACE_FONT_PRESETS) {
      expect(
        container.querySelector(`[data-testid="settings-font-preset-${preset.id}"]`),
      ).not.toBeNull();
    }

    // Select a curated serif preset ("Newsreader")
    const newsreaderBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-font-preset-newsreader"]',
    )!;
    await act(async () => {
      newsreaderBtn.click();
    });
    expect(useAppStore.getState().interfaceFontId).toBe('newsreader');
    expect(
      container.querySelector('[data-testid="settings-active-font-badge"]')?.textContent,
    ).toBe('Newsreader');

    // Filter to Accessible category
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="settings-font-cat-accessible"]')!
        .click();
    });
    expect(
      container.querySelector('[data-testid="settings-font-preset-atkinson-hyperlegible"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="settings-font-preset-newsreader"]'),
    ).toBeNull();

    // Switch back to All, type any font name and apply it
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="settings-font-cat-all"]')!.click();
    });
    const searchInput = container.querySelector<HTMLInputElement>(
      '[data-testid="settings-font-search-input"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(searchInput, 'Comic Neue');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const useCustomBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="settings-apply-custom-font-btn"]',
    )!;
    expect(useCustomBtn.textContent).toContain('Comic Neue');
    await act(async () => {
      useCustomBtn.click();
      await Promise.resolve();
    });
    expect(useAppStore.getState().interfaceFontId).toBe('custom');
    expect(useAppStore.getState().interfaceCustomFont).toBe('Comic Neue');

    // Clear search and select an installed Windows System font from the System tab
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(searchInput, '');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      container
        .querySelector<HTMLButtonElement>('[data-testid="settings-font-cat-system"]')!
        .click();
    });
    const sysBtns = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid="settings-system-font-btn"]'),
    );
    expect(sysBtns.some((b) => b.textContent?.includes('Bahnschrift'))).toBe(true);
    await act(async () => {
      sysBtns.find((b) => b.textContent?.includes('Bahnschrift'))!.click();
    });
    expect(useAppStore.getState().interfaceFontId).toBe('custom');
    expect(useAppStore.getState().interfaceCustomFont).toBe('Bahnschrift');

    // Import a local .ttf font file via action and verify UI lists & deletes it
    const fakeFontFile = new File([new Uint8Array([0, 1, 0, 0])], 'My_Clean_Sans-Regular.ttf', {
      type: 'font/ttf',
    });
    Object.defineProperty(fakeFontFile, 'arrayBuffer', {
      value: async () => new Uint8Array([0, 1, 0, 0]).buffer,
    });
    let importedId = '';
    await act(async () => {
      const res = await useAppStore.getState().importCustomInterfaceFont(fakeFontFile);
      expect(res.ok).toBe(true);
      importedId = res.fontId!.replace('uploaded:', '');
      container
        .querySelector<HTMLButtonElement>('[data-testid="settings-font-cat-imported"]')!
        .click();
    });
    expect(
      container.querySelector(`[data-testid="settings-font-uploaded-${importedId}"]`),
    ).not.toBeNull();

    // Delete imported font -> falls back cleanly to Folio Default
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(`[data-testid="settings-font-uploaded-delete-${importedId}"]`)!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(useAppStore.getState().interfaceFontId).toBe('folio-default');
    expect(await db.customFonts.count()).toBe(0);
  });
});
