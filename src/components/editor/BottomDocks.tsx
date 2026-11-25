import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eraser,
  Highlighter,
  ImagePlus,
  Lasso,
  Maximize2,
  Minus,
  MousePointer2,
  PenTool,
  Plus,
  Type,
} from 'lucide-react';
import {
  getNotebookMinZoom,
  NOTEBOOK_MAX_ZOOM,
  stepCanvasZoom,
  WHITEBOARD_MAX_ZOOM,
  WHITEBOARD_MIN_ZOOM,
} from '../../canvas/whiteboard';
import { useAppStore } from '../../store/useAppStore';
import type { ToolType } from '../../types/notes';
import { formatShortcutCompact } from '../../utils/shortcuts';
import { MorphingPill, useMorphingIndicator } from '../common/MorphingIndicator';

interface BottomDocksProps {
  isWhiteboard?: boolean;
  pageIndex: number;
  totalPages: number;
  spacePressed: boolean;
  rightClickLassoActive?: boolean;
  drawerOpen?: boolean;
  aiSidebarOpen?: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
  onFitWidth: () => void;
  onFitContent?: () => void;
  onResetView?: () => void;
  onInsertImage?: () => void;
}

const NOTEBOOK_ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const NOTEBOOK_LOW_ZOOM_PRESETS = [0.02, 0.05, 0.1, 0.25];
const WHITEBOARD_ZOOM_PRESETS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5];

