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
import type { Folder, Notebook, Page } from '../../types/notes';
import {
  evaluatePasswordStrength,
  parseRecoveryKeyInput,
  resetVaultPasswordWithRecoveryKey,
  unlockMasterKeyWithPassword,
} from '../../utils/vaultCrypto';

interface UnlockNotebookModalProps {
  open: boolean;
  notebook: Notebook | null;
  folder?: Folder | null;
  mode: 'open' | 'remove-lock' | 'lock-existing' | 'export' | 'delete' | 'delete-folder';
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
  folder = null,
  mode,
  onUnlockedForExport,
  onClose,
}) => {
  const lockNotebookWithPassword = useAppStore((s) => s.lockNotebookWithPassword);
  const unlockNotebookWithPassword = useAppStore((s) => s.unlockNotebookWithPassword);
  const resetPasswordAndUnlock = useAppStore((s) => s.resetPasswordAndUnlock);
  const deleteLockedNotebookWithPassword = useAppStore(
    (s) => s.deleteLockedNotebookWithPassword,
  );
  const deleteLockedNotebookWithRecoveryKey = useAppStore(
    (s) => s.deleteLockedNotebookWithRecoveryKey,
  );
  const deleteFolderWithPassword = useAppStore((s) => s.deleteFolderWithPassword);
  const deleteFolderWithRecoveryKey = useAppStore((s) => s.deleteFolderWithRecoveryKey);

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
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
      setError(null);
      setBusy(false);
    }
  }, [open, notebook?.id, folder?.id, mode]);

  const strength = useMemo(
    () => evaluatePasswordStrength(newPassword),
    [newPassword],
  );

  if (!open || (mode === 'delete-folder' ? !folder : !notebook)) return null;

  const isLockingExisting = mode === 'lock-existing';
  const isDeleteMode = mode === 'delete' || mode === 'delete-folder';
  const targetTitle = mode === 'delete-folder' ? folder!.name : notebook!.title;

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
      if (mode === 'delete' && notebook) {
        await deleteLockedNotebookWithPassword(notebook.id, password);
        onClose();
        return;
      }

      if (mode === 'delete-folder' && folder) {
        await deleteFolderWithPassword(folder.id, password);
        onClose();
        return;
      }

      if (isLockingExisting && notebook) {
        await lockNotebookWithPassword(notebook.id, password);
        onClose();
        return;
      }

      if (mode === 'export' && notebook) {
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

      if (notebook) {
        const targetAction = overrideAction ?? (mode === 'remove-lock' ? 'remove-lock' : 'open');
        await unlockNotebookWithPassword(notebook.id, password, targetAction);
        onClose();
      }
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
      if (mode === 'delete' && notebook) {
        await deleteLockedNotebookWithRecoveryKey(notebook.id, parsed, newPassword);
        onClose();
        return;
      }
      if (mode === 'delete-folder' && folder) {
        await deleteFolderWithRecoveryKey(folder.id, parsed, newPassword);
        onClose();
        return;
      }
      if (mode === 'export' && notebook) {
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
      if (notebook) {
        const targetAction = mode === 'remove-lock' ? 'remove-lock' : 'open';
        await resetPasswordAndUnlock(notebook.id, parsed, newPassword, targetAction);
        onClose();
      }
    } catch {
      setError('Invalid Recovery Key. Unable to unwrap Vault Master Key.');
    } finally {
      setBusy(false);
    }
  };

  const strengthColors = [
    'bg-[var(--border-subtle)]',
    'bg-[var(--state-danger)]',
    'bg-[var(--state-warning)]',
    'bg-[#38BDF8]',
    'bg-[var(--state-success)]',
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
        className="folio-modal-card w-full max-w-md overflow-hidden rounded-2xl text-[var(--navy-900)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                isDeleteMode && !forgotMode ? 'bg-[var(--state-danger)] text-white' : 'folio-glass-badge'
              }`}
            >
              {isDeleteMode && !forgotMode ? (
                <Trash2 className="h-4 w-4" />
              ) : isLockingExisting ? (
                <Lock className="h-4 w-4" />
              ) : forgotMode ? (
                <KeyRound className="h-4 w-4" />
              ) : (
                <LockOpen className="h-4 w-4" />
              )}
            </div>
            <div>
              <h2 id="unlock-notebook-title" className="text-base font-bold text-[var(--navy-900)]">
                {isLockingExisting
                  ? 'Lock Notebook'
                  : forgotMode
                    ? 'Reset Password with Recovery Key'
                    : mode === 'delete'
                      ? 'Delete Locked Notebook'
                      : mode === 'delete-folder'
                        ? 'Delete Protected Folder'
                        : mode === 'export'
                          ? 'Unlock to Export'
                          : mode === 'remove-lock'
                            ? 'Unlock / Remove Lock'
                            : 'Unlock Notebook'}
              </h2>
              <p className="max-w-[240px] truncate text-xs text-[var(--navy-600)]">
                {targetTitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close unlock modal"
            onClick={onClose}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-600)] hover:bg-[var(--surface-seal)] hover:text-[var(--navy-900)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {!forgotMode ? (
            <form onSubmit={(e) => void handlePasswordSubmit(e)} className="space-y-4">
              {isDeleteMode && (
                <div
                  data-testid="unlock-delete-warning"
                  className="folio-badge-danger flex items-start gap-2 rounded-xl p-3 text-xs"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--state-danger)]" />
                  <p>
                    {mode === 'delete-folder' ? (
                      <>
                        <strong>{targetTitle}</strong> contains Vault locked notebooks. Enter your
                        Vault Password to delete this folder and move its notebooks to Trash for 7
                        days.
                      </>
                    ) : (
                      <>
                        Enter your Vault Password to delete <strong>{targetTitle}</strong>. Deleted
                        notebooks stay encrypted in Recently Deleted for 7 days.
                      </>
                    )}
                  </p>
                </div>
              )}

              <div>
                <label
                  htmlFor="unlock-vault-password"
                  className="folio-section-label mb-1.5 block"
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
                    className="folio-press absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p data-testid="unlock-error-message" className="text-xs font-semibold text-[var(--state-danger-text)]">
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
                    className="text-xs font-semibold text-[var(--crimson-600)] hover:underline"
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
                    className="folio-btn-secondary folio-press rounded-xl px-3.5 py-2 text-xs font-semibold"
                  >
                    Cancel
                  </button>

                  {mode === 'remove-lock' ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => void handlePasswordSubmit(e, 'open')}
                        className="folio-btn-secondary folio-press rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50"
                      >
                        Unlock &amp; Open
                      </button>
                      <button
                        type="submit"
                        disabled={busy}
                        className="folio-btn-navy folio-press inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
                      >
                        <Unlock className="h-3.5 w-3.5" />
                        {busy ? 'Decrypting...' : 'Remove Lock'}
                      </button>
                    </>
                  ) : isDeleteMode ? (
                    <button
                      type="submit"
                      data-testid="unlock-confirm-delete-btn"
                      disabled={busy}
                      className="folio-btn-danger folio-press inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {busy
                        ? 'Deleting...'
                        : mode === 'delete-folder'
                          ? 'Verify & Delete Folder'
                          : 'Verify & Delete'}
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={busy}
                      className="folio-btn-navy folio-press inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50"
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
                    className="folio-section-label"
                  >
                    Recovery Key
                  </label>
                  <label className="folio-btn-secondary folio-press inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold">
                    <Upload className="h-3 w-3 text-[var(--crimson-500)]" />
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
                  className="folio-section-label mb-1 block"
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
                          strength.score >= bar ? strengthColors[strength.score] : 'bg-[var(--border-subtle)]'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-[11px] font-semibold text-[var(--navy-600)]">
                    {newPassword ? strength.label : ''}
                  </span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="recovery-confirm-password"
                  className="folio-section-label mb-1 block"
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
                  placeholder="Reenter new password"
                  className="folio-input w-full rounded-xl px-3.5 py-2 text-sm"
                />
              </div>

              {error && (
                <p data-testid="recovery-error-message" className="text-xs font-semibold text-[var(--state-danger-text)]">
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
                  className="text-xs font-semibold text-[var(--navy-600)] hover:text-[var(--navy-900)]"
                >
                  Back to password
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className={`${
                    isDeleteMode ? 'folio-btn-danger' : 'folio-btn-crimson'
                  } folio-press rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50`}
                >
                  {busy
                    ? isDeleteMode
                      ? 'Deleting...'
                      : 'Resetting...'
                    : isDeleteMode
                      ? 'Reset Password & Delete'
                      : 'Reset Password & Unlock'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
