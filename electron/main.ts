import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from 'electron';
import {
  buildPrintDocumentHtml,
  type FolioPrinterInfo,
  type FolioPrintResult,
  validatePrintSheetsRequest,
} from './printCore';
import { parseWindowsFontRegistryOutput } from './systemFontsCore';
import { initHybridUpdater } from './updater';

const execFileAsync = promisify(execFile);

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
  '.woff': 'font/woff',
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

function isAllowedAiProxyUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:') return true;
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '::1' ||
        parsed.hostname === '[::1]')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function registerAiProxyIpc(): void {
  ipcMain.handle('ai:proxy-fetch', async (_event, rawReq: unknown) => {
    if (!rawReq || typeof rawReq !== 'object') {
      throw new Error('Invalid AI proxy fetch request payload.');
    }
    const req = rawReq as {
      url?: unknown;
      method?: unknown;
      headers?: unknown;
      body?: unknown;
      timeoutMs?: unknown;
    };

    const url = typeof req.url === 'string' ? req.url.trim() : '';
    if (!url || !isAllowedAiProxyUrl(url)) {
      throw new Error(
        'Blocked AI request URL: only HTTPS endpoints or http://localhost / 127.0.0.1 are permitted.',
      );
    }

    const method = req.method === 'GET' ? 'GET' : 'POST';
    const headers: Record<string, string> = {};
    if (req.headers && typeof req.headers === 'object') {
      for (const [k, v] of Object.entries(req.headers as Record<string, unknown>)) {
        if (typeof k === 'string' && typeof v === 'string') {
          headers[k] = v;
        }
      }
    }

    const body = typeof req.body === 'string' && method !== 'GET' ? req.body : undefined;
    const rawTimeout = typeof req.timeoutMs === 'number' && Number.isFinite(req.timeoutMs)
      ? req.timeoutMs
      : 60000;
    const timeoutMs = Math.max(1000, Math.min(120000, Math.round(rawTimeout)));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await net.fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      const bodyText = await resp.text();
      return {
        ok: resp.ok,
        status: resp.status,
        statusText: resp.statusText,
        bodyText,
      };
    } finally {
      clearTimeout(timer);
    }
  });
}

function registerFontsIpc(): void {
  let cachedSystemFonts: string[] | null = null;

  ipcMain.handle('fonts:list-system', async (): Promise<string[]> => {
    if (cachedSystemFonts) return cachedSystemFonts;
    if (process.platform !== 'win32') {
      cachedSystemFonts = [];
      return cachedSystemFonts;
    }

    const keys = [
      'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
      'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    ];
    const outputs: string[] = [];

    for (const key of keys) {
      try {
        const { stdout } = await execFileAsync('reg', ['query', key], {
          windowsHide: true,
          timeout: 4000,
          maxBuffer: 4 * 1024 * 1024,
        });
        if (stdout) outputs.push(stdout);
      } catch {
        // Ignore unavailable or empty per-user registry key
      }
    }

    cachedSystemFonts = parseWindowsFontRegistryOutput(outputs);
    return cachedSystemFonts;
  });
}

function registerWindowIpc(): void {
  ipcMain.handle('window:toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!win || win.isDestroyed()) return false;
    const next = !win.isFullScreen();
    win.setFullScreen(next);
    return next;
  });
}

