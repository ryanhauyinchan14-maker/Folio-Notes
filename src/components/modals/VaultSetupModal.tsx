import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Lock,
  Shield,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { Notebook } from '../../types/notes';
import {
  buildRecoveryKeyFileText,
  evaluatePasswordStrength,
  generateRecoveryKey,
} from '../../utils/vaultCrypto';

interface VaultSetupModalProps {
  open: boolean;
  notebookToLock?: Notebook | null;
  onClose: () => void;
  onCompleted?: () => void;
}

export const VaultSetupModal: React.FC<VaultSetupModalProps> = ({
  open,
  notebookToLock,
  onClose,
  onCompleted,
}) => {
  const setupVaultAndMaybeLockNotebook = useAppStore(
    (s) => s.setupVaultAndMaybeLockNotebook,
  );

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword('');
      setConfirmPassword('');
      setShowPassword(false);
      setRecoveryKey(generateRecoveryKey());
      setCopied(false);
      setSavedConfirmed(false);
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const strength = useMemo(() => evaluatePasswordStrength(password), [password]);

  if (!open) return null;

  const strengthColors = [
    'bg-[var(--border-subtle)]',
    'bg-[var(--state-danger)]',
    'bg-[var(--state-warning)]',
    'bg-[#38BDF8]',
    'bg-[var(--state-success)]',
  ];

  const handleCopyKey = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback copy if clipboard API restricted
      setCopied(false);
    }
  };

  const handleDownloadKey = () => {
    const content = buildRecoveryKeyFileText(recoveryKey);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'folio-recovery-key.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!savedConfirmed) {
      setError('Please confirm that you have saved your Recovery Key.');
      return;
    }

    try {
      setSubmitting(true);
      await setupVaultAndMaybeLockNotebook(
        password,
        recoveryKey,
        notebookToLock?.id ?? null,
      );
      onCompleted?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize Vault Lock.');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    password.length >= 6 &&
    password === confirmPassword &&
    savedConfirmed &&
    !submitting;

  return (
    <div
      className="folio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-setup-title"
        className="folio-modal-card flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl text-[var(--navy-900)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="folio-modal-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="folio-glass-badge flex h-9 w-9 items-center justify-center rounded-xl">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <h2 id="vault-setup-title" className="text-base font-bold text-[var(--navy-900)]">
                Set Up Vault Password
              </h2>
              <p className="text-xs text-[var(--navy-600)]">
                {notebookToLock
                  ? `Encrypt & lock "${notebookToLock.title}" locally with AES-GCM-256`
                  : 'Create your local encryption password & offline Recovery Key'}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Vault Setup"
            onClick={onClose}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-600)] hover:bg-[var(--surface-seal)] hover:text-[var(--navy-900)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Password Inputs */}
          <div className="space-y-3">
            <div>
              <label
                htmlFor="vault-setup-password"
                className="folio-section-label mb-1 block"
              >
                Vault Password
              </label>
              <div className="relative">
                <input
                  id="vault-setup-password"
                  type={showPassword ? 'text' : 'password'}
                  autoFocus
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  placeholder="Enter at least 6 characters"
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

              {/* Strength Meter */}
              <div className="mt-2 flex items-center gap-2">
                <div className="grid flex-1 grid-cols-4 gap-1">
                  {[1, 2, 3, 4].map((bar) => (
                    <div
                      key={bar}
                      className={`h-1.5 rounded-full transition-colors ${
                        strength.score >= bar ? strengthColors[strength.score] : 'bg-[var(--border-subtle)]'
                      }`}
                    />
                  ))}
                </div>
                <span
                  data-testid="password-strength-label"
                  className="w-16 text-right text-[11px] font-bold text-[var(--navy-600)]"
                >
                  {password ? strength.label : 'Enter'}
                </span>
              </div>
            </div>

            <div>
              <label
                htmlFor="vault-setup-confirm"
                className="folio-section-label mb-1 block"
              >
                Confirm Password
              </label>
              <input
                id="vault-setup-confirm"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError(null);
                }}
                placeholder="Reenter your Vault Password"
                className="folio-input w-full rounded-xl px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>

          {/* Generated Recovery Key Box */}
          <div className="space-y-2.5 rounded-2xl border border-[var(--state-warning-border)] bg-[var(--state-warning-bg)] p-4">
            <div className="flex items-start gap-2 text-[var(--state-warning-text)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--state-warning)]" />
              <div className="text-xs">
                <p className="font-semibold">Save Your Offline Recovery Key</p>
                <p className="mt-0.5 opacity-90">
                  There is no cloud backup. If you forget your password, this Recovery Key is the
                  only way to decrypt your locked notebooks.
                </p>
              </div>
            </div>

            <div
              data-testid="generated-recovery-key"
              className="rounded-xl border border-[var(--state-warning-border)] bg-[var(--surface-elevated)] px-3 py-2.5 text-center font-mono text-sm font-bold tracking-wider text-[var(--navy-900)] select-all"
            >
              {recoveryKey}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopyKey}
                className="folio-btn-secondary folio-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[var(--state-success)]" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy Key
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleDownloadKey}
                className="folio-btn-secondary folio-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
              >
                <Download className="h-3.5 w-3.5" />
                Download Recovery Key (.txt)
              </button>
            </div>
          </div>

          {/* Required Confirmation Checkbox */}
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-tint)] p-3 text-xs text-[var(--navy-900)]">
            <input
              type="checkbox"
              checked={savedConfirmed}
              onChange={(e) => {
                setSavedConfirmed(e.target.checked);
                setError(null);
              }}
              className="mt-0.5 h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--crimson-500)]"
            />
            <span className="font-semibold">
              I have saved my Recovery Key in a safe place offline.
            </span>
          </label>

          {error && (
            <p data-testid="vault-setup-error" className="text-xs font-semibold text-[var(--state-danger-text)]">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="folio-btn-secondary folio-press rounded-xl px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="folio-btn-navy folio-press inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Lock className="h-4 w-4" />
              {submitting
                ? 'Encrypting...'
                : notebookToLock
                  ? 'Activate & Lock Notebook'
                  : 'Activate Vault Lock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
