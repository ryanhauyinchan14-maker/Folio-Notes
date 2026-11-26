import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Radio, X } from 'lucide-react';
import type { Page } from '../../types/notes';
import { getCssFallbackZoomFactor } from '../../utils/uiZoom';
import { SlideElementNode } from './SlideElementNode';
import { resolveSlideBgStyle } from './SlideStageCanvas';

interface SlidePresentModeProps {
  open: boolean;
  pages: Page[];
  startIndex: number;
  onClose: () => void;
}

export const SlidePresentMode: React.FC<SlidePresentModeProps> = ({
  open,
  pages,
  startIndex,
  onClose,
}) => {
  const [index, setIndex] = useState(startIndex);
  const [laserEnabled, setLaserEnabled] = useState(false);
  const [notesOverlay, setNotesOverlay] = useState(false);
  const [laserPos, setLaserPos] = useState<{ x: number; y: number } | null>(null);
  const [stageScale, setStageScale] = useState(0.7);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!open) return;
    setIndex(Math.max(0, Math.min(pages.length - 1, startIndex)));
    setElapsedSec(0);
    if (typeof document !== 'undefined' && document.fullscreenEnabled) {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
    const timer = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => {
      window.clearInterval(timer);
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => {});
      }
    };
  }, [open, pages.length, startIndex]);

  const activeSlide = pages[index] ?? pages[0] ?? null;
  const slideW = activeSlide?.paper.width ?? 1920;
  const slideH = activeSlide?.paper.height ?? 1080;

  useEffect(() => {
    if (!open) return;
    const recompute = () => {
      const zoomFactor = getCssFallbackZoomFactor();
      const vw = Math.max(280, (window.innerWidth || 1280) / zoomFactor - 48);
      const vh = Math.max(200, (window.innerHeight || 720) / zoomFactor - 84);
      setStageScale(Math.min(vw / slideW, vh / slideH));
    };
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [open, slideW, slideH]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (
        e.key === 'ArrowRight' ||
        e.key === 'ArrowDown' ||
        e.key === ' ' ||
        e.key === 'Enter' ||
        e.key === 'PageDown'
      ) {
        e.preventDefault();
        setIndex((i) => Math.min(pages.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key.toLowerCase() === 'l') {
        setLaserEnabled((l) => !l);
      } else if (e.key.toLowerCase() === 'n') {
        setNotesOverlay((n) => !n);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose, pages.length]);

  if (!open || !activeSlide) return null;

  const slideData = activeSlide.slideData;
  const bg = slideData?.background ?? { kind: 'solid' as const, color: '#FFFFFF' };
  const transition = slideData?.transition ?? 'fade';
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const ss = String(elapsedSec % 60).padStart(2, '0');

  return (
    <div
      data-testid="slides-present-mode"
      onMouseMove={(e) => {
        if (laserEnabled) setLaserPos({ x: e.clientX, y: e.clientY });
      }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#05182E] select-none"
    >
      <div
        key={activeSlide.id}
        data-transition={transition}
        style={{
          width: `${Math.round(slideW * stageScale)}px`,
          height: `${Math.round(slideH * stageScale)}px`,
        }}
        className="relative overflow-hidden rounded-lg shadow-2xl transition-all duration-300"
      >
        <div
          style={{
            width: `${slideW}px`,
            height: `${slideH}px`,
            transform: `scale(${stageScale})`,
            transformOrigin: 'top left',
            ...resolveSlideBgStyle(bg),
          }}
          className="relative"
        >
          {[...(slideData?.elements ?? [])]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((el) => (
              <div
                key={el.id}
                style={{
                  left: `${el.x}px`,
                  top: `${el.y}px`,
                  width: `${el.width}px`,
                  height: `${el.height}px`,
                  transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                  opacity: el.opacity,
                  zIndex: el.zIndex,
                }}
                className="absolute"
              >
                <SlideElementNode element={el} />
              </div>
            ))}
        </div>
      </div>

      {notesOverlay && (
        <div className="folio-glass-island fixed bottom-20 left-1/2 z-50 max-w-xl -translate-x-1/2 rounded-2xl px-4 py-3 text-xs text-[var(--navy-900)]">
          <div className="mb-1 flex items-center justify-between gap-4 font-bold">
            <span>Speaker Notes</span>
            <span className="font-mono text-[var(--navy-600)]">{mm}:{ss}</span>
          </div>
          <p className="whitespace-pre-wrap">
            {slideData?.speakerNotes || 'No speaker notes for this slide.'}
          </p>
        </div>
      )}

      {laserEnabled && laserPos && (
        <div
          style={{ left: laserPos.x - 7, top: laserPos.y - 7 }}
          className="pointer-events-none fixed z-[60] h-3.5 w-3.5 rounded-full bg-[#FD6E88] shadow-[0_0_16px_4px_rgba(253,110,136,0.9)]"
        />
      )}

      {/* Presenter Floating Bar */}
      <div className="folio-glass-island fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold text-[var(--navy-900)]">
        <button
          type="button"
          data-testid="present-prev-btn"
          aria-label="Previous slide"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          className="rounded-full p-1.5 hover:bg-[var(--surface-tint)] disabled:opacity-35"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span data-testid="present-slide-counter" className="px-2 tabular-nums">
          {index + 1} / {pages.length}
        </span>
        <button
          type="button"
          data-testid="present-next-btn"
          aria-label="Next slide"
          disabled={index === pages.length - 1}
          onClick={() => setIndex((i) => Math.min(pages.length - 1, i + 1))}
          className="rounded-full p-1.5 hover:bg-[var(--surface-tint)] disabled:opacity-35"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="h-4 w-px bg-[var(--border-subtle)]" />
        <button
          type="button"
          title="Laser Pointer (L)"
          onClick={() => setLaserEnabled((l) => !l)}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${
            laserEnabled ? 'folio-glass-active' : 'hover:bg-[var(--surface-tint)]'
          }`}
        >
          <Radio className="h-3.5 w-3.5" />
          <span>Laser</span>
        </button>
        <button
          type="button"
          title="Speaker Notes (N)"
          onClick={() => setNotesOverlay((n) => !n)}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${
            notesOverlay ? 'folio-glass-active' : 'hover:bg-[var(--surface-tint)]'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          <span>Notes</span>
        </button>
        <button
          type="button"
          data-testid="present-exit-btn"
          aria-label="Exit Present Mode"
          onClick={onClose}
          className="folio-btn-crimson inline-flex items-center gap-1 rounded-full px-3 py-1"
        >
          <X className="h-3.5 w-3.5" />
          <span>Exit</span>
        </button>
      </div>
    </div>
  );
};
