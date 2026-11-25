import React, { useLayoutEffect, useRef, useState } from 'react';

export type MorphingIndicatorKind = 'switch' | 'rect';

export interface MorphingIndicatorState {
  left: number;
  top: number;
  width: number;
  height: number;
  ready: boolean;
  transitionsArmed: boolean;
}

function measureOffsetRelativeToContainer(
  target: HTMLElement,
  container: HTMLElement,
): { left: number; top: number; width: number; height: number } {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = target;

  while (node && node !== container) {
    left += node.offsetLeft;
    top += node.offsetTop;
    const parent = node.offsetParent as HTMLElement | null;
    if (!parent) break;
    if (parent !== container && !container.contains(parent)) {
      if (parent === container.offsetParent) {
        left -= container.offsetLeft;
        top -= container.offsetTop;
      }
      break;
    }
    node = parent;
  }

  return {
    left,
    top,
    width: target.offsetWidth,
    height: target.offsetHeight,
  };
}

/**
 * Tracks an active descendant `[data-morph-key]` element inside `trackRef`
 * strictly via offsetLeft/offsetTop/offsetWidth/offsetHeight so the sliding pill
 * stays aligned inside horizontally scrollable bars and transformed modals.
 */
export function useMorphingIndicator(
  trackRef: React.RefObject<HTMLElement | null>,
  activeKey: string | null | undefined,
  deps: ReadonlyArray<unknown> = [],
): MorphingIndicatorState {
  const [state, setState] = useState<MorphingIndicatorState>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    ready: false,
    transitionsArmed: false,
  });
  const armRafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const container = trackRef.current;
    if (!container || !activeKey) {
      setState((prev) =>
        prev.ready ? { ...prev, ready: false, transitionsArmed: false } : prev,
      );
      return;
    }

    const findTarget = (): HTMLElement | null => {
      const candidates = container.querySelectorAll<HTMLElement>('[data-morph-key]');
      for (const candidate of candidates) {
        if (candidate.dataset.morphKey === activeKey) {
          return candidate;
        }
      }
      return null;
    };

    const measure = () => {
      const target = findTarget();
      if (!target) {
        setState((prev) => (prev.ready ? { ...prev, ready: false } : prev));
        return;
      }
      const next = measureOffsetRelativeToContainer(target, container);
      if (next.width <= 0 || next.height <= 0) {
        setState((prev) => (prev.ready ? { ...prev, ready: false } : prev));
        return;
      }

      setState((prev) => {
        const unchanged =
          prev.ready &&
          Math.abs(prev.left - next.left) < 0.5 &&
          Math.abs(prev.top - next.top) < 0.5 &&
          Math.abs(prev.width - next.width) < 0.5 &&
          Math.abs(prev.height - next.height) < 0.5;
        if (unchanged) return prev;
        return {
          ...next,
          ready: true,
          transitionsArmed: prev.transitionsArmed,
        };
      });
    };

    measure();

    const targetEl = findTarget();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(container);
      if (targetEl) ro.observe(targetEl);
    }
    window.addEventListener('resize', measure);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, ...deps]);

  // Arm spring CSS transitions one animation frame after initial measurement so mount never flashes from (0, 0).
  useLayoutEffect(() => {
    if (!state.ready || state.transitionsArmed) return;
    armRafRef.current = window.requestAnimationFrame(() => {
      armRafRef.current = null;
      setState((prev) =>
        prev.ready && !prev.transitionsArmed ? { ...prev, transitionsArmed: true } : prev,
      );
    });
    return () => {
      if (armRafRef.current !== null) {
        window.cancelAnimationFrame(armRafRef.current);
        armRafRef.current = null;
      }
    };
  }, [state.ready, state.transitionsArmed]);

  return state;
}

interface MorphingPillProps {
  indicator: MorphingIndicatorState;
  className?: string;
}

export const MorphingPill: React.FC<MorphingPillProps> = ({
  indicator,
  className = 'rounded-lg',
}) => {
  if (!indicator.ready) return null;

  return (
    <span
      aria-hidden="true"
      data-testid="morphing-active-pill"
      className={`folio-morph-pill pointer-events-none absolute left-0 top-0 z-0 ${className}`}
      style={{
        width: `${indicator.width}px`,
        height: `${indicator.height}px`,
        transform: `translate3d(${indicator.left}px, ${indicator.top}px, 0)`,
        transition: indicator.transitionsArmed ? undefined : 'none',
      }}
    />
  );
};
