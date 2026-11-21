import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Plus, Trash2, X } from 'lucide-react';
import { generatePageThumbnail } from '../../canvas/thumbnail';
import { BUILT_IN_PAPER_PRESETS } from '../../constants/papers';
import { useAppStore } from '../../store/useAppStore';
import type { PageImage, PaperConfig, Stroke, Textbox } from '../../types/notes';

interface TemplatePickerModalProps {
  open: boolean;
  currentPaper: PaperConfig | null;
  onSelect: (
    paper: PaperConfig,
    strokes?: Stroke[],
    textboxes?: Textbox[],
    images?: PageImage[],
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
  const [tab, setTab] = useState<'my-templates' | 'built-in'>('built-in');
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setTab(customTemplates.length > 0 ? 'my-templates' : 'built-in');
    }
    wasOpenRef.current = open;
  }, [open, customTemplates.length]);

  const builtInWithThumbnails = useMemo(() => {
    if (!open) return [];
    return BUILT_IN_PAPER_PRESETS.map((preset) => ({
      ...preset,
      thumb: generatePageThumbnail(preset.paper, [], 180),
    }));
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="folio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-picker-title"
        className="folio-modal-card flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl text-[#072D59]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#DBF2FC] text-[#072D59]">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <h2 id="template-picker-title" className="text-base font-bold text-[#072D59]">
                {currentPaper ? 'Add Page from Template' : 'Paper & Template Gallery'}
              </h2>
              <p className="text-xs text-[#072D59]/65">
                Choose a built-in paper or a saved template from My Templates
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close template picker"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#072D59]/55 transition duration-150 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Quick Current Paper + Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#072D59]/10 bg-[#DBF2FC]/22 px-5 py-3">
          <div className="flex rounded-xl border border-[#072D59]/12 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setTab('my-templates')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition duration-150 ${
                tab === 'my-templates'
                  ? 'bg-[#072D59] text-white'
                  : 'text-[#072D59]/75 hover:text-[#072D59]'
              }`}
            >
              My Templates ({customTemplates.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('built-in')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition duration-150 ${
                tab === 'built-in'
                  ? 'bg-[#072D59] text-white'
                  : 'text-[#072D59]/75 hover:text-[#072D59]'
              }`}
            >
              Built-in Papers ({BUILT_IN_PAPER_PRESETS.length})
            </button>
          </div>

          {currentPaper && (
            <button
              type="button"
              onClick={() => {
                onSelect(currentPaper, []);
                onClose();
              }}
              className="folio-btn-crimson inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
            >
              <Plus className="h-3.5 w-3.5" />
              Same as Current Page
            </button>
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'my-templates' ? (
            customTemplates.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#072D59]/18 bg-[#DBF2FC]/15 py-14 text-center">
                <p className="text-sm font-bold text-[#072D59]">
                  No saved templates in My Templates yet
                </p>
                <p className="mt-1 max-w-sm text-xs text-[#072D59]/65">
                  Use &ldquo;Customize Paper&rdquo; to save paper presets or &ldquo;Save Current
                  Page as Template&rdquo; to capture layouts and ink strokes.
                </p>
                <button
                  type="button"
                  onClick={() => setTab('built-in')}
                  className="folio-btn-navy mt-4 rounded-xl px-3.5 py-2 text-xs font-semibold"
                >
                  Browse Built-in Papers
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {customTemplates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="group relative flex flex-col overflow-hidden rounded-xl border border-[#072D59]/10 bg-white transition duration-150 hover:-translate-y-0.5 hover:border-[#FD6E88]/65 hover:shadow-md"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(tpl.paper, tpl.strokes, tpl.textboxes, tpl.images);
                        onClose();
                      }}
                      className="flex flex-1 flex-col text-left"
                    >
                      <div className="flex h-40 items-center justify-center bg-[#DBF2FC]/30 p-3">
                        {tpl.thumbnailDataUrl ? (
                          <img
                            src={tpl.thumbnailDataUrl}
                            alt={tpl.name}
                            className="max-h-full rounded-xs shadow-sm ring-1 ring-[#072D59]/10"
                          />
                        ) : (
                          <div className="h-28 w-20 rounded bg-white shadow-xs" />
                        )}
                      </div>
                      <div className="p-2.5">
                        <div className="truncate text-xs font-bold text-[#072D59]">
                          {tpl.name}
                        </div>
                        <div className="mt-0.5 text-[11px] font-medium text-[#072D59]/60 capitalize">
                          {tpl.paper.pattern} ·{' '}
                          {tpl.strokes.length > 0
                            ? `${tpl.strokes.length} strokes`
                            : 'Paper preset'}
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      title="Delete template"
                      aria-label={`Delete template ${tpl.name}`}
                      onClick={() => void deleteCustomTemplate(tpl.id)}
                      className="absolute right-2 top-2 rounded-lg bg-white/95 p-1.5 text-[#072D59]/50 opacity-0 shadow-xs transition duration-150 hover:text-[#F95573] group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {builtInWithThumbnails.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    onSelect(preset.paper, []);
                    onClose();
                  }}
                  className="flex flex-col overflow-hidden rounded-xl border border-[#072D59]/10 bg-white text-left transition duration-150 hover:-translate-y-0.5 hover:border-[#FD6E88]/65 hover:shadow-md"
                >
                  <div className="flex h-40 items-center justify-center bg-[#DBF2FC]/30 p-3">
                    {preset.thumb ? (
                      <img
                        src={preset.thumb}
                        alt={preset.name}
                        className="max-h-full rounded-xs shadow-sm ring-1 ring-[#072D59]/10"
                      />
                    ) : (
                      <div className="h-28 w-20 rounded bg-white" />
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-xs font-bold text-[#072D59]">{preset.name}</div>
                    <div className="mt-0.5 text-[11px] font-medium text-[#072D59]/60">
                      {preset.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
