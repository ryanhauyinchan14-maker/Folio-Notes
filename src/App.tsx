import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UpdateToastCard } from './components/common/UpdatePill';
import { NotebookEditor } from './components/editor/NotebookEditor';
import { PdfImportProgressModal } from './components/modals/PdfImportProgressModal';
import { HomeShelf } from './components/shelf/HomeShelf';
import { useAppStore } from './store/useAppStore';
import { useUpdaterStore } from './store/useUpdaterStore';
import {
  isGlobalShortcutSafeInInputs,
  matchesShortcutEvent,
} from './utils/shortcuts';
import { applyInterfaceFontToRuntime } from './utils/uiFonts';
import {
  applyUiScaleToRuntime,
  DEFAULT_UI_SCALE,
  stepUiScale,
  UI_SCALE_KEY_STEP,
  UI_SCALE_WHEEL_STEP,
} from './utils/uiZoom';
import { setUiSoundEnabled } from './utils/uiSound';

export const App: React.FC = () => {
  const initApp = useAppStore((s) => s.initApp);
  const initUpdater = useUpdaterStore((s) => s.initUpdater);
  const activeNotebook = useAppStore((s) => s.activeNotebook);
  const uiSoundsEnabled = useAppStore((s) => s.uiSoundsEnabled);
  const interfaceFontId = useAppStore((s) => s.interfaceFontId);
  const interfaceCustomFont = useAppStore((s) => s.interfaceCustomFont);
  const uiScale = useAppStore((s) => s.uiScale);
  const setUiScale = useAppStore((s) => s.setUiScale);

  const [zoomBadgeVisible, setZoomBadgeVisible] = useState(false);
  const zoomBadgeTimerRef = useRef<number | null>(null);

  const flashZoomBadge = useCallback(() => {
    setZoomBadgeVisible(true);
    if (zoomBadgeTimerRef.current !== null) {
      window.clearTimeout(zoomBadgeTimerRef.current);
    }
    zoomBadgeTimerRef.current = window.setTimeout(() => {
      zoomBadgeTimerRef.current = null;
      setZoomBadgeVisible(false);
    }, 1500);
  }, []);

  useEffect(() => {
    void initApp();
  }, [initApp]);

  useEffect(() => initUpdater(), [initUpdater]);

  useEffect(() => {
    setUiSoundEnabled(uiSoundsEnabled);
  }, [uiSoundsEnabled]);

  useEffect(() => {
    applyUiScaleToRuntime(uiScale);
  }, [uiScale]);

  useEffect(() => {
    void applyInterfaceFontToRuntime(interfaceFontId, interfaceCustomFont);
  }, [interfaceFontId, interfaceCustomFont]);

  useEffect(() => {
    return () => {
      if (zoomBadgeTimerRef.current !== null) {
        window.clearTimeout(zoomBadgeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.defaultPrevented) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const target = e.target;
      const insideCanvas =
        target instanceof HTMLElement &&
        Boolean(target.closest('[data-testid="editor-canvas-viewport"]'));
      const isTrackpadPinch =
        insideCanvas &&
        e.ctrlKey &&
        !e.metaKey &&
        e.deltaMode === 0 &&
        Math.abs(e.deltaY) > 0 &&
        Math.abs(e.deltaY) < 25;

      const { ctrlScrollBehavior, activeNotebook, uiScale: currentScale } =
        useAppStore.getState();
      const shouldScaleGui =
        !isTrackpadPinch &&
        (ctrlScrollBehavior === 'gui-scale' ||
          (ctrlScrollBehavior === 'smart' && !activeNotebook));

      if (shouldScaleGui) {
        e.preventDefault();
        if (e.deltaY === 0) return;
        const dir = e.deltaY < 0 ? 1 : -1;
        const nextScale = stepUiScale(currentScale, dir * UI_SCALE_WHEEL_STEP);
        setUiScale(nextScale);
        flashZoomBadge();
      } else if (activeNotebook) {
        e.preventDefault();
      }
    };

    const isBlockedByEditableTarget = (e: KeyboardEvent, combo: string): boolean => {
      if (isGlobalShortcutSafeInInputs(combo)) return false;
      const target = e.target;
      if (!(target instanceof HTMLElement)) return false;
      if (target.closest('[role="dialog"]')) return true;
      const tag = target.tagName.toLowerCase();
      if (tag === 'input') {
        const type = (target as HTMLInputElement).type?.toLowerCase();
        return (
          type !== 'range' &&
          type !== 'color' &&
          type !== 'checkbox' &&
          type !== 'radio' &&
          type !== 'button' &&
          type !== 'file'
        );
      }
      return tag === 'textarea' || tag === 'select' || target.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const shortcuts = useAppStore.getState().keyboardShortcuts;

      if (
        !e.repeat &&
        !isBlockedByEditableTarget(e, shortcuts.toggleFullscreen) &&
        matchesShortcutEvent(e, shortcuts.toggleFullscreen)
      ) {
        if (window.folioDesktop?.toggleFullscreen) {
          e.preventDefault();
          void window.folioDesktop.toggleFullscreen();
          return;
        }
        if (typeof document !== 'undefined' && document.fullscreenEnabled) {
          e.preventDefault();
          if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => {});
          } else {
            void document.documentElement.requestFullscreen().catch(() => {});
          }
        }
        return;
      }

      const isPlus =
        !isBlockedByEditableTarget(e, shortcuts.guiZoomIn) &&
        matchesShortcutEvent(e, shortcuts.guiZoomIn);
      const isMinus =
        !isBlockedByEditableTarget(e, shortcuts.guiZoomOut) &&
        matchesShortcutEvent(e, shortcuts.guiZoomOut);
      const isReset =
        !isBlockedByEditableTarget(e, shortcuts.guiZoomReset) &&
        matchesShortcutEvent(e, shortcuts.guiZoomReset);

      if (!isPlus && !isMinus && !isReset) return;
      e.preventDefault();

      const currentScale = useAppStore.getState().uiScale;
      if (isReset) {
        setUiScale(DEFAULT_UI_SCALE);
      } else if (isPlus) {
        setUiScale(stepUiScale(currentScale, UI_SCALE_KEY_STEP));
      } else {
        setUiScale(stepUiScale(currentScale, -UI_SCALE_KEY_STEP));
      }
      flashZoomBadge();
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [flashZoomBadge, setUiScale]);

  return (
    <>
      {activeNotebook ? <NotebookEditor /> : <HomeShelf />}
      <PdfImportProgressModal />
      <UpdateToastCard />
      {zoomBadgeVisible && (
        <div
          data-testid="ui-zoom-badge"
          className="folio-glass-surface fixed right-4 top-14 z-[60] flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold text-[var(--navy-900)]"
        >
          <span className="folio-mono tabular-nums">{Math.round(uiScale * 100)}%</span>
          <button
            type="button"
            data-testid="ui-zoom-reset-btn"
            onClick={() => {
              setUiScale(DEFAULT_UI_SCALE);
              flashZoomBadge();
            }}
            className="folio-btn-navy folio-press rounded-full px-2 py-0.5 text-[11px] font-bold"
          >
            Reset
          </button>
        </div>
      )}
    </>
  );
};

export default App;
