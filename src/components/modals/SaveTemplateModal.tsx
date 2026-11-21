import React, { useEffect, useMemo, useState } from 'react';
import { BookmarkCheck, X } from 'lucide-react';
import { generatePageThumbnail } from '../../canvas/thumbnail';
import { useAppStore } from '../../store/useAppStore';
import type { Page } from '../../types/notes';

interface SaveTemplateModalProps {
  open: boolean;
  page: Page | null;
  onClose: () => void;
}

export const SaveTemplateModal: React.FC<SaveTemplateModalProps> = ({
  open,
  page,
  onClose,
}) => {
  const saveCurrentPageAsTemplate = useAppStore((s) => s.saveCurrentPageAsTemplate);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const previewUrl = useMemo(() => {
    if (!open || !page) return '';
    return generatePageThumbnail(
      page.paper,
      page.strokes,
      280,
      page.textboxes ?? [],
      page.images ?? [],
    );
  }, [open, page]);

  useEffect(() => {
    if (open) {
      setName('');
      setSaving(false);
    }
  }, [open]);

  if (!open || !page) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await saveCurrentPageAsTemplate(
      page.id,
      name.trim() || `Custom Template (${page.paper.pattern})`,
    );
    setSaving(false);
    onClose();
  };

  return (
    <div
      className="folio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-template-title"
        className="folio-modal-card w-full max-w-md overflow-hidden rounded-2xl text-[#072D59]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#DBF2FC] text-[#072D59]">
              <BookmarkCheck className="h-4 w-4" />
            </div>
            <div>
              <h2 id="save-template-title" className="text-base font-bold text-[#072D59]">
                Save Current Page as Template
              </h2>
              <p className="text-xs text-[#072D59]/65">
                Captures paper style &amp; all {page.strokes.length} stroke
                {page.strokes.length === 1 ? '' : 's'} into My Templates
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Save Template modal"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#072D59]/55 transition duration-150 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 p-5">
          <div className="flex justify-center rounded-xl border border-[#072D59]/10 bg-[#DBF2FC]/30 p-4">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Template preview"
                className="max-h-52 rounded-sm shadow-md ring-1 ring-[#072D59]/12"
              />
            ) : (
              <div className="flex h-44 w-36 items-center justify-center rounded bg-white text-xs text-[#072D59]/45">
                Preview
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="template-name-input"
              className="mb-1.5 block text-sm font-bold text-[#072D59]"
            >
              Template Name
            </label>
            <input
              id="template-name-input"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Weekly Planner Layout"
              className="folio-input w-full rounded-xl px-3.5 py-2.5 text-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="folio-btn-secondary rounded-xl px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="folio-btn-crimson rounded-xl px-4 py-2 text-sm font-semibold shadow-xs disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save to My Templates'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
