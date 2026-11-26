import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  ChevronDown,
  Copy,
  Crop,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Group,
  Italic,
  Loader2,
  Lock,
  Minus,
  PaintBucket,
  Pipette,
  Plus,
  RotateCw,
  Sparkles,
  Trash2,
  Type,
  Ungroup,
  Unlock,
  X,
} from 'lucide-react';
import { DraggableRangeSlider } from '../common/DraggableRangeSlider';
import {
  type ElementAlignment,
  getSelectionSummary,
  type PageElementSelection,
  type SelectionSummary,
} from '../../canvas/selection';
import {
  computeTextboxScaleForDimension,
  MAX_ELEMENT_DIMENSION,
  MAX_TEXTBOX_FONT_SIZE,
  measureTextboxLayout,
  MIN_ELEMENT_DIMENSION,
  MIN_TEXTBOX_FONT_SIZE,
} from '../../canvas/textLayout';
import {
  ERASER_SIZE_PRESETS,
  HIGHLIGHTER_THICKNESS_PRESETS,
  PEN_SWATCH_NAMES,
  PEN_THICKNESS_PRESETS,
  UNIFIED_INK_SWATCH_NAMES,
  UNIFIED_INK_SWATCHES,
} from '../../constants/covers';
import { useAppStore } from '../../store/useAppStore';
import type {
  Page,
  PageImage,
  Stroke,
  Textbox,
  TextboxFontFamily,
} from '../../types/notes';
import { DebouncedColorInput } from '../common/DebouncedColorInput';
import { MorphingPill, useMorphingIndicator } from '../common/MorphingIndicator';
import { getCssFallbackZoomFactor } from '../../utils/uiZoom';

interface ContextualSubBarProps {
  activePage: Page | null;
  onLassoAiAction?: (action: 'ask' | 'math-hint' | 'transcribe') => void;
  onTidyHandwritingAi?: () => void;
  tidyingHandwriting?: boolean;
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

const CompactDimensionInput: React.FC<{
  label?: string;
  value: number;
  suffix?: string;
  min: number;
  max: number;
  disabled?: boolean;
  testId: string;
  ariaLabel: string;
  widthClass?: string;
  onCommit: (next: number) => void;
}> = ({
  label,
  value,
  suffix,
  min,
  max,
  disabled = false,
  testId,
  ariaLabel,
  widthClass = 'w-12',
  onCommit,
}) => {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const skipNextBlurRef = useRef(false);

  useEffect(() => {
    if (!focused) {
      setDraft(String(value));
    }
  }, [value, focused]);

  const commitDraft = () => {
    const parsed = Number.parseFloat(draft.trim());
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, Math.round(parsed * 10) / 10));
    setDraft(String(clamped));
    if (Math.abs(clamped - value) >= 0.05) {
      onCommit(clamped);
    }
  };

  return (
    <label className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#072D59]/70">
      {label && <span className="select-none">{label}</span>}
      <input
        type="text"
        inputMode="decimal"
        data-testid={testId}
        aria-label={ariaLabel}
        disabled={disabled}
        value={draft}
        onFocus={(e) => {
          skipNextBlurRef.current = false;
          setFocused(true);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            skipNextBlurRef.current = true;
            setFocused(false);
            commitDraft();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            skipNextBlurRef.current = true;
            setFocused(false);
            setDraft(String(value));
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          setFocused(false);
          if (skipNextBlurRef.current) {
            skipNextBlurRef.current = false;
            return;
          }
          commitDraft();
        }}
        className={`folio-mono ${widthClass} rounded bg-[#F4F8FB]/75 px-1 py-0.5 text-center text-xs font-bold text-[#072D59] outline-none ring-1 ring-[#072D59]/10 focus:bg-white focus:ring-2 focus:ring-[#FD6E88] disabled:cursor-not-allowed disabled:opacity-45`}
      />
      {suffix && <span className="text-[10px] text-[#072D59]/55 select-none">{suffix}</span>}
    </label>
  );
};

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
          ? 'folio-glass-active'
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
      className="folio-press inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[var(--state-danger-text)] hover:bg-[var(--state-danger-bg)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Trash2 className="h-3.5 w-3.5" />
      <span className={compactLabels ? 'hidden md:inline' : ''}>Delete</span>
    </button>
  </div>
);

