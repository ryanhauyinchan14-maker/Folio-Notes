import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, FileText, ImagePlus, Palette, Presentation, X } from 'lucide-react';
import { DEFAULT_WHITEBOARD_PAPER } from '../../canvas/whiteboard';
import { COVER_PRESETS } from '../../constants/covers';
import {
  ALL_BUILT_IN_PAPER_VARIANTS,
  DEFAULT_PAPER_CONFIG,
  formatPaperPatternLabel,
} from '../../constants/papers';
import { repository } from '../../db/repository';
import {
  DEFAULT_SLIDE_SIZE_PRESET,
  SLIDE_SIZE_PRESETS,
  resolveSlidePaperConfig,
} from '../../slides/slidePresets';
import { useAppStore } from '../../store/useAppStore';
import type {
  CoverConfig,
  Folder,
  Notebook,
  NotebookMode,
  PageImage,
  PaperConfig,
  PaperPattern,
  SlideSizePresetId,
  Stroke,
  Textbox,
} from '../../types/notes';
import { MorphingPill, useMorphingIndicator } from '../common/MorphingIndicator';
import { PaperShaderBackdrop } from '../common/PaperShaderBackdrop';
import { CoverPreview } from '../shelf/CoverPreview';

interface NotebookModalProps {
  open: boolean;
  editingNotebook?: Notebook | null;
  initialMode?: NotebookMode;
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
  initialMode = 'notebook',
  defaultFolderId,
  onClose,
}) => {
  const customTemplates = useAppStore((s) => s.customTemplates);
  const createNotebook = useAppStore((s) => s.createNotebook);
  const updateNotebookMeta = useAppStore((s) => s.updateNotebookMeta);
  const defaultPaperPattern = useAppStore((s) => s.defaultPaperPattern);
  const defaultSlideSizePreset = useAppStore((s) => s.defaultSlideSizePreset);

  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<NotebookMode>(initialMode);
  const [boardPattern, setBoardPattern] = useState<'dotted' | 'grid' | 'blank'>('dotted');
  const [slideSizePreset, setSlideSizePreset] = useState<SlideSizePresetId>(
    defaultSlideSizePreset || DEFAULT_SLIDE_SIZE_PRESET,
  );
  const [customSlideWidth, setCustomSlideWidth] = useState(1920);
  const [customSlideHeight, setCustomSlideHeight] = useState(1080);
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  const [allFolders, setAllFolders] = useState<Folder[]>([]);
  const [cover, setCover] = useState<CoverConfig>({ ...COVER_PRESETS[0].cover });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    ALL_BUILT_IN_PAPER_VARIANTS[0].id,
  );
  const [saving, setSaving] = useState(false);
  const modeTrackRef = useRef<HTMLDivElement | null>(null);
  const modeIndicator = useMorphingIndicator(
    modeTrackRef,
    open && !editingNotebook ? mode : null,
    [open, editingNotebook],
  );

  useEffect(() => {
    if (!open) return;
    void repository.getAllFolders().then(setAllFolders);

    if (editingNotebook) {
      setTitle(editingNotebook.title);
      setMode(editingNotebook.mode ?? 'notebook');
      setFolderId(editingNotebook.folderId);
      setCover({ ...editingNotebook.cover });
    } else {
      const preferredPreset =
        ALL_BUILT_IN_PAPER_VARIANTS.find((b) => b.paper.pattern === defaultPaperPattern) ??
        ALL_BUILT_IN_PAPER_VARIANTS[0];
      setTitle('');
      setMode(initialMode);
      setBoardPattern('dotted');
      setSlideSizePreset(defaultSlideSizePreset || DEFAULT_SLIDE_SIZE_PRESET);
      setCustomSlideWidth(1920);
      setCustomSlideHeight(1080);
      setFolderId(defaultFolderId);
      setCover({ ...COVER_PRESETS[0].cover });
      setSelectedTemplateId(preferredPreset.id);
    }
    setSaving(false);
  }, [open, editingNotebook, initialMode, defaultFolderId, defaultPaperPattern, defaultSlideSizePreset]);

  if (!open) return null;

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setCover({
        styleId: 'custom-image',
        primaryColor: '#072D59',
        accentColor: '#DBF2FC',
        pattern: 'solid',
        customImageDataUrl: dataUrl,
        imagePresentation: 'inset',
      });
    } catch {
      // Ignore malformed image uploads
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const defaultUntitled =
      mode === 'slides'
        ? 'Untitled Presentation'
        : mode === 'notes'
          ? 'Untitled Document'
          : mode === 'whiteboard'
            ? 'Untitled Whiteboard'
            : 'Untitled Board';
    const finalTitle = title.trim() || defaultUntitled;

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

    let paper: PaperConfig =
      mode === 'slides'
        ? resolveSlidePaperConfig(slideSizePreset, customSlideWidth, customSlideHeight)
        : mode === 'whiteboard'
          ? { ...DEFAULT_WHITEBOARD_PAPER, pattern: boardPattern as PaperPattern }
          : DEFAULT_PAPER_CONFIG;
    let initialStrokes: Stroke[] = [];
    let initialTextboxes: Textbox[] = [];
    let initialImages: PageImage[] = [];

    if (mode === 'notebook') {
      const customTpl = customTemplates.find((t) => t.id === selectedTemplateId);
      if (customTpl) {
        paper = customTpl.paper;
        initialStrokes = customTpl.strokes;
        initialTextboxes = customTpl.textboxes ?? [];
        initialImages = customTpl.images ?? [];
      } else {
        const builtIn = ALL_BUILT_IN_PAPER_VARIANTS.find((b) => b.id === selectedTemplateId);
        if (builtIn) {
          paper = builtIn.paper;
        }
      }
    }

    await createNotebook({
      title: finalTitle,
      mode,
      ...(mode === 'slides' ? { slideSizePreset } : {}),
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
        className="folio-modal-card flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl text-[var(--navy-900)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-seal)] text-[var(--navy-900)]">
              <BookOpen className="h-4 w-4" />
            </div>
            <div>
              <h2 id="notebook-modal-title" className="text-base font-bold text-[var(--navy-900)]">
                {editingNotebook
                  ? 'Edit Cover & Details'
                  : mode === 'slides'
                    ? 'Create New Slides'
                    : mode === 'notes'
                      ? 'Create New Doc'
                      : mode === 'whiteboard'
                        ? 'Create Infinite Board'
                        : 'Create New Canvas'}
              </h2>
              <p className="text-xs text-[var(--navy-600)]">
                Choose workspace mode, cover style, folder, and starting layout
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close notebook modal"
            onClick={onClose}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-600)] hover:bg-[var(--surface-seal)] hover:text-[var(--navy-900)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="grid flex-1 gap-6 overflow-y-auto p-5 md:grid-cols-[180px_1fr]">
            {/* Cover Live Preview with Static Shader Stage */}
            <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-[20px] border border-[var(--border-subtle)] p-4">
              <PaperShaderBackdrop variant="static-accent" />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[var(--surface-elevated)]/38"
              />
              <CoverPreview
                cover={cover}
                mode={mode}
                title={
                  title ||
                  (mode === 'slides'
                    ? 'Untitled Presentation'
                    : mode === 'notes'
                      ? 'Untitled Document'
                      : mode === 'whiteboard'
                        ? 'Untitled Whiteboard'
                        : 'Untitled Board')
                }
                className="relative z-10 h-56 w-40"
              />
              <span className="relative z-10 mt-2.5 rounded-full bg-[var(--surface-elevated)]/88 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--navy-900)] ring-1 ring-[var(--border-subtle)] backdrop-blur-md">
                Cover Preview
              </span>
            </div>

            {/* Form Controls */}
            <div className="space-y-4">
              {!editingNotebook && (
                <div>
                  <label className="folio-section-label mb-1.5 block">
                    Workspace Mode
                  </label>
                  <div
                    ref={modeTrackRef}
                    className="folio-segmented-track grid grid-cols-2 gap-1 rounded-xl p-1"
                  >
                    <MorphingPill indicator={modeIndicator} className="rounded-lg" />
                    <button
                      type="button"
                      data-testid="notebook-mode-notebook"
                      data-morph-key="notebook"
                      aria-pressed={mode === 'notebook'}
                      onClick={() => setMode('notebook')}
                      className={`folio-press relative z-10 inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold ${
                        mode === 'notebook'
                          ? modeIndicator.ready
                            ? 'text-white'
                            : 'folio-glass-active'
                          : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                      }`}
                    >
                      <Palette className="h-3.5 w-3.5" />
                      <span>Drawing Board</span>
                    </button>
                    <button
                      type="button"
                      data-testid="notebook-mode-whiteboard"
                      data-morph-key="whiteboard"
                      aria-pressed={mode === 'whiteboard'}
                      onClick={() => setMode('whiteboard')}
                      className={`folio-press relative z-10 inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold ${
                        mode === 'whiteboard'
                          ? modeIndicator.ready
                            ? 'text-white'
                            : 'folio-glass-active'
                          : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                      }`}
                    >
                      <BookOpen className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
                      <span>Infinite Board</span>
                    </button>
                    <button
                      type="button"
                      data-testid="notebook-mode-notes"
                      data-morph-key="notes"
                      aria-pressed={mode === 'notes'}
                      onClick={() => setMode('notes')}
                      className={`folio-press relative z-10 inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold ${
                        mode === 'notes'
                          ? modeIndicator.ready
                            ? 'text-white'
                            : 'folio-glass-active'
                          : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                      }`}
                    >
                      <FileText className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
                      <span>Notes Doc</span>
                    </button>
                    <button
                      type="button"
                      data-testid="notebook-mode-slides"
                      data-morph-key="slides"
                      aria-pressed={mode === 'slides'}
                      onClick={() => setMode('slides')}
                      className={`folio-press relative z-10 inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold ${
                        mode === 'slides'
                          ? modeIndicator.ready
                            ? 'text-white'
                            : 'folio-glass-active'
                          : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                      }`}
                    >
                      <Presentation className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
                      <span>Slides Deck</span>
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="notebook-title-input"
                  className="folio-section-label mb-1 block"
                >
                  {mode === 'slides'
                    ? 'Presentation Title'
                    : mode === 'notes'
                      ? 'Document Title'
                      : mode === 'whiteboard'
                        ? 'Infinite Board Title'
                        : 'Drawing Board Title'}
                </label>
                <input
                  id="notebook-title-input"
                  type="text"
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    mode === 'slides'
                      ? 'e.g., Q4 Product Pitch Deck'
                      : mode === 'notes'
                        ? 'e.g., Lecture 5 Summary & Research'
                        : mode === 'whiteboard'
                          ? 'e.g., System Architecture Brainstorm'
                          : 'e.g., Anatomy Sketchbook'
                  }
                  className="folio-input w-full rounded-xl px-3.5 py-2 text-sm"
                />
              </div>

              <div>
                <label
                  htmlFor="notebook-folder-select"
                  className="folio-section-label mb-1 block"
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
                  <label className="folio-section-label">
                    Cover Style
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="folio-btn-secondary folio-press inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold">
                      <Palette className="h-3 w-3 text-[var(--crimson-500)]" />
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
                    <label className="folio-btn-secondary folio-press inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold">
                      <ImagePlus className="h-3 w-3 text-[var(--navy-900)]" />
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

                {cover.styleId === 'custom-image' && cover.customImageDataUrl && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-2.5 py-1.5">
                    <span className="text-[11px] font-semibold text-[var(--navy-600)]">
                      Cover Image Framing
                    </span>
                    <div className="folio-segmented-track inline-flex rounded-lg p-0.5">
                      <button
                        type="button"
                        data-testid="cover-framing-inset"
                        onClick={() =>
                          setCover((prev) => ({
                            ...prev,
                            primaryColor: prev.primaryColor || '#072D59',
                            imagePresentation: 'inset',
                          }))
                        }
                        className={`folio-press rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          cover.imagePresentation !== 'full'
                            ? 'folio-glass-active'
                            : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                        }`}
                      >
                        Framed Inset
                      </button>
                      <button
                        type="button"
                        data-testid="cover-framing-full"
                        onClick={() =>
                          setCover((prev) => ({
                            ...prev,
                            imagePresentation: 'full',
                          }))
                        }
                        className={`folio-press rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          cover.imagePresentation === 'full'
                            ? 'folio-glass-active'
                            : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                        }`}
                      >
                        Full Bleed
                      </button>
                    </div>
                  </div>
                )}

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
                        className={`folio-press flex flex-col items-center rounded-xl border p-1.5 ${
                          active
                            ? 'border-[var(--crimson-500)] bg-[var(--surface-seal)]/55 ring-2 ring-[var(--crimson-glow)]'
                            : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                        }`}
                      >
                        <CoverPreview cover={preset.cover} compact className="h-12 w-9" />
                        <span className="mt-1 w-full truncate text-center text-[10px] font-semibold text-[var(--navy-600)]">
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Mode-Specific Setup (only when creating) */}
              {!editingNotebook &&
                (mode === 'slides' ? (
                  <div className="space-y-2.5">
                    <label className="folio-section-label block">
                      Slide Dimensions (16:9 Default)
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {SLIDE_SIZE_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          data-testid={`slide-size-preset-${preset.id}`}
                          aria-pressed={slideSizePreset === preset.id}
                          onClick={() => setSlideSizePreset(preset.id)}
                          className={`folio-press rounded-xl border px-2 py-1.5 text-left ${
                            slideSizePreset === preset.id
                              ? 'folio-glass-active'
                              : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
                          }`}
                        >
                          <div className="text-[11px] font-bold">{preset.id}</div>
                          <div className="text-[10px] opacity-75">
                            {preset.width}×{preset.height}
                          </div>
                        </button>
                      ))}
                      <button
                        type="button"
                        data-testid="slide-size-preset-custom"
                        aria-pressed={slideSizePreset === 'custom'}
                        onClick={() => setSlideSizePreset('custom')}
                        className={`folio-press rounded-xl border px-2 py-1.5 text-left ${
                          slideSizePreset === 'custom'
                            ? 'folio-glass-active'
                            : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
                        }`}
                      >
                        <div className="text-[11px] font-bold">Custom</div>
                        <div className="text-[10px] opacity-75">Any W × H</div>
                      </button>
                    </div>
                    {slideSizePreset === 'custom' && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs font-semibold text-[var(--navy-600)]">
                          Width (px)
                          <input
                            type="number"
                            min={320}
                            max={4096}
                            data-testid="custom-slide-width-input"
                            value={customSlideWidth}
                            onChange={(e) =>
                              setCustomSlideWidth(Math.max(320, Number(e.target.value) || 320))
                            }
                            className="folio-input mt-1 w-full rounded-xl px-2.5 py-1.5 text-xs"
                          />
                        </label>
                        <label className="text-xs font-semibold text-[var(--navy-600)]">
                          Height (px)
                          <input
                            type="number"
                            min={320}
                            max={4096}
                            data-testid="custom-slide-height-input"
                            value={customSlideHeight}
                            onChange={(e) =>
                              setCustomSlideHeight(Math.max(320, Number(e.target.value) || 320))
                            }
                            className="folio-input mt-1 w-full rounded-xl px-2.5 py-1.5 text-xs"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                ) : mode === 'notes' ? (
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-tint)]/55 px-3 py-2 text-xs text-[var(--navy-600)]">
                    Creates a rich-text Google Docs-style document with headings, checklists, tables, outline navigation, and PDF/Markdown export.
                  </div>
                ) : mode === 'whiteboard' ? (
                  <div>
                    <label className="folio-section-label mb-1.5 block">
                      Board Background
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'dotted', label: 'Dotted' },
                          { id: 'grid', label: 'Graph Grid' },
                          { id: 'blank', label: 'Blank' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          data-testid={`whiteboard-bg-${opt.id}`}
                          aria-pressed={boardPattern === opt.id}
                          onClick={() => setBoardPattern(opt.id)}
                          className={`folio-press rounded-xl border px-3 py-2 text-xs font-semibold ${
                            boardPattern === opt.id
                              ? 'folio-glass-active'
                              : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label
                      htmlFor="notebook-template-select"
                      className="folio-section-label mb-1 block"
                    >
                      Starting Paper / Template
                    </label>
                    <select
                      id="notebook-template-select"
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                      className="folio-input w-full rounded-xl px-3 py-2 text-sm"
                    >
                      <optgroup label="Built in Papers">
                        {ALL_BUILT_IN_PAPER_VARIANTS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                      {customTemplates.length > 0 && (
                        <optgroup label="My Templates">
                          {customTemplates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({formatPaperPatternLabel(t.paper.pattern)}
                              {t.strokes.length > 0 ? `, ${t.strokes.length} strokes` : ''})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                ))}
            </div>
          </div>

          <div className="folio-modal-footer flex items-center justify-end gap-2 px-5 py-3.5">
            <button
              type="button"
              onClick={onClose}
              className="folio-btn-secondary folio-press rounded-xl px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="folio-btn-crimson folio-press rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {saving
                ? 'Saving...'
                : editingNotebook
                  ? 'Save Changes'
                  : mode === 'slides'
                    ? 'Create Slides Deck'
                    : mode === 'notes'
                      ? 'Create Document'
                      : mode === 'whiteboard'
                        ? 'Create Infinite Board'
                        : 'Create Drawing Board'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
