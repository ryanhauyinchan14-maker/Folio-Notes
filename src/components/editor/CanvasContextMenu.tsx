import React, { useEffect } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Calculator,
  Clipboard,
  Copy,
  CopyPlus,
  Crop,
  Group,
  Lock,
  Paintbrush,
  Sparkles,
  Trash2,
  Type,
  Ungroup,
  Unlock,
} from 'lucide-react';
import { getSelectionSummary } from '../../canvas/selection';
import { useAppStore } from '../../store/useAppStore';

export interface CanvasContextMenuState {
  pageId: string;
  clientX: number;
  clientY: number;
  targetType: 'textbox' | 'lasso' | 'image' | 'selection';
  textboxId?: string;
  imageId?: string;
}

interface CanvasContextMenuProps {
  menu: CanvasContextMenuState | null;
  onLassoAiAction?: (action: 'ask' | 'math-hint' | 'transcribe') => void;
  onTidyHandwritingAi?: () => void;
  onClose: () => void;
}

export const CanvasContextMenu: React.FC<CanvasContextMenuProps> = ({
  menu,
  onLassoAiAction,
  onTidyHandwritingAi,
  onClose,
}) => {
  const pages = useAppStore((s) => s.pages);
  const lassoSelection = useAppStore((s) => s.lassoSelection);
  const selectedTextboxIds = useAppStore((s) => s.selectedTextboxIds);
  const selectedImageIds = useAppStore((s) => s.selectedImageIds);
  const copySelection = useAppStore((s) => s.copySelection);
  const duplicateSelection = useAppStore((s) => s.duplicateSelection);
  const deleteActiveSelection = useAppStore((s) => s.deleteActiveSelection);
  const groupSelection = useAppStore((s) => s.groupSelection);
  const ungroupSelection = useAppStore((s) => s.ungroupSelection);
  const toggleLockSelection = useAppStore((s) => s.toggleLockSelection);
  const copyTextboxStyle = useAppStore((s) => s.copyTextboxStyle);
  const pasteTextboxStyle = useAppStore((s) => s.pasteTextboxStyle);
  const copiedTextboxStyle = useAppStore((s) => s.copiedTextboxStyle);
  const reorderImageLayer = useAppStore((s) => s.reorderImageLayer);
  const setCroppingImageId = useAppStore((s) => s.setCroppingImageId);

  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const targetPage = pages.find((p) => p.id === menu.pageId);
  const summary = targetPage
    ? getSelectionSummary(targetPage, {
        strokeIds:
          lassoSelection?.pageId === menu.pageId ? lassoSelection.strokeIds : [],
        textboxIds: selectedTextboxIds,
        imageIds: selectedImageIds,
      })
    : null;

  const left = Math.min(window.innerWidth - 220, Math.max(8, menu.clientX));
  const top = Math.min(window.innerHeight - 280, Math.max(8, menu.clientY));
  const showAiActions =
    Boolean(onLassoAiAction) &&
    (menu.targetType === 'lasso' ||
      (menu.targetType === 'selection' && (summary?.strokeCount ?? 0) > 0));
  const isSingleTextbox =
    menu.targetType === 'textbox' &&
    Boolean(menu.textboxId) &&
    (summary?.totalCount ?? 1) === 1;
  const isSingleImage =
    menu.targetType === 'image' &&
    Boolean(menu.imageId) &&
    (summary?.totalCount ?? 1) === 1;
  const allLocked = Boolean(summary?.allLocked);

  return (
    <div
      data-testid="canvas-context-menu"
      onMouseDown={(e) => e.stopPropagation()}
      style={{ left: `${left}px`, top: `${top}px` }}
      className="folio-popover fixed z-50 w-54 rounded-xl p-1.5 text-[var(--navy-900)]"
    >
      <button
        type="button"
        onClick={() => {
          copySelection(menu.pageId);
          onClose();
        }}
        className="folio-press flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
      >
        <span className="flex items-center gap-2">
          <Copy className="h-3.5 w-3.5 text-[var(--navy-600)]" />
          Copy
        </span>
        <kbd className="text-[10px] text-[var(--navy-600)]">Ctrl+C</kbd>
      </button>

      <button
        type="button"
        onClick={() => {
          duplicateSelection(menu.pageId);
          onClose();
        }}
        className="folio-press flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
      >
        <span className="flex items-center gap-2">
          <CopyPlus className="h-3.5 w-3.5 text-[var(--navy-600)]" />
          Duplicate
        </span>
        <kbd className="text-[10px] text-[var(--navy-600)]">Ctrl+D</kbd>
      </button>

      {summary && (summary.canGroup || summary.canUngroup || summary.totalCount > 0) && (
        <>
          <div className="my-1 h-px bg-[var(--border-subtle)]" />
          {summary.canGroup && (
            <button
              type="button"
              data-testid="context-group-btn"
              onClick={() => {
                groupSelection(menu.pageId);
                onClose();
              }}
              className="folio-press flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
            >
              <span className="flex items-center gap-2">
                <Group className="h-3.5 w-3.5 text-[var(--navy-600)]" />
                Group
              </span>
              <kbd className="text-[10px] text-[var(--navy-600)]">Ctrl+G</kbd>
            </button>
          )}
          {summary.canUngroup && (
            <button
              type="button"
              data-testid="context-ungroup-btn"
              onClick={() => {
                ungroupSelection(menu.pageId);
                onClose();
              }}
              className="folio-press flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
            >
              <span className="flex items-center gap-2">
                <Ungroup className="h-3.5 w-3.5 text-[var(--navy-600)]" />
                Ungroup
              </span>
              <kbd className="text-[10px] text-[var(--navy-600)]">Ctrl+Shift+G</kbd>
            </button>
          )}
          <button
            type="button"
            data-testid="context-lock-toggle-btn"
            onClick={() => {
              toggleLockSelection(menu.pageId);
              onClose();
            }}
            className="folio-press flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
          >
            <span className="flex items-center gap-2">
              {allLocked ? (
                <Unlock className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
              ) : (
                <Lock className="h-3.5 w-3.5 text-[var(--navy-600)]" />
              )}
              {allLocked ? 'Unlock Element' : 'Lock Position'}
            </span>
          </button>
        </>
      )}

      {isSingleTextbox && (
        <>
          <div className="my-1 h-px bg-[var(--border-subtle)]" />
          <button
            type="button"
            onClick={() => {
              copyTextboxStyle(menu.pageId, menu.textboxId!);
              onClose();
            }}
            className="folio-press flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
          >
            <span className="flex items-center gap-2">
              <Paintbrush className="h-3.5 w-3.5 text-[var(--navy-600)]" />
              Copy Style
            </span>
            <kbd className="text-[10px] text-[var(--navy-600)]">Ctrl+Alt+C</kbd>
          </button>
          <button
            type="button"
            disabled={!copiedTextboxStyle || allLocked}
            onClick={() => {
              const ids =
                selectedTextboxIds.length > 0 ? selectedTextboxIds : [menu.textboxId!];
              pasteTextboxStyle(menu.pageId, ids);
              onClose();
            }}
            className="folio-press flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="flex items-center gap-2">
              <Clipboard className="h-3.5 w-3.5 text-[var(--navy-600)]" />
              Paste Style
            </span>
            <kbd className="text-[10px] text-[var(--navy-600)]">Ctrl+Alt+V</kbd>
          </button>
        </>
      )}

      {isSingleImage && (
        <>
          <div className="my-1 h-px bg-[var(--border-subtle)]" />
          <button
            type="button"
            disabled={allLocked}
            onClick={() => {
              setCroppingImageId(menu.imageId!);
              onClose();
            }}
            className="folio-press flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="flex items-center gap-2">
              <Crop className="h-3.5 w-3.5 text-[var(--navy-600)]" />
              Crop Photo
            </span>
            <kbd className="text-[10px] text-[var(--navy-600)]">2× Click</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              reorderImageLayer(menu.pageId, menu.imageId!, 'forward');
              onClose();
            }}
            className="folio-press flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
          >
            <span className="flex items-center gap-2">
              <ArrowUp className="h-3.5 w-3.5 text-[var(--navy-600)]" />
              Bring Forward
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              reorderImageLayer(menu.pageId, menu.imageId!, 'backward');
              onClose();
            }}
            className="folio-press flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
          >
            <span className="flex items-center gap-2">
              <ArrowDown className="h-3.5 w-3.5 text-[var(--navy-600)]" />
              Send Backward
            </span>
          </button>
        </>
      )}

      {showAiActions && (onLassoAiAction || onTidyHandwritingAi) && (
        <>
          <div className="my-1 h-px bg-[var(--border-subtle)]" />
          {onTidyHandwritingAi && !allLocked && (
            <button
              type="button"
              data-testid="context-tidy-handwriting-ai"
              onClick={() => {
                onTidyHandwritingAi();
                onClose();
              }}
              className="folio-press flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
            >
              <Sparkles className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
              <span>Tidy Handwriting (AI)</span>
            </button>
          )}
          {onLassoAiAction && (
            <>
              <button
                type="button"
                data-testid="context-lasso-ask-ai"
                onClick={() => {
                  onLassoAiAction('ask');
                  onClose();
                }}
                className="folio-press flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
              >
                <Sparkles className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
                <span>Ask AI</span>
              </button>
              <button
                type="button"
                data-testid="context-lasso-math-hint"
                onClick={() => {
                  onLassoAiAction('math-hint');
                  onClose();
                }}
                className="folio-press flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
              >
                <Calculator className="h-3.5 w-3.5 text-[var(--navy-900)]" />
                <span>Math Hint</span>
              </button>
              <button
                type="button"
                data-testid="context-lasso-transcribe"
                onClick={() => {
                  onLassoAiAction('transcribe');
                  onClose();
                }}
                className="folio-press flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
              >
                <Type className="h-3.5 w-3.5 text-[var(--navy-900)]" />
                <span>Transcribe</span>
              </button>
            </>
          )}
        </>
      )}

      <div className="my-1 h-px bg-[var(--border-subtle)]" />
      <button
        type="button"
        disabled={allLocked}
        onClick={() => {
          deleteActiveSelection(menu.pageId);
          onClose();
        }}
        className="folio-press flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--state-danger-text)] hover:bg-[var(--state-danger-bg)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="flex items-center gap-2">
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </span>
        <kbd className="text-[10px] text-[var(--state-danger-text)]/80">Del</kbd>
      </button>
    </div>
  );
};
