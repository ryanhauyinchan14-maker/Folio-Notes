import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Plus, Trash2, X } from 'lucide-react';
import { generatePageThumbnail } from '../../canvas/thumbnail';
import {
  BUILT_IN_PAPER_PRESETS,
  BUILT_IN_WHITEBOARD_PRESETS,
  formatPaperPatternLabel,
} from '../../constants/papers';
import { useAppStore } from '../../store/useAppStore';
import type {
  BuiltInPaperPreset,
  NotebookMode,
  PageImage,
  PaperConfig,
  Stroke,
  Textbox,
} from '../../types/notes';
import { MorphingPill, useMorphingIndicator } from '../common/MorphingIndicator';

type GalleryTab = 'all' | 'whiteboards' | 'papers' | 'my-templates';

interface TemplatePickerModalProps {
  open: boolean;
  currentPaper: PaperConfig | null;
  onSelect: (
    paper: PaperConfig,
    strokes?: Stroke[],
    textboxes?: Textbox[],
    images?: PageImage[],
    meta?: { mode?: NotebookMode; title?: string },
  ) => void;
  onClose: () => void;
}

export const TemplatePickerModal: React.FC<TemplatePickerModalProps> = ({
  open,
  currentPaper,
  onSelect,
  onClose,
}) => {
  const customTemplates = useAppStore((s) => s.customTemplates);
  const deleteCustomTemplate = useAppStore((s) => s.deleteCustomTemplate);
  const allowWhiteboards = currentPaper === null;
  const visibleCustomTemplates = useMemo(
    () =>
      allowWhiteboards
        ? customTemplates
        : customTemplates.filter((t) => t.mode !== 'whiteboard'),
    [allowWhiteboards, customTemplates],
  );

  const [tab, setTab] = useState<GalleryTab>('all');
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const wasOpenRef = useRef(false);
  const tabTrackRef = useRef<HTMLDivElement | null>(null);
  const tabIndicator = useMorphingIndicator(
    tabTrackRef,
    open ? tab : null,
    [open, allowWhiteboards, visibleCustomTemplates.length],
  );

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setSelectedVariants({});
      if (allowWhiteboards) {
        setTab('all');
      } else {
        setTab(visibleCustomTemplates.length > 0 ? 'my-templates' : 'papers');
      }
    }
    wasOpenRef.current = open;
  }, [open, allowWhiteboards, visibleCustomTemplates.length]);

  const whiteboardsWithThumbnails = useMemo(() => {
    if (!open || !allowWhiteboards) return [];
    return BUILT_IN_WHITEBOARD_PRESETS.map((preset) => {
      const entries =
        preset.variants && preset.variants.length > 0
          ? preset.variants.map((v) => [v.id, generatePageThumbnail(v.paper, [], 220, [], [], null, true)] as const)
          : [[preset.id, generatePageThumbnail(preset.paper, [], 220, [], [], null, true)] as const];
      return {
        ...preset,
        thumbsByVariantId: Object.fromEntries(entries) as Record<string, string>,
      };
    });
  }, [open, allowWhiteboards]);

  const builtInWithThumbnails = useMemo(() => {
    if (!open) return [];
    return BUILT_IN_PAPER_PRESETS.map((preset) => {
      const entries =
        preset.variants && preset.variants.length > 0
          ? preset.variants.map((v) => [v.id, generatePageThumbnail(v.paper, [], 180)] as const)
          : [[preset.id, generatePageThumbnail(preset.paper, [], 180)] as const];
      return {
        ...preset,
        thumbsByVariantId: Object.fromEntries(entries) as Record<string, string>,
      };
    });
  }, [open]);

  if (!open) return null;

  const renderPresetCard = (
    preset: BuiltInPaperPreset & { thumbsByVariantId: Record<string, string> },
  ) => {
    const isBoard = preset.mode === 'whiteboard';
    const variants = preset.variants;
    const hasVariants = Boolean(variants && variants.length > 1);
    const activeVariant =
      (variants &&
        (variants.find((v) => v.id === selectedVariants[preset.id]) ?? variants[0])) ?? {
        id: preset.id,
        label: preset.name,
        fullName: preset.name,
        paper: preset.paper,
      };
    const activeThumb = preset.thumbsByVariantId[activeVariant.id] ?? '';
    const isLandscape = activeVariant.paper.orientation === 'landscape';

    return (
      <div
        key={preset.id}
        data-testid={`template-card-${preset.id}`}
        className="folio-cover-lift flex flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:-translate-y-0.5 hover:border-[var(--crimson-500)]/65 hover:shadow-[var(--shadow-card-hover)]"
      >
        <button
          type="button"
          data-testid={`template-preset-${preset.id}`}
          onClick={() => {
            onSelect(activeVariant.paper, [], [], [], {
              mode: preset.mode ?? 'notebook',
              title: activeVariant.fullName,
            });
            onClose();
          }}
          className="folio-press flex flex-1 flex-col text-left"
        >
          <div className="relative flex h-40 w-full items-center justify-center bg-[var(--surface-tint)] p-3">
            {activeThumb ? (
              <img
                src={activeThumb}
                alt={activeVariant.fullName}
                className="max-h-full rounded-xs shadow-sm ring-1 ring-[var(--border-subtle)]"
              />
            ) : (
              <div
                className={
                  isBoard
                    ? 'h-24 w-36 rounded shadow-xs'
                    : isLandscape
                      ? 'h-20 w-28 rounded shadow-xs'
                      : 'h-28 w-20 rounded shadow-xs'
                }
                style={{ backgroundColor: activeVariant.paper.paperColor || '#FFFFFF' }}
              />
            )}
          </div>
          <div className={hasVariants ? 'px-3 pt-2.5 pb-1.5' : 'p-3'}>
            <div className="text-xs font-bold text-[var(--navy-900)]">{preset.name}</div>
          </div>
        </button>

        {hasVariants && variants && (
          <div
            role="group"
            aria-label={`${preset.name} styles`}
            className="flex flex-wrap items-center gap-1.5 px-3 pt-0.5 pb-3"
          >
            {variants.map((variant) => {
              const isSelected = activeVariant.id === variant.id;
              return (
                <button
                  key={variant.id}
                  type="button"
                  data-testid={`template-variant-${variant.id}`}
                  aria-pressed={isSelected}
                  onClick={() =>
                    setSelectedVariants((prev) => ({
                      ...prev,
                      [preset.id]: variant.id,
                    }))
                  }
                  className={`folio-press inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                    isSelected
                      ? 'folio-glass-active'
                      : 'border border-[var(--border-subtle)] bg-[var(--surface-tint)] text-[var(--navy-700)] hover:border-[var(--navy-400)] hover:text-[var(--navy-900)]'
                  }`}
                >
                  {variant.swatchColor && (
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full border border-black/15"
                      style={{ backgroundColor: variant.swatchColor }}
                    />
                  )}
                  <span>{variant.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="folio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-picker-title"
        className="folio-modal-card flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl text-[var(--navy-900)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-seal)] text-[var(--navy-900)]">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <h2 id="template-picker-title" className="text-base font-bold text-[var(--navy-900)]">
                {currentPaper ? 'Add Page from Template' : 'Paper & Template Gallery'}
              </h2>
              <p className="text-xs text-[var(--navy-600)]">
                {allowWhiteboards
                  ? 'Start a whiteboard, paper, or saved template'
                  : 'Choose a built in paper or a saved template from My Templates'}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close template picker"
            onClick={onClose}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-600)] hover:bg-[var(--surface-seal)] hover:text-[var(--navy-900)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Quick Current Paper + Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-tint)] px-5 py-3">
          <div
            ref={tabTrackRef}
            className="folio-segmented-track flex flex-wrap rounded-xl p-0.5 tabular-nums"
          >
            <MorphingPill indicator={tabIndicator} className="rounded-lg" />
            {allowWhiteboards && (
              <>
                <button
                  type="button"
                  data-testid="template-tab-all"
                  data-morph-key="all"
                  onClick={() => setTab('all')}
                  className={`folio-press relative z-10 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    tab === 'all'
                      ? tabIndicator.ready
                        ? 'text-white'
                        : 'folio-glass-active'
                      : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                  }`}
                >
                  All ({BUILT_IN_WHITEBOARD_PRESETS.length + BUILT_IN_PAPER_PRESETS.length})
                </button>
                <button
                  type="button"
                  data-testid="template-tab-whiteboards"
                  data-morph-key="whiteboards"
                  onClick={() => setTab('whiteboards')}
                  className={`folio-press relative z-10 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    tab === 'whiteboards'
                      ? tabIndicator.ready
                        ? 'text-white'
                        : 'folio-glass-active'
                      : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                  }`}
                >
                  Whiteboards ({BUILT_IN_WHITEBOARD_PRESETS.length})
                </button>
                <button
                  type="button"
                  data-testid="template-tab-papers"
                  data-morph-key="papers"
                  onClick={() => setTab('papers')}
                  className={`folio-press relative z-10 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    tab === 'papers'
                      ? tabIndicator.ready
                        ? 'text-white'
                        : 'folio-glass-active'
                      : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                  }`}
                >
                  Built in Papers ({BUILT_IN_PAPER_PRESETS.length})
                </button>
                <button
                  type="button"
                  data-testid="template-tab-custom"
                  data-morph-key="my-templates"
                  onClick={() => setTab('my-templates')}
                  className={`folio-press relative z-10 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    tab === 'my-templates'
                      ? tabIndicator.ready
                        ? 'text-white'
                        : 'folio-glass-active'
                      : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                  }`}
                >
                  My Templates ({visibleCustomTemplates.length})
                </button>
              </>
            )}

            {!allowWhiteboards && (
              <>
                <button
                  type="button"
                  data-testid="template-tab-custom"
                  data-morph-key="my-templates"
                  onClick={() => setTab('my-templates')}
                  className={`folio-press relative z-10 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    tab === 'my-templates'
                      ? tabIndicator.ready
                        ? 'text-white'
                        : 'folio-glass-active'
                      : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                  }`}
                >
                  My Templates ({visibleCustomTemplates.length})
                </button>
                <button
                  type="button"
                  data-testid="template-tab-papers"
                  data-morph-key="papers"
                  onClick={() => setTab('papers')}
                  className={`folio-press relative z-10 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    tab === 'papers'
                      ? tabIndicator.ready
                        ? 'text-white'
                        : 'folio-glass-active'
                      : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                  }`}
                >
                  Built in Papers ({BUILT_IN_PAPER_PRESETS.length})
                </button>
              </>
            )}
          </div>

          {currentPaper && (
            <button
              type="button"
              onClick={() => {
                onSelect(currentPaper, []);
                onClose();
              }}
              className="folio-btn-crimson folio-press inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
            >
              <Plus className="h-3.5 w-3.5" />
              Same as Current Page
            </button>
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'my-templates' ? (
            visibleCustomTemplates.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--border-strong)] bg-[var(--surface-tint)] py-14 text-center">
                <p className="text-sm font-bold text-[var(--navy-900)]">
                  No saved templates in My Templates yet
                </p>
                <p className="mt-1 max-w-sm text-xs text-[var(--navy-600)]">
                  Use &ldquo;Customize Paper&rdquo; to save paper presets or &ldquo;Save Current
                  Page as Template&rdquo; to capture layouts and ink strokes.
                </p>
                <button
                  type="button"
                  onClick={() => setTab(allowWhiteboards ? 'all' : 'papers')}
                  className="folio-btn-navy folio-press mt-4 rounded-xl px-3.5 py-2 text-xs font-semibold"
                >
                  {allowWhiteboards ? 'Browse Built in Gallery' : 'Browse Built in Papers'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {visibleCustomTemplates.map((tpl) => {
                  const isBoard = tpl.mode === 'whiteboard';
                  return (
                    <div
                      key={tpl.id}
                      className="folio-cover-lift group relative flex flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:-translate-y-0.5 hover:border-[var(--crimson-500)]/65 hover:shadow-[var(--shadow-card-hover)]"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(tpl.paper, tpl.strokes, tpl.textboxes, tpl.images, {
                            mode: tpl.mode ?? 'notebook',
                            title: tpl.name,
                          });
                          onClose();
                        }}
                        className="flex flex-1 flex-col text-left"
                      >
                        <div className="relative flex h-40 items-center justify-center bg-[var(--surface-tint)] p-3">
                          {tpl.thumbnailDataUrl ? (
                            <img
                              src={tpl.thumbnailDataUrl}
                              alt={tpl.name}
                              className="max-h-full rounded-xs shadow-sm ring-1 ring-[var(--border-subtle)]"
                            />
                          ) : (
                            <div className="h-28 w-20 rounded bg-[var(--surface-elevated)] shadow-xs" />
                          )}
                        </div>
                        <div className="p-2.5">
                          <div className="truncate text-xs font-bold text-[var(--navy-900)]">
                            {tpl.name}
                          </div>
                          <div className="mt-0.5 text-[11px] font-medium text-[var(--navy-600)] tabular-nums">
                            {isBoard ? 'Whiteboard · ' : ''}
                            {formatPaperPatternLabel(tpl.paper.pattern)} ·{' '}
                            {tpl.strokes.length > 0
                              ? `${tpl.strokes.length} strokes`
                              : 'Saved style'}
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        title="Delete template"
                        aria-label={`Delete template ${tpl.name}`}
                        onClick={() => void deleteCustomTemplate(tpl.id)}
                        className="folio-press absolute right-2 top-2 rounded-lg bg-[var(--surface-elevated)]/95 p-1.5 text-[var(--navy-600)] opacity-0 shadow-xs hover:bg-[var(--state-danger-bg)] hover:text-[var(--state-danger-text)] group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          ) : tab === 'whiteboards' && allowWhiteboards ? (
            <div data-testid="gallery-whiteboards-section">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {whiteboardsWithThumbnails.map((preset) => renderPresetCard(preset))}
              </div>
            </div>
          ) : tab === 'all' && allowWhiteboards ? (
            <div className="space-y-6">
              <section data-testid="gallery-whiteboards-section">
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <h3 className="folio-section-label text-[var(--navy-900)]">Whiteboards</h3>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {whiteboardsWithThumbnails.map((preset) => renderPresetCard(preset))}
                </div>
              </section>

              <section data-testid="gallery-papers-section">
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <h3 className="folio-section-label text-[var(--navy-900)]">
                    Built in Papers
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {builtInWithThumbnails.map((preset) => renderPresetCard(preset))}
                </div>
              </section>
            </div>
          ) : (
            <div data-testid="gallery-papers-section">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {builtInWithThumbnails.map((preset) => renderPresetCard(preset))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
