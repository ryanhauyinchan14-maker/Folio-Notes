/// <reference types="vite/client" />
import type {
  FolioPrinterInfo,
  FolioPrintResult,
  FolioPrintSheetsRequest,
  PrintFitMode,
  PrintMarginsMode,
  PrintPaperSize,
} from '../electron/printCore';
import type { AppUpdateStatus, UpdatePhase, UpdateSource } from '../electron/updaterCore';

export type {
  AppUpdateStatus,
  FolioPrinterInfo,
  FolioPrintResult,
  FolioPrintSheetsRequest,
  PrintFitMode,
  PrintMarginsMode,
  PrintPaperSize,
  UpdatePhase,
  UpdateSource,
};

export interface AiProxyFetchRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface AiProxyFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  bodyText: string;
}

export interface FolioUpdaterBridge {
  getStatus: () => Promise<AppUpdateStatus>;
  checkNow: () => Promise<AppUpdateStatus>;
  restartAndInstall: () => Promise<{ ok: boolean; error?: string }>;
  setLocalConfig: (cfg: {
    enabled?: boolean;
    releaseDir?: string | null;
  }) => Promise<AppUpdateStatus>;
  pickLocalDir: () => Promise<AppUpdateStatus>;
  onStatusChanged: (callback: (status: AppUpdateStatus) => void) => () => void;
}

export interface FolioPrintBridge {
  getPrinters: () => Promise<FolioPrinterInfo[]>;
  printSheets: (req: FolioPrintSheetsRequest) => Promise<FolioPrintResult>;
}

export interface FolioFontsBridge {
  listSystemFonts: () => Promise<string[]>;
}

export interface FolioDesktopBridge {
  isElectron: true;
  platform: string;
  setUiZoomFactor: (factor: number) => number;
  getUiZoomFactor: () => number;
  toggleFullscreen?: () => Promise<boolean>;
  aiFetch: (req: AiProxyFetchRequest) => Promise<AiProxyFetchResponse>;
  print?: FolioPrintBridge;
  fonts?: FolioFontsBridge;
  updater?: FolioUpdaterBridge;
}

declare global {
  interface Window {
    folioDesktop?: FolioDesktopBridge;
  }
}
