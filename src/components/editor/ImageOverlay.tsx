import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Move } from 'lucide-react';
import {
  type AlignmentGuide,
  computeDragAlignment,
  getTextboxBoundsList,
} from '../../canvas/alignment';
import {
  type CornerHandle,
  cropImageFromSide,
  panCropInsideFrame,
  resizeImageFromCorner,
  type SideHandle,
} from '../../canvas/imageRenderer';
import {
  expandSelectionWithGroups,
  type PageElementSelection,
} from '../../canvas/selection';
import { useAppStore } from '../../store/useAppStore';
import type { ImageCropRect, Page, PageImage } from '../../types/notes';
import type { CanvasContextMenuState } from './CanvasContextMenu';

interface ImageOverlayProps {
  page: Page;
  zoom: number;
  spacePressed?: boolean;
  hiddenImageIds?: ReadonlySet<string>;
  onActiveOverlayImageChange?: (imageId: string | null) => void;
  onGuidesChange?: (guides: AlignmentGuide[]) => void;
  onStartMultiDrag?: (
    e: React.PointerEvent<HTMLElement>,
    sel: PageElementSelection,
  ) => void;
  onContextMenuRequest?: (menu: CanvasContextMenuState) => void;
}

const SMALL_WIDTH_PX = 44;
const SMALL_HEIGHT_PX = 30;

