import { create } from 'zustand';
import type { AppUpdateStatus } from '../vite-env.d';

interface UpdaterStoreState {
  status: AppUpdateStatus | null;
  bannerDismissed: boolean;
  restarting: boolean;
  justUpdatedToastVisible: boolean;
  actionError: string | null;
  lastReadyKey: string | null;
  initUpdater: () => () => void;
  checkForUpdates: () => Promise<void>;
  restartAndInstall: () => Promise<void>;
  setLocalConfig: (cfg: { enabled?: boolean; releaseDir?: string | null }) => Promise<void>;
  pickLocalDir: () => Promise<void>;
  dismissBanner: () => void;
  dismissJustUpdatedToast: () => void;
}

let justUpdatedTimer: number | null = null;
let hasShownJustUpdatedToast = false;

function getReadyKey(status: AppUpdateStatus): string | null {
  if (status.phase !== 'ready') return null;
  return `${status.source}:${status.availableVersion ?? ''}:${status.availableBuildId ?? ''}`;
}

export const useUpdaterStore = create<UpdaterStoreState>((set, get) => {
  const applyStatus = (nextStatus: AppUpdateStatus) => {
    const nextReadyKey = getReadyKey(nextStatus);
    const prevReadyKey = get().lastReadyKey;
    const isNewReadyUpdate = nextReadyKey !== null && nextReadyKey !== prevReadyKey;

    if (nextStatus.justUpdated && !hasShownJustUpdatedToast) {
      hasShownJustUpdatedToast = true;
      set({ justUpdatedToastVisible: true });
      if (typeof window !== 'undefined') {
        if (justUpdatedTimer !== null) {
          window.clearTimeout(justUpdatedTimer);
        }
        justUpdatedTimer = window.setTimeout(() => {
          justUpdatedTimer = null;
          set({ justUpdatedToastVisible: false });
        }, 4500);
      }
    }

    set((state) => ({
      status: nextStatus,
      lastReadyKey: nextReadyKey ?? state.lastReadyKey,
      bannerDismissed: isNewReadyUpdate ? false : state.bannerDismissed,
      actionError: nextStatus.error ?? (nextStatus.phase === 'ready' ? null : state.actionError),
    }));
  };

  return {
    status: null,
    bannerDismissed: false,
    restarting: false,
    justUpdatedToastVisible: false,
    actionError: null,
    lastReadyKey: null,

    initUpdater: () => {
      if (typeof window === 'undefined') return () => {};
      const bridge = window.folioDesktop?.updater;
      if (!bridge) return () => {};

      let active = true;
      const unsubscribe = bridge.onStatusChanged((nextStatus) => {
        if (active) applyStatus(nextStatus);
      });

      void bridge
        .getStatus()
        .then((initialStatus) => {
          if (active) applyStatus(initialStatus);
        })
        .catch(() => {
          // Ignore updater init errors in renderer
        });

      return () => {
        active = false;
        unsubscribe();
        if (justUpdatedTimer !== null) {
          window.clearTimeout(justUpdatedTimer);
          justUpdatedTimer = null;
        }
      };
    },

    checkForUpdates: async () => {
      const bridge = typeof window !== 'undefined' ? window.folioDesktop?.updater : undefined;
      if (!bridge) return;
      set({ actionError: null });
      try {
        const nextStatus = await bridge.checkNow();
        applyStatus(nextStatus);
      } catch (err) {
        set({
          actionError: err instanceof Error ? err.message : 'Unable to check for updates.',
        });
      }
    },

    restartAndInstall: async () => {
      const bridge = typeof window !== 'undefined' ? window.folioDesktop?.updater : undefined;
      if (!bridge) return;
      set({ restarting: true, actionError: null });
      try {
        const res = await bridge.restartAndInstall();
        if (!res.ok) {
          set({
            restarting: false,
            actionError: res.error ?? 'Failed to launch installer.',
          });
        }
      } catch (err) {
        set({
          restarting: false,
          actionError: err instanceof Error ? err.message : 'Failed to restart and update.',
        });
      }
    },

    setLocalConfig: async (cfg) => {
      const bridge = typeof window !== 'undefined' ? window.folioDesktop?.updater : undefined;
      if (!bridge) return;
      set({ actionError: null });
      try {
        const nextStatus = await bridge.setLocalConfig(cfg);
        applyStatus(nextStatus);
      } catch (err) {
        set({
          actionError: err instanceof Error ? err.message : 'Failed to update local folder settings.',
        });
      }
    },

    pickLocalDir: async () => {
      const bridge = typeof window !== 'undefined' ? window.folioDesktop?.updater : undefined;
      if (!bridge) return;
      set({ actionError: null });
      try {
        const nextStatus = await bridge.pickLocalDir();
        applyStatus(nextStatus);
      } catch (err) {
        set({
          actionError: err instanceof Error ? err.message : 'Failed to select local folder.',
        });
      }
    },

    dismissBanner: () => set({ bannerDismissed: true }),

    dismissJustUpdatedToast: () => set({ justUpdatedToastVisible: false }),
  };
});
