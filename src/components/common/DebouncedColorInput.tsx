import React, { useEffect, useRef } from 'react';

export const COLOR_PICKER_DEBOUNCE_MS = 100;

export function normalizeColorInputHex(color: string): string {
  if (typeof color !== 'string') return '#072d59';
  const trimmed = color.trim();
  const hex6 = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (hex6) return `#${hex6[1].toLowerCase()}`;
  const hex3 = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (hex3) {
    const [r, g, b] = hex3[1].toLowerCase().split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '#072d59';
}

export interface DebouncedColorInputProps {
  value: string;
  disabled?: boolean;
  ariaLabel: string;
  testId?: string;
  className?: string;
  debounceMs?: number;
  onSessionStart?: () => void;
  onPreview: (color: string) => void;
  onCommit?: (color: string) => void;
}

/**
 * Uncontrolled native `<input type="color">` wrapper that stays silent while dragging
 * inside the OS/Chromium color picker and only applies a preview after the pointer
 * stops moving for `debounceMs` (default 100ms), then commits once on close.
 */
export const DebouncedColorInput: React.FC<DebouncedColorInputProps> = ({
  value,
  disabled = false,
  ariaLabel,
  testId,
  className,
  debounceMs = COLOR_PICKER_DEBOUNCE_MS,
  onSessionStart,
  onPreview,
  onCommit,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const sessionActiveRef = useRef(false);
  const pendingColorRef = useRef<string | null>(null);
  const lastPreviewedRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onSessionStart, onPreview, onCommit, debounceMs });
  callbacksRef.current = { onSessionStart, onPreview, onCommit, debounceMs };

  const normalizedValue = normalizeColorInputHex(value);

  useEffect(() => {
    const el = inputRef.current;
    if (!el || sessionActiveRef.current) return;
    if (el.value !== normalizedValue) {
      el.value = normalizedValue;
    }
  }, [normalizedValue]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const flushAndCommit = (explicitColor?: string) => {
      clearTimer();
      const finalColor = normalizeColorInputHex(
        explicitColor ?? pendingColorRef.current ?? el.value,
      );

      if (!sessionActiveRef.current) {
        sessionActiveRef.current = true;
        callbacksRef.current.onSessionStart?.();
      }
      if (finalColor !== lastPreviewedRef.current) {
        lastPreviewedRef.current = finalColor;
        callbacksRef.current.onPreview(finalColor);
      }

      sessionActiveRef.current = false;
      pendingColorRef.current = null;
      lastPreviewedRef.current = null;
      callbacksRef.current.onCommit?.(finalColor);
    };

    const handleInput = () => {
      if (!sessionActiveRef.current) {
        sessionActiveRef.current = true;
        callbacksRef.current.onSessionStart?.();
      }
      pendingColorRef.current = normalizeColorInputHex(el.value);
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const color = pendingColorRef.current;
        if (!color || color === lastPreviewedRef.current) return;
        lastPreviewedRef.current = color;
        callbacksRef.current.onPreview(color);
      }, callbacksRef.current.debounceMs);
    };

    const handleChange = () => {
      flushAndCommit(el.value);
    };

    const handleBlur = () => {
      if (sessionActiveRef.current) {
        flushAndCommit();
      }
    };

    el.addEventListener('input', handleInput);
    el.addEventListener('change', handleChange);
    el.addEventListener('blur', handleBlur);

    return () => {
      el.removeEventListener('input', handleInput);
      el.removeEventListener('change', handleChange);
      el.removeEventListener('blur', handleBlur);
      if (sessionActiveRef.current) {
        flushAndCommit();
      } else {
        clearTimer();
      }
    };
  }, []);

  return (
    <input
      ref={inputRef}
      type="color"
      defaultValue={normalizedValue}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
      className={className}
    />
  );
};
