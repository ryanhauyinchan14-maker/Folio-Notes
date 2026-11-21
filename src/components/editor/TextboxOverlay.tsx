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
  type PageElementSelection,
} from '../../canvas/selection';
import {
  measureTextboxLayout,
  TEXTBOX_FONT_STACKS,
} from '../../canvas/textLayout';
import { useAppStore } from '../../store/useAppStore';
import type { Page, Textbox } from '../../types/notes';
import type { CanvasContextMenuState } from './CanvasContextMenu';

interface TextboxOverlayProps {
  page: Page;
  zoom: number;
  spacePressed?: boolean;
  hiddenTextboxIds?: ReadonlySet<string>;
  onDraggingTextboxChange?: (textboxId: string | null) => void;
  onGuidesChange?: (guides: AlignmentGuide[]) => void;
  onStartMultiDrag?: (
    e: React.PointerEvent<HTMLElement>,
    sel: PageElementSelection,
  ) => void;
  onContextMenuRequest?: (menu: CanvasContextMenuState) => void;
}

type CornerKey = 'tl' | 'tr' | 'bl' | 'br';

const SMALL_WIDTH_PX = 44;
const SMALL_HEIGHT_PX = 30;

export const TextboxOverlay: React.FC<TextboxOverlayProps> = ({
  page,
  zoom,
  spacePressed = false,
  hiddenTextboxIds,
  onDraggingTextboxChange,
  onGuidesChange,
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

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sawTextareaKeyDownRef = useRef(false);
  const initialSpawnCharRef = useRef<string | null>(null);

  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const [liveTransform, setLiveTransform] = useState<{
    id: string;
    x: number;
    y: number;
    fontSize: number;
    wrapWidth?: number;
    pillText: string;
  } | null>(null);

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

  // Auto-focus & put caret at end when entering active editing
  useEffect(() => {
    if (!isEditingPrimary || !textareaRef.current) return;
    sawTextareaKeyDownRef.current = false;
    initialSpawnCharRef.current =
      primaryTextbox?.text.length === 1 ? primaryTextbox.text : null;
    const el = textareaRef.current;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [isEditingPrimary, primaryTextbox?.id]);

  // Clear hover when leaving pan mode or switching page
  useEffect(() => {
    if (activeTool !== 'pan' || spacePressed) {
      setHoveredId(null);
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

  const handleDragStart = (
    e: React.PointerEvent<HTMLElement>,
    tb: Textbox,
    kind: 'move' | 'scale' | 'wrap',
    corner?: CornerKey,
    captureEl?: HTMLElement,
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
    };
    setLiveTransform({
      id: targetTb.id,
      x: targetTb.x,
      y: targetTb.y,
      fontSize: targetTb.fontSize,
      wrapWidth: targetTb.wrapWidth,
      pillText:
        kind === 'move'
          ? `X: ${Math.round(targetTb.x)}, Y: ${Math.round(targetTb.y)}`
          : `${Math.round(startLayout.width)} × ${Math.round(startLayout.height)} · ${targetTb.fontSize}pt`,
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
    if (!drag.hasMoved && distPx >= 2) {
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
      });

      const nextX = Math.max(
        0,
        Math.min(page.paper.width - 12, drag.textbox.x + dx),
      );
      const nextY = Math.max(
        0,
        Math.min(page.paper.height - 12, drag.textbox.y + dy),
      );
      onGuidesChange?.(guides);
      setLiveTransform({
        id: drag.textbox.id,
        x: nextX,
        y: nextY,
        fontSize: drag.textbox.fontSize,
        wrapWidth: drag.textbox.wrapWidth,
        pillText: `X: ${Math.round(nextX)}, Y: ${Math.round(nextY)}`,
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
        0.35,
        (drag.startWidth + diagDelta) / Math.max(12, drag.startWidth),
      );
      const nextFontSize = Math.max(
        10,
        Math.min(96, Math.round(drag.textbox.fontSize * ratio)),
      );
      const nextWrap = drag.textbox.wrapWidth
        ? Math.max(
            40,
            Math.round(
              drag.textbox.wrapWidth * (nextFontSize / drag.textbox.fontSize),
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

      setLiveTransform({
        id: drag.textbox.id,
        x: nextX,
        y: nextY,
        fontSize: nextFontSize,
        wrapWidth: nextWrap,
        pillText: `${Math.round(previewLayout.width)} × ${Math.round(previewLayout.height)} · ${nextFontSize}pt`,
      });
    } else {
      const nextWrap = Math.max(48, Math.round(drag.startWidth + rawDx));
      const previewLayout = measureTextboxLayout({
        ...drag.textbox,
        wrapWidth: nextWrap,
      });
      setLiveTransform({
        id: drag.textbox.id,
        x: drag.textbox.x,
        y: drag.textbox.y,
        fontSize: drag.textbox.fontSize,
        wrapWidth: nextWrap,
        pillText: `${Math.round(previewLayout.width)} × ${Math.round(previewLayout.height)} · Wrap`,
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

    const finalTransform = liveTransform;
    setLiveTransform(null);
    if (!finalTransform) return;

    // Pure click without drag shouldn't create a no-op Undo entry
    if (drag.kind === 'move' && !drag.hasMoved && !drag.prevTextboxesSnapshot) {
      return;
    }

    const patch: Partial<Textbox> = {
      x: finalTransform.x,
      y: finalTransform.y,
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
        fontSize: Math.min(96, primaryTextbox.fontSize + 1),
      });
      return;
    }
    if (mod && e.shiftKey && (e.key === '<' || e.key === ',')) {
      e.preventDefault();
      e.stopPropagation();
      updateTextboxLive(page.id, primaryTextbox.id, {
        fontSize: Math.max(10, primaryTextbox.fontSize - 1),
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
        const isHovered = !isSelected && hoveredId === tb.id;
        const isSmallElement =
          widthPx < SMALL_WIDTH_PX || heightPx < SMALL_HEIGHT_PX;
        const isLocked = Boolean(effectiveTb.locked);
        const showSingleHandles = isPrimary && !isMultiSelected && !isLocked;

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
            onPointerEnter={() => {
              if (!isSelected && canInteractUnselected) setHoveredId(tb.id);
            }}
            onPointerLeave={() => {
              if (hoveredId === tb.id) setHoveredId(null);
            }}
            onPointerDown={(e) => {
              if (spacePressed) return;
              if (!isSelected && !canInteractUnselected) return;
              if (isEditing) {
                e.stopPropagation();
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
              handleDragStart(e, effectiveTb, 'move', undefined, e.currentTarget);
            }}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
            onDoubleClick={(e) => {
              if (spacePressed) return;
              if (!isSelected && !canInteractUnselected) return;
              e.stopPropagation();
              if (!isEditing && !isLocked) {
                beginEditTextbox(page.id, tb.id);
              }
            }}
            onContextMenu={(e) => {
              if (spacePressed) return;
              if (!isSelected && !canInteractUnselected) return;
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
              outline: isSelected
                ? isMultiSelected
                  ? '1px dashed rgba(7, 45, 89, 0.38)'
                  : isLocked
                    ? '1.5px dashed rgba(7, 45, 89, 0.65)'
                    : '1.5px solid #072D59'
                : isHovered
                  ? '1.5px solid rgba(7, 45, 89, 0.5)'
                  : 'none',
              outlineOffset: '0px',
            }}
            className={`absolute overflow-visible ${
              spacePressed || isMultiSelected ? 'pointer-events-none' : ''
            } ${isSelected ? (isMultiSelected ? 'z-10' : 'z-20') : 'z-10'} ${
              isEditing ? 'cursor-text' : isLocked ? 'cursor-default' : 'cursor-move'
            }`}
          >
            {/* Generous +4px outer pointer tolerance zone */}
            {!isEditing && !isLocked && !isMultiSelected && (
              <div
                aria-hidden="true"
                className="absolute -inset-1 cursor-move bg-transparent"
              />
            )}

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
                className="pointer-events-none absolute -top-3 right-0 inline-flex items-center gap-1 rounded-full border border-[#072D59]/20 bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#072D59] shadow-sm"
              >
                <Lock className="h-2.5 w-2.5 text-[#FD6E88]" />
                <span>Locked</span>
              </span>
            )}

            {/* Border-strip drag targets while actively editing text */}
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
                  className="absolute -top-1.5 left-1 right-1 h-2 cursor-move bg-transparent"
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
                  className="absolute -bottom-1.5 left-1 right-1 h-2 cursor-move bg-transparent"
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
                  className="absolute -left-1.5 bottom-1 top-1 w-2 cursor-move bg-transparent"
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
                  className="absolute -right-1.5 bottom-1 top-1 w-2 cursor-move bg-transparent"
                />
              </>
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
                onBlur={() => {
                  commitTextboxSession(page.id, tb.id, false);
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
                    className={`group absolute ${c.posClass} z-10 flex h-6 w-6 items-center justify-center bg-transparent ${c.cursorClass}`}
                  >
                    <span className="block h-2.5 w-2.5 rounded-full border-[1.5px] border-[#072D59] bg-white shadow-xs transition-transform group-hover:scale-110" />
                  </button>
                ))}

                {/* Right-edge pill handle for text wrap width with >=6px hit-slop */}
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
                  className="group absolute -right-2.5 top-1/2 z-10 flex h-7 w-5 -translate-y-1/2 cursor-ew-resize items-center justify-center bg-transparent"
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
                    className="absolute left-1/2 top-full z-20 mt-2 flex h-6 w-6 -translate-x-1/2 cursor-move items-center justify-center rounded-full border border-[#072D59] bg-white text-[#072D59] shadow-sm hover:bg-[#DBF2FC]"
                  >
                    <Move className="h-3 w-3" />
                  </button>
                )}
              </>
            )}

            {/* Live Coordinate / Dimension Pill while dragging or scaling */}
            {isActivelyTransforming && liveTransform && (
              <div
                data-testid="live-drag-pill"
                className={`folio-mono pointer-events-none absolute left-1/2 top-full z-30 ${
                  isSmallElement ? 'mt-9' : 'mt-2'
                } -translate-x-1/2 whitespace-nowrap rounded-full bg-[#072D59]/95 px-2.5 py-0.5 text-[10px] font-semibold text-white shadow-md`}
              >
                {liveTransform.pillText}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};
