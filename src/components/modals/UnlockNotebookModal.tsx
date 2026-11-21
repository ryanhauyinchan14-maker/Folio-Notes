import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LockOpen,
  Trash2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import { repository } from '../../db/repository';
import { useAppStore } from '../../store/useAppStore';
import type { Notebook, Page } from '../../types/notes';
import {
  evaluatePasswordStrength,
  parseRecoveryKeyInput,
  resetVaultPasswordWithRecoveryKey,
  unlockMasterKeyWithPassword,
} from '../../utils/vaultCrypto';

interface UnlockNotebookModalProps {
  open: boolean;
  notebook: Notebook | null;
  mode: 'open' | 'remove-lock' | 'lock-existing' | 'export';
  onUnlockedForExport?: (
    notebook: Notebook,
    pages: Page[],
    pdfAssets?: Map<string, ArrayBuffer>,
  ) => void;
  onClose: () => void;
}

export const UnlockNotebookModal: React.FC<UnlockNotebookModalProps> = ({
  open,
  notebook,
  mode,
  onUnlockedForExport,
  onClose,
}) => {
  const lockNotebookWithPassword = useAppStore((s) => s.lockNotebookWithPassword);
  const unlockNotebookWithPassword = useAppStore((s) => s.unlockNotebookWithPassword);
  const resetPasswordAndUnlock = useAppStore((s) => s.resetPasswordAndUnlock);
  const deleteNotebook = useAppStore((s) => s.deleteNotebook);

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword('');
      setShowPassword(false);
      setForgotMode(false);
      setRecoveryInput('');
      setNewPassword('');
      setConfirmNewPassword('');
      setConfirmDelete(false);
      setError(null);
      setBusy(false);
    }
  }, [open, notebook?.id, mode]);

  const strength = useMemo(
    () => evaluatePasswordStrength(newPassword),
    [newPassword],
  );

  if (!open || !notebook) return null;

  const isLockingExisting = mode === 'lock-existing';

  const handlePasswordSubmit = async (
    e: React.FormEvent,
    overrideAction?: 'open' | 'remove-lock',
  ) => {
    e.preventDefault();
    setError(null);
    if (!password) {
      setError('Please enter your Vault Password.');
      return;
    }

    try {
      setBusy(true);
      if (isLockingExisting) {
        await lockNotebookWithPassword(notebook.id, password);
        onClose();
        return;
      }

      if (mode === 'export') {
        const key = await unlockMasterKeyWithPassword(password, false);
        const [loaded, pdfAssets] = await Promise.all([
          repository.getNotebookWithPages(notebook.id, key),
          repository.getPdfAssetsForNotebook(notebook.id, key),
        ]);
        onClose();
        if (loaded) {
          onUnlockedForExport?.(loaded.notebook, loaded.pages, pdfAssets);
        }
        return;
      }

      const targetAction = overrideAction ?? (mode === 'remove-lock' ? 'remove-lock' : 'open');
      await unlockNotebookWithPassword(notebook.id, password, targetAction);
      onClose();
    } catch {
      setError('Incorrect Vault Password. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleRecoveryFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseRecoveryKeyInput(text);
      setRecoveryInput(parsed ?? text.trim());
      setError(parsed ? null : 'Could not find a FOLIO-XXXX-XXXX-XXXX-XXXX key in that file.');
    } catch {
      setError('Could not read the selected file.');
    }
  };

  const handleResetWithRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = parseRecoveryKeyInput(recoveryInput);
    if (!parsed) {
      setError('Enter a valid Recovery Key (FOLIO-XXXX-XXXX-XXXX-XXXX).');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match.');
      return;
    }

    try {
      setBusy(true);
      if (mode === 'export') {
        const key = await resetVaultPasswordWithRecoveryKey(parsed, newPassword);
        const [loaded, pdfAssets] = await Promise.all([
          repository.getNotebookWithPages(notebook.id, key),
          repository.getPdfAssetsForNotebook(notebook.id, key),
        ]);
        onClose();
        if (loaded) {
          onUnlockedForExport?.(loaded.notebook, loaded.pages, pdfAssets);
        }
        return;
      }
      const targetAction = mode === 'remove-lock' ? 'remove-lock' : 'open';
      await resetPasswordAndUnlock(notebook.id, parsed, newPassword, targetAction);
      onClose();
    } catch {
      setError('Invalid Recovery Key. Unable to unwrap Vault Master Key.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    setBusy(true);
    await deleteNotebook(notebook.id);
    setBusy(false);
    onClose();
  };

  const strengthColors = [
    'bg-[#072D59]/12',
    'bg-[#F95573]',
    'bg-amber-500',
    'bg-[#0A3D7A]',
    'bg-emerald-600',
  ];

  return (
    <div
      className="folio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlock-notebook-title"
        className="folio-modal-card w-full max-w-md overflow-hidden rounded-2xl text-[#072D59]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#072D59] text-white">
              {isLockingExisting ? (
                <Lock className="h-4 w-4" />
              ) : forgotMode ? (
                <KeyRound className="h-4 w-4" />
              ) : (
                <LockOpen className="h-4 w-4" />
              )}
            </div>
            <div>
              <h2 id="unlock-notebook-title" className="text-base font-bold text-[#072D59]">
                {isLockingExisting
                  ? 'Lock Notebook'
                  : forgotMode
                    ? 'Reset Password with Recovery Key'
                    : mode === 'export'
                      ? 'Unlock to Export'
                      : mode === 'remove-lock'
                        ? 'Unlock / Remove Lock'
                        : 'Unlock Notebook'}
              </h2>
              <p className="max-w-[240px] truncate text-xs text-[#072D59]/65">
                {notebook.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close unlock modal"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#072D59]/55 transition duration-150 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {!forgotMode ? (
            <form onSubmit={(e) => void handlePasswordSubmit(e)} className="space-y-4">
              <div>
                <label
                  htmlFor="unlock-vault-password"
                  className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65"
                >
                  Vault Password
                </label>
                <div className="relative">
                  <input
                    id="unlock-vault-password"
                    type={showPassword ? 'text' : 'password'}
                    autoFocus
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError(null);
                    }}
                    placeholder="Enter your Vault Password"
                    className="folio-input w-full rounded-xl py-2.5 pl-3.5 pr-10 text-sm"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#072D59]/50 transition duration-150 hover:bg-[#DBF2FC]/60 hover:text-[#072D59]"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p data-testid="unlock-error-message" className="text-xs font-semibold text-[#F95573]">
                  {error}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                {!isLockingExisting ? (
                  <button
                    type="button"
                    onClick={() => {
                      setForgotMode(true);
                      setError(null);
                    }}
                    className="text-xs font-semibold text-[#F95573] hover:underline"
                  >
                    Forgot Password?
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="folio-btn-secondary rounded-xl px-3.5 py-2 text-xs font-semibold"
                  >
                    Cancel
                  </button>

                  {mode === 'remove-lock' ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => void handlePasswordSubmit(e, 'open')}
                        className="folio-btn-secondary rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50"
                      >
                        Unlock &amp; Open
                      </button>
                      <button
                        type="submit"
                        disabled={busy}
                        className="folio-btn-navy inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
                      >
                        <Unlock className="h-3.5 w-3.5" />
                        {busy ? 'Decrypting...' : 'Remove Lock'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="submit"
                      disabled={busy}
                      className="folio-btn-navy inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      {isLockingExisting ? (
                        <>
                          <Lock className="h-3.5 w-3.5" />
                          {busy ? 'Encrypting...' : 'Lock Notebook'}
                        </>
                      ) : mode === 'export' ? (
                        <>
                          <LockOpen className="h-3.5 w-3.5" />
                          {busy ? 'Decrypting...' : 'Unlock & Export'}
                        </>
                      ) : (
                        <>
                          <LockOpen className="h-3.5 w-3.5" />
                          {busy ? 'Unlocking...' : 'Unlock Notebook'}
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={handleResetWithRecovery} className="space-y-3.5">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="recovery-key-input"
                    className="text-xs font-bold uppercase tracking-wide text-[#072D59]/65"
                  >
                    Recovery Key
                  </label>
                  <label className="folio-btn-secondary inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold">
                    <Upload className="h-3 w-3 text-[#FD6E88]" />
                    Upload .txt
                    <input
                      type="file"
                      accept=".txt,text/plain"
                      aria-label="Upload recovery key txt file"
                      onChange={handleRecoveryFileUpload}
                      className="sr-only"
                    />
                  </label>
                </div>
                <input
                  id="recovery-key-input"
                  type="text"
                  autoFocus
                  value={recoveryInput}
                  onChange={(e) => {
                    setRecoveryInput(e.target.value);
                    setError(null);
                  }}
                  placeholder="FOLIO-XXXX-XXXX-XXXX-XXXX"
                  className="folio-input w-full rounded-xl px-3.5 py-2.5 font-mono text-xs uppercase"
                />
              </div>

              <div>
                <label
                  htmlFor="recovery-new-password"
                  className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65"
                >
                  New Vault Password
                </label>
                <input
                  id="recovery-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setError(null);
                  }}
                  placeholder="Enter new password (6+ chars)"
                  className="folio-input w-full rounded-xl px-3.5 py-2 text-sm"
                />
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="grid flex-1 grid-cols-4 gap-1">
                    {[1, 2, 3, 4].map((bar) => (
                      <div
                        key={bar}
                        className={`h-1.5 rounded-full ${
                          strength.score >= bar ? strengthColors[strength.score] : 'bg-[#072D59]/12'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-[11px] font-semibold text-[#072D59]/65">
                    {newPassword ? strength.label : ''}
                  </span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="recovery-confirm-password"
                  className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65"
                >
                  Confirm New Password
                </label>
                <input
                  id="recovery-confirm-password"
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => {
                    setConfirmNewPassword(e.target.value);
                    setError(null);
                  }}
                  placeholder="Re-enter new password"
                  className="folio-input w-full rounded-xl px-3.5 py-2 text-sm"
                />
              </div>

              {error && (
                <p data-testid="recovery-error-message" className="text-xs font-semibold text-[#F95573]">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setForgotMode(false);
                    setError(null);
                  }}
                  className="text-xs font-semibold text-[#072D59]/70 hover:text-[#072D59]"
                >
                  Back to password
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="folio-btn-crimson rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50"
                >
                  {busy ? 'Resetting...' : 'Reset Password & Unlock'}
                </button>
              </div>
            </form>
          )}

          {/* Secondary Delete Locked Notebook option */}
          {!isLockingExisting && (
            <div className="border-t border-[#072D59]/10 pt-3">
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#F95573] hover:underline"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Locked Notebook
                </button>
              ) : (
                <div className="space-y-2 rounded-xl border border-[#FD6E88]/35 bg-[#FD6E88]/10 p-3">
                  <div className="flex items-start gap-2 text-xs text-[#072D59]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F95573]" />
                    <p>
                      Permanently delete <strong>{notebook.title}</strong> and all encrypted pages?
                      This cannot be undone.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="folio-btn-secondary rounded-lg px-2.5 py-1 text-xs font-semibold"
                    >
                      Keep Notebook
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleConfirmDelete}
                      className="folio-btn-crimson rounded-lg px-3 py-1 text-xs font-semibold"
                    >
                      Confirm Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
