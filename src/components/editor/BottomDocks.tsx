import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  Highlighter,
  ImagePlus,
  Lasso,
  Minus,
  MousePointer2,
  PenTool,
  Plus,
  Type,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { ToolType } from '../../types/notes';

interface BottomDocksProps {
  pageIndex: number;
  totalPages: number;
  spacePressed: boolean;
  drawerOpen?: boolean;
  aiSidebarOpen?: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
  onFitWidth: () => void;
  onInsertImage?: () => void;
}

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const BottomDocks: React.FC<BottomDocksProps> = ({
  pageIndex,
  totalPages,
  spacePressed,
  drawerOpen = false,
  aiSidebarOpen = false,
  onPrevPage,
  onNextPage,
  onFitWidth,
  onInsertImage,
}) => {
  const activeTool = useAppStore((s) => s.activeTool);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const zoom = useAppStore((s) => s.zoom);
  const setZoom = useAppStore((s) => s.setZoom);
  const dockPosition = useAppStore((s) => s.dockPosition);

  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);

  const effectiveTool: ToolType = spacePressed ? 'pan' : activeTool;

  const tools: {
    id: ToolType;
    label: string;
    shortcut: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: 'pan',
      label: 'Select',
      shortcut: 'V',
      icon: <MousePointer2 className="h-4 w-4" />,
    },
    { id: 'pen', label: 'Pen', shortcut: 'P', icon: <PenTool className="h-4 w-4" /> },
    {
      id: 'highlighter',
      label: 'Highlighter',
      shortcut: 'H',
      icon: <Highlighter className="h-4 w-4" />,
    },
    {
      id: 'eraser',
      label: 'Stroke Eraser',
      shortcut: 'E',
      icon: <Eraser className="h-4 w-4" />,
    },
    {
      id: 'lasso',
      label: 'Lasso',
      shortcut: 'L',
      icon: <Lasso className="h-4 w-4" />,
    },
    { id: 'text', label: 'Text', shortcut: 'T', icon: <Type className="h-4 w-4" /> },
  ];

  const isVerticalLeft = dockPosition === 'left';

  const toolDockElement = (
    <nav
      data-testid="bottom-tool-dock"
      data-dock-position={dockPosition}
      aria-label="Drawing and selection tools"
      className={`pointer-events-auto flex items-center rounded-2xl border border-[#072D59]/12 bg-white/95 shadow-[0_10px_32px_rgba(7,45,89,0.16)] backdrop-blur-md ${
        isVerticalLeft
          ? 'custom-scrollbar max-h-[calc(100vh-8rem)] flex-col gap-1 overflow-y-auto p-1.5'
          : 'max-w-full gap-0.5 overflow-x-auto p-1 sm:gap-1 sm:p-1.5'
      } ${dockPosition === 'bottom' ? 'lg:justify-self-center' : ''}`}
    >
      {tools.map((tool) => {
        const active = effectiveTool === tool.id;
        return (
          <button
            key={tool.id}
            type="button"
            title={
              tool.id === 'pan'
                ? 'Select (V) · Space+Drag to Pan'
                : `${tool.label} (${tool.shortcut})`
            }
            aria-label={tool.label}
            aria-pressed={active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              setActiveTool(tool.id);
              e.currentTarget.blur();
            }}
            className={`group relative flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-semibold transition duration-150 sm:px-2.5 sm:py-2 ${
              active
                ? 'bg-[#072D59] text-white shadow-sm'
                : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/65 hover:text-[#072D59]'
            } ${isVerticalLeft ? 'w-10 flex-col gap-0.5 px-1 py-2' : ''}`}
          >
            {tool.icon}
            {!isVerticalLeft && <span className="hidden 2xl:inline">{tool.label}</span>}
            <span
              className={`folio-mono hidden rounded px-1 text-[10px] font-bold sm:inline ${
                active
                  ? 'bg-white/20 text-white'
                  : 'bg-[#DBF2FC]/70 text-[#072D59]/65 group-hover:text-[#072D59]'
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
                ? 'my-0.5 h-px w-6 shrink-0 bg-[#072D59]/12'
                : 'mx-0.5 h-5 w-px shrink-0 bg-[#072D59]/12'
            }
          />
          <button
            type="button"
            data-testid="insert-image-btn"
            title="Insert Image (I)"
            aria-label="Image"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.currentTarget.blur();
              onInsertImage();
            }}
            className={`group relative flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-semibold text-[#072D59]/80 transition duration-150 hover:bg-[#FD6E88]/14 hover:text-[#F95573] sm:px-2.5 sm:py-2 ${
              isVerticalLeft ? 'w-10 flex-col gap-0.5 px-1 py-2' : ''
            }`}
          >
            <ImagePlus className="h-4 w-4" />
            {!isVerticalLeft && <span className="hidden 2xl:inline">Image</span>}
            <span
              className={`folio-mono hidden rounded bg-[#DBF2FC]/70 px-1 text-[10px] font-bold text-[#072D59]/65 group-hover:bg-[#FD6E88]/20 group-hover:text-[#F95573] sm:inline ${
                isVerticalLeft ? '!text-[9px] !leading-tight' : ''
              }`}
            >
              I
            </span>
          </button>
        </>
      )}
    </nav>
  );

  const zoomPillElement = (
    <div
      data-testid="bottom-zoom-pill"
      className={`pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-2xl border border-[#072D59]/12 bg-white/95 px-2 py-1.5 text-[#072D59] shadow-[0_10px_32px_rgba(7,45,89,0.16)] backdrop-blur-md ${
        aiSidebarOpen ? '' : 'lg:justify-self-end'
      }`}
    >
      {/* Page Prev / X of Y / Next */}
      <div className="flex items-center gap-0.5 border-r border-[#072D59]/12 pr-1.5">
        <button
          type="button"
          title="Previous Page"
          aria-label="Previous Page"
          disabled={pageIndex <= 0}
          onClick={onPrevPage}
          className="rounded-lg p-1 text-[#072D59]/75 transition duration-150 hover:bg-[#DBF2FC]/65 disabled:opacity-35"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span
          data-testid="page-counter"
          className="folio-mono whitespace-nowrap px-1.5 text-xs font-bold text-[#072D59]"
        >
          Page {pageIndex + 1} of {totalPages}
        </span>
        <button
          type="button"
          title="Next Page"
          aria-label="Next Page"
          disabled={pageIndex >= totalPages - 1}
          onClick={onNextPage}
          className="rounded-lg p-1 text-[#072D59]/75 transition duration-150 hover:bg-[#DBF2FC]/65 disabled:opacity-35"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Zoom Controls */}
      <div className="relative flex items-center gap-0.5">
        <button
          type="button"
          title="Zoom Out (Ctrl+-)"
          aria-label="Zoom Out"
          onClick={() => setZoom(zoom - 0.15)}
          className="rounded-lg p-1 text-[#072D59]/75 transition duration-150 hover:bg-[#DBF2FC]/65"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          data-testid="zoom-level-button"
          title="Zoom Presets (Ctrl+0 for 100%)"
          onClick={() => setZoomMenuOpen((o) => !o)}
          className="folio-mono rounded-lg px-2 py-1 text-xs font-bold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/65"
        >
          {Math.round(zoom * 100)}%
        </button>

        <button
          type="button"
          title="Zoom In (Ctrl+=)"
          aria-label="Zoom In"
          onClick={() => setZoom(zoom + 0.15)}
          className="rounded-lg p-1 text-[#072D59]/75 transition duration-150 hover:bg-[#DBF2FC]/65"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          title="Fit Width (Ctrl+Alt+0)"
          onClick={onFitWidth}
          className="ml-0.5 rounded-lg bg-[#DBF2FC]/75 px-2 py-1 text-[11px] font-bold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]"
        >
          Fit
        </button>

        {zoomMenuOpen && (
          <div
            onMouseLeave={() => setZoomMenuOpen(false)}
            className="absolute bottom-full right-0 z-40 mb-2 w-28 rounded-xl border border-[#072D59]/12 bg-white p-1 shadow-2xl"
          >
            {ZOOM_PRESETS.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => {
                  setZoom(z);
                  setZoomMenuOpen(false);
                }}
                className={`folio-mono block w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition duration-150 ${
                  Math.abs(zoom - z) < 0.03
                    ? 'bg-[#072D59] text-white'
                    : 'text-[#072D59]/80 hover:bg-[#DBF2FC]/60'
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
          className={`pointer-events-none fixed inset-x-0 top-[102px] z-30 flex justify-center px-4 transition-all duration-150 ${
            aiSidebarOpen ? 'sm:pr-[356px]' : ''
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
