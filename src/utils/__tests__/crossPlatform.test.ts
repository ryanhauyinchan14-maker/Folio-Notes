// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  parseFontconfigListOutput,
  parseFontDirectoryFilenames,
} from '../../../electron/systemFontsCore';
import { formatShortcutCompact } from '../shortcuts';
import { canRegisterServiceWorker, detectDevicePlatform } from '../pwa';

describe('cross-platform support (Windows, macOS, Linux, iOS, iPadOS, Android)', () => {
  it('parses Linux fc-list output and macOS/Linux font directory filenames cleanly', () => {
    const linuxFonts = parseFontconfigListOutput(
      [
        'Inter,Inter SemiBold',
        'JetBrains Mono',
        'Noto Sans,Noto Sans Regular',
        '.LastResort',
        'inter',
        'DejaVu Sans',
      ].join('\n'),
    );
    expect(linuxFonts).toEqual([
      'DejaVu Sans',
      'Inter',
      'Inter SemiBold',
      'JetBrains Mono',
      'Noto Sans',
      'Noto Sans Regular',
    ]);

    const macDirFonts = parseFontDirectoryFilenames([
      '/System/Library/Fonts/SFPro-Regular.otf',
      '/System/Library/Fonts/.SFNS-Regular.ttf',
      '/Library/Fonts/AvenirNext-Bold.ttf',
      '/Library/Fonts/AvenirNext-Italic.ttf',
      'Roboto-Medium.ttf',
      'README.txt',
    ]);
    expect(macDirFonts).toEqual(['AvenirNext', 'Roboto', 'SFPro']);
  });

  it('detects Windows, macOS, Linux, Android, iPhone, and iPadOS touch devices accurately', () => {
    expect(
      detectDevicePlatform(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0',
        'Win32',
        0,
      ),
    ).toBe('windows');
    expect(
      detectDevicePlatform(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/605.1.15',
        'MacIntel',
        0,
      ),
    ).toBe('macos');
    expect(
      detectDevicePlatform(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
        'MacIntel',
        5,
      ),
    ).toBe('ios');
    expect(
      detectDevicePlatform(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)',
        'iPhone',
        5,
      ),
    ).toBe('ios');
    expect(
      detectDevicePlatform(
        'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36',
        'Linux armv8l',
        5,
      ),
    ).toBe('android');
    expect(
      detectDevicePlatform(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Linux x86_64',
        0,
      ),
    ).toBe('linux');
  });

  it('guards PWA Service Worker registration inside Electron while permitting HTTPS / localhost browsers', () => {
    const origDesktop = window.folioDesktop;
    const origSw = navigator.serviceWorker;

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: async () => ({}) },
    });

    window.folioDesktop = {
      isElectron: true,
      platform: 'win32',
      setUiZoomFactor: (f) => f,
      getUiZoomFactor: () => 1,
      aiFetch: async () => ({ ok: true, status: 200, statusText: 'OK', bodyText: '{}' }),
    };
    expect(canRegisterServiceWorker()).toBe(false);

    delete window.folioDesktop;
    // jsdom runs at http://localhost by default
    expect(canRegisterServiceWorker()).toBe(true);

    window.folioDesktop = origDesktop;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: origSw,
    });
  });

  it('formats Cmd shortcuts on macOS and Ctrl shortcuts on Windows/Linux', () => {
    const navPlatformDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'platform');
    try {
      Object.defineProperty(navigator, 'platform', {
        configurable: true,
        get: () => 'MacIntel',
      });
      expect(formatShortcutCompact('Ctrl+Z')).toBe('Cmd+Z');

      Object.defineProperty(navigator, 'platform', {
        configurable: true,
        get: () => 'Linux x86_64',
      });
      expect(formatShortcutCompact('Ctrl+Z')).toBe('Ctrl+Z');
    } finally {
      if (navPlatformDesc) {
        Object.defineProperty(Navigator.prototype, 'platform', navPlatformDesc);
      }
    }
  });
});
