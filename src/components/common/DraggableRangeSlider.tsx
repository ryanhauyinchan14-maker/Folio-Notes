import React, { useEffect, useRef, useState } from 'react';

interface DraggableRangeSliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  testId?: string;
  className?: string;
}

/**
 * Maps a horizontal pointer coordinate onto a snapped range value within `[min, max]`,
 * accounting for the visual thumb radius at both ends of the track.
 */
export function computeSliderValueFromClientX(
  clientX: number,
  rect: Pick<DOMRect, 'left' | 'width'>,
  min: number,
  max: number,
  step = 1,
): number {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  if (!(rect.width > 0) || !(max > min)) {
    return min;
  }

  const thumbRadius = Math.min(9, rect.width * 0.15);
  const trackLeft = rect.left + thumbRadius;
  const usableWidth = Math.max(1, rect.width - thumbRadius * 2);
  const ratio = Math.max(0, Math.min(1, (clientX - trackLeft) / usableWidth));

  const raw = min + ratio * (max - min);
  const snapped = min + Math.round((raw - min) / safeStep) * safeStep;
  const decimals = Math.max(0, (safeStep.toString().split('.')[1] ?? '').length);
  const rounded = Number(snapped.toFixed(decimals));
  return Math.max(min, Math.min(max, rounded));
}

export const DraggableRangeSlider: React.FC<DraggableRangeSliderProps> = ({
  min,
  max,
  step = 1,
  value,
  onChange,
  onCommit,
  onDragStart,
  onDragEnd,
  onBlur,
  disabled = false,
  ariaLabel,
  testId,
  className = '',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const rectSnapshotRef = useRef<{ left: number; width: number } | null>(null);
  const latestValueRef = useRef<number>(value);

  useEffect(() => {
    if (!draggingRef.current) {
      latestValueRef.current = value;
    }
  }, [value]);

  const span = max - min;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((value - min) / span) * 100)) : 0;

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (disabled || e.button !== 0) return;

    draggingRef.current = true;
    pointerIdRef.current = e.pointerId;
    latestValueRef.current = value;
    setIsDragging(true);
    onDragStart?.();

    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width > 0) {
      // Suppress native browser text selection / track quirks and track from locked rect
      e.preventDefault();
      e.currentTarget.focus({ preventScroll: true });
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Ignore synthetic environments without active pointer IDs
      }
      rectSnapshotRef.current = { left: rect.left, width: rect.width };
      const next = computeSliderValueFromClientX(e.clientX, rectSnapshotRef.current, min, max, step);
      latestValueRef.current = next;
      if (next !== value) {
        onChange(next);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLInputElement>) => {
    if (!draggingRef.current || pointerIdRef.current !== e.pointerId || !rectSnapshotRef.current) {
      return;
    }
    const next = computeSliderValueFromClientX(e.clientX, rectSnapshotRef.current, min, max, step);
    if (next !== latestValueRef.current) {
      latestValueRef.current = next;
      onChange(next);
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLInputElement>) => {
    if (!draggingRef.current) return;
    if (pointerIdRef.current !== null && pointerIdRef.current !== e.pointerId) {
      return;
    }

    const finalValue = latestValueRef.current;
    draggingRef.current = false;
    pointerIdRef.current = null;
    rectSnapshotRef.current = null;
    setIsDragging(false);

    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }
    } catch {
      // Ignore synthetic environments
    }

    onCommit?.(finalValue);
    onDragEnd?.();
  };

  const handleNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(e.target.value);
    if (!Number.isFinite(next)) return;
    latestValueRef.current = next;
    onChange(next);
    if (!draggingRef.current) {
      onCommit?.(next);
    }
  };

  return (
    <input
      type="range"
      data-testid={testId}
      data-dragging={isDragging ? 'true' : 'false'}
      aria-label={ariaLabel}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      value={value}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onBlur={onBlur}
      onChange={handleNativeChange}
      style={{ '--range-pct': `${pct}%` } as React.CSSProperties}
      className={`folio-range ${className}`.trim()}
    />
  );
};
