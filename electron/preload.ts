import { contextBridge, type IpcRendererEvent, ipcRenderer, webFrame } from 'electron';
import type {
  FolioPrinterInfo,
  FolioPrintResult,
  FolioPrintSheetsRequest,
} from './printCore';
import type { AppUpdateStatus } from './updaterCore';

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 1.5;
const DEFAULT_ZOOM = 1.35;

function clampZoomFactor(factor: number): number {
  if (typeof factor !== 'number' || !Number.isFinite(factor)) return DEFAULT_ZOOM;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(factor * 100) / 100));
}

export interface AiProxyFetchRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

contextBridge.exposeInMainWorld('folioDesktop', {
  isElectron: true,
  platform: process.platform,
  setUiZoomFactor: (factor: number): number => {
    const clamped = clampZoomFactor(factor);
    webFrame.setZoomFactor(clamped);
    return clamped;
  },
  getUiZoomFactor: (): number => {
    return clampZoomFactor(webFrame.getZoomFactor());
  },
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-fullscreen'),
  aiFetch: (req: AiProxyFetchRequest) => ipcRenderer.invoke('ai:proxy-fetch', req),
  print: {
    getPrinters: (): Promise<FolioPrinterInfo[]> => ipcRenderer.invoke('print:get-printers'),
    printSheets: (req: FolioPrintSheetsRequest): Promise<FolioPrintResult> =>
      ipcRenderer.invoke('print:execute', req),
  },
  fonts: {
    listSystemFonts: (): Promise<string[]> => ipcRenderer.invoke('fonts:list-system'),
  },
  updater: {
    getStatus: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updater:get-status'),
    checkNow: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updater:check-now'),
    restartAndInstall: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('updater:restart-and-install'),
    setLocalConfig: (cfg: {
      enabled?: boolean;
      releaseDir?: string | null;
    }): Promise<AppUpdateStatus> => ipcRenderer.invoke('updater:set-local-config', cfg),
    pickLocalDir: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('updater:pick-local-dir'),
    onStatusChanged: (callback: (status: AppUpdateStatus) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, status: AppUpdateStatus) => {
        callback(status);
      };
      ipcRenderer.on('updater:status-changed', handler);
      return () => {
        ipcRenderer.removeListener('updater:status-changed', handler);
      };
    },
  },
});
