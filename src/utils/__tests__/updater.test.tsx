// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compareSemver,
  evaluateLocalManifestUpdate,
  formatFriendlyUpdaterError,
  getSilentNsisUpdateArgs,
  isQuietGitHubNoReleaseError,
  isSafeInstallerFilename,
  parseBuildMeta,
  parseLocalUpdateManifest,
} from '../../../electron/updaterCore';
import { UpdateHeaderButton, UpdateToastCard } from '../../components/common/UpdatePill';
import { SettingsModal } from '../../components/modals/SettingsModal';
import { useUpdaterStore } from '../../store/useUpdaterStore';
import type { AppUpdateStatus, FolioUpdaterBridge } from '../../vite-env.d';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeStatus(overrides: Partial<AppUpdateStatus> = {}): AppUpdateStatus {
  return {
    supported: true,
    isPackaged: true,
    isPortable: false,
    justUpdated: false,
    currentVersion: '1.1.0',
    currentBuildId: '1.1.0-20261121T160000Z-aaaa1111',
    currentBuiltAt: '2026-11-21T16:00:00.000Z',
    phase: 'idle',
    source: 'none',
    availableVersion: null,
    availableBuildId: null,
    downloadProgress: null,
    message: 'Folio Notes v1.1.0 is up to date.',
    error: null,
    lastCheckedAt: null,
    localReleaseDir: 'C:\\Projects\\FolioNotes\\release',
    localWatchEnabled: true,
    ...overrides,
  };
}

describe('Hybrid Auto-Updater Core Logic', () => {
  it('compares semantic versions accurately including prefixes and prereleases', () => {
    expect(compareSemver('1.1.0', '1.0.0')).toBe(1);
    expect(compareSemver('v1.2.0', '1.1.9')).toBe(1);
    expect(compareSemver('v1.1.0', '1.1.0')).toBe(0);
    expect(compareSemver('1.0.9', '1.1.0')).toBe(-1);
    expect(compareSemver('1.1.0', '1.1.0-beta.1')).toBe(1);
    expect(compareSemver('1.1.0-beta.2', '1.1.0-beta.1')).toBe(1);
  });

  it('validates safe single-segment Windows installer filenames and local manifests', () => {
    expect(isSafeInstallerFilename('Folio-Notes-Setup-1.1.0.exe')).toBe(true);
    expect(isSafeInstallerFilename('../evil.exe')).toBe(false);
    expect(isSafeInstallerFilename('sub/Folio-Notes-Setup-1.1.0.exe')).toBe(false);
    expect(isSafeInstallerFilename('sub\\Folio-Notes-Setup-1.1.0.exe')).toBe(false);
    expect(isSafeInstallerFilename('installer.bat')).toBe(false);
    expect(isSafeInstallerFilename('.exe')).toBe(false);

    const valid = parseLocalUpdateManifest({
      schemaVersion: 1,
      version: '1.2.0',
      buildId: '1.2.0-20261122T120000Z-1234abcd',
      builtAt: '2026-11-22T12:00:00.000Z',
      installerFile: 'Folio-Notes-Setup-1.2.0.exe',
      size: 146564296,
      sha512: 'abc123sha512==',
    });
    expect(valid).not.toBeNull();
    expect(valid?.installerFile).toBe('Folio-Notes-Setup-1.2.0.exe');

    expect(
      parseLocalUpdateManifest({
        schemaVersion: 1,
        version: '1.2.0',
        buildId: 'id-1',
        builtAt: '2026-11-22T12:00:00.000Z',
        installerFile: '../evil.exe',
        size: 100,
        sha512: 'hash==',
      }),
    ).toBeNull();

    expect(
      parseLocalUpdateManifest({
        schemaVersion: 1,
        version: '1.2.0',
        buildId: 'id-1',
        builtAt: '2026-11-22T12:00:00.000Z',
        installerFile: 'Folio-Notes-Setup-1.2.0.exe',
        size: 100,
        sha512: '',
      }),
    ).toBeNull();

    expect(
      parseLocalUpdateManifest({
        schemaVersion: 2,
        version: '1.2.0',
        buildId: 'id-1',
        builtAt: '2026-11-22T12:00:00.000Z',
        installerFile: 'Folio-Notes-Setup-1.2.0.exe',
        size: 100,
        sha512: 'hash==',
      }),
    ).toBeNull();
  });

  it('evaluates local manifests without update loops or downgrades', () => {
    const current = parseBuildMeta(
      {
        version: '1.1.0',
        buildId: '1.1.0-20261121T160000Z-aaaa1111',
        builtAt: '2026-11-21T16:00:00.000Z',
      },
      '1.1.0',
    );

    const sameBuildManifest = parseLocalUpdateManifest({
      schemaVersion: 1,
      version: '1.1.0',
      buildId: '1.1.0-20261121T160000Z-aaaa1111',
      builtAt: '2026-11-21T16:00:00.000Z',
      installerFile: 'Folio-Notes-Setup-1.1.0.exe',
      size: 1234,
      sha512: 'hash==',
    })!;
    expect(evaluateLocalManifestUpdate(current, sameBuildManifest)).toEqual({
      hasUpdate: false,
      reason: 'same-build',
    });

    const newerVersionManifest = parseLocalUpdateManifest({
      schemaVersion: 1,
      version: '1.2.0',
      buildId: '1.2.0-20261121T160500Z-bbbb2222',
      builtAt: '2026-11-21T16:05:00.000Z',
      installerFile: 'Folio-Notes-Setup-1.2.0.exe',
      size: 1234,
      sha512: 'hash==',
    })!;
    expect(evaluateLocalManifestUpdate(current, newerVersionManifest)).toEqual({
      hasUpdate: true,
      reason: 'newer-version',
    });

    const sameSemverNewerBuild = parseLocalUpdateManifest({
      schemaVersion: 1,
      version: '1.1.0',
      buildId: '1.1.0-20261121T170000Z-cccc3333',
      builtAt: '2026-11-21T17:00:00.000Z',
      installerFile: 'Folio-Notes-Setup-1.1.0.exe',
      size: 1234,
      sha512: 'hash==',
    })!;
    expect(evaluateLocalManifestUpdate(current, sameSemverNewerBuild)).toEqual({
      hasUpdate: true,
      reason: 'newer-build',
    });

    const olderVersionManifest = parseLocalUpdateManifest({
      schemaVersion: 1,
      version: '1.0.0',
      buildId: '1.0.0-20261120T120000Z-00001111',
      builtAt: '2026-11-20T12:00:00.000Z',
      installerFile: 'Folio-Notes-Setup-1.0.0.exe',
      size: 1234,
      sha512: 'hash==',
    })!;
    expect(evaluateLocalManifestUpdate(current, olderVersionManifest)).toEqual({
      hasUpdate: false,
      reason: 'older-version',
    });
  });

  it('uses silent NSIS relaunch flags and friendly GitHub error mapping', () => {
    expect(getSilentNsisUpdateArgs()).toEqual(['--updated', '/S', '--force-run']);
    expect(isQuietGitHubNoReleaseError('HttpError: 404 Cannot find latest.yml')).toBe(true);
    expect(isQuietGitHubNoReleaseError('No published versions on GitHub')).toBe(true);
    expect(isQuietGitHubNoReleaseError('net::ERR_INTERNET_DISCONNECTED')).toBe(false);

    expect(formatFriendlyUpdaterError('Cannot find latest.yml (404)')).toContain('GitHub Release');
    expect(formatFriendlyUpdaterError('net::ERR_INTERNET_DISCONNECTED')).toContain('internet');
    expect(formatFriendlyUpdaterError('sha512 checksum mismatch')).toContain('integrity');
  });
});

