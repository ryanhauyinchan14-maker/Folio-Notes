import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const RELEASE_DIR = path.join(ROOT_DIR, 'release');
const DIST_ELECTRON_DIR = path.join(ROOT_DIR, 'dist-electron');

function computeSha512Base64(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

function writeJsonAtomic(targetPath, data) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

function findSetupInstaller(version) {
  if (!fs.existsSync(RELEASE_DIR)) {
    throw new Error(`Release directory does not exist: ${RELEASE_DIR}`);
  }

  const expectedName = `Folio-Notes-Setup-${version}.exe`;
  const expectedPath = path.join(RELEASE_DIR, expectedName);
  if (fs.existsSync(expectedPath) && fs.statSync(expectedPath).isFile()) {
    return expectedPath;
  }

  const candidates = fs
    .readdirSync(RELEASE_DIR)
    .filter((name) => /setup.*\.exe$/i.test(name))
    .map((name) => {
      const fullPath = path.join(RELEASE_DIR, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, mtimeMs: stat.mtimeMs, isFile: stat.isFile() };
    })
    .filter((entry) => entry.isFile)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (candidates.length === 0) {
    throw new Error(
      `No NSIS Setup installer (*.exe) found in ${RELEASE_DIR}. Expected ${expectedName}.`,
    );
  }

  return candidates[0].fullPath;
}

async function main() {
  const pkgPath = path.join(ROOT_DIR, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const pkgName = typeof pkg.name === 'string' && pkg.name.trim() ? pkg.name.trim() : 'goodnotes';
  const pkgVersion =
    typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : '1.0.0';

  const buildMetaPath = path.join(DIST_ELECTRON_DIR, 'build-meta.json');
  if (!fs.existsSync(buildMetaPath)) {
    throw new Error(`Missing build metadata: ${buildMetaPath}. Run electron:compile first.`);
  }
  const buildMeta = JSON.parse(fs.readFileSync(buildMetaPath, 'utf8'));
  const version =
    typeof buildMeta.version === 'string' && buildMeta.version.trim()
      ? buildMeta.version.trim()
      : pkgVersion;
  const buildId =
    typeof buildMeta.buildId === 'string' && buildMeta.buildId.trim()
      ? buildMeta.buildId.trim()
      : `${version}-${Date.now()}`;
  const builtAt =
    typeof buildMeta.builtAt === 'string' && buildMeta.builtAt.trim()
      ? buildMeta.builtAt.trim()
      : new Date().toISOString();

  const installerPath = findSetupInstaller(version);
  const installerFile = path.basename(installerPath);
  const size = fs.statSync(installerPath).size;
  const sha512 = await computeSha512Base64(installerPath);

  const manifest = {
    schemaVersion: 1,
    version,
    buildId,
    builtAt,
    installerFile,
    size,
    sha512,
  };

  const manifestPath = path.join(RELEASE_DIR, 'folio-local-update.json');
  writeJsonAtomic(manifestPath, manifest);
  console.log(
    `Wrote local update manifest: ${manifestPath} (${installerFile}, ${(size / (1024 * 1024)).toFixed(1)} MB, buildId=${buildId})`,
  );

  if (process.env.CI === 'true' || process.env.FOLIO_SKIP_LOCAL_SOURCE_REGISTER === '1') {
    console.log('Skipping local update source registration (CI / skip flag active).');
    return;
  }

  const appDataDir = process.env.APPDATA;
  if (!appDataDir) {
    return;
  }

  const sourceConfigPath = path.join(appDataDir, pkgName, 'local-update-source.json');
  let userDisabled = false;
  if (fs.existsSync(sourceConfigPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(sourceConfigPath, 'utf8'));
      if (existing && existing.enabled === false) {
        userDisabled = true;
      }
    } catch {
      // Ignore malformed existing config and refresh it cleanly.
    }
  }

  if (userDisabled) {
    console.log(
      `Local update watch disabled by user in ${sourceConfigPath}; leaving enabled=false intact.`,
    );
    return;
  }

  writeJsonAtomic(sourceConfigPath, {
    enabled: true,
    releaseDir: path.resolve(RELEASE_DIR),
    updatedAt: new Date().toISOString(),
  });
  console.log(`Registered local update source: ${sourceConfigPath}`);
}

main().catch((err) => {
  console.error('Failed to write local update manifest:', err);
  process.exit(1);
});
