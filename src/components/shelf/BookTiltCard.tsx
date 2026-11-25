import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { Notebook } from '../../types/notes';
import { CoverPreview } from './CoverPreview';

interface BookTiltCardProps {
  notebook: Notebook;
  index: number;
  relativeUpdatedLabel: string;
  menuOpen: boolean;
  opening?: boolean;
  onOpen: () => void;
  onToggleMenu: () => void;
  menuNode?: React.ReactNode;
}

export const BookTiltCard: React.FC<BookTiltCardProps> = ({
  notebook,
  index,
  relativeUpdatedLabel,
  menuOpen,
  opening = false,
  onOpen,
  onToggleMenu,
  menuNode,
}) => {
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  const tiltVisualRef = useRef<HTMLDivElement | null>(null);
  const sheenRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pressingRef = useRef(false);
  const lastTiltRef = useRef({ rx: 0, ry: 0, mx: 50, my: 35, active: false });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const writeVisualTransform = useCallback(
    (rx: number, ry: number, mx: number, my: number, active: boolean, pressed: boolean) => {
      const visualEl = tiltVisualRef.current;
      if (visualEl) {
        if (pressed) {
          visualEl.style.transform =
            'rotateX(0deg) rotateY(0deg) translateY(-1px) scale(0.985)';
          visualEl.style.transition = 'transform 110ms cubic-bezier(0.22, 1, 0.36, 1)';
        } else if (active) {
          visualEl.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) translateY(-4px) scale(1)`;
          visualEl.style.transition = 'transform 90ms cubic-bezier(0.22, 1, 0.36, 1)';
        } else {
          visualEl.style.transform = 'rotateX(0deg) rotateY(0deg) translateY(0px) scale(1)';
          visualEl.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
        }
      }

      const sheenEl = sheenRef.current;
      if (sheenEl) {
        const showSheen = active && !pressed;
        sheenEl.style.opacity = showSheen ? '1' : '0';
        if (showSheen) {
          sheenEl.style.background = `radial-gradient(circle at ${mx}% ${my}%, rgba(255, 255, 255, 0.42) 0%, rgba(219, 242, 252, 0.14) 34%, transparent 66%)`;
        }
      }
    },
    [],
  );

  const resetVisualTilt = useCallback(() => {
    if (rafRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pressingRef.current = false;
    lastTiltRef.current = { rx: 0, ry: 0, mx: 50, my: 35, active: false };
    writeVisualTransform(0, 0, 50, 35, false, false);
  }, [writeVisualTransform]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  // Guardrail #3: Pause 3D tilt cleanly while the popover menu is open or reduced motion is requested
  useEffect(() => {
    if (menuOpen || reducedMotion) {
      resetVisualTilt();
    }
  }, [menuOpen, reducedMotion, resetVisualTilt]);

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (
      menuOpen ||
      reducedMotion ||
      e.pointerType === 'touch' ||
      pressingRef.current ||
      e.buttons !== 0
    ) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const px = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const py = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const ry = Number(((px - 0.5) * 14).toFixed(2));
    const rx = Number(((0.5 - py) * 14).toFixed(2));
    const mx = Math.round(px * 100);
    const my = Math.round(py * 100);

    lastTiltRef.current = { rx, ry, mx, my, active: true };
    if (rafRef.current === null && typeof window !== 'undefined') {
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        if (menuOpen || reducedMotion || pressingRef.current) return;
        const t = lastTiltRef.current;
        writeVisualTransform(t.rx, t.ry, t.mx, t.my, t.active, false);
      });
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || reducedMotion) return;
    if (rafRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pressingRef.current = true;
    const t = lastTiltRef.current;
    writeVisualTransform(t.rx, t.ry, t.mx, t.my, t.active, true);
  };

  const handlePointerUpOrCancel = () => {
    if (!pressingRef.current) return;
    pressingRef.current = false;
    if (menuOpen || reducedMotion) {
      resetVisualTilt();
      return;
    }
    const t = lastTiltRef.current;
    writeVisualTransform(t.rx, t.ry, t.mx, t.my, t.active, false);
  };

  const handlePointerLeave = () => {
    resetVisualTilt();
  };

  return (
    <div
      data-testid={`book-tilt-card-${notebook.id}`}
      data-menu-open={menuOpen ? 'true' : 'false'}
      style={{ animationDelay: `${Math.min(index * 28, 220)}ms` }}
      className={`folio-card-enter group relative flex flex-col ${
        menuOpen ? 'z-40' : 'z-0 hover:z-10'
      }`}
    >
      {/* Stationary outer button prevents 3D CSS transforms / active-scale shrink from dropping clicks */}
      <button
        type="button"
        draggable={false}
        data-testid={`book-card-open-surface-${notebook.id}`}
        aria-label={`${notebook.isLocked ? 'Unlock' : 'Open'} ${notebook.title}`}
        aria-busy={opening ? 'true' : undefined}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        onPointerLeave={handlePointerLeave}
        onClick={onOpen}
        style={{ perspective: '920px' }}
        className="relative block aspect-[3/4] w-full cursor-pointer touch-manipulation select-none rounded-2xl text-left focus-visible:outline-2 focus-visible:outline-[var(--crimson-500)]"
      >
        <div
          ref={tiltVisualRef}
          data-testid={`book-card-visual-${notebook.id}`}
          className={`pointer-events-none relative h-full w-full ${opening ? 'opacity-80' : ''}`}
          style={{
            transform: 'rotateX(0deg) rotateY(0deg) translateY(0px) scale(1)',
            transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <CoverPreview
            cover={notebook.cover}
            title={notebook.title}
            mode={notebook.mode}
            locked={Boolean(notebook.isLocked)}
            className="h-full w-full"
          />
          <div
            ref={sheenRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-25 rounded-2xl transition-opacity duration-200"
            style={{ opacity: 0 }}
          />
        </div>
      </button>

      {/* Metadata Row — entire title + subtitle region is clickable */}
      <div className="mt-2.5 flex items-start justify-between gap-1 px-0.5">
        <button
          type="button"
          draggable={false}
          data-testid={`book-card-meta-open-${notebook.id}`}
          onClick={onOpen}
          className="group/meta min-w-0 flex-1 cursor-pointer touch-manipulation select-none rounded-lg text-left focus-visible:outline-2 focus-visible:outline-[var(--crimson-500)]"
        >
          <div className="block w-full truncate text-sm font-bold text-[var(--navy-900)] transition duration-150 group-hover/meta:text-[var(--crimson-500)]">
            {notebook.title}
          </div>
          <div className="text-[11px] font-medium text-[var(--navy-600)] tabular-nums">
            {notebook.mode === 'whiteboard'
              ? 'Whiteboard'
              : `${notebook.pageOrder.length} page${notebook.pageOrder.length === 1 ? '' : 's'}`}{' '}
            · {relativeUpdatedLabel}
          </div>
        </button>

        <button
          type="button"
          aria-label={`Notebook options for ${notebook.title}`}
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMenu();
          }}
          className="folio-press rounded-lg p-1 text-[var(--navy-600)] opacity-85 hover:bg-[var(--surface-elevated)] hover:text-[var(--navy-900)] group-hover:opacity-100"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      {/* Menu Popover renders OUTSIDE transformed cover layer so it sits cleanly above neighbors */}
      {menuNode}
    </div>
  );
};
