import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Move } from 'lucide-react';
import {
  type AlignmentGuide,
  computeDragAlignment,
  getTextboxBoundsList,
} from '../../canvas/alignment';
import {
  isSmartDarkApplicable,
  resolveSmartDarkInkColor,
} from '../../canvas/paperRenderer';
import {
  expandSelectionWithGroups,
  isBoundsOffPage,
  type PageElementSelection,
} from '../../canvas/selection';
import {
  isPointOnTextboxText,
  MAX_ELEMENT_DIMENSION,
  MAX_TEXTBOX_FONT_SIZE,
  measureTextboxLayout,
  MIN_TEXTBOX_FONT_SIZE,
  resolveTextboxCaretOffsetAtPoint,
  TEXTBOX_FONT_STACKS,
  type TextboxLayout,
} from '../../canvas/textLayout';
import { useAppStore } from '../../store/useAppStore';
import type { Page, Textbox } from '../../types/notes';
import type { CanvasContextMenuState } from './CanvasContextMenu';

interface TextboxOverlayProps {
  page: Page;
  zoom: number;
  spacePressed?: boolean;
  isWhiteboard?: boolean;
  hiddenTextboxIds?: ReadonlySet<string>;
  ignoreDoubleClickUntilRef?: { readonly current: number };
  onDraggingTextboxChange?: (textboxId: string | null) => void;
  onGuidesChange?: (guides: AlignmentGuide[]) => void;
  onOffPageDragChange?: (pos: { clientX: number; clientY: number } | null) => void;
  onStartMultiDrag?: (
    e: React.PointerEvent<HTMLElement>,
    sel: PageElementSelection,
  ) => void;
  onContextMenuRequest?: (menu: CanvasContextMenuState) => void;
}

type CornerKey = 'tl' | 'tr' | 'bl' | 'br';

const SMALL_WIDTH_PX = 44;
const SMALL_HEIGHT_PX = 30;
export const TEXTBOX_FRAME_PAD_X = 14;
export const TEXTBOX_FRAME_PAD_Y = 9;

