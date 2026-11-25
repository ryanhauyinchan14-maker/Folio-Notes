import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow, dialog, ipcMain } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import {
  type AppUpdateStatus,
  type BuildMeta,
  evaluateLocalManifestUpdate,
  formatFriendlyUpdaterError,
  getSilentNsisUpdateArgs,
  isQuietGitHubNoReleaseError,
  parseBuildMeta,
  parseLocalUpdateManifest,
} from './updaterCore';

const LOCAL_MANIFEST_FILENAME = 'folio-local-update.json';
const LOCAL_SOURCE_CONFIG_FILENAME = 'local-update-source.json';
const LOCAL_WATCH_DEBOUNCE_MS = 1500;
const LOCAL_POLL_INTERVAL_MS = 20_000;
const FOCUS_CHECK_DEBOUNCE_MS = 5_000;
const STARTUP_CHECK_DELAY_MS = 4_000;
const GITHUB_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;

interface InitHybridUpdaterOptions {
  getMainWindow: () => BrowserWindow | null;
  isSmokeCheck: boolean;
}

interface StoredLocalSourceConfig {
  enabled: boolean;
  releaseDir: string | null;
  updatedAt?: string;
}

function hashFileSha512Base64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

function isInsideDirStrict(rootDir: string, candidatePath: string): boolean {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(candidatePath);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  return (
    rel !== '' &&
    rel !== '.' &&
    rel !== '..' &&
    !rel.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(rel)
  );
}

