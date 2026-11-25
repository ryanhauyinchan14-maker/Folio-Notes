export const MIN_UI_SCALE = 0.75;
export const MAX_UI_SCALE = 1.5;
export const DEFAULT_UI_SCALE = 1.35;
export const UI_SCALE_WHEEL_STEP = 0.05;
export const UI_SCALE_KEY_STEP = 0.1;

export function clampUiScale(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_UI_SCALE;
  }
  const rounded = Math.round(value * 100) / 100;
  return Math.max(MIN_UI_SCALE, Math.min(MAX_UI_SCALE, rounded));
}

export function stepUiScale(current: number, delta: number): number {
  return clampUiScale(Math.round((current + delta) * 100) / 100);
}

/**
 * Applies whole-GUI zoom factor via Electron's native `webFrame.setZoomFactor` when running
 * inside Electron, or falls back smoothly to `document.documentElement.style.zoom` in web browsers.
 */
export function applyUiScaleToRuntime(scale: number): number {
  const clamped = clampUiScale(scale);

  if (typeof window !== 'undefined' && typeof window.folioDesktop?.setUiZoomFactor === 'function') {
    const applied = clampUiScale(window.folioDesktop.setUiZoomFactor(clamped));
    if (typeof document !== 'undefined') {
      const style = document.documentElement.style as CSSStyleDeclaration & { zoom?: string };
      style.zoom = '';
      document.documentElement.dataset.uiScale = String(applied);
    }
    return applied;
  }

  if (typeof document !== 'undefined') {
    const style = document.documentElement.style as CSSStyleDeclaration & { zoom?: string };
    style.zoom = clamped === 1 ? '' : String(clamped);
    document.documentElement.dataset.uiScale = String(clamped);
  }
  return clamped;
}

/**
 * Returns the active CSS `zoom` factor on `:root` when running outside Electron so `fixed`
 * cursor-tracking pills align accurately with pointer `clientX` / `clientY`.
 */
export function getCssFallbackZoomFactor(): number {
  if (typeof window !== 'undefined' && window.folioDesktop?.isElectron) {
    return 1;
  }
  if (typeof document !== 'undefined') {
    const raw = Number(document.documentElement.dataset.uiScale);
    if (Number.isFinite(raw) && raw > 0) {
      return raw;
    }
  }
  return 1;
}
