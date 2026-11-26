export type DevicePlatform =
  | 'windows'
  | 'macos'
  | 'linux'
  | 'ios'
  | 'android'
  | 'other';

export interface BeforeInstallPromptEventLike extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/**
 * Detects the current OS or mobile device platform cleanly across browsers and Electron.
 */
export function detectDevicePlatform(
  userAgent?: string,
  platform?: string,
  maxTouchPoints?: number,
): DevicePlatform {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const ua = userAgent ?? nav?.userAgent ?? '';
  const plat = platform ?? nav?.platform ?? '';
  const touchPoints =
    maxTouchPoints ?? (typeof nav?.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0);

  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || /iPhone|iPad|iPod/i.test(plat)) return 'ios';
  // iPadOS Safari defaults to reporting "Macintosh" with touch points > 1
  if ((/Mac/i.test(ua) || /Mac/i.test(plat)) && touchPoints > 1) return 'ios';
  if (/Win/i.test(plat) || /Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(plat) || /Macintosh|Mac OS X/i.test(ua)) return 'macos';
  if (/Linux|X11|CrOS/i.test(plat) || /Linux|X11|CrOS/i.test(ua)) return 'linux';
  return 'other';
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(display-mode: standalone)').matches;
  }
  return false;
}

/**
 * Service workers should run on hosted HTTPS / localhost browser sessions,
 * never inside Electron (`app://`) or `file://` contexts.
 */
export function canRegisterServiceWorker(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (window.folioDesktop?.isElectron) return false;
  if (!('serviceWorker' in navigator)) return false;

  const { protocol, hostname } = window.location;
  if (protocol === 'https:') return true;
  if (
    protocol === 'http:' &&
    (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]')
  ) {
    return true;
  }
  return false;
}

export async function registerPwaServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!canRegisterServiceWorker()) return null;
  try {
    return await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch {
    return null;
  }
}

let deferredInstallPrompt: BeforeInstallPromptEventLike | null = null;
let installListenersInitialized = false;
const installSubscribers = new Set<() => void>();

function notifyInstallSubscribers(): void {
  for (const listener of installSubscribers) {
    listener();
  }
}

export function initPwaInstallPrompt(): void {
  if (typeof window === 'undefined' || installListenersInitialized) return;
  if (window.folioDesktop?.isElectron) return;
  installListenersInitialized = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEventLike;
    notifyInstallSubscribers();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    notifyInstallSubscribers();
  });
}

export function getCanInstallPwa(): boolean {
  if (typeof window !== 'undefined' && window.folioDesktop?.isElectron) return false;
  return deferredInstallPrompt !== null && !isStandalonePwa();
}

export function subscribePwaInstall(listener: () => void): () => void {
  installSubscribers.add(listener);
  return () => {
    installSubscribers.delete(listener);
  };
}

export async function triggerPwaInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredInstallPrompt) return 'unavailable';
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  notifyInstallSubscribers();
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    return choice.outcome;
  } catch {
    return 'dismissed';
  }
}
