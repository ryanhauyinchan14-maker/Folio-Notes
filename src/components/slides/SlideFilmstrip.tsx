import React from 'react';
import { ChevronLeft, ChevronRight, Copy, FileText, Plus, Trash2 } from 'lucide-react';
import type { Page } from '../../types/notes';
import { SlideElementNode } from './SlideElementNode';
import { resolveSlideBgStyle } from './SlideStageCanvas';

interface SlideFilmstripProps {
  pages: Page[];
  activePageId: string | null;
  speakerNotesOpen: boolean;
  speakerNotes: string;
  onToggleSpeakerNotes: () => void;
  onChangeSpeakerNotes: (notes: string) => void;
  onSelectSlide: (pageId: string) => void;
  onAddSlide: () => void;
  onDuplicateSlide: (pageId: string) => void;
  onMoveSlide: (index: number, delta: -1 | 1) => void;
  onDeleteSlide: (pageId: string) => void;
}

export const SlideFilmstrip: React.FC<SlideFilmstripProps> = ({
  pages,
  activePageId,
  speakerNotesOpen,
  speakerNotes,
  onToggleSpeakerNotes,
  onChangeSpeakerNotes,
  onSelectSlide,
  onAddSlide,
  onDuplicateSlide,
  onMoveSlide,
  onDeleteSlide,
}) => {
  return (
    <div
      data-testid="slides-filmstrip"
      className="z-20 shrink-0 border-t border-[var(--border-subtle)] bg-[var(--surface-glass)] backdrop-blur-md"
    >
      {speakerNotesOpen && (
        <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)]/90 px-4 py-2">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--navy-600)]">
            Speaker Notes (visible only to presenter)
          </div>
          <textarea
            data-testid="slides-speaker-notes"
            rows={2}
            value={speakerNotes}
            onChange={(e) => onChangeSpeakerNotes(e.target.value)}
            placeholder="Add speaker cues, timing notes, or talking points for this slide…"
            className="folio-input w-full resize-none rounded-xl px-3 py-1.5 text-xs"
          />
        </div>
      )}

      <div className="flex items-center gap-3 px-3 py-2">
        <div className="custom-scrollbar flex flex-1 items-center gap-2.5 overflow-x-auto py-1">
          {pages.map((p, idx) => {
            const active = p.id === activePageId;
            const slideW = Math.max(1, p.paper.width);
            const slideH = Math.max(1, p.paper.height);
            const thumbH = 62;
            const thumbW = Math.max(40, Math.min(132, Math.round((slideW / slideH) * thumbH)));
            const scale = thumbW / slideW;
            const bg = p.slideData?.background ?? { kind: 'solid' as const, color: '#FFFFFF' };

            return (
              <div
                key={p.id}
                data-testid={`slides-thumb-${idx + 1}`}
                className={`group relative shrink-0 rounded-xl border p-1 transition ${
                  active
                    ? 'border-[var(--crimson-500)] bg-[var(--surface-elevated)] ring-2 ring-[var(--crimson-glow)]'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)]/80 hover:border-[var(--border-strong)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectSlide(p.id)}
                  style={{ width: `${thumbW}px`, height: `${thumbH}px` }}
                  className="relative block overflow-hidden rounded-lg border border-[var(--border-subtle)]"
                >
                  <div
                    style={{
                      width: `${slideW}px`,
                      height: `${slideH}px`,
                      transform: `scale(${scale})`,
                      transformOrigin: 'top left',
                      ...resolveSlideBgStyle(bg),
                    }}
                    className="pointer-events-none relative"
                  >
                    {(p.slideData?.elements ?? []).map((el) => (
                      <div
                        key={el.id}
                        style={{
                          left: `${el.x}px`,
                          top: `${el.y}px`,
                          width: `${el.width}px`,
                          height: `${el.height}px`,
                          transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                          zIndex: el.zIndex,
                        }}
                        className="absolute"
                      >
                        <SlideElementNode element={el} />
                      </div>
                    ))}
                  </div>
                  <span className="folio-glass-badge absolute bottom-1 left-1 rounded px-1 text-[9px] font-bold tabular-nums">
                    {idx + 1}
                  </span>
                </button>

                <div className="mt-1 flex items-center justify-center gap-0.5 opacity-80 group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label={`Move slide ${idx + 1} left`}
                    disabled={idx === 0}
                    onClick={() => onMoveSlide(idx, -1)}
                    className="rounded p-0.5 hover:bg-[var(--surface-tint)] disabled:opacity-30"
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move slide ${idx + 1} right`}
                    disabled={idx === pages.length - 1}
                    onClick={() => onMoveSlide(idx, 1)}
                    className="rounded p-0.5 hover:bg-[var(--surface-tint)] disabled:opacity-30"
                  >
                    <ChevronRight className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Duplicate slide ${idx + 1}`}
                    onClick={() => onDuplicateSlide(p.id)}
                    className="rounded p-0.5 hover:bg-[var(--surface-tint)]"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  {pages.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Delete slide ${idx + 1}`}
                      onClick={() => onDeleteSlide(p.id)}
                      className="rounded p-0.5 text-[var(--state-danger-text)] hover:bg-[var(--state-danger-bg)]"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          <button
            type="button"
            data-testid="slides-add-btn"
            onClick={onAddSlide}
            className="folio-press flex h-[78px] w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-elevated)]/70 text-xs font-bold text-[var(--navy-900)] hover:border-[var(--crimson-500)] hover:bg-[var(--surface-elevated)]"
          >
            <Plus className="h-4 w-4 text-[var(--crimson-500)]" />
            <span>Add Slide</span>
          </button>
        </div>

        <button
          type="button"
          data-testid="slides-speaker-notes-toggle"
          aria-pressed={speakerNotesOpen}
          onClick={onToggleSpeakerNotes}
          className={`folio-press shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold ${
            speakerNotesOpen
              ? 'folio-glass-active'
              : 'border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Notes</span>
        </button>
      </div>
    </div>
  );
};