export const ImageOverlay: React.FC<ImageOverlayProps> = ({
  page,
  zoom,
  spacePressed = false,
  hiddenImageIds,
  onActiveOverlayImageChange,
  onGuidesChange,
  onStartMultiDrag,
  onContextMenuRequest,
}) => {
  const activeTool = useAppStore((s) => s.activeTool);
  const selectedImageIds = useAppStore((s) => s.selectedImageIds);
  const selectedTextboxIds = useAppStore((s) => s.selectedTextboxIds);
  const lassoSelection = useAppStore((s) => s.lassoSelection);
  const croppingImageId = useAppStore((s) => s.croppingImageId);
  const selectImage = useAppStore((s) => s.selectImage);
  const setUnifiedSelection = useAppStore((s) => s.setUnifiedSelection);
  const toggleElementInSelection = useAppStore((s) => s.toggleElementInSelection);
  const setCroppingImageId = useAppStore((s) => s.setCroppingImageId);
  const commitImageMutation = useAppStore((s) => s.commitImageMutation);
  const altCloneImage = useAppStore((s) => s.altCloneImage);
  const commitAltImageDrag = useAppStore((s) => s.commitAltImageDrag);

  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const [liveTransform, setLiveTransform] = useState<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    crop: ImageCropRect;
    pillText: string;
    showGhostBackdrop: boolean;
  } | null>(null);

  const dragRef = useRef<{
    kind: 'move' | 'resize' | 'crop' | 'crop-pan';
    corner?: CornerHandle;
    side?: SideHandle;
    pointerId: number;
    image: PageImage;
    prevImagesSnapshot: PageImage[] | null;
    startClientX: number;
    startClientY: number;
    hasMoved: boolean;
  } | null>(null);

  const images = useMemo(
    () => [...(page.images ?? [])].sort((a, b) => a.zIndex - b.zIndex),
    [page.images],
  );
  const selectedSet = useMemo(() => new Set(selectedImageIds), [selectedImageIds]);
  const primaryImageId = selectedImageIds[0] ?? null;

  // Notify PageCanvas whenever an image is actively being transformed or crop-panned in DOM
  useEffect(() => {
    const activeId = liveTransform?.id ?? croppingImageId ?? null;
    onActiveOverlayImageChange?.(activeId);
  }, [liveTransform?.id, croppingImageId, onActiveOverlayImageChange]);

  // Clear hover when leaving pan mode or switching page
  useEffect(() => {
    if (activeTool !== 'pan' || spacePressed) {
      setHoveredId(null);
    }
  }, [activeTool, spacePressed, page.id]);

  if (images.length === 0) return null;

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
    img: PageImage,
    kind: 'move' | 'resize' | 'crop' | 'crop-pan',
    opts?: {
      corner?: CornerHandle;
      side?: SideHandle;
      captureEl?: HTMLElement;
    },
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const targetEl = opts?.captureEl ?? e.currentTarget;
    targetEl.setPointerCapture(e.pointerId);

    if (!selectedSet.has(img.id)) {
      selectImage(img.id);
    }

    let targetImg = img;
    let prevSnapshot: PageImage[] | null = null;

    if (kind === 'move' && e.altKey) {
      prevSnapshot = [...(page.images ?? [])];
      const cloned = altCloneImage(page.id, img.id);
      if (cloned) {
        targetImg = cloned;
      } else {
        prevSnapshot = null;
      }
    }

    dragRef.current = {
      kind,
      corner: opts?.corner,
      side: opts?.side,
      pointerId: e.pointerId,
      image: targetImg,
      prevImagesSnapshot: prevSnapshot,
      startClientX: e.clientX,
      startClientY: e.clientY,
      hasMoved: false,
    };

    const pillText =
      kind === 'move'
        ? `X: ${Math.round(targetImg.x)}, Y: ${Math.round(targetImg.y)}`
        : kind === 'crop' || kind === 'crop-pan'
          ? `Crop ${Math.round(targetImg.width)} × ${Math.round(targetImg.height)}`
          : `${Math.round(targetImg.width)} × ${Math.round(targetImg.height)} px`;

    setLiveTransform({
      id: targetImg.id,
      x: targetImg.x,
      y: targetImg.y,
      width: targetImg.width,
      height: targetImg.height,
      crop: targetImg.crop ?? { x: 0, y: 0, width: 1, height: 1 },
      pillText,
      showGhostBackdrop: kind === 'crop' || kind === 'crop-pan',
    });
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
    }

    const rawDx = (e.clientX - drag.startClientX) / zoom;
    const rawDy = (e.clientY - drag.startClientY) / zoom;

    if (drag.kind === 'move') {
      if (!drag.hasMoved && !drag.prevImagesSnapshot) return;
      const exclude = new Set<string>([drag.image.id]);
      const otherBounds = getTextboxBoundsList(
        page.textboxes ?? [],
        exclude,
        page.images ?? [],
        page.strokes,
      );
      const { dx, dy, guides } = computeDragAlignment({
        originBounds: {
          minX: drag.image.x,
          minY: drag.image.y,
          maxX: drag.image.x + drag.image.width,
          maxY: drag.image.y + drag.image.height,
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
        -drag.image.width + 20,
        Math.min(page.paper.width - 20, drag.image.x + dx),
      );
      const nextY = Math.max(
        -drag.image.height + 20,
        Math.min(page.paper.height - 20, drag.image.y + dy),
      );
      onGuidesChange?.(guides);
      setLiveTransform({
        id: drag.image.id,
        x: nextX,
        y: nextY,
        width: drag.image.width,
        height: drag.image.height,
        crop: drag.image.crop,
        pillText: `X: ${Math.round(nextX)}, Y: ${Math.round(nextY)}`,
        showGhostBackdrop: false,
      });
    } else if (drag.kind === 'resize' && drag.corner) {
      const next = resizeImageFromCorner(
        drag.image,
        drag.corner,
        rawDx,
        rawDy,
        20,
      );
      setLiveTransform({
        id: drag.image.id,
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
        crop: drag.image.crop,
        pillText: `${Math.round(next.width)} × ${Math.round(next.height)} px`,
        showGhostBackdrop: false,
      });
    } else if (drag.kind === 'crop' && drag.side) {
      const next = cropImageFromSide(drag.image, drag.side, rawDx, rawDy, 24);
      setLiveTransform({
        id: drag.image.id,
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
        crop: next.crop,
        pillText: `Crop ${Math.round(next.width)} × ${Math.round(next.height)}`,
        showGhostBackdrop: true,
      });
    } else if (drag.kind === 'crop-pan') {
      const nextCrop = panCropInsideFrame(drag.image, rawDx, rawDy);
      setLiveTransform({
        id: drag.image.id,
        x: drag.image.x,
        y: drag.image.y,
        width: drag.image.width,
        height: drag.image.height,
        crop: nextCrop,
        pillText: `Pan photo`,
        showGhostBackdrop: true,
      });
    }
  };

  const handleDragEnd = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    dragRef.current = null;
    onGuidesChange?.([]);

    const finalTransform = liveTransform;
    setLiveTransform(null);
    if (!finalTransform) return;

    if (drag.kind === 'move' && !drag.hasMoved && !drag.prevImagesSnapshot) {
      return;
    }

    const patch: Partial<PageImage> = {
      x: finalTransform.x,
      y: finalTransform.y,
      width: finalTransform.width,
      height: finalTransform.height,
      crop: finalTransform.crop,
    };

    if (drag.prevImagesSnapshot) {
      commitAltImageDrag(
        page.id,
        drag.prevImagesSnapshot,
        drag.image.id,
        patch,
      );
    } else {
      commitImageMutation(page.id, drag.image.id, patch);
    }
  };

  const corners: Array<{
    key: CornerHandle;
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

  const sides: Array<{
    key: SideHandle;
    btnClass: string;
    pillClass: string;
    label: string;
  }> = [
    {
      key: 'top',
      btnClass: 'left-1/2 -top-2.5 h-5 w-8 -translate-x-1/2 cursor-ns-resize',
      pillClass: 'h-[5px] w-4',
      label: 'Crop top edge',
    },
    {
      key: 'bottom',
      btnClass: 'left-1/2 -bottom-2.5 h-5 w-8 -translate-x-1/2 cursor-ns-resize',
      pillClass: 'h-[5px] w-4',
      label: 'Crop bottom edge',
    },
    {
      key: 'left',
      btnClass: '-left-2.5 top-1/2 h-8 w-5 -translate-y-1/2 cursor-ew-resize',
      pillClass: 'h-4 w-[5px]',
      label: 'Crop left edge',
    },
    {
      key: 'right',
      btnClass: '-right-2.5 top-1/2 h-8 w-5 -translate-y-1/2 cursor-ew-resize',
      pillClass: 'h-4 w-[5px]',
      label: 'Crop right edge',
    },
  ];

  return (
    <>
      {images.map((img) => {
        if (hiddenImageIds?.has(img.id)) return null;
        const isSelected = selectedSet.has(img.id);
        const isPrimary = img.id === primaryImageId;
        const isCropping = croppingImageId === img.id;
        const isMultiSelected = isSelected && totalSelectedCount > 1 && !isCropping;

        if (!isSelected && !canInteractUnselected) {
          return null;
        }

        const effective: PageImage =
          liveTransform && liveTransform.id === img.id
            ? {
                ...img,
                x: liveTransform.x,
                y: liveTransform.y,
                width: liveTransform.width,
                height: liveTransform.height,
                crop: liveTransform.crop,
              }
            : img;

        const leftPx = effective.x * zoom;
        const topPx = effective.y * zoom;
        const widthPx = effective.width * zoom;
        const heightPx = effective.height * zoom;
        const crop = effective.crop ?? { x: 0, y: 0, width: 1, height: 1 };
        const fullW = widthPx / Math.max(0.02, crop.width);
        const fullH = heightPx / Math.max(0.02, crop.height);
        const imgLeftPx = -crop.x * fullW;
        const imgTopPx = -crop.y * fullH;

        const isActivelyTransforming = Boolean(
          liveTransform && liveTransform.id === img.id,
        );
        const showDomPreview = isActivelyTransforming || isCropping;
        const showGhostBackdrop =
          isCropping ||
          Boolean(
            isActivelyTransforming && liveTransform?.showGhostBackdrop,
          );
        const isHovered = !isSelected && hoveredId === img.id;
        const isSmallElement =
          widthPx < SMALL_WIDTH_PX || heightPx < SMALL_HEIGHT_PX;
        const isLocked = Boolean(effective.locked);
        const showSingleHandles = isPrimary && !isMultiSelected && !isLocked;

        return (
          <div
            key={img.id}
            data-testid={
              isPrimary && !isMultiSelected
                ? 'image-box'
                : isSelected
                  ? `image-box-${img.id}`
                  : `image-hit-${img.id}`
            }
            data-cropping={isCropping ? 'true' : 'false'}
            data-locked={isLocked ? 'true' : 'false'}
            onPointerEnter={() => {
              if (!isSelected && canInteractUnselected) setHoveredId(img.id);
            }}
            onPointerLeave={() => {
              if (hoveredId === img.id) setHoveredId(null);
            }}
            onPointerDown={(e) => {
              if (spacePressed) return;
              if (!isSelected && !canInteractUnselected) return;
              if (e.button !== 0) {
                e.stopPropagation();
                return;
              }
              if (e.shiftKey && canInteractUnselected && !isCropping) {
                e.preventDefault();
                e.stopPropagation();
                toggleElementInSelection(page.id, { kind: 'image', id: img.id });
                return;
              }
              if (img.groupId && !isSelected && !isCropping) {
                const expanded = expandSelectionWithGroups(page, {
                  strokeIds: [],
                  textboxIds: [],
                  imageIds: [img.id],
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
                  selectImage(img.id);
                }
                return;
              }
              handleDragStart(
                e,
                effective,
                isCropping ? 'crop-pan' : 'move',
                { captureEl: e.currentTarget },
              );
            }}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
            onDoubleClick={(e) => {
              if (spacePressed || isLocked) return;
              if (!isSelected && !canInteractUnselected) return;
              e.stopPropagation();
              setCroppingImageId(isCropping ? null : img.id);
            }}
            onContextMenu={(e) => {
              if (spacePressed) return;
              if (!isSelected && !canInteractUnselected) return;
              e.preventDefault();
              e.stopPropagation();
              if (!isSelected) {
                selectImage(img.id);
              }
              onContextMenuRequest?.({
                pageId: page.id,
                clientX: e.clientX,
                clientY: e.clientY,
                targetType: 'image',
                imageId: img.id,
              });
            }}
            style={{
              left: `${leftPx}px`,
              top: `${topPx}px`,
              width: `${widthPx}px`,
              height: `${heightPx}px`,
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
              isCropping
                ? 'cursor-grab active:cursor-grabbing'
                : isLocked
                  ? 'cursor-default'
                  : 'cursor-move'
            }`}
          >
            {/* Generous +4px outer pointer tolerance zone */}
            {!isCropping && !isLocked && !isMultiSelected && (
              <div
                aria-hidden="true"
                className="absolute -inset-1 cursor-move bg-transparent"
              />
            )}

            {/* Hover outline test marker for unselected hover checks */}
            {isHovered && (
              <div
                data-testid="image-hover-outline"
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

            {/* Dimmed uncropped source backdrop during crop / crop-pan mode */}
            {showGhostBackdrop && (
              <div
                style={{
                  transform: `scale(${effective.flipX ? -1 : 1}, ${
                    effective.flipY ? -1 : 1
                  })`,
                  opacity: Math.max(0.15, (effective.opacity ?? 1) * 0.35),
                }}
                className="pointer-events-none absolute inset-0 overflow-visible"
              >
                <img
                  src={effective.dataUrl}
                  alt=""
                  draggable={false}
                  style={{
                    left: `${imgLeftPx}px`,
                    top: `${imgTopPx}px`,
                    width: `${fullW}px`,
                    height: `${fullH}px`,
                    maxWidth: 'none',
                  }}
                  className="pointer-events-none absolute select-none"
                />
              </div>
            )}

            {/* Clipped sharp foreground preview during live drag/resize/crop/crop-pan */}
            {showDomPreview && (
              <div
                style={{
                  borderRadius: `${(effective.borderRadius ?? 0) * zoom}px`,
                  opacity: effective.opacity ?? 1,
                  transform: `scale(${effective.flipX ? -1 : 1}, ${
                    effective.flipY ? -1 : 1
                  })`,
                }}
                className="pointer-events-none absolute inset-0 overflow-hidden"
              >
                <img
                  src={effective.dataUrl}
                  alt=""
                  draggable={false}
                  style={{
                    left: `${imgLeftPx}px`,
                    top: `${imgTopPx}px`,
                    width: `${fullW}px`,
                    height: `${fullH}px`,
                    maxWidth: 'none',
                  }}
                  className="pointer-events-none absolute select-none"
                />
              </div>
            )}

            {/* Done Cropping chip when in double-click crop-pan mode */}
            {isCropping && (
              <button
                type="button"
                data-testid="crop-done-btn"
                onMouseDown={(e) => e.preventDefault()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setCroppingImageId(null);
                }}
                className="folio-btn-navy absolute -top-8 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold shadow-sm"
              >
                Done cropping
              </button>
            )}

            {/* Canva-style 4 corner proportional resize & 4 side non-destructive crop handles */}
            {showSingleHandles && (
              <>
                {!isCropping &&
                  corners.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      data-testid={`image-handle-${c.key}`}
                      title="Drag corner to resize proportionally"
                      aria-label={c.label}
                      onMouseDown={(e) => e.preventDefault()}
                      onPointerDown={(e) =>
                        handleDragStart(e, effective, 'resize', { corner: c.key })
                      }
                      onPointerMove={handleDragMove}
                      onPointerUp={handleDragEnd}
                      onPointerCancel={handleDragEnd}
                      className={`group absolute ${c.posClass} z-20 flex h-6 w-6 items-center justify-center bg-transparent ${c.cursorClass}`}
                    >
                      <span className="block h-2.5 w-2.5 rounded-full border-[1.5px] border-[#072D59] bg-white shadow-xs transition-transform group-hover:scale-110" />
                    </button>
                  ))}

                {sides.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    data-testid={`image-crop-${s.key}`}
                    title="Drag side pill to crop"
                    aria-label={s.label}
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) =>
                      handleDragStart(e, effective, 'crop', { side: s.key })
                    }
                    onPointerMove={handleDragMove}
                    onPointerUp={handleDragEnd}
                    onPointerCancel={handleDragEnd}
                    className={`group absolute ${s.btnClass} z-20 flex items-center justify-center bg-transparent`}
                  >
                    <span
                      className={`block ${s.pillClass} rounded-full border-[1.5px] border-[#072D59] bg-white shadow-xs transition-transform group-hover:scale-110`}
                    />
                  </button>
                ))}

                {/* Smart compact floating move handle ONLY when element is very small */}
                {isSmallElement && !isCropping && (
                  <button
                    type="button"
                    data-testid="small-element-move-handle"
                    title="Drag to move small image"
                    aria-label="Drag to move small image"
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) => handleDragStart(e, effective, 'move')}
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

            {/* Live Coordinate / Dimension Pill */}
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
