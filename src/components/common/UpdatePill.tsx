import React from 'react';
import { CheckCircle2, Download, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { useUpdaterStore } from '../../store/useUpdaterStore';
import { PaperShaderBackdrop } from './PaperShaderBackdrop';

export const UpdateHeaderButton: React.FC = () => {
  const status = useUpdaterStore((s) => s.status);
  const restarting = useUpdaterStore((s) => s.restarting);
  const restartAndInstall = useUpdaterStore((s) => s.restartAndInstall);

  if (!status) return null;

  if (status.phase === 'downloading') {
    const pct = status.downloadProgress ?? 0;
    return (
      <span
        data-testid="header-downloading-update-pill"
        title={status.message}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#072D59]/15 bg-[#DBF2FC]/80 px-2.5 text-xs font-semibold text-[#072D59]"
      >
        <Download className="h-3.5 w-3.5 animate-pulse text-[#072D59]" />
        <span className="folio-mono tabular-nums">Updating {pct}%…</span>
      </span>
    );
  }

  if (status.phase !== 'ready') return null;

  const sourceLabel = status.source === 'local' ? 'Local build' : 'GitHub Release';

  return (
    <button
      type="button"
      data-testid="header-restart-update-btn"
      disabled={restarting}
      title={`${sourceLabel} v${status.availableVersion ?? status.currentVersion} ready — click to restart and install`}
      onClick={() => void restartAndInstall()}
      className="folio-btn-crimson inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold shadow-2xs transition duration-150 disabled:cursor-wait disabled:opacity-75"
    >
      {restarting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
      <span>{restarting ? 'Restarting…' : 'Restart to Update'}</span>
    </button>
  );
};

export const UpdateToastCard: React.FC = () => {
  const status = useUpdaterStore((s) => s.status);
  const bannerDismissed = useUpdaterStore((s) => s.bannerDismissed);
  const restarting = useUpdaterStore((s) => s.restarting);
  const actionError = useUpdaterStore((s) => s.actionError);
  const justUpdatedToastVisible = useUpdaterStore((s) => s.justUpdatedToastVisible);
  const restartAndInstall = useUpdaterStore((s) => s.restartAndInstall);
  const dismissBanner = useUpdaterStore((s) => s.dismissBanner);
  const dismissJustUpdatedToast = useUpdaterStore((s) => s.dismissJustUpdatedToast);

  const showReadyBanner = status?.phase === 'ready' && !bannerDismissed;
  const showJustUpdated = Boolean(justUpdatedToastVisible && status?.justUpdated);

  if (!showReadyBanner && !showJustUpdated) return null;

  const targetVersion = status?.availableVersion ?? status?.currentVersion ?? '';
  const sourceBadge = status?.source === 'local' ? 'Local Build' : 'GitHub Release';

  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-[65] flex max-w-sm flex-col gap-2 md:bottom-16">
      {showJustUpdated && status && (
        <div
          data-testid="just-updated-toast"
          className="folio-update-toast-glass folio-card-enter pointer-events-auto rounded-2xl border-[var(--state-success-border)] px-4 py-3 text-xs font-semibold text-[var(--navy-900)]"
        >
          <PaperShaderBackdrop
            variant="static-accent"
            data-testid="just-updated-toast-shader"
          />
          <div
            aria-hidden="true"
            className="folio-update-toast-scrim pointer-events-none absolute inset-0"
          />
          <div className="relative z-10 flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--state-success-bg)] text-[var(--state-success)]">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-[var(--navy-900)]">
                Folio Notes updated to v{status.currentVersion}
              </div>
              <div className="text-[11px] font-medium text-[var(--navy-600)]">
                All local notebooks &amp; notes preserved cleanly.
              </div>
            </div>
            <button
              type="button"
              aria-label="Dismiss update confirmation"
              onClick={dismissJustUpdatedToast}
              className="folio-press rounded-lg p-1 text-[var(--navy-600)] hover:bg-white/65 hover:text-[var(--navy-900)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {showReadyBanner && status && (
        <div
          data-testid="update-ready-banner"
          role="status"
          className="folio-update-toast-glass folio-card-enter pointer-events-auto rounded-2xl p-4 text-[var(--navy-900)]"
        >
          <PaperShaderBackdrop
            variant="static-accent"
            data-testid="update-toast-shader"
          />
          <div
            aria-hidden="true"
            className="folio-update-toast-scrim pointer-events-none absolute inset-0"
          />
          <div className="relative z-10 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--crimson-soft)] text-[var(--crimson-500)] backdrop-blur-sm">
              <Sparkles className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-[var(--navy-900)]">
                  Update Ready{targetVersion ? ` · v${targetVersion}` : ''}
                </span>
                <span className="rounded-full bg-white/75 px-2 py-0.5 text-[10px] font-bold text-[var(--navy-900)] ring-1 ring-[var(--border-subtle)] backdrop-blur-sm">
                  {sourceBadge}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--navy-600)]">
                Restart Folio Notes to apply the latest update automatically. Your local notebooks stay untouched.
              </p>
              {actionError && (
                <p className="mt-1.5 text-[11px] font-semibold text-[var(--state-danger-text)]">
                  {actionError}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  data-testid="banner-restart-update-btn"
                  disabled={restarting}
                  onClick={() => void restartAndInstall()}
                  className="folio-btn-crimson inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold disabled:cursor-wait disabled:opacity-75"
                >
                  {restarting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  <span>{restarting ? 'Restarting…' : 'Restart to Update'}</span>
                </button>
                <button
                  type="button"
                  data-testid="banner-dismiss-update-btn"
                  disabled={restarting}
                  onClick={dismissBanner}
                  className="folio-press rounded-xl px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-600)] hover:bg-white/65 hover:text-[var(--navy-900)] disabled:opacity-50"
                >
                  Later
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
