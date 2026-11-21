import React from 'react';
import { FileText, Loader2, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export const PdfImportProgressModal: React.FC = () => {
  const progress = useAppStore((s) => s.pdfImportProgress);
  const cancelPdfImport = useAppStore((s) => s.cancelPdfImport);

  if (!progress) return null;

  const pct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pdf-import-progress-modal"
      className="fixed bottom-5 right-5 z-50 w-80 rounded-2xl border border-[#072D59]/14 bg-white/95 p-4 text-[#072D59] shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#DBF2FC] text-[#072D59]">
            <FileText className="h-4 w-4 text-[#FD6E88]" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-[#072D59]">
              {progress.fileName}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-[#072D59]/65">
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#FD6E88]" />
              <span>
                {progress.phase === 'saving'
                  ? 'Saving PDF to local library…'
                  : progress.total > 0 && progress.current > 0
                    ? `Preparing page ${progress.current} of ${progress.total}…`
                    : 'Reading PDF document…'}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          aria-label="Cancel PDF import"
          data-testid="pdf-import-cancel-btn"
          onClick={cancelPdfImport}
          className="rounded-lg p-1 text-[#072D59]/50 transition duration-150 hover:bg-[#FD6E88]/14 hover:text-[#F95573]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 space-y-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#DBF2FC]/70">
          <div
            className="h-full rounded-full bg-[#FD6E88] transition-all duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] font-semibold text-[#072D59]/55 tabular-nums">
          <span>
            {progress.total > 0 ? `${progress.current} / ${progress.total} pages` : 'Working…'}
          </span>
          <span>{pct}%</span>
        </div>
      </div>
    </div>
  );
};