function readJsonFileSafe(filePath: string): unknown {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function initHybridUpdater({
  getMainWindow,
  isSmokeCheck,
}: InitHybridUpdaterOptions): { cleanup: () => void } {
  const isPackaged = app.isPackaged;
  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
  const justUpdated = process.argv.includes('--updated');
  const supported = process.platform === 'win32' || isPackaged;

  const buildMetaRaw = readJsonFileSafe(path.resolve(__dirname, 'build-meta.json'));
  const buildMeta: BuildMeta = parseBuildMeta(buildMetaRaw, app.getVersion());

  const localSourceConfigPath = path.join(app.getPath('userData'), LOCAL_SOURCE_CONFIG_FILENAME);

  const loadLocalSourceConfig = (): StoredLocalSourceConfig => {
    if (isSmokeCheck) {
      return { enabled: false, releaseDir: null };
    }
    const raw = readJsonFileSafe(localSourceConfigPath);
    if (!raw || typeof raw !== 'object') {
      return { enabled: false, releaseDir: null };
    }
    const obj = raw as Record<string, unknown>;
    const releaseDir =
      typeof obj.releaseDir === 'string' && obj.releaseDir.trim()
        ? path.resolve(obj.releaseDir.trim())
        : null;
    const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : Boolean(releaseDir);
    return { enabled, releaseDir };
  };

  let localSourceConfig = loadLocalSourceConfig();

  const saveLocalSourceConfig = (next: StoredLocalSourceConfig): void => {
    localSourceConfig = next;
    if (isSmokeCheck) return;
    writeJsonAtomic(localSourceConfigPath, {
      enabled: next.enabled,
      releaseDir: next.releaseDir,
      updatedAt: new Date().toISOString(),
    });
  };

  let status: AppUpdateStatus = {
    supported,
    isPackaged,
    isPortable,
    justUpdated,
    currentVersion: buildMeta.version,
    currentBuildId: buildMeta.buildId,
    currentBuiltAt: buildMeta.builtAt,
    phase: supported ? 'idle' : 'unsupported',
    source: 'none',
    availableVersion: null,
    availableBuildId: null,
    downloadProgress: null,
    message: justUpdated
      ? `Updated to v${buildMeta.version}`
      : `Folio Notes v${buildMeta.version} is up to date.`,
    error: null,
    lastCheckedAt: null,
    localReleaseDir: localSourceConfig.releaseDir,
    localWatchEnabled: localSourceConfig.enabled,
  };

  let readyLocalInstallerPath: string | null = null;
  let localWatcher: fs.FSWatcher | null = null;
  let localWatchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let localPollTimer: ReturnType<typeof setInterval> | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let githubPollTimer: ReturnType<typeof setInterval> | null = null;
  let lastFocusCheckAt = 0;
  let checkInFlight: Promise<AppUpdateStatus> | null = null;
  let githubCheckMode: 'background' | 'interactive' = 'background';
  let githubHooksWired = false;
  let disposed = false;

  const broadcastStatus = () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (win.webContents.isDestroyed()) return;
    win.webContents.send('updater:status-changed', status);
  };

  const setStatus = (patch: Partial<AppUpdateStatus>) => {
    status = { ...status, ...patch };
    broadcastStatus();
  };

  const verifyLocalBuildReady = async (
    releaseDir: string,
  ): Promise<{
    state: 'ready' | 'up-to-date' | 'invalid';
    version?: string;
    buildId?: string;
    installerPath?: string;
    reason?: string;
  }> => {
    const resolvedDir = path.resolve(releaseDir);
    const manifestPath = path.join(resolvedDir, LOCAL_MANIFEST_FILENAME);
    if (!fs.existsSync(manifestPath)) {
      return { state: 'up-to-date' };
    }

    const parsedManifest = parseLocalUpdateManifest(readJsonFileSafe(manifestPath));
    if (!parsedManifest) {
      return { state: 'invalid', reason: 'Local update manifest is incomplete or malformed.' };
    }

    const evaluation = evaluateLocalManifestUpdate(buildMeta, parsedManifest);
    if (!evaluation.hasUpdate) {
      return { state: 'up-to-date' };
    }

    const candidateInstaller = path.resolve(resolvedDir, parsedManifest.installerFile);
    if (!isInsideDirStrict(resolvedDir, candidateInstaller)) {
      return { state: 'invalid', reason: 'Blocked unsafe local installer path.' };
    }

    try {
      const stat = await fs.promises.stat(candidateInstaller);
      if (!stat.isFile() || stat.size !== parsedManifest.size) {
        return {
          state: 'invalid',
          reason: `Local installer size mismatch for ${parsedManifest.installerFile}.`,
        };
      }

      const actualSha = await hashFileSha512Base64(candidateInstaller);
      if (actualSha !== parsedManifest.sha512) {
        return {
          state: 'invalid',
          reason: `Local installer SHA-512 mismatch for ${parsedManifest.installerFile}.`,
        };
      }
    } catch {
      return {
        state: 'invalid',
        reason: `Local installer ${parsedManifest.installerFile} is missing or unreadable.`,
      };
    }

    return {
      state: 'ready',
      version: parsedManifest.version,
      buildId: parsedManifest.buildId,
      installerPath: candidateInstaller,
    };
  };

  const checkLocalUpdate = async (interactive: boolean): Promise<boolean> => {
    localSourceConfig = loadLocalSourceConfig();
    const { enabled, releaseDir } = localSourceConfig;

    setStatus({
      localReleaseDir: releaseDir,
      localWatchEnabled: enabled,
    });

    if (!enabled || !releaseDir || !fs.existsSync(releaseDir)) {
      if (status.source === 'local') {
        readyLocalInstallerPath = null;
        setStatus({
          phase: 'idle',
          source: 'none',
          availableVersion: null,
          availableBuildId: null,
          downloadProgress: null,
          message: `Folio Notes v${buildMeta.version}`,
        });
      }
      return false;
    }

    const result = await verifyLocalBuildReady(releaseDir);
    if (disposed) return false;

    const checkedAt = new Date().toISOString();
    if (result.state === 'ready' && result.installerPath && result.version && result.buildId) {
      readyLocalInstallerPath = result.installerPath;
      setStatus({
        phase: 'ready',
        source: 'local',
        availableVersion: result.version,
        availableBuildId: result.buildId,
        downloadProgress: 100,
        message: `Local build v${result.version} ready · Restart to update`,
        error: null,
        lastCheckedAt: checkedAt,
      });
      return true;
    }

    readyLocalInstallerPath = null;
    if (result.state === 'invalid' && interactive) {
      setStatus({
        phase: 'error',
        source: 'local',
        availableVersion: null,
        availableBuildId: null,
        downloadProgress: null,
        message: result.reason ?? 'Local build check failed.',
        error: result.reason ?? 'Local build check failed.',
        lastCheckedAt: checkedAt,
      });
      return false;
    }

    if (status.source === 'local' && status.phase === 'ready') {
      setStatus({
        phase: 'up-to-date',
        source: 'none',
        availableVersion: null,
        availableBuildId: null,
        downloadProgress: null,
        message: `Folio Notes v${buildMeta.version} is up to date.`,
        error: null,
        lastCheckedAt: checkedAt,
      });
    } else {
      setStatus({ lastCheckedAt: checkedAt });
    }
    return false;
  };

  const ensureGithubAutoUpdater = () => {
    if (githubHooksWired || isSmokeCheck || !isPackaged || isPortable) return;
    githubHooksWired = true;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = null;

    autoUpdater.on('checking-for-update', () => {
      if (status.source === 'local' && status.phase === 'ready') return;
      setStatus({
        phase: 'checking',
        source: 'github',
        message: 'Checking GitHub Releases…',
        error: null,
      });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      if (status.source === 'local' && status.phase === 'ready') return;
      setStatus({
        phase: 'downloading',
        source: 'github',
        availableVersion: info.version,
        availableBuildId: info.version,
        downloadProgress: 0,
        message: `Downloading Folio Notes v${info.version}…`,
        error: null,
      });
    });

    autoUpdater.on('download-progress', (progress) => {
      if (status.source === 'local' && status.phase === 'ready') return;
      const pct = Math.max(0, Math.min(100, Math.round(progress.percent)));
      setStatus({
        phase: 'downloading',
        source: 'github',
        downloadProgress: pct,
        message: `Downloading update (${pct}%)…`,
        error: null,
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      if (status.source === 'local' && status.phase === 'ready') return;
      setStatus({
        phase: 'ready',
        source: 'github',
        availableVersion: info.version,
        availableBuildId: info.version,
        downloadProgress: 100,
        message: `Folio Notes v${info.version} downloaded · Restart to update`,
        error: null,
        lastCheckedAt: new Date().toISOString(),
      });
    });

    autoUpdater.on('update-not-available', () => {
      if (status.source === 'local' && status.phase === 'ready') return;
      setStatus({
        phase: 'up-to-date',
        source: 'none',
        availableVersion: null,
        availableBuildId: null,
        downloadProgress: null,
        message: `Folio Notes v${buildMeta.version} is up to date.`,
        error: null,
        lastCheckedAt: new Date().toISOString(),
      });
    });

    autoUpdater.on('error', (err: Error) => {
      if (status.source === 'local' && status.phase === 'ready') return;
      const rawMessage = err?.message ? String(err.message) : 'Unknown updater error';
      const checkedAt = new Date().toISOString();
      if (githubCheckMode === 'background' && isQuietGitHubNoReleaseError(rawMessage)) {
        setStatus({
          phase: 'idle',
          source: 'none',
          downloadProgress: null,
          message: `Folio Notes v${buildMeta.version} is up to date.`,
          error: null,
          lastCheckedAt: checkedAt,
        });
        return;
      }

      const friendly = formatFriendlyUpdaterError(rawMessage);
      setStatus({
        phase: 'error',
        source: 'github',
        downloadProgress: null,
        message: friendly,
        error: friendly,
        lastCheckedAt: checkedAt,
      });
    });
  };

  const runCheck = async (interactive: boolean): Promise<AppUpdateStatus> => {
    if (disposed || isSmokeCheck) return status;
    if (checkInFlight) return checkInFlight;

    checkInFlight = (async () => {
      if (interactive) {
        setStatus({
          phase: 'checking',
          error: null,
          message: 'Checking for updates…',
        });
      }

      const foundLocal = await checkLocalUpdate(interactive);
      if (foundLocal || disposed) {
        return status;
      }

      // Preserve interactive local validation error if one occurred
      if (interactive && status.phase === 'error' && status.source === 'local') {
        return status;
      }

      if (isPackaged && !isPortable) {
        ensureGithubAutoUpdater();
        githubCheckMode = interactive ? 'interactive' : 'background';
        try {
          await autoUpdater.checkForUpdates();
        } catch (err) {
          const rawMessage = err instanceof Error ? err.message : String(err ?? '');
          if (status.source === 'local' && status.phase === 'ready') {
            return status;
          }
          if (!interactive && isQuietGitHubNoReleaseError(rawMessage)) {
            setStatus({
              phase: 'idle',
              source: 'none',
              message: `Folio Notes v${buildMeta.version} is up to date.`,
              error: null,
              lastCheckedAt: new Date().toISOString(),
            });
          } else {
            const friendly = formatFriendlyUpdaterError(rawMessage);
            setStatus({
              phase: 'error',
              source: 'github',
              message: friendly,
              error: friendly,
              lastCheckedAt: new Date().toISOString(),
            });
          }
        }
        return status;
      }

      if (interactive) {
        const devOrPortableNote = isPortable
          ? `Portable v${buildMeta.version} · Use the NSIS Setup installer or a Local Build Folder for 1-click updates.`
          : `Dev build v${buildMeta.version} · Watching Local Build Folder (GitHub auto-check runs in packaged builds).`;
        setStatus({
          phase: 'up-to-date',
          source: 'none',
          downloadProgress: null,
          message: devOrPortableNote,
          error: null,
          lastCheckedAt: new Date().toISOString(),
        });
      }

      return status;
    })().finally(() => {
      checkInFlight = null;
    });

    return checkInFlight;
  };

  const stopLocalWatch = () => {
    if (localWatchDebounceTimer) {
      clearTimeout(localWatchDebounceTimer);
      localWatchDebounceTimer = null;
    }
    if (localPollTimer) {
      clearInterval(localPollTimer);
      localPollTimer = null;
    }
    if (localWatcher) {
      try {
        localWatcher.close();
      } catch {
        // Ignore watcher shutdown error
      }
      localWatcher = null;
    }
  };

  const startLocalWatch = () => {
    stopLocalWatch();
    if (disposed || isSmokeCheck) return;
    if (!localSourceConfig.enabled || !localSourceConfig.releaseDir) return;
    if (!fs.existsSync(localSourceConfig.releaseDir)) return;

    const triggerDebouncedLocalCheck = () => {
      if (localWatchDebounceTimer) {
        clearTimeout(localWatchDebounceTimer);
      }
      localWatchDebounceTimer = setTimeout(() => {
        localWatchDebounceTimer = null;
        void checkLocalUpdate(false);
      }, LOCAL_WATCH_DEBOUNCE_MS);
    };

    try {
      localWatcher = fs.watch(localSourceConfig.releaseDir, { persistent: false }, (_event, file) => {
        if (!file || file === LOCAL_MANIFEST_FILENAME || /\.exe$/i.test(file)) {
          triggerDebouncedLocalCheck();
        }
      });
      localWatcher.on('error', () => {
        // Fall back quietly to gentle interval polling if OS watch fails
      });
    } catch {
      // Ignore fs.watch unsupported errors; polling handles it
    }

    localPollTimer = setInterval(() => {
      void checkLocalUpdate(false);
    }, LOCAL_POLL_INTERVAL_MS);
    if (typeof localPollTimer.unref === 'function') {
      localPollTimer.unref();
    }
  };

  const restartAndInstall = async (): Promise<{ ok: boolean; error?: string }> => {
    if (status.phase !== 'ready') {
      return { ok: false, error: 'No ready update is available to install.' };
    }

    if (status.source === 'local') {
      const releaseDir = localSourceConfig.releaseDir;
      if (!releaseDir || !readyLocalInstallerPath) {
        return { ok: false, error: 'Local installer path is no longer available.' };
      }

      const verified = await verifyLocalBuildReady(releaseDir);
      if (verified.state !== 'ready' || !verified.installerPath) {
        readyLocalInstallerPath = null;
        const reason = verified.reason ?? 'Local update package could not be verified.';
        setStatus({
          phase: 'error',
          source: 'local',
          message: reason,
          error: reason,
        });
        return { ok: false, error: reason };
      }

      setStatus({
        message: 'Restarting to install update…',
        error: null,
      });

      try {
        const child = spawn(verified.installerPath, getSilentNsisUpdateArgs(), {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.on('error', () => {
          // App may already be quitting cleanly
        });
        child.unref();

        setTimeout(() => {
          app.quit();
        }, 150);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to launch local installer.';
        setStatus({
          phase: 'error',
          source: 'local',
          message: msg,
          error: msg,
        });
        return { ok: false, error: msg };
      }
    }

    if (status.source === 'github') {
      setStatus({
        message: 'Restarting to install update…',
        error: null,
      });
      setTimeout(() => {
        autoUpdater.quitAndInstall(true, true);
      }, 120);
      return { ok: true };
    }

    return { ok: false, error: 'No ready update source selected.' };
  };

  // Register IPC bridge handlers
  ipcMain.handle('updater:get-status', () => status);

  ipcMain.handle('updater:check-now', async () => runCheck(true));

  ipcMain.handle('updater:restart-and-install', async () => restartAndInstall());

  ipcMain.handle(
    'updater:set-local-config',
    async (_event, rawConfig: { enabled?: unknown; releaseDir?: unknown }) => {
      const nextEnabled =
        typeof rawConfig?.enabled === 'boolean' ? rawConfig.enabled : localSourceConfig.enabled;
      const nextDir =
        rawConfig?.releaseDir === null
          ? null
          : typeof rawConfig?.releaseDir === 'string' && rawConfig.releaseDir.trim()
            ? path.resolve(rawConfig.releaseDir.trim())
            : localSourceConfig.releaseDir;

      saveLocalSourceConfig({
        enabled: nextEnabled,
        releaseDir: nextDir,
      });
      setStatus({
        localReleaseDir: nextDir,
        localWatchEnabled: nextEnabled,
      });
      startLocalWatch();
      await checkLocalUpdate(false);
      return status;
    },
  );

  ipcMain.handle('updater:pick-local-dir', async () => {
    const win = getMainWindow();
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Select Folio Notes Local Release Folder',
      properties: ['openDirectory'],
      defaultPath: localSourceConfig.releaseDir ?? undefined,
    };
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return status;
    }

    const pickedDir = path.resolve(result.filePaths[0]);
    saveLocalSourceConfig({
      enabled: true,
      releaseDir: pickedDir,
    });
    setStatus({
      localReleaseDir: pickedDir,
      localWatchEnabled: true,
    });
    startLocalWatch();
    await checkLocalUpdate(true);
    return status;
  });

  if (!isSmokeCheck) {
    startLocalWatch();

    startupTimer = setTimeout(() => {
      startupTimer = null;
      void runCheck(false);
    }, STARTUP_CHECK_DELAY_MS);
    if (typeof startupTimer.unref === 'function') {
      startupTimer.unref();
    }

    if (isPackaged && !isPortable) {
      githubPollTimer = setInterval(() => {
        void runCheck(false);
      }, GITHUB_POLL_INTERVAL_MS);
      if (typeof githubPollTimer.unref === 'function') {
        githubPollTimer.unref();
      }
    }

    app.on('browser-window-focus', () => {
      if (disposed) return;
      const now = Date.now();
      if (now - lastFocusCheckAt < FOCUS_CHECK_DEBOUNCE_MS) return;
      lastFocusCheckAt = now;
      if (localSourceConfig.enabled && localSourceConfig.releaseDir) {
        void checkLocalUpdate(false);
      }
    });
  }

  const cleanup = () => {
    disposed = true;
    stopLocalWatch();
    if (startupTimer) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
    if (githubPollTimer) {
      clearInterval(githubPollTimer);
      githubPollTimer = null;
    }
  };

  return { cleanup };
}