export const BottomDocks: React.FC<BottomDocksProps> = ({
  isWhiteboard = false,
  pageIndex,
  totalPages,
  spacePressed,
  rightClickLassoActive = false,
  drawerOpen = false,
  aiSidebarOpen = false,
  onPrevPage,
  onNextPage,
  onFitWidth,
  onFitContent,
  onResetView,
  onInsertImage,
}) => {
  const activeTool = useAppStore((s) => s.activeTool);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const zoom = useAppStore((s) => s.zoom);
  const setZoom = useAppStore((s) => s.setZoom);
  const pages = useAppStore((s) => s.pages);
  const dockPosition = useAppStore((s) => s.dockPosition);
  const keyboardShortcuts = useAppStore((s) => s.keyboardShortcuts);

  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [magneticScales, setMagneticScales] = useState<number[]>([]);
  const [insertImageScale, setInsertImageScale] = useState(1);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  const toolBtnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const insertImageBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const minZoom = isWhiteboard ? WHITEBOARD_MIN_ZOOM : getNotebookMinZoom(pages);
  const maxZoom = isWhiteboard ? WHITEBOARD_MAX_ZOOM : NOTEBOOK_MAX_ZOOM;
  const notebookPresets = [
    ...NOTEBOOK_LOW_ZOOM_PRESETS.filter((z) => z >= minZoom - 0.001),
    ...NOTEBOOK_ZOOM_PRESETS,
  ];
  const zoomPct = zoom * 100;
  const zoomLabel =
    zoomPct < 10 ? `${Number(zoomPct.toFixed(1))}%` : `${Math.round(zoomPct)}%`;

  const effectiveTool: ToolType = spacePressed
    ? 'pan'
    : rightClickLassoActive
      ? 'lasso'
      : activeTool;
  const isVerticalLeft = dockPosition === 'left';
  const toolTrackRef = useRef<HTMLDivElement | null>(null);
  const toolIndicator = useMorphingIndicator(toolTrackRef, effectiveTool, [
    dockPosition,
    Boolean(onInsertImage),
  ]);

  const computeMagneticScale = (el: HTMLElement | null, cursorAxis: number): number => {
    if (!el) return 1;
    const center = isVerticalLeft
      ? el.offsetTop + el.offsetHeight / 2
      : el.offsetLeft + el.offsetWidth / 2;
    const dist = Math.abs(cursorAxis - center);
    const radius = isVerticalLeft ? 92 : 114;
    if (dist >= radius) return 1;
    const influence = Math.cos(((dist / radius) * Math.PI) / 2);
    return Number((1 + 0.24 * influence * influence).toFixed(3));
  };

  const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reducedMotion || e.pointerType === 'touch' || !toolTrackRef.current) return;
    const rect = toolTrackRef.current.getBoundingClientRect();
    const cursorAxis = isVerticalLeft ? e.clientY - rect.top : e.clientX - rect.left;
    setMagneticScales(tools.map((_, idx) => computeMagneticScale(toolBtnRefs.current[idx] ?? null, cursorAxis)));
    setInsertImageScale(computeMagneticScale(insertImageBtnRef.current, cursorAxis));
  };

  const resetMagneticScales = () => {
    setMagneticScales([]);
    setInsertImageScale(1);
  };

  const tools: {
    id: ToolType;
    label: string;
    shortcut: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: 'pan',
      label: 'Select',
      shortcut: formatShortcutCompact(keyboardShortcuts.toolSelect),
      icon: <MousePointer2 className="h-4 w-4" />,
    },
    {
      id: 'pen',
      label: 'Pen',
      shortcut: formatShortcutCompact(keyboardShortcuts.toolPen),
      icon: <PenTool className="h-4 w-4" />,
    },
    {
      id: 'highlighter',
      label: 'Highlighter',
      shortcut: formatShortcutCompact(keyboardShortcuts.toolHighlighter),
      icon: <Highlighter className="h-4 w-4" />,
    },
    {
      id: 'eraser',
      label: 'Eraser',
      shortcut: formatShortcutCompact(keyboardShortcuts.toolEraser),
      icon: <Eraser className="h-4 w-4" />,
    },
    {
      id: 'lasso',
      label: 'Lasso',
      shortcut: formatShortcutCompact(keyboardShortcuts.toolLasso),
      icon: <Lasso className="h-4 w-4" />,
    },
    {
      id: 'text',
      label: 'Text',
      shortcut: formatShortcutCompact(keyboardShortcuts.toolText),
      icon: <Type className="h-4 w-4" />,
    },
  ];
  const insertImageShortcutLabel = formatShortcutCompact(keyboardShortcuts.insertImage);

  const toolDockElement = (
    <nav
      data-testid="bottom-tool-dock"
      data-dock-position={dockPosition}
      aria-label="Drawing and selection tools"
      className={`folio-glass-island pointer-events-auto flex items-center rounded-[20px] ${
        isVerticalLeft
          ? 'custom-scrollbar max-h-[calc(100vh-8rem)] flex-col overflow-y-auto p-1.5'
          : 'max-w-full overflow-x-auto p-1 sm:p-1.5'
      } ${dockPosition === 'bottom' ? 'lg:justify-self-center' : ''}`}
    >
      <div
        ref={toolTrackRef}
        onPointerMove={handleTrackPointerMove}
        onPointerLeave={resetMagneticScales}
        className={`relative flex items-center ${
          isVerticalLeft ? 'flex-col gap-1' : 'gap-0.5 sm:gap-1'
        }`}
      >
        <MorphingPill indicator={toolIndicator} className="rounded-xl" />
        {tools.map((tool, idx) => {
          const active = effectiveTool === tool.id;
          const magScale = reducedMotion ? 1 : (magneticScales[idx] ?? 1);
          const magLift = ((magScale - 1) / 0.24) * 3.5;
          return (
            <button
              key={tool.id}
              ref={(node) => {
                toolBtnRefs.current[idx] = node;
              }}
              type="button"
              data-morph-key={tool.id}
              title={
                tool.id === 'pan'
                  ? `Select (${tool.shortcut}) · Space+Drag to Pan`
                  : `${tool.label} (${tool.shortcut})`
              }
              aria-label={tool.label}
              aria-pressed={active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                setActiveTool(tool.id);
                e.currentTarget.blur();
              }}
              className={`folio-press group relative z-10 flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-semibold sm:px-2.5 sm:py-2 ${
                active
                  ? toolIndicator.ready
                    ? 'bg-transparent text-white'
                    : 'folio-glass-active'
                  : 'text-[var(--navy-600)] hover:bg-[var(--surface-tint)]/75 hover:text-[var(--navy-900)]'
              } ${isVerticalLeft ? 'w-10 flex-col gap-0.5 px-1 py-2' : ''}`}
            >
              <span
                className="inline-flex transition-transform duration-150 ease-out"
                style={
                  magScale > 1.005
                    ? {
                        transform: isVerticalLeft
                          ? `translateX(${magLift}px) scale(${magScale})`
                          : `translateY(${-magLift}px) scale(${magScale})`,
                      }
                    : undefined
                }
              >
                {tool.icon}
              </span>
              {!isVerticalLeft && <span className="hidden 2xl:inline">{tool.label}</span>}
              <span
                className={`folio-mono hidden rounded px-1 text-[10px] font-bold sm:inline ${
                  active
                    ? 'bg-white/20 text-white'
                    : 'bg-[var(--surface-tint)] text-[var(--navy-600)] group-hover:text-[var(--navy-900)]'
                } ${isVerticalLeft ? '!text-[9px] !leading-tight' : ''}`}
              >
                {tool.shortcut}
              </span>
            </button>
          );
        })}
        {onInsertImage && (
          <>
            <div
              className={
                isVerticalLeft
                  ? 'my-0.5 h-px w-6 shrink-0 bg-[var(--border-subtle)]'
                  : 'mx-0.5 h-5 w-px shrink-0 bg-[var(--border-subtle)]'
              }
            />
            <button
              ref={insertImageBtnRef}
              type="button"
              data-testid="insert-image-btn"
              title={`Insert Image (${insertImageShortcutLabel})`}
              aria-label="Image"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.currentTarget.blur();
                onInsertImage();
              }}
              className={`folio-press group relative z-10 flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--crimson-soft)] hover:text-[var(--crimson-600)] sm:px-2.5 sm:py-2 ${
                isVerticalLeft ? 'w-10 flex-col gap-0.5 px-1 py-2' : ''
              }`}
            >
              <span
                className="inline-flex transition-transform duration-150 ease-out"
                style={
                  !reducedMotion && insertImageScale > 1.005
                    ? {
                        transform: isVerticalLeft
                          ? `translateX(${((insertImageScale - 1) / 0.24) * 3.5}px) scale(${insertImageScale})`
                          : `translateY(${-((insertImageScale - 1) / 0.24) * 3.5}px) scale(${insertImageScale})`,
                      }
                    : undefined
                }
              >
                <ImagePlus className="h-4 w-4" />
              </span>
              {!isVerticalLeft && <span className="hidden 2xl:inline">Image</span>}
              <span
                className={`folio-mono hidden rounded bg-[var(--surface-tint)] px-1 text-[10px] font-bold text-[var(--navy-600)] group-hover:bg-[var(--crimson-soft)] group-hover:text-[var(--crimson-600)] sm:inline ${
                  isVerticalLeft ? '!text-[9px] !leading-tight' : ''
                }`}
              >
                {insertImageShortcutLabel}
              </span>
            </button>
          </>
        )}
      </div>
    </nav>
  );

  const zoomPillElement = (
    <div
      data-testid="bottom-zoom-pill"
      className={`folio-glass-island pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-[20px] px-2.5 py-1.5 text-[var(--navy-900)] ${
        aiSidebarOpen ? '' : 'lg:justify-self-end'
      }`}
    >
      {/* Page Nav (Notebooks) OR Fit Content / Reset View (Whiteboard) */}
      {isWhiteboard ? (
        <div className="flex items-center gap-1 border-r border-[var(--border-subtle)] pr-1.5">
          <button
            type="button"
            data-testid="whiteboard-fit-content-btn"
            title={`Fit all whiteboard content in view (${formatShortcutCompact(keyboardShortcuts.fitView)})`}
            onClick={onFitContent}
            className="folio-press inline-flex items-center gap-1 rounded-lg bg-[var(--surface-seal)] px-2 py-1 text-[11px] font-bold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
          >
            <Maximize2 className="h-3 w-3" />
            <span>Fit Content</span>
          </button>
          <button
            type="button"
            data-testid="whiteboard-reset-view-btn"
            title="Reset camera to origin (0, 0) at 100%"
            onClick={onResetView}
            className="folio-press inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
          >
            <Crosshair className="h-3 w-3" />
            <span>Reset View</span>
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5 border-r border-[var(--border-subtle)] pr-1.5">
          <button
            type="button"
            title="Previous Page"
            aria-label="Previous Page"
            disabled={pageIndex <= 0}
            onClick={onPrevPage}
            className="folio-press rounded-lg p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)] disabled:opacity-35"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span
            data-testid="page-counter"
            className="folio-mono whitespace-nowrap px-1.5 text-xs font-bold text-[var(--navy-900)] tabular-nums"
          >
            Page {pageIndex + 1} of {totalPages}
          </span>
          <button
            type="button"
            title="Next Page"
            aria-label="Next Page"
            disabled={pageIndex >= totalPages - 1}
            onClick={onNextPage}
            className="folio-press rounded-lg p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)] disabled:opacity-35"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Zoom Controls */}
      <div className="relative flex items-center gap-0.5">
        <button
          type="button"
          title={`Zoom Out (${formatShortcutCompact(keyboardShortcuts.canvasZoomOut)})`}
          aria-label="Zoom Out"
          onClick={() => setZoom(stepCanvasZoom(zoom, -1, minZoom, maxZoom))}
          className="folio-press rounded-lg p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          data-testid="zoom-level-button"
          title={`Zoom Presets (${formatShortcutCompact(keyboardShortcuts.canvasZoomReset)} for 100%)`}
          onClick={() => setZoomMenuOpen((o) => !o)}
          className="folio-mono folio-press rounded-lg px-2 py-1 text-xs font-bold text-[var(--navy-900)] tabular-nums hover:bg-[var(--surface-tint)]"
        >
          {zoomLabel}
        </button>

        <button
          type="button"
          title={`Zoom In (${formatShortcutCompact(keyboardShortcuts.canvasZoomIn)})`}
          aria-label="Zoom In"
          onClick={() => setZoom(stepCanvasZoom(zoom, 1, minZoom, maxZoom))}
          className="folio-press rounded-lg p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>

        {!isWhiteboard && (
          <button
            type="button"
            title={`Fit Width (${formatShortcutCompact(keyboardShortcuts.fitView)})`}
            onClick={onFitWidth}
            className="folio-press ml-0.5 rounded-lg bg-[var(--surface-seal)] px-2 py-1 text-[11px] font-bold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
          >
            Fit
          </button>
        )}

        {zoomMenuOpen && (
          <div
            onMouseLeave={() => setZoomMenuOpen(false)}
            className="folio-popover absolute bottom-full right-0 z-40 mb-2 w-28 rounded-xl p-1"
          >
            {(isWhiteboard ? WHITEBOARD_ZOOM_PRESETS : notebookPresets).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => {
                  setZoom(z);
                  setZoomMenuOpen(false);
                }}
                className={`folio-mono folio-press block w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold tabular-nums ${
                  Math.abs(zoom - z) < Math.min(0.03, z * 0.15)
                    ? 'folio-glass-active'
                    : 'text-[var(--navy-900)]/80 hover:bg-[var(--surface-tint)]'
                }`}
              >
                {Math.round(z * 100)}%
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (dockPosition === 'top') {
    return (
      <>
        <div
          className={`pointer-events-none fixed inset-x-0 top-[116px] z-30 flex justify-center px-4 transition-all duration-150 ${
            drawerOpen ? 'sm:pl-[268px]' : ''
          } ${aiSidebarOpen ? 'sm:pr-[356px]' : ''}`}
        >
          {toolDockElement}
        </div>
        <div
          className={`pointer-events-none fixed bottom-4 z-30 flex justify-end transition-all duration-150 ${
            aiSidebarOpen ? 'right-4 sm:right-[356px]' : 'right-4'
          }`}
        >
          {zoomPillElement}
        </div>
      </>
    );
  }

  if (dockPosition === 'left') {
    return (
      <>
        <div
          className={`pointer-events-none fixed top-1/2 z-30 -translate-y-1/2 transition-all duration-150 ${
            drawerOpen ? 'left-[272px]' : 'left-3 sm:left-4'
          }`}
        >
          {toolDockElement}
        </div>
        <div
          className={`pointer-events-none fixed bottom-4 z-30 flex justify-end transition-all duration-150 ${
            aiSidebarOpen ? 'right-4 sm:right-[356px]' : 'right-4'
          }`}
        >
          {zoomPillElement}
        </div>
      </>
    );
  }

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-4 z-30 flex flex-wrap items-center justify-center px-4 transition-all duration-150 ${
        aiSidebarOpen
          ? 'gap-2.5 sm:pr-[356px]'
          : 'gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-3'
      }`}
    >
      {!aiSidebarOpen && <div className="hidden lg:block" aria-hidden="true" />}
      {toolDockElement}
      {zoomPillElement}
    </div>
  );
};