export const TextboxOverlay: React.FC<TextboxOverlayProps> = ({
  page,
  zoom,
  spacePressed = false,
  isWhiteboard = false,
  hiddenTextboxIds,
  ignoreDoubleClickUntilRef,
  onDraggingTextboxChange,
  onGuidesChange,
  onOffPageDragChange,
  onStartMultiDrag,
  onContextMenuRequest,
}) => {
  const activeTool = useAppStore((s) => s.activeTool);
  const darkPaperView = useAppStore((s) => s.darkPaperView);
  const smartDarkActive = isSmartDarkApplicable(page.paper.paperColor, darkPaperView);
  const activeTextboxId = useAppStore((s) => s.activeTextboxId);
  const selectedTextboxIds = useAppStore((s) => s.selectedTextboxIds);
  const selectedImageIds = useAppStore((s) => s.selectedImageIds);
  const lassoSelection = useAppStore((s) => s.lassoSelection);
  const selectTextbox = useAppStore((s) => s.selectTextbox);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const setUnifiedSelection = useAppStore((s) => s.setUnifiedSelection);
  const toggleElementInSelection = useAppStore((s) => s.toggleElementInSelection);
  const updateTextboxLive = useAppStore((s) => s.updateTextboxLive);
  const commitTextboxSession = useAppStore((s) => s.commitTextboxSession);
  const commitTextboxMutation = useAppStore((s) => s.commitTextboxMutation);
  const altCloneTextbox = useAppStore((s) => s.altCloneTextbox);
  const commitAltTextboxDrag = useAppStore((s) => s.commitAltTextboxDrag);
  const beginEditTextbox = useAppStore((s) => s.beginEditTextbox);
  const copyTextboxStyle = useAppStore((s) => s.copyTextboxStyle);
  const pasteTextboxStyle = useAppStore((s) => s.pasteTextboxStyle);
  const deleteElementsOffPage = useAppStore((s) => s.deleteElementsOffPage);
  const revertAltCloneSnapshot = useAppStore((s) => s.revertAltCloneSnapshot);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sawTextareaKeyDownRef = useRef(false);
  const initialSpawnCharRef = useRef<string | null>(null);
  const pendingCaretOffsetRef = useRef<{ textboxId: string; offset: number } | null>(null);

  const [hoverState, setHoverState] = useState<{ id: string; zone: 'text' | 'move' } | null>(null);

  type LiveTextboxTransform = {
    id: string;
    x: number;
    y: number;
    fontSize: number;
    wrapWidth?: number;
    pillText: string;
    isOffPage?: boolean;
  };
  const [liveTransform, setLiveTransform] = useState<LiveTextboxTransform | null>(null);
  const latestTransformRef = useRef<LiveTextboxTransform | null>(null);

  const updateLiveTransform = (next: LiveTextboxTransform | null) => {
    latestTransformRef.current = next;
    setLiveTransform(next);
  };

  const dragRef = useRef<{
    kind: 'move' | 'scale' | 'wrap';
    corner?: CornerKey;
    pointerId: number;
    textbox: Textbox;
    prevTextboxesSnapshot: Textbox[] | null;
    startClientX: number;
    startClientY: number;
    startWidth: number;
    startHeight: number;
    hasMoved: boolean;
    startedOnText: boolean;
    clickLocalX: number;
    clickLocalY: number;
    dragThresholdPx: number;
  } | null>(null);

  const textboxes = page.textboxes ?? [];
  const selectedSet = useMemo(() => {
    const s = new Set(selectedTextboxIds);
    if (activeTextboxId) s.add(activeTextboxId);
    return s;
  }, [selectedTextboxIds, activeTextboxId]);

  const primaryTextboxId = useMemo(() => {
    if (activeTextboxId) return activeTextboxId;
    if (selectedTextboxIds.length > 0) return selectedTextboxIds[0];
    return null;
  }, [activeTextboxId, selectedTextboxIds]);

  const primaryTextbox = useMemo(
    () =>
      primaryTextboxId
        ? textboxes.find((tb) => tb.id === primaryTextboxId) ?? null
        : null,
    [textboxes, primaryTextboxId],
  );

  const isEditingPrimary = Boolean(
    primaryTextbox && activeTextboxId === primaryTextbox.id,
  );

  // Auto-focus & position caret at clicked glyph (or end on new spawn / double-click fallback)
  useEffect(() => {
    if (!isEditingPrimary || !textareaRef.current || !primaryTextbox) return;
    sawTextareaKeyDownRef.current = false;
    initialSpawnCharRef.current =
      primaryTextbox.text.length === 1 ? primaryTextbox.text : null;
    const el = textareaRef.current;
    el.focus();
    const len = el.value.length;
    const pending = pendingCaretOffsetRef.current;
    if (pending && pending.textboxId === primaryTextbox.id) {
      pendingCaretOffsetRef.current = null;
      const clamped = Math.max(0, Math.min(len, pending.offset));
      el.setSelectionRange(clamped, clamped);
    } else {
      el.setSelectionRange(len, len);
    }
  }, [isEditingPrimary, primaryTextbox?.id]);

  // Clear hover when leaving pan mode or switching page
  useEffect(() => {
    if (activeTool !== 'pan' || spacePressed) {
      setHoverState(null);
    }
  }, [activeTool, spacePressed, page.id]);

  if (textboxes.length === 0) return null;

  const totalSelectedCount =
    selectedTextboxIds.length +
    selectedImageIds.length +
    (lassoSelection?.pageId === page.id ? lassoSelection.strokeIds.length : 0);
  const canInteractUnselected = activeTool === 'pan' && !spacePressed;

  const isSelectionGroupLocked = (sel: PageElementSelection): boolean => {
    const sSet = new Set(sel.strokeIds);
    const tSet = new Set(sel.textboxIds);
    const iSet = new Set(sel.imageIds);
    return (
      page.strokes.some((s) => sSet.has(s.id) && s.locked) ||
      (page.textboxes ?? []).some((t) => tSet.has(t.id) && t.locked) ||
      (page.images ?? []).some((im) => iSet.has(im.id) && im.locked)
    );
  };

  const getHoverZoneForEvent = (
    e: { clientX: number; clientY: number; target?: EventTarget | null },
    el: HTMLElement,
    tb: Textbox,
    layout: TextboxLayout,
  ): { zone: 'text' | 'move'; localX: number; localY: number } => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { zone: 'move', localX: 0, localY: 0 };
    }
    const safeZoom = Math.max(0.005, zoom);
    const localX = (e.clientX - rect.left) / safeZoom;
    const localY = (e.clientY - rect.top) / safeZoom;
    if (e.target instanceof HTMLElement && e.target.closest('button')) {
      return { zone: 'move', localX, localY };
    }
    return {
      zone: isPointOnTextboxText(localX, localY, tb, layout) ? 'text' : 'move',
      localX,
      localY,
    };
  };

  const handleDragStart = (
    e: React.PointerEvent<HTMLElement>,
    tb: Textbox,
    kind: 'move' | 'scale' | 'wrap',
    corner?: CornerKey,
    captureEl?: HTMLElement,
    hitInfo?: { startedOnText: boolean; clickLocalX: number; clickLocalY: number },
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const targetEl = captureEl ?? e.currentTarget;
    targetEl.setPointerCapture(e.pointerId);

    // One-motion selection when dragging an unselected textbox directly
    if (!selectedSet.has(tb.id)) {
      selectTextbox(tb.id);
    }

    let targetTb = tb;
    let prevSnapshot: Textbox[] | null = null;

    if (kind === 'move' && e.altKey) {
      prevSnapshot = [...textboxes];
      const cloned = altCloneTextbox(page.id, tb.id);
      if (cloned) {
        targetTb = cloned;
      } else {
        prevSnapshot = null;
      }
    }

    const startLayout = measureTextboxLayout(targetTb);
    const startedOnText = kind === 'move' && Boolean(hitInfo?.startedOnText);
    dragRef.current = {
      kind,
      corner,
      pointerId: e.pointerId,
      textbox: targetTb,
      prevTextboxesSnapshot: prevSnapshot,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startWidth: startLayout.width,
      startHeight: startLayout.height,
      hasMoved: false,
      startedOnText,
      clickLocalX: hitInfo?.clickLocalX ?? 0,
      clickLocalY: hitInfo?.clickLocalY ?? 0,
      dragThresholdPx: startedOnText ? 3 : 2,
    };
    updateLiveTransform({
      id: targetTb.id,
      x: targetTb.x,
      y: targetTb.y,
      fontSize: targetTb.fontSize,
      wrapWidth: targetTb.wrapWidth,
      pillText:
        kind === 'move'
          ? `X: ${Math.round(targetTb.x)}, Y: ${Math.round(targetTb.y)}`
          : `${Math.round(startLayout.width)} × ${Math.round(startLayout.height)} · ${targetTb.fontSize}pt`,
      isOffPage: false,
    });
    if (kind !== 'move' || prevSnapshot) {
      onDraggingTextboxChange?.(targetTb.id);
    }
  };

  const handleDragMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();

    const distPx = Math.hypot(
      e.clientX - drag.startClientX,
      e.clientY - drag.startClientY,
    );
    if (!drag.hasMoved && distPx >= drag.dragThresholdPx) {
      drag.hasMoved = true;
      onDraggingTextboxChange?.(drag.textbox.id);
    }

    const rawDx = (e.clientX - drag.startClientX) / zoom;
    const rawDy = (e.clientY - drag.startClientY) / zoom;

    if (drag.kind === 'move') {
      if (!drag.hasMoved && !drag.prevTextboxesSnapshot) return;
      const exclude = new Set<string>([drag.textbox.id]);
      const otherBounds = getTextboxBoundsList(
        textboxes,
        exclude,
        page.images ?? [],
        page.strokes,
      );
      const { dx, dy, guides } = computeDragAlignment({
        originBounds: {
          minX: drag.textbox.x,
          minY: drag.textbox.y,
          maxX: drag.textbox.x + drag.startWidth,
          maxY: drag.textbox.y + drag.startHeight,
        },
        rawDx,
        rawDy,
        paper: page.paper,
        otherTextboxBounds: otherBounds,
        axisLock: e.shiftKey,
        bypassSnap: e.ctrlKey || e.metaKey,
        snapThreshold: 5,
        isWhiteboard,
      });

      const candX = drag.textbox.x + dx;
      const candY = drag.textbox.y + dy;
      const offPage = isWhiteboard
        ? false
        : isBoundsOffPage(
            {
              minX: candX,
              minY: candY,
              maxX: candX + drag.startWidth,
              maxY: candY + drag.startHeight,
            },
            page.paper,
          );

      onGuidesChange?.(offPage ? [] : guides);
      onOffPageDragChange?.(offPage ? { clientX: e.clientX, clientY: e.clientY } : null);

      updateLiveTransform({
        id: drag.textbox.id,
        x: candX,
        y: candY,
        fontSize: drag.textbox.fontSize,
        wrapWidth: drag.textbox.wrapWidth,
        pillText: `X: ${Math.round(candX)}, Y: ${Math.round(candY)}`,
        isOffPage: offPage,
      });
    } else if (drag.kind === 'scale') {
      const corner = drag.corner ?? 'br';
      const signX = corner === 'tl' || corner === 'bl' ? -1 : 1;
      const signY = corner === 'tl' || corner === 'tr' ? -1 : 1;
      const orientedDx = rawDx * signX;
      const orientedDy = rawDy * signY;
      const aspect = drag.startWidth / Math.max(10, drag.startHeight);
      const diagDelta =
        Math.abs(orientedDx) >= Math.abs(orientedDy * aspect)
          ? orientedDx
          : orientedDy * aspect;

      const ratio = Math.max(
        0.05,
        (drag.startWidth + diagDelta) / Math.max(12, drag.startWidth),
      );
      const nextFontSize = Math.max(
        MIN_TEXTBOX_FONT_SIZE,
        Math.min(MAX_TEXTBOX_FONT_SIZE, Math.round(drag.textbox.fontSize * ratio)),
      );
      const nextWrap = drag.textbox.wrapWidth
        ? Math.max(
            24,
            Math.min(
              MAX_ELEMENT_DIMENSION,
              Math.round(
                drag.textbox.wrapWidth * (nextFontSize / drag.textbox.fontSize),
              ),
            ),
          )
        : undefined;
      const previewLayout = measureTextboxLayout({
        ...drag.textbox,
        fontSize: nextFontSize,
        wrapWidth: nextWrap,
      });

      // Anchor opposite corner when scaling from left or top corners
      const nextX =
        corner === 'tl' || corner === 'bl'
          ? drag.textbox.x + (drag.startWidth - previewLayout.width)
          : drag.textbox.x;
      const nextY =
        corner === 'tl' || corner === 'tr'
          ? drag.textbox.y + (drag.startHeight - previewLayout.height)
          : drag.textbox.y;

      updateLiveTransform({
        id: drag.textbox.id,
        x: nextX,
        y: nextY,
        fontSize: nextFontSize,
        wrapWidth: nextWrap,
        pillText: `${Math.round(previewLayout.width)} × ${Math.round(previewLayout.height)} · ${nextFontSize}pt`,
        isOffPage: false,
      });
    } else {
      const nextWrap = Math.max(
        24,
        Math.min(MAX_ELEMENT_DIMENSION, Math.round(drag.startWidth + rawDx)),
      );
      const previewLayout = measureTextboxLayout({
        ...drag.textbox,
        wrapWidth: nextWrap,
      });
      updateLiveTransform({
        id: drag.textbox.id,
        x: drag.textbox.x,
        y: drag.textbox.y,
        fontSize: drag.textbox.fontSize,
        wrapWidth: nextWrap,
        pillText: `${Math.round(previewLayout.width)} × ${Math.round(previewLayout.height)} · Wrap`,
        isOffPage: false,
      });
    }
  };

  const handleDragEnd = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    dragRef.current = null;
    onDraggingTextboxChange?.(null);
    onGuidesChange?.([]);
    onOffPageDragChange?.(null);

    const finalTransform = latestTransformRef.current;
    updateLiveTransform(null);
    if (!finalTransform) return;

    // Pure click without drag: enter editing directly if the user clicked on actual text,
    // or keep selected cleanly without no-op Undo entry when clicking blank space / border.
    if (drag.kind === 'move' && !drag.hasMoved && !drag.prevTextboxesSnapshot) {
      if (drag.startedOnText && !drag.textbox.locked) {
        const offset = resolveTextboxCaretOffsetAtPoint(
          drag.clickLocalX,
          drag.clickLocalY,
          drag.textbox,
        );
        pendingCaretOffsetRef.current = {
          textboxId: drag.textbox.id,
          offset,
        };
        beginEditTextbox(page.id, drag.textbox.id);
      }
      return;
    }

    if (drag.kind === 'move' && finalTransform.isOffPage && !drag.textbox.locked) {
      if (drag.prevTextboxesSnapshot) {
        revertAltCloneSnapshot(page.id, { textboxes: drag.prevTextboxesSnapshot });
      } else {
        deleteElementsOffPage(page.id, {
          strokeIds: [],
          textboxIds: [drag.textbox.id],
          imageIds: [],
        });
      }
      return;
    }

    const committedX =
      drag.kind === 'move' && !isWhiteboard
        ? Math.max(0, Math.min(page.paper.width - 12, finalTransform.x))
        : finalTransform.x;
    const committedY =
      drag.kind === 'move' && !isWhiteboard
        ? Math.max(0, Math.min(page.paper.height - 12, finalTransform.y))
        : finalTransform.y;

    const patch: Partial<Textbox> = {
      x: committedX,
      y: committedY,
      fontSize: finalTransform.fontSize,
      wrapWidth: finalTransform.wrapWidth,
    };

    if (drag.prevTextboxesSnapshot) {
      commitAltTextboxDrag(
        page.id,
        drag.prevTextboxesSnapshot,
        drag.textbox.id,
        patch,
      );
    } else if (activeTextboxId === drag.textbox.id) {
      updateTextboxLive(page.id, drag.textbox.id, patch);
    } else {
      commitTextboxMutation(page.id, drag.textbox.id, patch);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!primaryTextbox) return;
    sawTextareaKeyDownRef.current = true;
    initialSpawnCharRef.current = null;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      commitTextboxSession(page.id, primaryTextbox.id, true);
      return;
    }

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.altKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      e.stopPropagation();
      copyTextboxStyle(page.id, primaryTextbox.id);
      return;
    }
    if (mod && e.altKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      e.stopPropagation();
      pasteTextboxStyle(page.id, [primaryTextbox.id]);
      return;
    }
    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      e.stopPropagation();
      updateTextboxLive(page.id, primaryTextbox.id, {
        bold: !primaryTextbox.bold,
      });
      return;
    }
    if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      e.stopPropagation();
      updateTextboxLive(page.id, primaryTextbox.id, {
        italic: !primaryTextbox.italic,
      });
      return;
    }
    if (mod && e.shiftKey && (e.key === '>' || e.key === '.')) {
      e.preventDefault();
      e.stopPropagation();
      updateTextboxLive(page.id, primaryTextbox.id, {
        fontSize: Math.min(MAX_TEXTBOX_FONT_SIZE, primaryTextbox.fontSize + 1),
      });
      return;
    }
    if (mod && e.shiftKey && (e.key === '<' || e.key === ',')) {
      e.preventDefault();
      e.stopPropagation();
      updateTextboxLive(page.id, primaryTextbox.id, {
        fontSize: Math.max(MIN_TEXTBOX_FONT_SIZE, primaryTextbox.fontSize - 1),
      });
      return;
    }

    e.stopPropagation();
  };

  const handleBeforeInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const nativeData = (e.nativeEvent as unknown as { data?: string | null })
      .data;
    if (
      !sawTextareaKeyDownRef.current &&
      initialSpawnCharRef.current &&
      nativeData === initialSpawnCharRef.current
    ) {
      e.preventDefault();
      initialSpawnCharRef.current = null;
    }
  };

  const corners: Array<{
    key: CornerKey;
    posClass: string;
    cursorClass: string;
    label: string;
  }> = [
    {
      key: 'tl',
      posClass: '-left-3 -top-3',
      cursorClass: 'cursor-nwse-resize',
      label: 'Resize top-left corner',
    },
    {
      key: 'tr',
      posClass: '-right-3 -top-3',
      cursorClass: 'cursor-nesw-resize',
      label: 'Resize top-right corner',
    },
    {
      key: 'bl',
      posClass: '-left-3 -bottom-3',
      cursorClass: 'cursor-nesw-resize',
      label: 'Resize bottom-left corner',
    },
    {
      key: 'br',
      posClass: '-right-3 -bottom-3',
      cursorClass: 'cursor-nwse-resize',
      label: 'Resize bottom-right corner',
    },
  ];

  return (
    <>
      {textboxes.map((tb) => {
        if (hiddenTextboxIds?.has(tb.id)) return null;
        const isSelected = selectedSet.has(tb.id);
        const isPrimary = tb.id === primaryTextboxId;
        const isEditing = isPrimary && activeTextboxId === tb.id;
        const isMultiSelected = isSelected && totalSelectedCount > 1 && !isEditing;

        if (!isSelected && !canInteractUnselected) {
          return null;
        }

        const effectiveTb: Textbox =
          liveTransform && liveTransform.id === tb.id
            ? {
                ...tb,
                x: liveTransform.x,
                y: liveTransform.y,
                fontSize: liveTransform.fontSize,
                wrapWidth: liveTransform.wrapWidth,
              }
            : tb;

        const layout = measureTextboxLayout(effectiveTb);
        const leftPx = effectiveTb.x * zoom;
        const topPx = effectiveTb.y * zoom;
        const widthPx = layout.width * zoom;
        const heightPx = layout.height * zoom;
        const isActivelyTransforming = Boolean(
          liveTransform && liveTransform.id === tb.id,
        );
        const displayColor = resolveSmartDarkInkColor(
          effectiveTb.color,
          smartDarkActive,
          false,
        );
        const isHovered = !isSelected && hoverState?.id === tb.id;
        const isSmallElement =
          widthPx < SMALL_WIDTH_PX || heightPx < SMALL_HEIGHT_PX;
        const isLocked = Boolean(effectiveTb.locked);
        const showSingleHandles = isPrimary && !isMultiSelected && !isLocked;
        const isOffPagePreview = Boolean(isActivelyTransforming && liveTransform?.isOffPage);
        const activeHoverZone: 'text' | 'move' = isActivelyTransforming
          ? 'move'
          : isEditing
            ? 'text'
            : hoverState?.id === tb.id
              ? hoverState.zone
              : 'move';

        const showFrame = isSelected || isHovered || isOffPagePreview;
        const frameBorder = isOffPagePreview
          ? '1.5px dashed #FD6E88'
          : isSelected
            ? isMultiSelected
              ? '1px dashed rgba(7, 45, 89, 0.38)'
              : isLocked
                ? '1.5px dashed rgba(7, 45, 89, 0.65)'
                : '1.5px solid #072D59'
            : isHovered
              ? '1.5px solid rgba(7, 45, 89, 0.5)'
              : 'none';

        return (
          <div
            key={tb.id}
            data-testid={
              isPrimary && !isMultiSelected
                ? 'textbox-box'
                : isSelected
                  ? `textbox-box-${tb.id}`
                  : `textbox-hit-${tb.id}`
            }
            data-editing={isEditing ? 'true' : 'false'}
            data-locked={isLocked ? 'true' : 'false'}
            data-off-page-drag={isOffPagePreview ? 'true' : 'false'}
            data-hover-zone={isLocked ? 'locked' : activeHoverZone}
            onPointerEnter={(e) => {
              if (
                !isEditing &&
                !isLocked &&
                !isMultiSelected &&
                !spacePressed &&
                (isSelected || canInteractUnselected)
              ) {
                const { zone } = getHoverZoneForEvent(e, e.currentTarget, effectiveTb, layout);
                setHoverState((prev) =>
                  prev?.id === tb.id && prev.zone === zone ? prev : { id: tb.id, zone },
                );
              }
            }}
            onPointerLeave={() => {
              if (hoverState?.id === tb.id) setHoverState(null);
            }}
            onPointerDown={(e) => {
              if (e.button === 1) return;
              if (spacePressed) return;
              if (!isSelected && !canInteractUnselected) return;
              if (isEditing) {
                e.stopPropagation();
                return;
              }
              if (e.button === 2 && !isSelected && (activeTool === 'pan' || activeTool === 'pen')) {
                return;
              }
              if (e.button !== 0) {
                e.stopPropagation();
                return;
              }
              if (e.shiftKey && canInteractUnselected) {
                e.preventDefault();
                e.stopPropagation();
                toggleElementInSelection(page.id, { kind: 'textbox', id: tb.id });
                return;
              }
              if (tb.groupId && !isSelected) {
                const expanded = expandSelectionWithGroups(page, {
                  strokeIds: [],
                  textboxIds: [tb.id],
                  imageIds: [],
                });
                const memberCount =
                  expanded.strokeIds.length +
                  expanded.textboxIds.length +
                  expanded.imageIds.length;
                if (memberCount > 1) {
                  e.preventDefault();
                  e.stopPropagation();
                  setUnifiedSelection(page.id, expanded, { expandGroups: false });
                  if (!isSelectionGroupLocked(expanded)) {
                    onStartMultiDrag?.(e, expanded);
                  }
                  return;
                }
              }
              if (isLocked) {
                e.preventDefault();
                e.stopPropagation();
                if (!isSelected) {
                  selectTextbox(tb.id);
                }
                return;
              }
              const hitInfo = getHoverZoneForEvent(e, e.currentTarget, effectiveTb, layout);
              handleDragStart(e, effectiveTb, 'move', undefined, e.currentTarget, {
                startedOnText: hitInfo.zone === 'text',
                clickLocalX: hitInfo.localX,
                clickLocalY: hitInfo.localY,
              });
            }}
            onPointerMove={(e) => {
              if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
                handleDragMove(e);
                return;
              }
              if (
                !isEditing &&
                !isLocked &&
                !isMultiSelected &&
                !spacePressed &&
                (isSelected || canInteractUnselected)
              ) {
                const { zone } = getHoverZoneForEvent(e, e.currentTarget, effectiveTb, layout);
                setHoverState((prev) =>
                  prev?.id === tb.id && prev.zone === zone ? prev : { id: tb.id, zone },
                );
              }
            }}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
            onDoubleClick={(e) => {
              if (spacePressed) return;
              if (
                activeTool !== 'pen' &&
                ignoreDoubleClickUntilRef &&
                Date.now() < ignoreDoubleClickUntilRef.current
              ) {
                e.stopPropagation();
                return;
              }
              if (activeTool === 'pen') {
                e.stopPropagation();
                setActiveTool('pan');
                selectTextbox(tb.id);
                return;
              }
              if (!isSelected && !canInteractUnselected) return;
              e.stopPropagation();
              if (!isEditing && !isLocked) {
                const rect = e.currentTarget.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  const safeZoom = Math.max(0.005, zoom);
                  const localX = (e.clientX - rect.left) / safeZoom;
                  const localY = (e.clientY - rect.top) / safeZoom;
                  pendingCaretOffsetRef.current = {
                    textboxId: tb.id,
                    offset: resolveTextboxCaretOffsetAtPoint(localX, localY, effectiveTb, layout),
                  };
                }
                beginEditTextbox(page.id, tb.id);
              }
            }}
            onContextMenu={(e) => {
              if (spacePressed) return;
              if (!isSelected && !canInteractUnselected) return;
              if (!isSelected && (activeTool === 'pan' || activeTool === 'pen')) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              e.preventDefault();
              e.stopPropagation();
              if (!isSelected) {
                selectTextbox(tb.id);
              }
              onContextMenuRequest?.({
                pageId: page.id,
                clientX: e.clientX,
                clientY: e.clientY,
                targetType: 'textbox',
                textboxId: tb.id,
              });
            }}
            style={{
              left: `${leftPx}px`,
              top: `${topPx}px`,
              width: `${widthPx}px`,
              height: `${heightPx}px`,
              padding: 0,
              opacity: isOffPagePreview ? 0.45 : undefined,
            }}
            className={`absolute overflow-visible ${
              spacePressed || isMultiSelected ? 'pointer-events-none' : 'pointer-events-auto'
            } ${isSelected ? (isMultiSelected ? 'z-10' : 'z-20') : 'z-10'} ${
              isEditing
                ? 'cursor-text'
                : isLocked
                  ? 'cursor-default'
                  : activeHoverZone === 'text'
                    ? 'cursor-text'
                    : 'cursor-move'
            }`}
          >
            {/* Padded outer hit-tolerance zone matching visual selection frame */}
            {!isEditing && !isLocked && !isMultiSelected && (
              <div
                aria-hidden="true"
                style={{
                  cursor: 'inherit',
                  left: `-${TEXTBOX_FRAME_PAD_X}px`,
                  top: `-${TEXTBOX_FRAME_PAD_Y}px`,
                  right: `-${TEXTBOX_FRAME_PAD_X}px`,
                  bottom: `-${TEXTBOX_FRAME_PAD_Y}px`,
                }}
                className="pointer-events-auto absolute bg-transparent"
              />
            )}

            {/* Preview glyphs when dragging/scaling while not in active text editing */}
            {!isEditing && isActivelyTransforming && (
              <div
                style={
                  {
                    marginTop: `${layout.domMarginTop * zoom}px`,
                    marginLeft: `${layout.leftOffset * zoom}px`,
                    padding: 0,
                    fontFamily: TEXTBOX_FONT_STACKS[effectiveTb.fontFamily],
                    fontSize: `${effectiveTb.fontSize * zoom}px`,
                    fontWeight: effectiveTb.bold ? 700 : 400,
                    fontStyle: effectiveTb.italic ? 'italic' : 'normal',
                    lineHeight: `${layout.cssLineHeight * zoom}px`,
                    color: displayColor,
                    whiteSpace: effectiveTb.wrapWidth ? 'pre-wrap' : 'pre',
                    textBoxTrim: 'trim-both',
                  } as React.CSSProperties
                }
                className="pointer-events-none select-none"
              >
                {effectiveTb.text}
              </div>
            )}

            {/* Active airtight <textarea> aligned sub-pixel exact with Canvas 2D TextMetrics */}
            {isEditing && (
              <textarea
                ref={textareaRef}
                data-testid="textbox-textarea"
                value={effectiveTb.text}
                wrap={effectiveTb.wrapWidth ? 'soft' : 'off'}
                onChange={(e) =>
                  updateTextboxLive(page.id, tb.id, { text: e.target.value })
                }
                onBeforeInput={handleBeforeInput}
                onKeyDown={handleKeyDown}
                onBlur={(e) => {
                  const nextFocused = e.relatedTarget as HTMLElement | null;
                  const keepSelected = Boolean(
                    nextFocused?.closest('[data-testid="contextual-subbar"]'),
                  );
                  commitTextboxSession(page.id, tb.id, keepSelected);
                }}
                style={
                  {
                    padding: 0,
                    margin: 0,
                    marginTop: `${layout.domMarginTop * zoom}px`,
                    marginLeft: `${layout.leftOffset * zoom}px`,
                    width: `${Math.ceil((layout.width + (effectiveTb.wrapWidth ? 2 : 16)) * zoom)}px`,
                    height: `${Math.ceil(
                      (layout.height +
                        Math.abs(layout.domMarginTop) +
                        layout.fontDescent +
                        10) *
                        zoom,
                    )}px`,
                    border: 0,
                    outline: 'none',
                    resize: 'none',
                    overflow: 'hidden',
                    background: 'transparent',
                    textBoxTrim: 'trim-both',
                    fontFamily: TEXTBOX_FONT_STACKS[effectiveTb.fontFamily],
                    fontSize: `${effectiveTb.fontSize * zoom}px`,
                    fontWeight: effectiveTb.bold ? 700 : 400,
                    fontStyle: effectiveTb.italic ? 'italic' : 'normal',
                    lineHeight: `${layout.cssLineHeight * zoom}px`,
                    color: displayColor,
                    caretColor: displayColor,
                    whiteSpace: effectiveTb.wrapWidth ? 'pre-wrap' : 'pre',
                    wordBreak: effectiveTb.wrapWidth ? 'break-word' : 'normal',
                  } as React.CSSProperties
                }
              />
            )}

            {/* Padded selection/hover frame + anchored handles with comfortable breathing room */}
            {showFrame && (
              <div
                data-testid="textbox-selection-frame"
                style={{
                  left: `-${TEXTBOX_FRAME_PAD_X}px`,
                  top: `-${TEXTBOX_FRAME_PAD_Y}px`,
                  right: `-${TEXTBOX_FRAME_PAD_X}px`,
                  bottom: `-${TEXTBOX_FRAME_PAD_Y}px`,
                  border: frameBorder,
                }}
                className="pointer-events-none absolute rounded-[3px]"
              >
                {isHovered && (
                  <div
                    data-testid="textbox-hover-outline"
                    className="pointer-events-none absolute inset-0"
                  />
                )}

                {isPrimary && !isMultiSelected && isLocked && (
                  <span
                    data-testid="element-lock-badge"
                    title="Locked element — unlock from top bar or right-click menu"
                    className="pointer-events-none absolute -top-3.5 right-0 inline-flex items-center gap-1 rounded-full border border-[#072D59]/20 bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#072D59] shadow-sm"
                  >
                    <Lock className="h-2.5 w-2.5 text-[#FD6E88]" />
                    <span>Locked</span>
                  </span>
                )}

                {/* Border-strip drag targets along the padded frame while actively editing */}
                {isEditing && (
                  <>
                    <div
                      title="Drag border to move textbox"
                      onMouseDown={(e) => e.preventDefault()}
                      onPointerDown={(e) =>
                        handleDragStart(e, effectiveTb, 'move')
                      }
                      onPointerMove={handleDragMove}
                      onPointerUp={handleDragEnd}
                      onPointerCancel={handleDragEnd}
                      className="pointer-events-auto absolute -top-1.5 left-2 right-2 h-2.5 cursor-move bg-transparent"
                    />
                    <div
                      title="Drag border to move textbox"
                      onMouseDown={(e) => e.preventDefault()}
                      onPointerDown={(e) =>
                        handleDragStart(e, effectiveTb, 'move')
                      }
                      onPointerMove={handleDragMove}
                      onPointerUp={handleDragEnd}
                      onPointerCancel={handleDragEnd}
                      className="pointer-events-auto absolute -bottom-1.5 left-2 right-2 h-2.5 cursor-move bg-transparent"
                    />
                    <div
                      title="Drag border to move textbox"
                      onMouseDown={(e) => e.preventDefault()}
                      onPointerDown={(e) =>
                        handleDragStart(e, effectiveTb, 'move')
                      }
                      onPointerMove={handleDragMove}
                      onPointerUp={handleDragEnd}
                      onPointerCancel={handleDragEnd}
                      className="pointer-events-auto absolute -left-1.5 bottom-2 top-2 w-3 cursor-move bg-transparent"
                    />
                    <div
                      title="Drag border to move textbox"
                      onMouseDown={(e) => e.preventDefault()}
                      onPointerDown={(e) =>
                        handleDragStart(e, effectiveTb, 'move')
                      }
                      onPointerMove={handleDragMove}
                      onPointerUp={handleDragEnd}
                      onPointerCancel={handleDragEnd}
                      className="pointer-events-auto absolute -right-1.5 bottom-2 top-2 w-3 cursor-move bg-transparent"
                    />
                  </>
                )}

                {/* Canva-style corner & side handles ONLY on single unlocked primary selected textbox */}
                {showSingleHandles && (
                  <>
                    {corners.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        data-testid={`textbox-handle-${c.key}`}
                        title="Drag corner (or Shift+Drag) to scale"
                        aria-label={c.label}
                        onMouseDown={(e) => e.preventDefault()}
                        onPointerDown={(e) =>
                          handleDragStart(e, effectiveTb, 'scale', c.key)
                        }
                        onPointerMove={handleDragMove}
                        onPointerUp={handleDragEnd}
                        onPointerCancel={handleDragEnd}
                        className={`pointer-events-auto group absolute ${c.posClass} z-10 flex h-6 w-6 items-center justify-center bg-transparent ${c.cursorClass}`}
                      >
                        <span className="block h-2.5 w-2.5 rounded-full border-[1.5px] border-[#072D59] bg-white shadow-xs transition-transform group-hover:scale-110" />
                      </button>
                    ))}

                    {/* Right-edge pill handle for text wrap width */}
                    <button
                      type="button"
                      data-testid="textbox-handle-wrap"
                      title="Drag to adjust text wrap width"
                      aria-label="Resize textbox wrap width"
                      onMouseDown={(e) => e.preventDefault()}
                      onPointerDown={(e) =>
                        handleDragStart(e, effectiveTb, 'wrap')
                      }
                      onPointerMove={handleDragMove}
                      onPointerUp={handleDragEnd}
                      onPointerCancel={handleDragEnd}
                      className="pointer-events-auto group absolute -right-2.5 top-1/2 z-10 flex h-7 w-5 -translate-y-1/2 cursor-ew-resize items-center justify-center bg-transparent"
                    >
                      <span className="block h-4 w-[5px] rounded-full border-[1.5px] border-[#072D59] bg-white shadow-xs transition-transform group-hover:scale-110" />
                    </button>

                    {/* Smart compact floating move handle ONLY when element is very small */}
                    {isSmallElement && (
                      <button
                        type="button"
                        data-testid="small-element-move-handle"
                        title="Drag to move small element"
                        aria-label="Drag to move small textbox"
                        onMouseDown={(e) => e.preventDefault()}
                        onPointerDown={(e) =>
                          handleDragStart(e, effectiveTb, 'move')
                        }
                        onPointerMove={handleDragMove}
                        onPointerUp={handleDragEnd}
                        onPointerCancel={handleDragEnd}
                        className="pointer-events-auto absolute left-1/2 top-full z-20 mt-2.5 flex h-6 w-6 -translate-x-1/2 cursor-move items-center justify-center rounded-full border border-[#072D59] bg-white text-[#072D59] shadow-sm hover:bg-[#DBF2FC]"
                      >
                        <Move className="h-3 w-3" />
                      </button>
                    )}
                  </>
                )}

                {/* Live Coordinate / Dimension Pill while dragging or scaling */}
                {isActivelyTransforming && liveTransform && !liveTransform.isOffPage && (
                  <div
                    data-testid="live-drag-pill"
                    className={`folio-mono pointer-events-none absolute left-1/2 top-full z-30 ${
                      isSmallElement ? 'mt-10' : 'mt-2.5'
                    } folio-glass-badge -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-semibold`}
                  >
                    {liveTransform.pillText}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};