function registerPrintIpc(): void {
  ipcMain.handle('print:get-printers', async (event): Promise<FolioPrinterInfo[]> => {
    try {
      const list = await event.sender.getPrintersAsync();
      return list.map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        description: p.description || '',
        isDefault: Boolean((p as { isDefault?: boolean }).isDefault),
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('print:execute', async (_event, rawReq: unknown): Promise<FolioPrintResult> => {
    let printWin: BrowserWindow | null = null;
    const tempHtmlPath = path.join(os.tmpdir(), `folio-print-${crypto.randomUUID()}.html`);
    try {
      const req = validatePrintSheetsRequest(rawReq);
      const html = buildPrintDocumentHtml(req);
      await fs.promises.writeFile(tempHtmlPath, html, 'utf8');

      printWin = new BrowserWindow({
        show: false,
        width: 900,
        height: 1100,
        backgroundColor: '#ffffff',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          javascript: false,
        },
      });

      await printWin.loadFile(tempHtmlPath);
      await new Promise((resolve) => setTimeout(resolve, 120));

      const activeWin = printWin;
      return await new Promise<FolioPrintResult>((resolve) => {
        activeWin.webContents.print(
          {
            silent: req.silent,
            printBackground: true,
            deviceName: req.deviceName || undefined,
            color: req.color,
            landscape: req.landscape,
            copies: req.copies,
            pageSize: req.pageSize,
            margins: { marginType: 'none' },
          },
          (success, failureReason) => {
            if (success) {
              resolve({ ok: true });
            } else {
              resolve({
                ok: false,
                error: failureReason || 'Printing was cancelled or failed.',
              });
            }
          },
        );
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to prepare print job.',
      };
    } finally {
      if (printWin && !printWin.isDestroyed()) {
        printWin.destroy();
      }
      try {
        await fs.promises.unlink(tempHtmlPath);
      } catch {
        // Ignore temp file cleanup errors
      }
    }
  });
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
    show: false,
    backgroundColor: '#f1f5f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.platform !== 'darwin') {
    win.removeMenu();
    win.setMenuBarVisibility(false);
  }

  win.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      !input.isAutoRepeat &&
      (input.key === 'F11' || input.code === 'F11') &&
      !input.control &&
      !input.alt &&
      !input.meta &&
      !input.shift
    ) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  win.once('ready-to-show', () => {
    if (!IS_SMOKE_CHECK) {
      win.show();
    }
  });

  if (IS_SMOKE_CHECK) {
    const consoleErrors: string[] = [];
    const cspWarnings: string[] = [];
    win.webContents.on('console-message', (details) => {
      if (details.level === 'error') {
        consoleErrors.push(details.message);
      }
      if (
        (details.level === 'error' || details.level === 'warning') &&
        /content security policy|\bcsp\b|refused to/i.test(details.message)
      ) {
        cspWarnings.push(details.message);
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
          const heroEl = document.querySelector('[data-testid="home-hero-banner"]');
          const shaderEl = document.querySelector('[data-testid="home-hero-shader"]');
          const canvasEl = shaderEl ? shaderEl.querySelector('canvas') : null;
          const shaderMode = shaderEl?.getAttribute('data-shader-mode') || '';
          const canvasWidth = canvasEl ? canvasEl.width : 0;
          const canvasHeight = canvasEl ? canvasEl.height : 0;
          const hasScrim = Boolean(heroEl && heroEl.querySelector('.folio-hero-scrim'));
          const shaderHeroCheck = {
            hasHeroEl: Boolean(heroEl),
            hasShaderEl: Boolean(shaderEl),
            shaderMode,
            hasCanvas: Boolean(canvasEl),
            canvasWidth,
            canvasHeight,
            hasScrim,
            ok:
              Boolean(heroEl && shaderEl && hasScrim) &&
              ((shaderMode === 'webgl' && canvasWidth > 0 && canvasHeight > 0) ||
                shaderMode === 'css-fallback'),
          };
          return {
            href: window.location.href,
            origin: window.location.origin,
            title: document.title,
            isSecureContext: window.isSecureContext,
            hasCryptoSubtle: typeof window.crypto?.subtle?.generateKey === 'function',
            hasIndexedDB: Boolean(window.indexedDB),
            hasFolioDesktop: Boolean(window.folioDesktop?.isElectron),
            hasUiZoomBridge:
              typeof window.folioDesktop?.setUiZoomFactor === 'function' &&
              typeof window.folioDesktop?.getUiZoomFactor === 'function',
            uiScale: window.folioDesktop?.getUiZoomFactor?.() ?? null,
            hasFullscreenBridge: typeof window.folioDesktop?.toggleFullscreen === 'function',
            hasAiProxyFetch: typeof window.folioDesktop?.aiFetch === 'function',
            hasUpdaterBridge:
              typeof window.folioDesktop?.updater?.getStatus === 'function' &&
              typeof window.folioDesktop?.updater?.restartAndInstall === 'function',
            hasPrintBridge:
              typeof window.folioDesktop?.print?.getPrinters === 'function' &&
              typeof window.folioDesktop?.print?.printSheets === 'function',
            hasFontsBridge:
              typeof window.folioDesktop?.fonts?.listSystemFonts === 'function',
            nodeLeaked: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
            rootChildren: document.getElementById('root')?.children.length ?? 0,
            bodyTextSample: (document.body?.innerText || '').slice(0, 120),
            pdfWorkerCheck,
            shaderHeroCheck,
          };
        })()`);
        const hasNoMenuBar =
          process.platform === 'darwin' ||
          (Menu.getApplicationMenu() === null && !win.isMenuBarVisible());
        console.log(
          'SMOKE_REPORT',
          JSON.stringify({ ...report, hasNoMenuBar, consoleErrors, cspWarnings }),
        );
        const workerOk =
          !workerFile ||
          (report.pdfWorkerCheck?.status === 200 &&
            String(report.pdfWorkerCheck?.contentType).toLowerCase().includes('javascript'));
        const ok =
          report.isSecureContext &&
          report.hasCryptoSubtle &&
          report.hasIndexedDB &&
          report.hasFolioDesktop &&
          report.hasUiZoomBridge &&
          report.hasFullscreenBridge &&
          win.isFullScreenable() &&
          report.hasAiProxyFetch &&
          report.hasUpdaterBridge &&
          report.hasPrintBridge &&
          hasNoMenuBar &&
          !report.nodeLeaked &&
          report.rootChildren > 0 &&
          workerOk &&
          Boolean(report.shaderHeroCheck?.ok) &&
          consoleErrors.length === 0 &&
          cspWarnings.length === 0;
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

  let cleanupUpdater: (() => void) | null = null;

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.folionotes.desktop');
    }
    if (process.platform !== 'darwin') {
      Menu.setApplicationMenu(null);
    }

    const distRoot = path.resolve(__dirname, '../dist');
    registerAppProtocol(distRoot);
    registerAiProxyIpc();
    registerWindowIpc();
    registerPrintIpc();
    registerFontsIpc();
    cleanupUpdater = initHybridUpdater({
      getMainWindow: () => mainWindow,
      isSmokeCheck: IS_SMOKE_CHECK,
    }).cleanup;

    mainWindow = createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  });

  app.on('before-quit', () => {
    cleanupUpdater?.();
    cleanupUpdater = null;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
