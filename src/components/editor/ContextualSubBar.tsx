import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowUp,
  Bold,
  Bookmark,
  Calculator,
  Check,
  Copy,
  Crop,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Group,
  Italic,
  Lock,
  Minus,
  Plus,
  Shapes,
  Sparkles,
  Trash2,
  Type,
  Ungroup,
  Unlock,
  X,
} from 'lucide-react';
import {
  type ElementAlignment,
  getSelectionSummary,
  type PageElementSelection,
  type SelectionSummary,
} from '../../canvas/selection';
import {
  HIGHLIGHTER_SWATCH_NAMES,
  HIGHLIGHTER_THICKNESS_PRESETS,
  PEN_DEFAULT_SWATCHES,
  PEN_SWATCH_NAMES,
  PEN_THICKNESS_PRESETS,
} from '../../constants/covers';
import { useAppStore } from '../../store/useAppStore';
import type {
  Page,
  PageImage,
  Textbox,
  TextboxFontFamily,
} from '../../types/notes';

interface ContextualSubBarProps {
  activePage: Page | null;
  onLassoAiAction?: (action: 'ask' | 'math-hint' | 'transcribe') => void;
}

const FONT_OPTIONS: { id: TextboxFontFamily; label: string }[] = [
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
  { id: 'handwriting', label: 'Hand' },
];

const ALIGNMENT_CONTROLS: Array<{
  id: ElementAlignment;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'left', label: 'Align Left', icon: <AlignStartVertical className="h-3.5 w-3.5" /> },
  { id: 'center', label: 'Align Center', icon: <AlignCenterVertical className="h-3.5 w-3.5" /> },
  { id: 'right', label: 'Align Right', icon: <AlignEndVertical className="h-3.5 w-3.5" /> },
  { id: 'top', label: 'Align Top', icon: <AlignStartHorizontal className="h-3.5 w-3.5" /> },
  { id: 'middle', label: 'Align Middle', icon: <AlignCenterHorizontal className="h-3.5 w-3.5" /> },
  { id: 'bottom', label: 'Align Bottom', icon: <AlignEndHorizontal className="h-3.5 w-3.5" /> },
];

const AlignmentButtonsGroup: React.FC<{
  disabled: boolean;
  onAlign: (alignment: ElementAlignment) => void;
}> = ({ disabled, onAlign }) => (
  <div
    data-testid="alignment-buttons-group"
    className="flex shrink-0 items-center gap-0.5 rounded-lg border border-[#072D59]/12 bg-white p-0.5"
  >
    {ALIGNMENT_CONTROLS.map((ctrl, idx) => (
      <React.Fragment key={ctrl.id}>
        {idx === 3 && <div className="mx-0.5 h-4 w-px bg-[#072D59]/12" />}
        <button
          type="button"
          data-testid={`align-${ctrl.id}-btn`}
          title={ctrl.label}
          aria-label={ctrl.label}
          disabled={disabled}
          onClick={() => onAlign(ctrl.id)}
          className="rounded-md p-1 text-[#072D59]/80 transition duration-150 hover:bg-[#DBF2FC]/65 hover:text-[#072D59] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {ctrl.icon}
        </button>
      </React.Fragment>
    ))}
  </div>
);

