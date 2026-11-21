import React, { useEffect, useState } from 'react';
import { BookOpen, ImagePlus, Palette, X } from 'lucide-react';
import { COVER_PRESETS } from '../../constants/covers';
import { BUILT_IN_PAPER_PRESETS, DEFAULT_PAPER_CONFIG } from '../../constants/papers';
import { repository } from '../../db/repository';
import { useAppStore } from '../../store/useAppStore';
import type {
  CoverConfig,
  Folder,
  Notebook,
  PageImage,
  PaperConfig,
  Stroke,
  Textbox,
} from '../../types/notes';
import { CoverPreview } from '../shelf/CoverPreview';

interface NotebookModalProps {
  open: boolean;
  editingNotebook?: Notebook | null;
  defaultFolderId: string | null;
  onClose: () => void;
}

async function resizeImageToDataUrl(file: File, maxW = 420, maxH = 540): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Could not decode cover image'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export const NotebookModal: React.FC<NotebookModalProps> = ({
  open,
  editingNotebook,
  defaultFolderId,
  onClose,
}) => {
  const customTemplates = useAppStore((s) => s.customTemplates);
  const createNotebook = useAppStore((s) => s.createNotebook);
  const updateNotebookMeta = useAppStore((s) => s.updateNotebookMeta);
  const defaultPaperPattern = useAppStore((s) => s.defaultPaperPattern);

  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  const [allFolders, setAllFolders] = useState<Folder[]>([]);
  const [cover, setCover] = useState<CoverConfig>({ ...COVER_PRESETS[0].cover });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    BUILT_IN_PAPER_PRESETS[0].id,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void repository.getAllFolders().then(setAllFolders);

    if (editingNotebook) {
      setTitle(editingNotebook.title);
      setFolderId(editingNotebook.folderId);
      setCover({ ...editingNotebook.cover });
    } else {
      const preferredPreset =
        BUILT_IN_PAPER_PRESETS.find((b) => b.paper.pattern === defaultPaperPattern) ??
        BUILT_IN_PAPER_PRESETS[0];
      setTitle('');
      setFolderId(defaultFolderId);
      setCover({ ...COVER_PRESETS[0].cover });
      setSelectedTemplateId(preferredPreset.id);
    }
    setSaving(false);
  }, [open, editingNotebook, defaultFolderId, defaultPaperPattern]);

  if (!open) return null;

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setCover({
        styleId: 'custom-image',
        primaryColor: '#334155',
        accentColor: '#94A3B8',
        pattern: 'solid',
        customImageDataUrl: dataUrl,
      });
    } catch {
      // Ignore malformed image uploads
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const finalTitle = title.trim() || 'Untitled Notebook';

    if (editingNotebook) {
      await updateNotebookMeta(editingNotebook.id, {
        title: finalTitle,
        folderId,
        cover,
      });
      setSaving(false);
      onClose();
      return;
    }

    let paper: PaperConfig = DEFAULT_PAPER_CONFIG;
    let initialStrokes: Stroke[] = [];
    let initialTextboxes: Textbox[] = [];
    let initialImages: PageImage[] = [];

    const customTpl = customTemplates.find((t) => t.id === selectedTemplateId);
    if (customTpl) {
      paper = customTpl.paper;
      initialStrokes = customTpl.strokes;
      initialTextboxes = customTpl.textboxes ?? [];
      initialImages = customTpl.images ?? [];
    } else {
      const builtIn = BUILT_IN_PAPER_PRESETS.find((b) => b.id === selectedTemplateId);
      if (builtIn) {
        paper = builtIn.paper;
      }
    }

    await createNotebook({
      title: finalTitle,
      folderId,
      cover,
      paper,
      initialStrokes,
      initialTextboxes,
      initialImages,
      openImmediately: true,
    });
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
        aria-labelledby="notebook-modal-title"
        className="folio-modal-card flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl text-[#072D59]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#DBF2FC] text-[#072D59]">
              <BookOpen className="h-4 w-4" />
            </div>
            <div>
              <h2 id="notebook-modal-title" className="text-base font-bold text-[#072D59]">
                {editingNotebook ? 'Edit Notebook' : 'Create New Notebook'}
              </h2>
              <p className="text-xs text-[#072D59]/65">
                Choose a custom cover, folder, and starting paper template
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close notebook modal"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#072D59]/55 transition duration-150 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="grid flex-1 gap-6 overflow-y-auto p-5 md:grid-cols-[180px_1fr]">
            {/* Cover Live Preview */}
            <div className="flex flex-col items-center">
              <CoverPreview
                cover={cover}
                title={title || 'Untitled Notebook'}
                className="h-56 w-40"
              />
              <span className="mt-2.5 text-xs font-medium text-[#072D59]/60">Cover Preview</span>
            </div>

            {/* Form Controls */}
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="notebook-title-input"
                  className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65"
                >
                  Notebook Title
                </label>
                <input
                  id="notebook-title-input"
                  type="text"
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Physics Lecture Notes"
                  className="folio-input w-full rounded-xl px-3.5 py-2 text-sm"
                />
              </div>

              <div>
                <label
                  htmlFor="notebook-folder-select"
                  className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65"
                >
                  Folder Location
                </label>
                <select
                  id="notebook-folder-select"
                  value={folderId ?? ''}
                  onChange={(e) => setFolderId(e.target.value || null)}
                  className="folio-input w-full rounded-xl px-3 py-2 text-sm"
                >
                  <option value="">All Notes (Root)</option>
                  {allFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Cover Picker */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wide text-[#072D59]/65">
                    Cover Style
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="folio-btn-secondary inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold">
                      <Palette className="h-3 w-3 text-[#FD6E88]" />
                      Custom Color
                      <input
                        type="color"
                        aria-label="Custom cover color"
                        value={cover.primaryColor}
                        onChange={(e) =>
                          setCover({
                            styleId: 'custom-color',
                            primaryColor: e.target.value,
                            accentColor: '#FFFFFF',
                            pattern: 'spine-band',
                          })
                        }
                        className="sr-only"
                      />
                    </label>
                    <label className="folio-btn-secondary inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold">
                      <ImagePlus className="h-3 w-3 text-[#072D59]" />
                      Upload Image
                      <input
                        type="file"
                        accept="image/*"
                        aria-label="Upload custom cover image"
                        onChange={handleImageUpload}
                        className="sr-only"
                      />
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {COVER_PRESETS.map((preset) => {
                    const active = cover.styleId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        title={preset.name}
                        aria-label={`Select cover ${preset.name}`}
                        onClick={() => setCover({ ...preset.cover })}
                        className={`flex flex-col items-center rounded-xl border p-1.5 transition duration-150 ${
                          active
                            ? 'border-[#FD6E88] bg-[#DBF2FC]/45 ring-2 ring-[#FD6E88]/25'
                            : 'border-[#072D59]/12 hover:border-[#072D59]/30'
                        }`}
                      >
                        <CoverPreview cover={preset.cover} compact className="h-12 w-9" />
                        <span className="mt-1 w-full truncate text-center text-[10px] font-semibold text-[#072D59]/75">
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Paper Template (only when creating) */}
              {!editingNotebook && (
                <div>
                  <label
                    htmlFor="notebook-template-select"
                    className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65"
                  >
                    Starting Paper / Template
                  </label>
                  <select
                    id="notebook-template-select"
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    className="folio-input w-full rounded-xl px-3 py-2 text-sm"
                  >
                    <optgroup label="Built-in Papers">
                      {BUILT_IN_PAPER_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {p.description}
                        </option>
                      ))}
                    </optgroup>
                    {customTemplates.length > 0 && (
                      <optgroup label="My Templates">
                        {customTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.paper.pattern}
                            {t.strokes.length > 0 ? `, ${t.strokes.length} strokes` : ''})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="folio-modal-footer flex items-center justify-end gap-2 px-5 py-3.5">
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
              {saving
                ? 'Saving...'
                : editingNotebook
                  ? 'Save Changes'
                  : 'Create Notebook'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
