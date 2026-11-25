export type UpdateSource = 'local' | 'github' | 'none';

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'up-to-date'
  | 'error'
  | 'unsupported';

export interface BuildMeta {
  version: string;
  buildId: string;
  builtAt: string;
}

export interface LocalUpdateManifest {
  schemaVersion: 1;
  version: string;
  buildId: string;
  builtAt: string;
  installerFile: string;
  size: number;
  sha512: string;
}

export interface LocalUpdateSourceConfig {
  enabled: boolean;
  releaseDir: string | null;
  updatedAt?: string;
}

export interface LocalUpdateEvaluation {
  hasUpdate: boolean;
  reason: 'newer-version' | 'newer-build' | 'same-build' | 'older-version';
}

export interface AppUpdateStatus {
  supported: boolean;
  isPackaged: boolean;
  isPortable: boolean;
  justUpdated: boolean;
  currentVersion: string;
  currentBuildId: string;
  currentBuiltAt: string;
  phase: UpdatePhase;
  source: UpdateSource;
  availableVersion: string | null;
  availableBuildId: string | null;
  downloadProgress: number | null;
  message: string;
  error: string | null;
  lastCheckedAt: string | null;
  localReleaseDir: string | null;
  localWatchEnabled: boolean;
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemverParts(version: string): ParsedSemver {
  const cleaned = version.trim().replace(/^v/i, '').split('+')[0] ?? '';
  const dashIdx = cleaned.indexOf('-');
  const coreStr = dashIdx >= 0 ? cleaned.slice(0, dashIdx) : cleaned;
  const preStr = dashIdx >= 0 ? cleaned.slice(dashIdx + 1) : '';
  const coreNums = coreStr.split('.').map((part) => {
    const match = /^\d+/.exec(part.trim());
    return match ? Number.parseInt(match[0], 10) : 0;
  });

  return {
    major: coreNums[0] ?? 0,
    minor: coreNums[1] ?? 0,
    patch: coreNums[2] ?? 0,
    prerelease: preStr ? preStr.split('.').filter(Boolean) : [],
  };
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;

  const aPre = pa.prerelease;
  const bPre = pb.prerelease;
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;

  const maxLen = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < maxLen; i++) {
    const ai = aPre[i];
    const bi = bPre[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    if (ai === bi) continue;

    const aNum = /^\d+$/.test(ai) ? Number.parseInt(ai, 10) : null;
    const bNum = /^\d+$/.test(bi) ? Number.parseInt(bi, 10) : null;
    if (aNum !== null && bNum !== null) {
      return aNum > bNum ? 1 : -1;
    }
    if (aNum !== null) return -1;
    if (bNum !== null) return 1;
    return ai > bi ? 1 : -1;
  }

  return 0;
}

export function isSafeInstallerFilename(filename: string): boolean {
  if (typeof filename !== 'string') return false;
  const trimmed = filename.trim();
  if (!trimmed || trimmed !== filename || trimmed.length > 180) return false;
  if (!/\.exe$/i.test(trimmed) || trimmed.toLowerCase() === '.exe') return false;
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) return false;
  if (/[<>:"|?*]/.test(trimmed)) return false;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) < 32) return false;
  }
  return true;
}

export function parseBuildMeta(raw: unknown, fallbackVersion: string): BuildMeta {
  const safeVersion =
    typeof fallbackVersion === 'string' && fallbackVersion.trim()
      ? fallbackVersion.trim()
      : '1.0.0';
  if (!raw || typeof raw !== 'object') {
    return { version: safeVersion, buildId: 'dev', builtAt: '' };
  }
  const obj = raw as Record<string, unknown>;
  const version =
    typeof obj.version === 'string' && obj.version.trim() ? obj.version.trim() : safeVersion;
  const buildId =
    typeof obj.buildId === 'string' && obj.buildId.trim() ? obj.buildId.trim() : 'dev';
  const builtAt =
    typeof obj.builtAt === 'string' && obj.builtAt.trim() ? obj.builtAt.trim() : '';
  return { version, buildId, builtAt };
}

export function parseLocalUpdateManifest(raw: unknown): LocalUpdateManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 1) return null;

  const version = typeof obj.version === 'string' ? obj.version.trim() : '';
  const buildId = typeof obj.buildId === 'string' ? obj.buildId.trim() : '';
  const builtAt = typeof obj.builtAt === 'string' ? obj.builtAt.trim() : '';
  const sha512 = typeof obj.sha512 === 'string' ? obj.sha512.trim() : '';
  const installerFile = typeof obj.installerFile === 'string' ? obj.installerFile : '';
  const size = typeof obj.size === 'number' ? obj.size : Number.NaN;

  if (!version || !buildId || !builtAt || !sha512) return null;
  if (!Number.isFinite(size) || size <= 0) return null;
  if (!isSafeInstallerFilename(installerFile)) return null;

  return {
    schemaVersion: 1,
    version,
    buildId,
    builtAt,
    installerFile,
    size,
    sha512,
  };
}

export function evaluateLocalManifestUpdate(
  current: BuildMeta,
  manifest: LocalUpdateManifest,
): LocalUpdateEvaluation {
  if (manifest.buildId === current.buildId) {
    return { hasUpdate: false, reason: 'same-build' };
  }

  const semverCmp = compareSemver(manifest.version, current.version);
  if (semverCmp > 0) {
    return { hasUpdate: true, reason: 'newer-version' };
  }
  if (semverCmp < 0) {
    return { hasUpdate: false, reason: 'older-version' };
  }

  const manifestMs = Date.parse(manifest.builtAt);
  const currentMs = Date.parse(current.builtAt);
  if (Number.isFinite(manifestMs) && Number.isFinite(currentMs)) {
    if (manifestMs > currentMs) {
      return { hasUpdate: true, reason: 'newer-build' };
    }
    return { hasUpdate: false, reason: 'same-build' };
  }

  if (!current.builtAt && current.buildId !== 'dev' && Number.isFinite(manifestMs)) {
    return { hasUpdate: true, reason: 'newer-build' };
  }

  return { hasUpdate: false, reason: 'same-build' };
}

export function getSilentNsisUpdateArgs(): string[] {
  return ['--updated', '/S', '--force-run'];
}

export function isQuietGitHubNoReleaseError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('cannot find latest.yml') ||
    lower.includes('httperror: 404') ||
    lower.includes('status code 404') ||
    lower.includes('404 not found') ||
    lower.includes('no published versions on github') ||
    lower.includes('unable to find latest version on github') ||
    lower.includes('err_updater_latest_version_not_found') ||
    lower.includes('release not found') ||
    (lower.includes('404') && lower.includes('github'))
  );
}

export function formatFriendlyUpdaterError(errMessage: string): string {
  const trimmed = errMessage.trim();
  if (!trimmed) return 'Unable to check for updates right now.';

  if (isQuietGitHubNoReleaseError(trimmed)) {
    return 'No published GitHub Release found yet (make sure the repository is Public and has a release).';
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.includes('err_internet_disconnected') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('econnrefused') ||
    lower.includes('err_network') ||
    lower.includes('net::')
  ) {
    return 'Could not reach GitHub to check for updates (check your internet connection).';
  }

  if (lower.includes('sha512') || lower.includes('checksum') || lower.includes('integrity')) {
    return 'Downloaded update failed integrity verification and was discarded.';
  }

  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
}