const SelectionActionsGroup: React.FC<{
  summary: SelectionSummary;
  onGroup: () => void;
  onUngroup: () => void;
  onToggleLock: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  compactLabels?: boolean;
}> = ({
  summary,
  onGroup,
  onUngroup,
  onToggleLock,
  onDuplicate,
  onDelete,
  compactLabels = true,
}) => (
  <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white p-0.5">
    {summary.canGroup && (
      <button
        type="button"
        data-testid="subbar-group-btn"
        title="Group Elements (Ctrl+G)"
        aria-label="Group Elements"
        onClick={onGroup}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/65"
      >
        <Group className="h-3.5 w-3.5" />
        <span className={compactLabels ? 'hidden lg:inline' : ''}>Group</span>
      </button>
    )}
    {summary.canUngroup && (
      <button
        type="button"
        data-testid="subbar-ungroup-btn"
        title="Ungroup (Ctrl+Shift+G)"
        aria-label="Ungroup Elements"
        onClick={onUngroup}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/65"
      >
        <Ungroup className="h-3.5 w-3.5" />
        <span className={compactLabels ? 'hidden lg:inline' : ''}>Ungroup</span>
      </button>
    )}
    <button
      type="button"
      data-testid="subbar-lock-toggle"
      title={summary.allLocked ? 'Unlock Position' : 'Lock Position'}
      aria-label={summary.allLocked ? 'Unlock Element' : 'Lock Element'}
      aria-pressed={summary.allLocked}
      onClick={onToggleLock}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition duration-150 ${
        summary.allLocked
          ? 'bg-[#072D59] text-white'
          : 'text-[#072D59] hover:bg-[#DBF2FC]/65'
      }`}
    >
      {summary.allLocked ? (
        <Lock className="h-3.5 w-3.5 text-[#FD6E88]" />
      ) : (
        <Unlock className="h-3.5 w-3.5" />
      )}
      <span className={compactLabels ? 'hidden xl:inline' : ''}>
        {summary.allLocked ? 'Locked' : 'Lock'}
      </span>
    </button>
    <button
      type="button"
      data-testid="subbar-duplicate-btn"
      title="Duplicate (Ctrl+D)"
      aria-label="Duplicate selection"
      onClick={onDuplicate}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/65"
    >
      <Copy className="h-3.5 w-3.5" />
      <span className={compactLabels ? 'hidden md:inline' : ''}>Duplicate</span>
    </button>
    <button
      type="button"
      data-testid="subbar-delete-btn"
      disabled={summary.allLocked}
      title={summary.allLocked ? 'Unlock before deleting' : 'Delete (Del)'}
      aria-label="Delete selection"
      onClick={onDelete}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#F95573] transition duration-150 hover:bg-[#FD6E88]/12 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Trash2 className="h-3.5 w-3.5" />
      <span className={compactLabels ? 'hidden md:inline' : ''}>Delete</span>
    </button>
  </div>
);

export const ContextualSubBar: React.FC<ContextualSubBarProps> = ({
  activePage,
  onLassoAiAction,
}) => {
  const activeTool = useAppStore((s) => s.activeTool);
  const penColor = useAppStore((s) => s.penColor);
  const penSize = useAppStore((s) => s.penSize);
  const penSwatches = useAppStore((s) => s.penSwatches);
  const highlighterColor = useAppStore((s) => s.highlighterColor);
  const highlighterSize = useAppStore((s) => s.highlighterSize);
  const highlighterSwatches = useAppStore((s) => s.highlighterSwatches);
  const eraserSize = useAppStore((s) => s.eraserSize);
  const holdToSnapEnabled = useAppStore((s) => s.holdToSnapEnabled);
  const handwritingCorrectionEnabled = useAppStore(
    (s) => s.handwritingCorrectionEnabled,
  );
  const lassoSelection = useAppStore((s) => s.lassoSelection);
  const activeTextboxId = useAppStore((s) => s.activeTextboxId);
  const selectedTextboxIds = useAppStore((s) => s.selectedTextboxIds);
  const selectedImageIds = useAppStore((s) => s.selectedImageIds);
  const croppingImageId = useAppStore((s) => s.croppingImageId);

  const setActiveColor = useAppStore((s) => s.setActiveColor);
  const replaceToolSwatch = useAppStore((s) => s.replaceToolSwatch);
  const setActiveSize = useAppStore((s) => s.setActiveSize);
  const setEraserSize = useAppStore((s) => s.setEraserSize);
  const setHoldToSnapEnabled = useAppStore((s) => s.setHoldToSnapEnabled);
  const setHandwritingCorrectionEnabled = useAppStore(
    (s) => s.setHandwritingCorrectionEnabled,
  );
  const clearPageAnnotations = useAppStore((s) => s.clearPageAnnotations);
  const penSlots = useAppStore((s) => s.penSlots);
  const activatePenSlot = useAppStore((s) => s.activatePenSlot);
  const saveCurrentToolToSlot = useAppStore((s) => s.saveCurrentToolToSlot);

  const updateTextboxLive = useAppStore((s) => s.updateTextboxLive);
  const commitTextboxMutation = useAppStore((s) => s.commitTextboxMutation);
  const updateImageLive = useAppStore((s) => s.updateImageLive);
  const commitImageHistorySnapshot = useAppStore(
    (s) => s.commitImageHistorySnapshot,
  );
  const commitImageMutation = useAppStore((s) => s.commitImageMutation);
  const reorderImageLayer = useAppStore((s) => s.reorderImageLayer);
  const setCroppingImageId = useAppStore((s) => s.setCroppingImageId);
  const duplicateSelection = useAppStore((s) => s.duplicateSelection);
  const deleteActiveSelection = useAppStore((s) => s.deleteActiveSelection);
  const groupSelection = useAppStore((s) => s.groupSelection);
  const ungroupSelection = useAppStore((s) => s.ungroupSelection);
  const toggleLockSelection = useAppStore((s) => s.toggleLockSelection);
  const alignSelection = useAppStore((s) => s.alignSelection);
  const commitLassoRecolor = useAppStore((s) => s.commitLassoRecolor);

  const [confirmClear, setConfirmClear] = useState(false);
  const [slotSavePickerOpen, setSlotSavePickerOpen] = useState(false);
  const [slotSavedLabel, setSlotSavedLabel] = useState<string | null>(null);
  const sliderPrevImagesRef = useRef<PageImage[] | null>(null);
  const slotSavedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setConfirmClear(false);
    setSlotSavePickerOpen(false);
  }, [activeTool, activePage?.id]);

  useEffect(() => {
    return () => {
      if (slotSavedTimerRef.current !== null) {
        window.clearTimeout(slotSavedTimerRef.current);
      }
    };
  }, []);

  const currentSelection: PageElementSelection = useMemo(() => {
    if (!activePage) {
      return { strokeIds: [], textboxIds: [], imageIds: [] };
    }
    return {
      strokeIds:
        lassoSelection?.pageId === activePage.id ? lassoSelection.strokeIds : [],
      textboxIds: selectedTextboxIds,
      imageIds: selectedImageIds,
    };
  }, [activePage, lassoSelection, selectedTextboxIds, selectedImageIds]);

  const selectionSummary = useMemo(
    () =>
      activePage
        ? getSelectionSummary(activePage, currentSelection)
        : getSelectionSummary(
            { strokes: [], textboxes: [], images: [] },
            { strokeIds: [], textboxIds: [], imageIds: [] },
          ),
    [activePage, currentSelection],
  );

  const selectedTextbox = useMemo(() => {
    if (!activePage) return null;
    const targetId = activeTextboxId ?? selectedTextboxIds[0];
    if (!targetId) return null;
    return (activePage.textboxes ?? []).find((tb) => tb.id === targetId) ?? null;
  }, [activePage, activeTextboxId, selectedTextboxIds]);

  const selectedImage = useMemo(() => {
    if (!activePage || selectedImageIds.length === 0) return null;
    const targetId = selectedImageIds[0];
    return (activePage.images ?? []).find((im) => im.id === targetId) ?? null;
  }, [activePage, selectedImageIds]);

  const applyImagePatch = (patch: Partial<PageImage>) => {
    if (!activePage || !selectedImage || selectedImage.locked) return;
    commitImageMutation(activePage.id, selectedImage.id, patch);
  };

  const beginSliderDrag = () => {
    if (!activePage || selectedImage?.locked) return;
    sliderPrevImagesRef.current = [...(activePage.images ?? [])];
  };

  const changeSliderPatch = (patch: Partial<PageImage>) => {
    if (!activePage || !selectedImage || selectedImage.locked) return;
    if (sliderPrevImagesRef.current) {
      updateImageLive(activePage.id, selectedImage.id, patch);
    } else {
      commitImageMutation(activePage.id, selectedImage.id, patch);
    }
  };

  const endSliderDrag = () => {
    if (!activePage || !sliderPrevImagesRef.current) return;
    const prev = sliderPrevImagesRef.current;
    sliderPrevImagesRef.current = null;
    commitImageHistorySnapshot(activePage.id, prev);
  };

  const applyTextboxStyle = (patch: Partial<Textbox>) => {
    if (!activePage || !selectedTextbox || selectedTextbox.locked) return;
    if (activeTextboxId === selectedTextbox.id) {
      updateTextboxLive(activePage.id, selectedTextbox.id, patch);
    } else {
      for (const id of selectedTextboxIds) {
        commitTextboxMutation(activePage.id, id, patch);
      }
    }
  };

  const renderLassoAiPill = () =>
    onLassoAiAction && selectionSummary.strokeCount > 0 ? (
      <div
        data-testid="lasso-ai-actions"
        className="flex shrink-0 items-center gap-1 rounded-lg border border-[#FD6E88]/35 bg-white p-0.5 shadow-2xs"
      >
        <button
          type="button"
          data-testid="lasso-ai-ask-btn"
          onClick={() => onLassoAiAction('ask')}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/70"
        >
          <Sparkles className="h-3.5 w-3.5 text-[#FD6E88]" />
          <span>Ask AI</span>
        </button>
        <button
          type="button"
          data-testid="lasso-ai-math-btn"
          onClick={() => onLassoAiAction('math-hint')}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/70"
        >
          <Calculator className="h-3.5 w-3.5 text-[#072D59]" />
          <span>Math Hint</span>
        </button>
        <button
          type="button"
          data-testid="lasso-ai-transcribe-btn"
          onClick={() => onLassoAiAction('transcribe')}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/70"
        >
          <Type className="h-3.5 w-3.5 text-[#072D59]" />
          <span>Transcribe</span>
        </button>
      </div>
    ) : null;

  // Mode 1a: Multi-element or Mixed selection (or actively multi-selecting with textboxes/images)
  const isMixedOrMultiBar =
    Boolean(activePage) &&
    !activeTextboxId &&
    !croppingImageId &&
    selectionSummary.totalCount >= 2 &&
    (selectionSummary.textboxCount > 0 || selectionSummary.imageCount > 0);

  if (isMixedOrMultiBar && activePage) {
    return (
      <div
        data-testid="contextual-subbar"
        data-mode="multi"
        className="folio-editor-subbar custom-scrollbar z-20 flex h-11 shrink-0 items-center justify-start gap-2.5 overflow-x-auto whitespace-nowrap px-3 text-[#072D59] md:justify-center"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-[#072D59] ring-1 ring-[#072D59]/12">
          {selectionSummary.isSingleGroup ? (
            <>
              <Group className="h-3 w-3 text-[#FD6E88]" />
              <span>Group ({selectionSummary.totalCount})</span>
            </>
          ) : (
            <span>{selectionSummary.totalCount} selected</span>
          )}
        </span>

        <AlignmentButtonsGroup
          disabled={selectionSummary.allLocked}
          onAlign={(a) => alignSelection(activePage.id, a)}
        />

        <SelectionActionsGroup
          summary={selectionSummary}
          onGroup={() => groupSelection(activePage.id)}
          onUngroup={() => ungroupSelection(activePage.id)}
          onToggleLock={() => toggleLockSelection(activePage.id)}
          onDuplicate={() => duplicateSelection(activePage.id)}
          onDelete={() => deleteActiveSelection(activePage.id)}
        />

        {renderLassoAiPill()}
      </div>
    );
  }

  // Mode 1: Single Textbox selected or actively editing
  if (selectedTextbox && activePage) {
    const isLocked = Boolean(selectedTextbox.locked);
    return (
      <div
        data-testid="contextual-subbar"
        data-mode="textbox"
        onMouseDown={(e) => e.preventDefault()}
        className="folio-editor-subbar custom-scrollbar z-20 flex h-11 shrink-0 items-center justify-start gap-2 overflow-x-auto whitespace-nowrap px-3 text-[#072D59] lg:justify-center"
      >
        {/* Font Family */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-[#072D59]/12 bg-white p-0.5">
          {FONT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              disabled={isLocked}
              onClick={() => applyTextboxStyle({ fontFamily: opt.id })}
              className={`rounded-md px-2 py-1 text-xs font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${
                selectedTextbox.fontFamily === opt.id
                  ? 'bg-[#072D59] text-white'
                  : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/60'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Font Size */}
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white px-1.5 py-0.5">
          <button
            type="button"
            disabled={isLocked}
            aria-label="Decrease font size"
            onClick={() =>
              applyTextboxStyle({
                fontSize: Math.max(10, selectedTextbox.fontSize - 2),
              })
            }
            className="rounded p-1 text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/60 disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span
            data-testid="subbar-font-size"
            className="min-w-[28px] text-center text-xs font-bold text-[#072D59] tabular-nums"
          >
            {selectedTextbox.fontSize}
          </span>
          <button
            type="button"
            disabled={isLocked}
            aria-label="Increase font size"
            onClick={() =>
              applyTextboxStyle({
                fontSize: Math.min(96, selectedTextbox.fontSize + 2),
              })
            }
            className="rounded p-1 text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/60 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Bold / Italic */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-[#072D59]/12 bg-white p-0.5">
          <button
            type="button"
            disabled={isLocked}
            aria-label="Bold"
            aria-pressed={selectedTextbox.bold}
            onClick={() => applyTextboxStyle({ bold: !selectedTextbox.bold })}
            className={`rounded-md p-1.5 transition duration-150 disabled:opacity-40 ${
              selectedTextbox.bold
                ? 'bg-[#072D59] text-white'
                : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/60'
            }`}
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={isLocked}
            aria-label="Italic"
            aria-pressed={selectedTextbox.italic}
            onClick={() => applyTextboxStyle({ italic: !selectedTextbox.italic })}
            className={`rounded-md p-1.5 transition duration-150 disabled:opacity-40 ${
              selectedTextbox.italic
                ? 'bg-[#072D59] text-white'
                : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/60'
            }`}
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Curated Stationery Text Color Swatches */}
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white px-2 py-1">
          {PEN_DEFAULT_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              disabled={isLocked}
              title={PEN_SWATCH_NAMES[color] ?? color}
              aria-label={`Text color ${color}`}
              onClick={() => applyTextboxStyle({ color })}
              className={`h-4.5 w-4.5 rounded-full border border-[#072D59]/20 transition-transform duration-150 disabled:opacity-40 ${
                selectedTextbox.color.toLowerCase() === color.toLowerCase()
                  ? 'scale-110 ring-2 ring-[#FD6E88] ring-offset-1'
                  : 'hover:scale-105'
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
          <label
            title="Custom text color"
            className="relative flex h-4.5 w-4.5 cursor-pointer items-center justify-center rounded-full border border-dashed border-[#072D59]/35 bg-gradient-to-tr from-[#FD6E88] to-[#072D59] text-[10px] font-bold text-white"
          >
            +
            <input
              type="color"
              disabled={isLocked}
              aria-label="Custom text color"
              value={selectedTextbox.color}
              onChange={(e) => applyTextboxStyle({ color: e.target.value })}
              className="sr-only"
            />
          </label>
        </div>

        <SelectionActionsGroup
          summary={selectionSummary}
          onGroup={() => groupSelection(activePage.id)}
          onUngroup={() => ungroupSelection(activePage.id)}
          onToggleLock={() => toggleLockSelection(activePage.id)}
          onDuplicate={() => duplicateSelection(activePage.id)}
          onDelete={() => deleteActiveSelection(activePage.id)}
        />
      </div>
    );
  }

  // Mode 1b: Single Image / Photo selected
  if (selectedImage && activePage) {
    const maxRadius = Math.max(
      24,
      Math.round(Math.min(selectedImage.width, selectedImage.height) / 2),
    );
    const opacityPct = Math.round((selectedImage.opacity ?? 1) * 100);
    const cornerRadiusPx = Math.round(selectedImage.borderRadius ?? 0);
    const imageCount = (activePage.images ?? []).length;
    const isLocked = Boolean(selectedImage.locked);

    return (
      <div
        data-testid="contextual-subbar"
        data-mode="image"
        onMouseDown={(e) => e.preventDefault()}
        className="folio-editor-subbar custom-scrollbar z-20 flex h-11 shrink-0 items-center justify-start gap-2 overflow-x-auto whitespace-nowrap px-3 text-[#072D59] lg:justify-center"
      >
        {/* Opacity */}
        <label className="flex shrink-0 items-center gap-2 rounded-lg border border-[#072D59]/12 bg-white px-2.5 py-1 text-xs font-semibold text-[#072D59]/80">
          <span>Opacity</span>
          <input
            type="range"
            data-testid="image-opacity-slider"
            aria-label="Image opacity"
            disabled={isLocked}
            min={10}
            max={100}
            step={5}
            value={opacityPct}
            onPointerDown={beginSliderDrag}
            onPointerUp={endSliderDrag}
            onPointerCancel={endSliderDrag}
            onBlur={endSliderDrag}
            onChange={(e) =>
              changeSliderPatch({ opacity: Number(e.target.value) / 100 })
            }
            className="h-1.5 w-20 accent-[#FD6E88] disabled:opacity-40"
          />
          <span
            data-testid="image-opacity-value"
            className="w-8 text-right font-bold text-[#072D59] tabular-nums"
          >
            {opacityPct}%
          </span>
        </label>

        {/* Corner Rounding */}
        <label className="flex shrink-0 items-center gap-2 rounded-lg border border-[#072D59]/12 bg-white px-2.5 py-1 text-xs font-semibold text-[#072D59]/80">
          <span>Rounding</span>
          <input
            type="range"
            data-testid="image-radius-slider"
            aria-label="Image corner rounding"
            disabled={isLocked}
            min={0}
            max={maxRadius}
            step={2}
            value={Math.min(maxRadius, cornerRadiusPx)}
            onPointerDown={beginSliderDrag}
            onPointerUp={endSliderDrag}
            onPointerCancel={endSliderDrag}
            onBlur={endSliderDrag}
            onChange={(e) =>
              changeSliderPatch({ borderRadius: Number(e.target.value) })
            }
            className="h-1.5 w-20 accent-[#FD6E88] disabled:opacity-40"
          />
          <span
            data-testid="image-radius-value"
            className="w-8 text-right font-bold text-[#072D59] tabular-nums"
          >
            {cornerRadiusPx}px
          </span>
        </label>

        {/* Flip Horizontal / Flip Vertical / Crop */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-[#072D59]/12 bg-white p-0.5">
          <button
            type="button"
            disabled={isLocked}
            title="Flip Horizontal"
            aria-label="Flip Horizontal"
            aria-pressed={Boolean(selectedImage.flipX)}
            onClick={() => applyImagePatch({ flipX: !selectedImage.flipX })}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition duration-150 disabled:opacity-40 ${
              selectedImage.flipX
                ? 'bg-[#072D59] text-white'
                : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/60'
            }`}
          >
            <FlipHorizontal2 className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Flip H</span>
          </button>
          <button
            type="button"
            disabled={isLocked}
            title="Flip Vertical"
            aria-label="Flip Vertical"
            aria-pressed={Boolean(selectedImage.flipY)}
            onClick={() => applyImagePatch({ flipY: !selectedImage.flipY })}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition duration-150 disabled:opacity-40 ${
              selectedImage.flipY
                ? 'bg-[#072D59] text-white'
                : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/60'
            }`}
          >
            <FlipVertical2 className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Flip V</span>
          </button>
          <button
            type="button"
            disabled={isLocked}
            title="Crop & Pan Photo (or Double-click photo)"
            aria-label="Crop Photo"
            aria-pressed={croppingImageId === selectedImage.id}
            onClick={() =>
              setCroppingImageId(
                croppingImageId === selectedImage.id ? null : selectedImage.id,
              )
            }
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition duration-150 disabled:opacity-40 ${
              croppingImageId === selectedImage.id
                ? 'bg-[#FD6E88] text-white'
                : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/60'
            }`}
          >
            <Crop className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Crop</span>
          </button>
        </div>

        {/* Layer Order */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-[#072D59]/12 bg-white p-0.5">
          <button
            type="button"
            disabled={imageCount <= 1}
            title="Bring Forward"
            aria-label="Bring Forward"
            onClick={() =>
              reorderImageLayer(activePage.id, selectedImage.id, 'forward')
            }
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Forward</span>
          </button>
          <button
            type="button"
            disabled={imageCount <= 1}
            title="Send Backward"
            aria-label="Send Backward"
            onClick={() =>
              reorderImageLayer(activePage.id, selectedImage.id, 'backward')
            }
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Backward</span>
          </button>
        </div>

        <SelectionActionsGroup
          summary={selectionSummary}
          onGroup={() => groupSelection(activePage.id)}
          onUngroup={() => ungroupSelection(activePage.id)}
          onToggleLock={() => toggleLockSelection(activePage.id)}
          onDuplicate={() => duplicateSelection(activePage.id)}
          onDelete={() => deleteActiveSelection(activePage.id)}
        />
      </div>
    );
  }

  // Mode 2: Stroke(s) Selected (via Universal Select V or Lasso L)
  if (selectionSummary.strokeCount > 0 && activePage && lassoSelection) {
    return (
      <div
        data-testid="contextual-subbar"
        data-mode="lasso"
        className="folio-editor-subbar custom-scrollbar z-20 flex h-11 shrink-0 items-center justify-start gap-2 overflow-x-auto whitespace-nowrap px-3 text-[#072D59] lg:justify-center"
      >
        <span className="text-xs font-bold text-[#072D59]">
          {lassoSelection.strokeIds.length} stroke
          {lassoSelection.strokeIds.length === 1 ? '' : 's'}
        </span>

        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white px-2 py-1">
          <span className="mr-0.5 text-[11px] font-semibold text-[#072D59]/60">
            Recolor
          </span>
          {PEN_DEFAULT_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              disabled={selectionSummary.allLocked}
              title={PEN_SWATCH_NAMES[color] ?? color}
              aria-label={`Recolor selection to ${color}`}
              onClick={() =>
                commitLassoRecolor(activePage.id, lassoSelection.strokeIds, color)
              }
              className="h-4.5 w-4.5 rounded-full border border-[#072D59]/20 transition-transform duration-150 hover:scale-110 disabled:opacity-40"
              style={{ backgroundColor: color }}
            />
          ))}
          <label
            title="Custom recolor"
            className="relative flex h-4.5 w-4.5 cursor-pointer items-center justify-center rounded-full border border-dashed border-[#072D59]/35 bg-gradient-to-tr from-[#FD6E88] to-[#072D59] text-[10px] font-bold text-white"
          >
            +
            <input
              type="color"
              disabled={selectionSummary.allLocked}
              aria-label="Custom recolor selection"
              onChange={(e) =>
                commitLassoRecolor(
                  activePage.id,
                  lassoSelection.strokeIds,
                  e.target.value,
                )
              }
              className="sr-only"
            />
          </label>
        </div>

        {selectionSummary.totalCount >= 2 && (
          <AlignmentButtonsGroup
            disabled={selectionSummary.allLocked}
            onAlign={(a) => alignSelection(activePage.id, a)}
          />
        )}

        <SelectionActionsGroup
          summary={selectionSummary}
          onGroup={() => groupSelection(activePage.id)}
          onUngroup={() => ungroupSelection(activePage.id)}
          onToggleLock={() => toggleLockSelection(activePage.id)}
          onDuplicate={() => duplicateSelection(activePage.id)}
          onDelete={() => deleteActiveSelection(activePage.id)}
        />

        {renderLassoAiPill()}
      </div>
    );
  }

  // Mode 3: Pen or Highlighter active
  if (activeTool === 'pen' || activeTool === 'highlighter') {
    const isHighlighter = activeTool === 'highlighter';
    const currentSwatches = isHighlighter ? highlighterSwatches : penSwatches;
    const swatchNames = isHighlighter
      ? HIGHLIGHTER_SWATCH_NAMES
      : PEN_SWATCH_NAMES;
    const currentColor = isHighlighter ? highlighterColor : penColor;
    const thicknessPresets = isHighlighter
      ? HIGHLIGHTER_THICKNESS_PRESETS
      : PEN_THICKNESS_PRESETS;
    const currentSize = isHighlighter ? highlighterSize : penSize;

    return (
      <div
        data-testid="contextual-subbar"
        data-mode={activeTool}
        className="folio-editor-subbar custom-scrollbar z-20 flex h-11 shrink-0 items-center justify-start gap-2 overflow-x-auto whitespace-nowrap px-3 text-[#072D59] lg:justify-center"
      >
        {/* 5 Pinned Favorite Ink Slots + Save to Slot */}
        <div
          data-testid="pen-slots-bar"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white px-1.5 py-0.5"
        >
          {penSlots.map((slot, idx) => {
            const slotMatched =
              slot.tool === activeTool &&
              slot.color.toLowerCase() === currentColor.toLowerCase() &&
              Math.abs(slot.size - currentSize) < 0.35;
            return (
              <button
                key={slot.id}
                type="button"
                data-testid={`pen-slot-btn-${idx + 1}`}
                title={`${slot.name} (Key ${idx + 1})`}
                aria-label={`Favorite slot ${idx + 1}: ${slot.name}`}
                aria-pressed={slotMatched}
                onClick={() => activatePenSlot(idx)}
                className={`inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-bold transition duration-150 ${
                  slotMatched
                    ? 'bg-[#072D59] text-white shadow-2xs'
                    : 'text-[#072D59]/80 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]'
                }`}
              >
                <span className="folio-mono opacity-80">{idx + 1}</span>
                {slot.tool === 'highlighter' ? (
                  <span
                    className="h-3 w-2 rounded-[2px] border border-black/15"
                    style={{ backgroundColor: slot.color }}
                  />
                ) : (
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-black/15"
                    style={{ backgroundColor: slot.color }}
                  />
                )}
              </button>
            );
          })}

          <div className="mx-0.5 h-4 w-px bg-[#072D59]/12" />

          {!slotSavePickerOpen ? (
            <button
              type="button"
              data-testid="save-to-slot-trigger"
              title="Save active ink color & size to a favorite slot (1–5)"
              onClick={() => setSlotSavePickerOpen(true)}
              className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-[#072D59]/80 transition duration-150 hover:bg-[#FD6E88]/15 hover:text-[#F95573]"
            >
              {slotSavedLabel ? (
                <>
                  <Check className="h-3 w-3 text-emerald-600" />
                  <span className="text-emerald-700">{slotSavedLabel}</span>
                </>
              ) : (
                <>
                  <Bookmark className="h-3 w-3" />
                  <span>Save</span>
                </>
              )}
            </button>
          ) : (
            <div data-testid="save-to-slot-picker" className="flex items-center gap-0.5">
              <span className="px-1 text-[10px] font-bold text-[#072D59]/65">
                Slot:
              </span>
              {penSlots.map((slot, idx) => (
                <button
                  key={`save-${slot.id}`}
                  type="button"
                  data-testid={`save-to-slot-${idx + 1}`}
                  title={`Overwrite Slot ${idx + 1} (${slot.name})`}
                  onClick={() => {
                    saveCurrentToolToSlot(idx);
                    setSlotSavePickerOpen(false);
                    setSlotSavedLabel(`#${idx + 1}`);
                    if (slotSavedTimerRef.current !== null) {
                      window.clearTimeout(slotSavedTimerRef.current);
                    }
                    slotSavedTimerRef.current = window.setTimeout(() => {
                      slotSavedTimerRef.current = null;
                      setSlotSavedLabel(null);
                    }, 1400);
                  }}
                  className="folio-mono flex h-5 w-5 items-center justify-center rounded bg-[#FD6E88]/15 text-[10px] font-bold text-[#F95573] transition duration-150 hover:bg-[#FD6E88] hover:text-white"
                >
                  {idx + 1}
                </button>
              ))}
              <button
                type="button"
                aria-label="Cancel saving slot"
                onClick={() => setSlotSavePickerOpen(false)}
                className="rounded p-0.5 text-[#072D59]/50 hover:bg-[#DBF2FC]/70"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {/* Curated Stationery Swatches + Custom Color */}
        <div
          data-testid="tool-color-swatches"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white px-2 py-1"
        >
          {currentSwatches.map((swatch, idx) => {
            const selected = currentColor.toLowerCase() === swatch.toLowerCase();
            const labelName = swatchNames[swatch] ?? swatch;
            return (
              <button
                key={`${idx}-${swatch}`}
                type="button"
                title={`${labelName} (${swatch})`}
                aria-label={`Select color ${labelName} (${swatch})`}
                onClick={() => setActiveColor(swatch)}
                className={`h-4.5 w-4.5 rounded-full border border-[#072D59]/20 transition-transform duration-150 ${
                  selected
                    ? 'scale-110 ring-2 ring-[#FD6E88] ring-offset-1'
                    : 'hover:scale-105'
                }`}
                style={{ backgroundColor: swatch }}
              />
            );
          })}
          <label
            title="Custom color picker"
            className="relative flex h-4.5 w-4.5 cursor-pointer items-center justify-center rounded-full border border-dashed border-[#072D59]/35 bg-gradient-to-tr from-[#FD6E88] via-amber-300 to-[#072D59] text-[10px] font-bold text-white"
          >
            +
            <input
              type="color"
              aria-label="Custom ink color"
              value={currentColor}
              onChange={(e) =>
                replaceToolSwatch(currentSwatches.length - 1, e.target.value)
              }
              className="sr-only"
            />
          </label>
        </div>

        {/* Thickness Presets */}
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white px-2 py-0.5">
          {thicknessPresets.map((preset) => {
            const selected = Math.abs(currentSize - preset) < 0.25;
            const dotPx = isHighlighter
              ? Math.max(8, Math.min(16, preset * 0.48))
              : Math.max(4, Math.min(13, preset * 1.45));
            return (
              <button
                key={preset}
                type="button"
                title={`Thickness ${preset}px`}
                aria-label={`Thickness ${preset}px`}
                onClick={() => setActiveSize(preset)}
                className={`flex h-6 w-6 items-center justify-center rounded-full transition duration-150 ${
                  selected ? 'bg-[#DBF2FC] ring-1 ring-[#072D59]' : 'hover:bg-[#DBF2FC]/45'
                }`}
              >
                <span
                  className="rounded-full"
                  style={{
                    width: `${dotPx}px`,
                    height: `${dotPx}px`,
                    backgroundColor: currentColor,
                  }}
                />
              </button>
            );
          })}
        </div>

        {/* Hold-to-Snap Toggle */}
        <button
          type="button"
          title="Draw & hold steady to snap Line, Rectangle, or Circle"
          aria-pressed={holdToSnapEnabled}
          onClick={() => setHoldToSnapEnabled(!holdToSnapEnabled)}
          className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs font-semibold transition duration-150 ${
            holdToSnapEnabled
              ? 'border-[#072D59] bg-[#072D59] text-white'
              : 'border-[#072D59]/12 bg-white text-[#072D59]/70 hover:text-[#072D59]'
          }`}
        >
          <Shapes className="h-3.5 w-3.5" />
          <span>Hold-to-Snap {holdToSnapEnabled ? 'On' : 'Off'}</span>
        </button>

        {/* Handwriting Correction Toggle */}
        <button
          type="button"
          data-testid="handwriting-correction-toggle"
          title="Automatically straighten baseline and smooth handwritten pen strokes"
          aria-pressed={handwritingCorrectionEnabled}
          onClick={() =>
            setHandwritingCorrectionEnabled(!handwritingCorrectionEnabled)
          }
          className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs font-semibold transition duration-150 ${
            handwritingCorrectionEnabled
              ? 'border-[#072D59] bg-[#072D59] text-white'
              : 'border-[#072D59]/12 bg-white text-[#072D59]/70 hover:text-[#072D59]'
          }`}
        >
          <Sparkles
            className={`h-3.5 w-3.5 ${handwritingCorrectionEnabled ? 'text-[#FD6E88]' : ''}`}
          />
          <span>
            Handwriting Correction {handwritingCorrectionEnabled ? 'On' : 'Off'}
          </span>
        </button>
      </div>
    );
  }

  // Mode 4: Eraser active
  if (activeTool === 'eraser') {
    const hasContent =
      Boolean(activePage) &&
      (activePage!.strokes.length > 0 ||
        (activePage!.textboxes?.length ?? 0) > 0 ||
        (activePage!.images?.length ?? 0) > 0);

    return (
      <div
        data-testid="contextual-subbar"
        data-mode="eraser"
        className="folio-editor-subbar z-20 flex h-11 shrink-0 items-center justify-center gap-3 px-3 text-[#072D59]"
      >
        <div className="flex items-center gap-1.5 rounded-lg border border-[#072D59]/12 bg-white px-2.5 py-0.5">
          <Eraser className="h-3.5 w-3.5 text-[#FD6E88]" />
          <span className="text-xs font-semibold text-[#072D59]/80">
            Stroke Eraser
          </span>
          {[10, 18, 28].map((r) => (
            <button
              key={r}
              type="button"
              aria-label={`Eraser radius ${r}`}
              onClick={() => setEraserSize(r)}
              className={`rounded-md px-2 py-0.5 text-xs font-bold transition duration-150 ${
                eraserSize === r
                  ? 'bg-[#072D59] text-white'
                  : 'text-[#072D59]/70 hover:bg-[#DBF2FC]/60'
              }`}
            >
              {r === 10 ? 'S' : r === 18 ? 'M' : 'L'}
            </button>
          ))}
        </div>

        {activePage &&
          hasContent &&
          (!confirmClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#FD6E88]/40 bg-white px-2.5 text-xs font-semibold text-[#F95573] transition duration-150 hover:bg-[#FD6E88]/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear Page
            </button>
          ) : (
            <div className="flex items-center gap-1.5 rounded-lg border border-[#FD6E88]/40 bg-[#FD6E88]/10 px-2 py-0.5">
              <span className="text-xs font-semibold text-[#072D59]">
                Clear unlocked?
              </span>
              <button
                type="button"
                onClick={() => {
                  clearPageAnnotations(activePage.id);
                  setConfirmClear(false);
                }}
                className="folio-btn-crimson rounded px-2 py-0.5 text-xs font-semibold"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="rounded px-2 py-0.5 text-xs font-medium text-[#072D59]/75 transition duration-150 hover:bg-white"
              >
                Cancel
              </button>
            </div>
          ))}
      </div>
    );
  }

  // Mode 5: Universal Select / Text / Lasso with no selection
  return (
    <div
      data-testid="contextual-subbar"
      data-mode={activeTool}
      className="folio-editor-subbar z-20 flex h-11 shrink-0 items-center justify-center px-3"
    >
      <span className="text-xs font-semibold text-[#072D59]/68">
        {activeTool === 'text'
          ? 'Click anywhere on the page to place a textbox, or press any printable key'
          : activeTool === 'lasso'
            ? 'Circle handwritten strokes to move, recolor, align, or ask Gemini AI'
            : 'Drag any stroke, text, or photo · Drag empty paper to marquee-select · Space+Drag to pan'}
      </span>
    </div>
  );
};