describe('Updater Store & Antigravity-Style UI Components', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useUpdaterStore.setState({
      status: null,
      bannerDismissed: false,
      restarting: false,
      justUpdatedToastVisible: false,
      actionError: null,
      lastReadyKey: null,
    });
    delete window.folioDesktop;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    delete window.folioDesktop;
  });

  it('subscribes to updater events, renders header & toast pills, handles Later dismissal and new build re-pop', async () => {
    let listener: ((s: AppUpdateStatus) => void) | null = null;
    const restartMock = vi.fn().mockResolvedValue({ ok: true });
    const bridge: FolioUpdaterBridge = {
      getStatus: vi.fn().mockResolvedValue(makeStatus({ phase: 'idle' })),
      checkNow: vi.fn().mockResolvedValue(makeStatus({ phase: 'up-to-date' })),
      restartAndInstall: restartMock,
      setLocalConfig: vi.fn().mockResolvedValue(makeStatus()),
      pickLocalDir: vi.fn().mockResolvedValue(makeStatus()),
      onStatusChanged: vi.fn((cb) => {
        listener = cb;
        return () => {
          listener = null;
        };
      }),
    };

    window.folioDesktop = {
      isElectron: true,
      platform: 'win32',
      setUiZoomFactor: (f) => f,
      getUiZoomFactor: () => 1,
      aiFetch: vi.fn(),
      updater: bridge,
    };

    let cleanup: (() => void) | undefined;
    await act(async () => {
      cleanup = useUpdaterStore.getState().initUpdater();
      root.render(
        <>
          <UpdateHeaderButton />
          <UpdateToastCard />
        </>,
      );
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="header-restart-update-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="update-ready-banner"]')).toBeNull();

    // Emit local ready status
    await act(async () => {
      listener?.(
        makeStatus({
          phase: 'ready',
          source: 'local',
          availableVersion: '1.1.1',
          availableBuildId: '1.1.1-20261121T161000Z-dddd4444',
          downloadProgress: 100,
          message: 'Local build v1.1.1 ready · Restart to update',
        }),
      );
    });

    const headerBtn = container.querySelector('[data-testid="header-restart-update-btn"]');
    const banner = container.querySelector('[data-testid="update-ready-banner"]');
    expect(headerBtn?.textContent).toContain('Restart to Update');
    expect(banner?.textContent).toContain('Local Build');
    expect(banner?.textContent).toContain('v1.1.1');
    expect(banner?.classList.contains('folio-update-toast-glass')).toBe(true);
    expect(banner?.querySelector('[data-testid="update-toast-shader"]')).not.toBeNull();
    expect(banner?.querySelector('.folio-update-toast-scrim')).not.toBeNull();

    // Dismiss toast banner with "Later"; header button must stay visible
    const laterBtn = container.querySelector(
      '[data-testid="banner-dismiss-update-btn"]',
    ) as HTMLButtonElement;
    await act(async () => {
      laterBtn.click();
    });

    expect(container.querySelector('[data-testid="update-ready-banner"]')).toBeNull();
    expect(container.querySelector('[data-testid="header-restart-update-btn"]')).not.toBeNull();

    // New build arrives -> toast un-dismisses automatically
    await act(async () => {
      listener?.(
        makeStatus({
          phase: 'ready',
          source: 'local',
          availableVersion: '1.1.2',
          availableBuildId: '1.1.2-20261121T162000Z-eeee5555',
          downloadProgress: 100,
          message: 'Local build v1.1.2 ready · Restart to update',
        }),
      );
    });
    expect(container.querySelector('[data-testid="update-ready-banner"]')?.textContent).toContain(
      'v1.1.2',
    );

    // Clicking Restart to Update invokes bridge.restartAndInstall()
    const bannerRestartBtn = container.querySelector(
      '[data-testid="banner-restart-update-btn"]',
    ) as HTMLButtonElement;
    await act(async () => {
      bannerRestartBtn.click();
      await Promise.resolve();
    });
    expect(restartMock).toHaveBeenCalledTimes(1);

    cleanup?.();
  });

  it('renders App Updates settings tab in desktop mode and wires check/toggle controls', async () => {
    const checkNowMock = vi.fn().mockResolvedValue(
      makeStatus({
        phase: 'up-to-date',
        lastCheckedAt: '2026-11-21T16:30:00.000Z',
        message: 'Folio Notes v1.1.0 is up to date.',
      }),
    );
    const setLocalConfigMock = vi
      .fn()
      .mockResolvedValue(makeStatus({ localWatchEnabled: false }));

    window.folioDesktop = {
      isElectron: true,
      platform: 'win32',
      setUiZoomFactor: (f) => f,
      getUiZoomFactor: () => 1,
      aiFetch: vi.fn(),
      updater: {
        getStatus: vi.fn().mockResolvedValue(
          makeStatus({
            localReleaseDir: 'C:\\Work\\Goodnotes\\release',
            localWatchEnabled: true,
          }),
        ),
        checkNow: checkNowMock,
        restartAndInstall: vi.fn().mockResolvedValue({ ok: true }),
        setLocalConfig: setLocalConfigMock,
        pickLocalDir: vi.fn().mockResolvedValue(makeStatus()),
        onStatusChanged: vi.fn(() => () => {}),
      },
    };

    await act(async () => {
      root.render(<SettingsModal open initialTab="updates" onClose={() => {}} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="settings-panel-updates"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="settings-updater-build-id"]')?.textContent).toBe(
      '1.1.0-20261121T160000Z-aaaa1111',
    );
    expect(
      container.querySelector('[data-testid="settings-local-release-dir"]')?.textContent,
    ).toBe('C:\\Work\\Goodnotes\\release');

    const checkBtn = container.querySelector(
      '[data-testid="settings-check-updates-btn"]',
    ) as HTMLButtonElement;
    await act(async () => {
      checkBtn.click();
      await Promise.resolve();
    });
    expect(checkNowMock).toHaveBeenCalledTimes(1);

    const toggleBtn = container.querySelector(
      '[data-testid="settings-local-watch-toggle"]',
    ) as HTMLButtonElement;
    await act(async () => {
      toggleBtn.click();
      await Promise.resolve();
    });
    expect(setLocalConfigMock).toHaveBeenCalledWith({ enabled: false });
  });

  it('renders graceful web browser fallback in Settings -> App Updates when not in Electron', async () => {
    await act(async () => {
      root.render(<SettingsModal open initialTab="updates" onClose={() => {}} />);
      await Promise.resolve();
    });

    const fallback = container.querySelector('[data-testid="settings-updates-web-fallback"]');
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toContain('Windows desktop app');
  });
});