export const ContextualSubBar: React.FC<ContextualSubBarProps> = ({
  activePage,
  onLassoAiAction,
  onTidyHandwritingAi,
  tidyingHandwriting = false,
}) => {
  const activeTool = useAppStore((s) => s.activeTool);
  const inkColor = useAppStore((s) => s.inkColor);
  const inkSwatches = useAppStore((s) => s.inkSwatches);
  const penSize = useAppStore((s) => s.penSize);
  const highlighterSize = useAppStore((s) => s.highlighterSize);
  const eraserMode = useAppStore((s) => s.eraserMode);
  const eraserSize = useAppStore((s) => s.eraserSize);
  const holdToSnapEnabled = useAppStore((s) => s.holdToSnapEnabled);
  const lassoSelection = useAppStore((s) => s.lassoSelection);
  const activeTextboxId = useAppStore((s) => s.activeTextboxId);
  const selectedTextboxIds = useAppStore((s) => s.selectedTextboxIds);
  const selectedImageIds = useAppStore((s) => s.selectedImageIds);
  const croppingImageId = useAppStore((s) => s.croppingImageId);

  const setActiveColor = useAppStore((s) => s.setActiveColor);
  const setActiveSize = useAppStore((s) => s.setActiveSize);
  const setEraserMode = useAppStore((s) => s.setEraserMode);
  const setEraserSize = useAppStore((s) => s.setEraserSize);
  const setHoldToSnapEnabled = useAppStore((s) => s.setHoldToSnapEnabled);
  const clearPageAnnotations = useAppStore((s) => s.clearPageAnnotations);
  const penSlots = useAppStore((s) => s.penSlots);
  const activatePenSlot = useAppStore((s) => s.activatePenSlot);
  const saveCurrentToolToSlot = useAppStore((s) => s.saveCurrentToolToSlot);

  const updateTextboxLive = useAppStore((s) => s.updateTextboxLive);
  const updateTextboxesLive = useAppStore((s) => s.updateTextboxesLive);
  const commitTextboxHistorySnapshot = useAppStore(
    (s) => s.commitTextboxHistorySnapshot,
  );
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
  const updateLassoRecolorLive = useAppStore((s) => s.updateLassoRecolorLive);
  const commitStrokeHistorySnapshot = useAppStore(
    (s) => s.commitStrokeHistorySnapshot,
  );
  const commitLassoRecolor = useAppStore((s) => s.commitLassoRecolor);
  const commitStrokeScale = useAppStore((s) => s.commitStrokeScale);
  const commitStrokeTransform = useAppStore((s) => s.commitStrokeTransform);

  const [confirmClear, setConfirmClear] = useState(false);
  const [slotSavePickerOpen, setSlotSavePickerOpen] = useState(false);
  const [slotSavedLabel, setSlotSavedLabel] = useState<string | null>(null);
  const [thicknessSliderOpen, setThicknessSliderOpen] = useState(false);
  const [thicknessPopoverPos, setThicknessPopoverPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const thicknessPillRef = useRef<HTMLDivElement | null>(null);
  const thicknessPopoverRef = useRef<HTMLDivElement | null>(null);
  const sliderPrevImagesRef = useRef<PageImage[] | null>(null);
  const recolorSessionRef = useRef<{
    pageId: string;
    strokeIds: string[];
    prevStrokes: Stroke[];
  } | null>(null);
  const textboxColorSessionRef = useRef<{
    pageId: string;
    textboxIds: string[];
    prevTextboxes: Textbox[];
    editingActive: boolean;
  } | null>(null);
  const slotSavedTimerRef = useRef<number | null>(null);
  const eraserModeTrackRef = useRef<HTMLDivElement | null>(null);
  const eraserSizeTrackRef = useRef<HTMLDivElement | null>(null);
  const eraserModeIndicator = useMorphingIndicator(
    eraserModeTrackRef,
    activeTool === 'eraser' ? eraserMode : null,
    [activeTool],
  );
  const eraserSizeIndicator = useMorphingIndicator(
    eraserSizeTrackRef,
    activeTool === 'eraser' ? String(eraserSize) : null,
    [activeTool],
  );

  useEffect(() => {
    setConfirmClear(false);
    setSlotSavePickerOpen(false);
    setThicknessSliderOpen(false);
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

  useEffect(() => {
    if (
      (activeTool !== 'pen' && activeTool !== 'highlighter') ||
      activeTextboxId ||
      croppingImageId ||
      selectionSummary.totalCount > 0
    ) {
      setThicknessSliderOpen(false);
    }
  }, [activeTool, activeTextboxId, croppingImageId, selectionSummary.totalCount]);

  useEffect(() => {
    if (!thicknessSliderOpen) {
      setThicknessPopoverPos(null);
      return;
    }

    const updatePosition = () => {
      const el = thicknessPillRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const zoomFactor = Math.max(0.25, getCssFallbackZoomFactor());
      const POPOVER_W = 224;
      const viewportW = (window.innerWidth || 1280) / zoomFactor;
      const centerX = (rect.left + rect.width / 2) / zoomFactor;
      const left = Math.max(
        12,
        Math.min(viewportW - POPOVER_W - 12, Math.round(centerX - POPOVER_W / 2)),
      );
      const top = Math.round(rect.bottom / zoomFactor + 8);
      setThicknessPopoverPos({ left, top });
    };

    updatePosition();

    const handleOutside = (ev: Event) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (thicknessPillRef.current?.contains(target)) return;
      if (thicknessPopoverRef.current?.contains(target)) return;
      setThicknessSliderOpen(false);
    };

    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        setThicknessSliderOpen(false);
      }
    };

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('pointerdown', handleOutside, true);
    window.addEventListener('mousedown', handleOutside, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('pointerdown', handleOutside, true);
      window.removeEventListener('mousedown', handleOutside, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [thicknessSliderOpen]);

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

  const hasUnlockedPenStrokes = useMemo(() => {
    if (!activePage || currentSelection.strokeIds.length === 0) return false;
    const set = new Set(currentSelection.strokeIds);
    return activePage.strokes.some(
      (s) => set.has(s.id) && s.tool === 'pen' && !s.locked,
    );
  }, [activePage, currentSelection.strokeIds]);

  const renderLassoAiPill = () =>
    (onLassoAiAction || onTidyHandwritingAi) && selectionSummary.strokeCount > 0 ? (
      <div
        data-testid="lasso-ai-actions"
        className="flex shrink-0 items-center gap-1 rounded-lg border border-[#FD6E88]/35 bg-white p-0.5 shadow-2xs"
      >
        {onTidyHandwritingAi && hasUnlockedPenStrokes && (
          <button
            type="button"
            data-testid="subbar-tidy-handwriting-ai-btn"
            disabled={tidyingHandwriting}
            title="Clean selected handwritten strokes into neat ink strokes (Ctrl+Z reverts)"
            onClick={onTidyHandwritingAi}
            className="folio-btn-navy inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold disabled:opacity-60"
          >
            {tidyingHandwriting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FD6E88]" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-[#FD6E88]" />
            )}
            <span>{tidyingHandwriting ? 'Tidying…' : 'Tidy Handwriting (AI)'}</span>
          </button>
        )}
        {onLassoAiAction && (
          <>
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
          </>
        )}
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
        className="folio-glass-island folio-island-morph custom-scrollbar pointer-events-auto flex min-h-[44px] max-w-full shrink-0 items-center justify-start gap-2.5 overflow-x-auto whitespace-nowrap rounded-2xl px-3 py-1 text-[var(--navy-900)]"
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
    const tbLayout = measureTextboxLayout(selectedTextbox);
    const applyTextboxFontSize = (nextPt: number) => {
      const clamped = Math.max(
        MIN_TEXTBOX_FONT_SIZE,
        Math.min(MAX_TEXTBOX_FONT_SIZE, Math.round(nextPt * 10) / 10),
      );
      const ratio =
        clamped / Math.max(MIN_TEXTBOX_FONT_SIZE, selectedTextbox.fontSize || 20);
      const nextWrap =
        selectedTextbox.wrapWidth && selectedTextbox.wrapWidth > 0
          ? Math.max(
              24,
              Math.min(MAX_ELEMENT_DIMENSION, Math.round(selectedTextbox.wrapWidth * ratio)),
            )
          : undefined;
      applyTextboxStyle({
        fontSize: clamped,
        ...(selectedTextbox.wrapWidth ? { wrapWidth: nextWrap } : {}),
      });
    };

    return (
      <div
        data-testid="contextual-subbar"
        data-mode="textbox"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
          e.preventDefault();
        }}
        className="folio-glass-island folio-island-morph custom-scrollbar pointer-events-auto flex min-h-[44px] max-w-full shrink-0 items-center justify-start gap-2 overflow-x-auto whitespace-nowrap rounded-2xl px-3 py-1 text-[var(--navy-900)]"
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
                  ? 'folio-glass-active'
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
            onClick={() => applyTextboxFontSize(selectedTextbox.fontSize - 2)}
            className="rounded p-1 text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/60 disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <CompactDimensionInput
            testId="subbar-font-size"
            ariaLabel="Font size in points"
            value={Math.round(selectedTextbox.fontSize * 10) / 10}
            min={MIN_TEXTBOX_FONT_SIZE}
            max={MAX_TEXTBOX_FONT_SIZE}
            disabled={isLocked}
            widthClass="w-11"
            onCommit={applyTextboxFontSize}
          />
          <button
            type="button"
            disabled={isLocked}
            aria-label="Increase font size"
            onClick={() => applyTextboxFontSize(selectedTextbox.fontSize + 2)}
            className="rounded p-1 text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/60 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Exact Width & Height */}
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white px-2 py-0.5">
          <CompactDimensionInput
            label="W"
            value={Math.round(tbLayout.width)}
            min={MIN_ELEMENT_DIMENSION}
            max={MAX_ELEMENT_DIMENSION}
            disabled={isLocked}
            testId="subbar-dim-w"
            ariaLabel="Textbox width in pixels"
            onCommit={(nextW) =>
              applyTextboxStyle(
                computeTextboxScaleForDimension(selectedTextbox, 'width', nextW),
              )
            }
          />
          <span className="text-[10px] font-bold text-[#072D59]/40">×</span>
          <CompactDimensionInput
            label="H"
            value={Math.round(tbLayout.height)}
            min={MIN_ELEMENT_DIMENSION}
            max={MAX_ELEMENT_DIMENSION}
            disabled={isLocked}
            testId="subbar-dim-h"
            ariaLabel="Textbox height in pixels"
            onCommit={(nextH) =>
              applyTextboxStyle(
                computeTextboxScaleForDimension(selectedTextbox, 'height', nextH),
              )
            }
          />
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
                ? 'folio-glass-active'
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
                ? 'folio-glass-active'
                : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/60'
            }`}
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Curated Stationery Text Color Swatches */}
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white px-2 py-1">
          {UNIFIED_INK_SWATCHES.map((color) => (
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
            className="relative flex h-4.5 w-4.5 cursor-pointer items-center justify-center rounded-full border border-dashed border-[#072D59]/35 bg-[conic-gradient(from_0deg,#FD6E88,#F59E0B,#10B981,#38BDF8,#A855F7,#FD6E88)] text-[10px] font-bold text-white"
          >
            +
            <DebouncedColorInput
              key={`${activePage.id}:${selectedTextboxIds.join(',')}`}
              value={selectedTextbox.color}
              disabled={isLocked}
              ariaLabel="Custom text color"
              testId="custom-text-color-input"
              className="sr-only"
              onSessionStart={() => {
                textboxColorSessionRef.current = {
                  pageId: activePage.id,
                  textboxIds:
                    activeTextboxId === selectedTextbox.id
                      ? [selectedTextbox.id]
                      : [...selectedTextboxIds],
                  prevTextboxes: activePage.textboxes ?? [],
                  editingActive: activeTextboxId === selectedTextbox.id,
                };
              }}
              onPreview={(color) => {
                const session = textboxColorSessionRef.current;
                if (session) {
                  updateTextboxesLive(session.pageId, session.textboxIds, { color });
                } else {
                  const ids =
                    activeTextboxId === selectedTextbox.id
                      ? [selectedTextbox.id]
                      : selectedTextboxIds;
                  updateTextboxesLive(activePage.id, ids, { color });
                }
              }}
              onCommit={(color) => {
                const session = textboxColorSessionRef.current;
                textboxColorSessionRef.current = null;
                if (!session) return;
                if (session.editingActive) {
                  updateTextboxLive(session.pageId, session.textboxIds[0], { color });
                } else {
                  commitTextboxHistorySnapshot(session.pageId, session.prevTextboxes);
                }
              }}
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
        onMouseDown={(e) => {
          if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
          e.preventDefault();
        }}
        className="folio-glass-island folio-island-morph custom-scrollbar pointer-events-auto flex min-h-[44px] max-w-full shrink-0 items-center justify-start gap-2 overflow-x-auto whitespace-nowrap rounded-2xl px-3 py-1 text-[var(--navy-900)]"
      >
        {/* Exact Width & Height */}
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white px-2 py-0.5">
          <CompactDimensionInput
            label="W"
            value={Math.round(selectedImage.width)}
            min={12}
            max={MAX_ELEMENT_DIMENSION}
            disabled={isLocked}
            testId="subbar-dim-w"
            ariaLabel="Image width in pixels"
            onCommit={(nextW) => applyImagePatch({ width: nextW })}
          />
          <span className="text-[10px] font-bold text-[#072D59]/40">×</span>
          <CompactDimensionInput
            label="H"
            value={Math.round(selectedImage.height)}
            min={12}
            max={MAX_ELEMENT_DIMENSION}
            disabled={isLocked}
            testId="subbar-dim-h"
            ariaLabel="Image height in pixels"
            onCommit={(nextH) => applyImagePatch({ height: nextH })}
          />
        </div>

        {/* Opacity */}
        <label className="flex shrink-0 items-center gap-2 rounded-lg border border-[#072D59]/12 bg-white px-2.5 py-1 text-xs font-semibold text-[#072D59]/80">
          <span>Opacity</span>
          <DraggableRangeSlider
            testId="image-opacity-slider"
            ariaLabel="Image opacity"
            disabled={isLocked}
            min={10}
            max={100}
            step={5}
            value={opacityPct}
            onDragStart={beginSliderDrag}
            onDragEnd={endSliderDrag}
            onBlur={endSliderDrag}
            onChange={(nextPct) => changeSliderPatch({ opacity: nextPct / 100 })}
            className="w-24"
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
          <DraggableRangeSlider
            testId="image-radius-slider"
            ariaLabel="Image corner rounding"
            disabled={isLocked}
            min={0}
            max={maxRadius}
            step={2}
            value={Math.min(maxRadius, cornerRadiusPx)}
            onDragStart={beginSliderDrag}
            onDragEnd={endSliderDrag}
            onBlur={endSliderDrag}
            onChange={(nextRadius) => changeSliderPatch({ borderRadius: nextRadius })}
            className="w-24"
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
                ? 'folio-glass-active'
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
                ? 'folio-glass-active'
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
    const selectedIdSet = new Set(lassoSelection.strokeIds);
    const firstSelectedUnlockedStroke = activePage.strokes.find(
      (s) => selectedIdSet.has(s.id) && !s.locked,
    );
    const currentRecolorValue = firstSelectedUnlockedStroke?.color ?? '#072D59';

    return (
      <div
        data-testid="contextual-subbar"
        data-mode="lasso"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
          e.preventDefault();
        }}
        className="folio-glass-island folio-island-morph custom-scrollbar pointer-events-auto flex min-h-[44px] max-w-full shrink-0 items-center justify-start gap-2 overflow-x-auto whitespace-nowrap rounded-2xl px-3 py-1 text-[var(--navy-900)]"
      >
        <span className="text-xs font-bold text-[var(--navy-900)]">
          {lassoSelection.strokeIds.length} stroke
          {lassoSelection.strokeIds.length === 1 ? '' : 's'}
        </span>

        {selectionSummary.combinedBounds && (() => {
          const sb = selectionSummary.combinedBounds;
          const strokeW = Math.max(1, Math.round(sb.maxX - sb.minX));
          const strokeH = Math.max(1, Math.round(sb.maxY - sb.minY));
          return (
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white px-2 py-0.5">
              <CompactDimensionInput
                label="W"
                value={strokeW}
                min={MIN_ELEMENT_DIMENSION}
                max={MAX_ELEMENT_DIMENSION}
                disabled={selectionSummary.anyLocked}
                testId="subbar-dim-w"
                ariaLabel="Selection width in pixels"
                onCommit={(nextW) =>
                  commitStrokeScale(activePage.id, lassoSelection.strokeIds, sb, {
                    ...sb,
                    maxX: sb.minX + nextW,
                  })
                }
              />
              <span className="text-[10px] font-bold text-[#072D59]/40">×</span>
              <CompactDimensionInput
                label="H"
                value={strokeH}
                min={MIN_ELEMENT_DIMENSION}
                max={MAX_ELEMENT_DIMENSION}
                disabled={selectionSummary.anyLocked}
                testId="subbar-dim-h"
                ariaLabel="Selection height in pixels"
                onCommit={(nextH) =>
                  commitStrokeScale(activePage.id, lassoSelection.strokeIds, sb, {
                    ...sb,
                    maxY: sb.minY + nextH,
                  })
                }
              />
            </div>
          );
        })()}

        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white px-2 py-1">
          <span className="mr-0.5 text-[11px] font-semibold text-[#072D59]/60">
            Recolor
          </span>
          {UNIFIED_INK_SWATCHES.map((color) => (
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
            className="relative flex h-4.5 w-4.5 cursor-pointer items-center justify-center rounded-full border border-dashed border-[#072D59]/35 bg-[conic-gradient(from_0deg,#FD6E88,#F59E0B,#10B981,#38BDF8,#A855F7,#FD6E88)] text-[10px] font-bold text-white"
          >
            +
            <DebouncedColorInput
              key={`${activePage.id}:${lassoSelection.strokeIds.join(',')}`}
              value={currentRecolorValue}
              disabled={selectionSummary.allLocked}
              ariaLabel="Custom recolor selection"
              testId="custom-recolor-input"
              className="sr-only"
              onSessionStart={() => {
                recolorSessionRef.current = {
                  pageId: activePage.id,
                  strokeIds: [...lassoSelection.strokeIds],
                  prevStrokes: activePage.strokes,
                };
              }}
              onPreview={(color) => {
                const session = recolorSessionRef.current;
                if (session) {
                  updateLassoRecolorLive(session.pageId, session.strokeIds, color);
                } else {
                  updateLassoRecolorLive(
                    activePage.id,
                    lassoSelection.strokeIds,
                    color,
                  );
                }
              }}
              onCommit={() => {
                const session = recolorSessionRef.current;
                recolorSessionRef.current = null;
                if (!session) return;
                commitStrokeHistorySnapshot(session.pageId, session.prevStrokes);
              }}
            />
          </label>
        </div>

        {selectionSummary.totalCount >= 2 && (
          <AlignmentButtonsGroup
            disabled={selectionSummary.allLocked}
            onAlign={(a) => alignSelection(activePage.id, a)}
          />
        )}

        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-[#072D59]/12 bg-white p-0.5">
          <button
            type="button"
            data-testid="stroke-flip-h-btn"
            disabled={selectionSummary.allLocked}
            title="Flip Selected Strokes Horizontal"
            aria-label="Flip Horizontal"
            onClick={() =>
              commitStrokeTransform(activePage.id, lassoSelection.strokeIds, 'flipX')
            }
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/65 disabled:opacity-40"
          >
            <FlipHorizontal2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-testid="stroke-flip-v-btn"
            disabled={selectionSummary.allLocked}
            title="Flip Selected Strokes Vertical"
            aria-label="Flip Vertical"
            onClick={() =>
              commitStrokeTransform(activePage.id, lassoSelection.strokeIds, 'flipY')
            }
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/65 disabled:opacity-40"
          >
            <FlipVertical2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-testid="stroke-rotate-90-btn"
            disabled={selectionSummary.allLocked}
            title="Rotate Selected Strokes 90°"
            aria-label="Rotate 90 Degrees"
            onClick={() =>
              commitStrokeTransform(activePage.id, lassoSelection.strokeIds, 'rotate90')
            }
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/65 disabled:opacity-40"
          >
            <RotateCw className="h-3.5 w-3.5" />
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

        {renderLassoAiPill()}
      </div>
    );
  }

  // Mode 3: Pen or Highlighter active
  if (activeTool === 'pen' || activeTool === 'highlighter') {
    const isHighlighter = activeTool === 'highlighter';
    const currentSwatches = inkSwatches;
    const currentColor = inkColor;
    const isCustomColor = !currentSwatches.some(
      (sw) => sw.toLowerCase() === currentColor.toLowerCase(),
    );
    const thicknessPresets = isHighlighter
      ? HIGHLIGHTER_THICKNESS_PRESETS
      : PEN_THICKNESS_PRESETS;
    const currentSize = isHighlighter ? highlighterSize : penSize;
    const matchesPreset = thicknessPresets.some((p) => Math.abs(currentSize - p) < 0.25);
    const sliderMin = isHighlighter ? 6 : 1;
    const sliderMax = isHighlighter ? 48 : 15;
    const sliderStep = isHighlighter ? 1 : 0.5;
    const formattedSize = Number.isInteger(currentSize)
      ? String(currentSize)
      : String(Number(currentSize.toFixed(1)));
    const previewDotPx = isHighlighter
      ? Math.max(6, Math.min(16, currentSize * 0.34))
      : Math.max(2, Math.min(15, currentSize));

    return (
      <div
        data-testid="contextual-subbar"
        data-mode={activeTool}
        className="folio-glass-island folio-island-morph custom-scrollbar pointer-events-auto flex min-h-[44px] max-w-full shrink-0 items-center justify-start gap-2 overflow-x-auto whitespace-nowrap rounded-2xl px-3 py-1 text-[var(--navy-900)]"
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
                    ? 'folio-glass-active'
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
                  <Check className="h-3 w-3 text-[var(--state-success)]" />
                  <span className="font-bold text-[var(--state-success-text)]">{slotSavedLabel}</span>
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

        {/* Unified Pen & Highlighter Color Swatches + Custom Color */}
        <div
          data-testid="tool-color-swatches"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white px-2 py-1"
        >
          {currentSwatches.map((swatch, idx) => {
            const selected = currentColor.toLowerCase() === swatch.toLowerCase();
            const labelName = UNIFIED_INK_SWATCH_NAMES[swatch] ?? swatch;
            return (
              <button
                key={`${idx}-${swatch}`}
                type="button"
                title={`${labelName} (${swatch})`}
                aria-label={`Select color ${labelName} (${swatch})`}
                aria-pressed={selected}
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
            className={`relative flex h-4.5 w-4.5 cursor-pointer items-center justify-center rounded-full border border-dashed border-[#072D59]/35 text-[10px] font-bold text-white transition-transform duration-150 ${
              isCustomColor
                ? 'scale-110 ring-2 ring-[var(--crimson-500)] ring-offset-1'
                : 'bg-[conic-gradient(from_0deg,#FD6E88,#F59E0B,#10B981,#38BDF8,#A855F7,#FD6E88)] hover:scale-105'
            }`}
            style={isCustomColor ? { backgroundColor: currentColor } : undefined}
          >
            +
            <DebouncedColorInput
              value={currentColor}
              ariaLabel="Custom ink color"
              testId="custom-ink-color-input"
              className="sr-only"
              onPreview={(color) => setActiveColor(color)}
              onCommit={(color) => setActiveColor(color)}
            />
          </label>
        </div>

        {/* Thickness Presets + Precision Slider Trigger */}
        <div
          ref={thicknessPillRef}
          data-testid="thickness-presets-pill"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white px-2 py-0.5"
        >
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
          <div className="mx-0.5 h-3.5 w-px bg-[#072D59]/12" />
          <button
            type="button"
            data-testid="thickness-slider-trigger"
            aria-label="Custom thickness slider"
            aria-expanded={thicknessSliderOpen}
            title={`Precision thickness (${formattedSize} px)`}
            onClick={() => setThicknessSliderOpen((prev) => !prev)}
            className={`inline-flex h-6 w-5 items-center justify-center rounded-md transition duration-150 ${
              !matchesPreset || thicknessSliderOpen
                ? 'bg-[#DBF2FC] text-[#072D59] ring-1 ring-[#072D59]/40'
                : 'text-[#072D59]/70 hover:bg-[#DBF2FC]/55 hover:text-[#072D59]'
            }`}
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-150 ${
                thicknessSliderOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
        </div>

        {thicknessSliderOpen &&
          thicknessPopoverPos &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={thicknessPopoverRef}
              data-testid="thickness-slider-popover"
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                left: `${thicknessPopoverPos.left}px`,
                top: `${thicknessPopoverPos.top}px`,
              }}
              className="folio-popover fixed z-50 w-56 space-y-2.5 rounded-2xl p-3 text-[var(--navy-900)]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5.5 w-5.5 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-canvas)]">
                    <span
                      className="rounded-full"
                      style={{
                        width: `${previewDotPx}px`,
                        height: `${previewDotPx}px`,
                        backgroundColor: currentColor,
                        opacity: isHighlighter ? 0.5 : 1,
                      }}
                    />
                  </span>
                  <span className="text-xs font-bold text-[var(--navy-900)]">
                    Thickness
                  </span>
                </div>
                <span
                  data-testid="thickness-slider-value"
                  className="folio-mono rounded-full bg-[var(--surface-canvas)] px-2 py-0.5 text-[11px] font-bold text-[var(--navy-900)] ring-1 ring-[var(--border-subtle)] tabular-nums"
                >
                  {formattedSize} px
                </span>
              </div>

              <DraggableRangeSlider
                testId="thickness-precision-slider"
                ariaLabel="Precision thickness"
                min={sliderMin}
                max={sliderMax}
                step={sliderStep}
                value={Math.max(sliderMin, Math.min(sliderMax, currentSize))}
                onChange={(val) => setActiveSize(val)}
                onCommit={(val) => setActiveSize(val)}
                className="w-full"
              />

              <div className="flex items-center justify-between text-[10px] font-medium text-[var(--navy-600)] tabular-nums">
                <span>{sliderMin} px</span>
                <span>{sliderMax} px</span>
              </div>
            </div>,
            document.body,
          )}

        {/* Hold-to-Snap Toggle */}
        <button
          type="button"
          title="Draw & hold steady to snap Line, Rectangle, or Circle"
          aria-pressed={holdToSnapEnabled}
          onClick={() => setHoldToSnapEnabled(!holdToSnapEnabled)}
          className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs font-semibold transition duration-150 ${
            holdToSnapEnabled
              ? 'folio-glass-active'
              : 'border-[#072D59]/12 bg-white text-[#072D59]/70 hover:text-[#072D59]'
          }`}
        >
          <span>Hold to Snap {holdToSnapEnabled ? 'On' : 'Off'}</span>
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
        className="folio-glass-island folio-island-morph pointer-events-auto flex min-h-[44px] max-w-full shrink-0 items-center justify-center gap-3 overflow-x-auto rounded-2xl px-3 py-1 text-[var(--navy-900)]"
      >
        <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 py-0.5 shadow-[var(--specular-rim)]">
          <Eraser className="h-3.5 w-3.5 text-[var(--crimson-500)]" />

          {/* Precision vs. Whole-Stroke Segmented Toggle */}
          <div
            ref={eraserModeTrackRef}
            data-testid="eraser-mode-toggle"
            className="folio-segmented-track flex items-center rounded-md p-0.5"
          >
            <MorphingPill indicator={eraserModeIndicator} className="rounded" />
            <button
              type="button"
              data-morph-key="precision"
              data-testid="eraser-mode-precision"
              aria-pressed={eraserMode === 'precision'}
              title="Erase only the exact part of strokes touched by the cursor"
              onClick={() => setEraserMode('precision')}
              className={`folio-press relative z-10 rounded px-2 py-0.5 text-xs font-semibold ${
                eraserMode === 'precision'
                  ? eraserModeIndicator.ready
                    ? 'bg-transparent text-white'
                    : 'folio-glass-active'
                  : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
              }`}
            >
              Precision
            </button>
            <button
              type="button"
              data-morph-key="stroke"
              data-testid="eraser-mode-stroke"
              aria-pressed={eraserMode === 'stroke'}
              title="Erase entire touched stroke at once"
              onClick={() => setEraserMode('stroke')}
              className={`folio-press relative z-10 rounded px-2 py-0.5 text-xs font-semibold ${
                eraserMode === 'stroke'
                  ? eraserModeIndicator.ready
                    ? 'bg-transparent text-white'
                    : 'folio-glass-active'
                  : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
              }`}
            >
              Stroke
            </button>
          </div>

          <div className="mx-0.5 h-4 w-px bg-[var(--border-subtle)]" />

          {/* Eraser Size Presets (S = 8px, M = 18px, L = 34px) */}
          <div ref={eraserSizeTrackRef} className="relative flex items-center gap-0.5">
            <MorphingPill indicator={eraserSizeIndicator} className="rounded-md" />
            {ERASER_SIZE_PRESETS.map(({ label, radius }) => {
              const active = eraserSize === radius;
              return (
                <button
                  key={label}
                  type="button"
                  data-morph-key={String(radius)}
                  data-testid={`eraser-size-${label.toLowerCase()}`}
                  aria-label={`Eraser radius ${radius}`}
                  aria-pressed={active}
                  onClick={() => setEraserSize(radius)}
                  className={`folio-press relative z-10 rounded-md px-2 py-0.5 text-xs font-bold ${
                    active
                      ? eraserSizeIndicator.ready
                        ? 'bg-transparent text-white'
                        : 'folio-glass-active'
                      : 'text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {activePage &&
          hasContent &&
          (!confirmClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="folio-press inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--state-danger-border)] bg-[var(--surface-elevated)] px-2.5 text-xs font-semibold text-[var(--state-danger-text)] hover:bg-[var(--state-danger-bg)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear Page
            </button>
          ) : (
            <div className="flex items-center gap-1.5 rounded-lg border border-[var(--state-danger-border)] bg-[var(--state-danger-bg)] px-2 py-0.5">
              <span className="text-xs font-semibold text-[var(--navy-900)]">
                Clear unlocked?
              </span>
              <button
                type="button"
                onClick={() => {
                  clearPageAnnotations(activePage.id);
                  setConfirmClear(false);
                }}
                className="folio-btn-danger rounded px-2 py-0.5 text-xs font-semibold"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="folio-press rounded px-2 py-0.5 text-xs font-medium text-[var(--navy-600)] hover:bg-[var(--surface-elevated)] hover:text-[var(--navy-900)]"
              >
                Cancel
              </button>
            </div>
          ))}
      </div>
    );
  }

  // Mode 4b: ColorDrop Fill active
  if (activeTool === 'fill') {
    return (
      <div
        data-testid="contextual-subbar"
        data-mode="fill"
        className="folio-glass-island folio-island-morph pointer-events-auto flex min-h-[44px] max-w-full shrink-0 items-center justify-center gap-2.5 overflow-x-auto rounded-2xl px-3 py-1 text-[var(--navy-900)]"
      >
        <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--navy-900)]">
          <PaintBucket className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
          <span>ColorDrop Fill</span>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 py-1">
          {inkSwatches.map((swatch, idx) => (
            <button
              key={`fill-${idx}-${swatch}`}
              type="button"
              title={UNIFIED_INK_SWATCH_NAMES[swatch] ?? swatch}
              aria-label={`Fill color ${swatch}`}
              onClick={() => setActiveColor(swatch)}
              className={`h-4.5 w-4.5 rounded-full border border-black/15 transition ${
                inkColor.toLowerCase() === swatch.toLowerCase()
                  ? 'scale-110 ring-2 ring-[var(--crimson-500)] ring-offset-1'
                  : 'hover:scale-105'
              }`}
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>
        <span className="hidden text-[11px] font-medium text-[var(--navy-600)] sm:inline">
          Click inside an enclosed shape to fill
        </span>
      </div>
    );
  }

  // Mode 4c: Eyedropper active
  if (activeTool === 'eyedropper') {
    return (
      <div
        data-testid="contextual-subbar"
        data-mode="eyedropper"
        className="folio-glass-island folio-island-morph pointer-events-auto flex min-h-[44px] max-w-full shrink-0 items-center justify-center gap-2.5 rounded-2xl px-3.5 py-1 text-[var(--navy-900)]"
      >
        <Pipette className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
        <span className="text-xs font-bold">Eyedropper</span>
        <span
          className="h-4 w-4 rounded-full border border-black/15"
          style={{ backgroundColor: inkColor }}
        />
        <span className="text-[11px] font-medium text-[var(--navy-600)]">
          Click anywhere on the canvas to sample ink color
        </span>
      </div>
    );
  }

  // Mode 5: Universal Select / Text / Lasso with no selection — keep canvas uncluttered
  return null;
};
