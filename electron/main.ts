import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, net, protocol, shell } from 'electron';

const APP_SCHEME = 'app';
const APP_HOST = 'folio';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const IS_SMOKE_CHECK = process.env.FOLIO_SMOKE_CHECK === '1';

if (IS_SMOKE_CHECK) {
  app.setPath('userData', path.join(os.tmpdir(), 'folio-notes-smoke-check'));
}

// Must be called synchronously before app.whenReady() so Chromium grants
// Secure Context privileges (crypto.subtle, IndexedDB, localStorage) to app://
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
};

function isInsideDirectory(rootDir: string, targetPath: string): boolean {
  const rel = path.relative(rootDir, targetPath);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function registerAppProtocol(distRoot: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const reqUrl = new URL(request.url);
      let relPath = decodeURIComponent(reqUrl.pathname).replace(/^\/+/, '');
      if (!relPath) {
        relPath = 'index.html';
      }

      const candidate = path.resolve(distRoot, relPath);
      if (!isInsideDirectory(distRoot, candidate)) {
        return new Response('Forbidden', { status: 403 });
      }

      let fileToServe = candidate;
      const existsAsFile =
        fs.existsSync(fileToServe) && fs.statSync(fileToServe).isFile();

      if (!existsAsFile) {
        if (!path.extname(relPath)) {
          fileToServe = path.join(distRoot, 'index.html');
        } else {
          return new Response('Not Found', { status: 404 });
        }
      }

      const resp = await net.fetch(pathToFileURL(fileToServe).href);
      const ext = path.extname(fileToServe).toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime) {
        return resp;
      }

      const headers = new Headers(resp.headers);
      headers.set('content-type', mime);
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers,
      });
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
  });
}

function isAllowedInternalUrl(rawUrl: string, isDev: boolean): boolean {
  if (rawUrl.startsWith(APP_ORIGIN)) return true;
  if (isDev && rawUrl.startsWith(DEV_SERVER_URL)) return true;
  return false;
}

function createMainWindow(): BrowserWindow {
  const isDev =
    !app.isPackaged &&
    (process.argv.includes('--dev') || Boolean(process.env.VITE_DEV_SERVER_URL));

  const iconPath =
    process.platform === 'win32'
      ? path.resolve(__dirname, '../build/icon.ico')
      : path.resolve(__dirname, '../build/icon.png');

  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    title: 'Folio Notes',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#f1f5f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    if (!IS_SMOKE_CHECK) {
      win.show();
    }
  });

  if (IS_SMOKE_CHECK) {
    const consoleErrors: string[] = [];
    win.webContents.on('console-message', (details) => {
      if (details.level === 'error') {
        consoleErrors.push(details.message);
      }
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error('SMOKE_FAIL_LOAD', { code, desc, url });
      app.exit(1);
    });
    win.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 800));
        const assetsDir = path.resolve(__dirname, '../dist/assets');
        const workerFile = fs.existsSync(assetsDir)
          ? fs.readdirSync(assetsDir).find((f) => /^pdf\.worker.*\.mjs$/i.test(f)) ?? null
          : null;
        const report = await win.webContents.executeJavaScript(`(async () => {
          let pdfWorkerCheck = null;
          const workerFile = ${JSON.stringify(workerFile)};
          if (workerFile) {
            const res = await fetch('${APP_ORIGIN}/assets/' + encodeURIComponent(workerFile));
            pdfWorkerCheck = {
              file: workerFile,
              status: res.status,
              contentType: res.headers.get('content-type') || '',
            };
          }
          return {
            href: window.location.href,
            origin: window.location.origin,
            title: document.title,
            isSecureContext: window.isSecureContext,
            hasCryptoSubtle: typeof window.crypto?.subtle?.generateKey === 'function',
            hasIndexedDB: Boolean(window.indexedDB),
            hasFolioDesktop: Boolean(window.folioDesktop?.isElectron),
            nodeLeaked: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
            rootChildren: document.getElementById('root')?.children.length ?? 0,
            bodyTextSample: (document.body?.innerText || '').slice(0, 120),
            pdfWorkerCheck,
          };
        })()`);
        console.log('SMOKE_REPORT', JSON.stringify({ ...report, consoleErrors }));
        const workerOk =
          !workerFile ||
          (report.pdfWorkerCheck?.status === 200 &&
            String(report.pdfWorkerCheck?.contentType).toLowerCase().includes('javascript'));
        const ok =
          report.isSecureContext &&
          report.hasCryptoSubtle &&
          report.hasIndexedDB &&
          report.hasFolioDesktop &&
          !report.nodeLeaked &&
          report.rootChildren > 0 &&
          workerOk &&
          consoleErrors.length === 0;
        app.exit(ok ? 0 : 1);
      } catch (err) {
        console.error('SMOKE_EVAL_ERROR', err);
        app.exit(1);
      }
    });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, navigationUrl) => {
    if (isAllowedInternalUrl(navigationUrl, isDev)) return;
    event.preventDefault();
    if (navigationUrl.startsWith('https://')) {
      void shell.openExternal(navigationUrl);
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  const targetUrl = isDev ? DEV_SERVER_URL : `${APP_ORIGIN}/index.html`;
  void win.loadURL(targetUrl);

  return win;
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.folionotes.desktop');
    }

    const distRoot = path.resolve(__dirname, '../dist');
    registerAppProtocol(distRoot);

    mainWindow = createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
