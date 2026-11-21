import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Check,
  Contrast,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Layout,
  Loader2,
  Lock,
  Moon,
  Palette,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { testGeminiConnection } from '../../ai/geminiClient';
import { type LocalStorageSummary, repository } from '../../db/repository';
import { useAppStore } from '../../store/useAppStore';
import type { PaperPattern } from '../../types/notes';
import { triggerBlobDownload } from '../../utils/exportNotebook';
import {
  DESK_BACKDROP_PRESETS,
  type DeskBackdropPresetId,
  type DockPosition,
  GEMINI_API_STUDIO_URL,
  type GeminiModelPresetId,
  getGeminiApiKey,
  resolveActiveGeminiModel,
} from '../../utils/settings';
import {
  buildRecoveryKeyFileText,
  changeVaultPassword,
  evaluatePasswordStrength,
  hasVaultSetup,
  regenerateVaultRecoveryKey,
} from '../../utils/vaultCrypto';
import { VaultSetupModal } from './VaultSetupModal';

export type SettingsTabId = 'general' | 'appearance' | 'ai' | 'vault' | 'data';

interface SettingsModalProps {
  open: boolean;
  initialTab?: SettingsTabId;
  onClose: () => void;
}

const SETTINGS_TABS: Array<{
  id: SettingsTabId;
  label: string;
  desc: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'general',
    label: 'General & Editor',
    desc: 'Defaults, tools & dock',
    icon: <Sliders className="h-4 w-4" />,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    desc: 'Backdrop & dark view',
    icon: <Palette className="h-4 w-4" />,
  },
  {
    id: 'ai',
    label: 'AI & Gemini',
    desc: 'BYOK key & model',
    icon: <Sparkles className="h-4 w-4" />,
  },
  {
    id: 'vault',
    label: 'Privacy & Vault',
    desc: 'Password & encryption',
    icon: <Shield className="h-4 w-4" />,
  },
  {
    id: 'data',
    label: 'Backup & Data',
    desc: 'Storage & exports',
    icon: <Database className="h-4 w-4" />,
  },
];

function formatBytesCompact(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return 'Local';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  initialTab = 'general',
  onClose,
}) => {
  const lockedNotebookCount = useAppStore((s) => s.lockedNotebookCount);
  const activeNotebook = useAppStore((s) => s.activeNotebook);
  const lockAllNotebooksNow = useAppStore((s) => s.lockAllNotebooksNow);
  const handwritingCorrectionEnabled = useAppStore((s) => s.handwritingCorrectionEnabled);
  const setHandwritingCorrectionEnabled = useAppStore((s) => s.setHandwritingCorrectionEnabled);
  const deskBackdrop = useAppStore((s) => s.deskBackdrop);
  const deskCustomColor = useAppStore((s) => s.deskCustomColor);
  const setDeskBackdrop = useAppStore((s) => s.setDeskBackdrop);
  const darkPaperView = useAppStore((s) => s.darkPaperView);
  const setDarkPaperView = useAppStore((s) => s.setDarkPaperView);
  const highContrastUi = useAppStore((s) => s.highContrastUi);
  const setHighContrastUi = useAppStore((s) => s.setHighContrastUi);
  const dockPosition = useAppStore((s) => s.dockPosition);
  const setDockPosition = useAppStore((s) => s.setDockPosition);
  const heroHeadline = useAppStore((s) => s.heroHeadline);
  const setHeroHeadline = useAppStore((s) => s.setHeroHeadline);
  const defaultZoomMode = useAppStore((s) => s.defaultZoomMode);
  const setDefaultZoomMode = useAppStore((s) => s.setDefaultZoomMode);
  const defaultTool = useAppStore((s) => s.defaultTool);
  const setDefaultTool = useAppStore((s) => s.setDefaultTool);
  const defaultPaperPattern = useAppStore((s) => s.defaultPaperPattern);
  const setDefaultPaperPattern = useAppStore((s) => s.setDefaultPaperPattern);
  const resetPenSlots = useAppStore((s) => s.resetPenSlots);
  const exportWorkspaceBackup = useAppStore((s) => s.exportWorkspaceBackup);
  const importWorkspaceBackup = useAppStore((s) => s.importWorkspaceBackup);
  const storedGeminiApiKey = useAppStore((s) => s.geminiApiKey);
  const setGeminiApiKeyStore = useAppStore((s) => s.setGeminiApiKey);
  const clearStoredGeminiApiKey = useAppStore((s) => s.clearStoredGeminiApiKey);
  const geminiModelPreset = useAppStore((s) => s.geminiModelPreset);
  const geminiCustomModelId = useAppStore((s) => s.geminiCustomModelId);
  const setGeminiModelConfig = useAppStore((s) => s.setGeminiModelConfig);
  const blockAiOnVaultLocked = useAppStore((s) => s.blockAiOnVaultLocked);
  const setBlockAiOnVaultLocked = useAppStore((s) => s.setBlockAiOnVaultLocked);

  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [customModelDraft, setCustomModelDraft] = useState(geminiCustomModelId);
  const [testingKey, setTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [headlineDraft, setHeadlineDraft] = useState(heroHeadline);

  // Vault state
  const [vaultConfigured, setVaultConfigured] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [vaultAction, setVaultAction] = useState<'none' | 'change-password' | 'regen-recovery'>(
    'none',
  );
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [freshRecoveryKey, setFreshRecoveryKey] = useState<string | null>(null);
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  const [vaultNotice, setVaultNotice] = useState<string | null>(null);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultBusy, setVaultBusy] = useState(false);

  // Workspace Backup / Restore + Storage summary state
  const workspaceInputRef = useRef<HTMLInputElement | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [storageSummary, setStorageSummary] = useState<LocalStorageSummary | null>(null);

  useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab);
    setApiKey(storedGeminiApiKey || getGeminiApiKey());
    setCustomModelDraft(geminiCustomModelId);
    setTestingKey(false);
    setTestResult(null);
    setHeadlineDraft(heroHeadline);
    setShowKey(false);
    setStatusMessage(null);
    setVaultConfigured(hasVaultSetup());
    setVaultAction('none');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setFreshRecoveryKey(null);
    setCopiedRecovery(false);
    setVaultNotice(null);
    setVaultError(null);
    setVaultBusy(false);
    setWorkspaceBusy(false);
    setWorkspaceMessage(null);
    setWorkspaceError(null);

    let cancelled = false;
    void repository.getStorageSummary().then((summary) => {
      if (!cancelled) setStorageSummary(summary);
    });
    return () => {
      cancelled = true;
    };
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !setupOpen) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setupOpen, onClose]);

  const strength = useMemo(
    () => evaluatePasswordStrength(newPassword),
    [newPassword],
  );

  if (!open) return null;

  const refreshStorageSummary = () => {
    void repository.getStorageSummary().then(setStorageSummary);
  };

  const handleExportWorkspace = async () => {
    setWorkspaceBusy(true);
    setWorkspaceMessage(null);
    setWorkspaceError(null);
    try {
      const backup = await exportWorkspaceBackup();
      const dateStr = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      triggerBlobDownload(blob, `folio-workspace-${dateStr}.folio-workspace.json`);
      const skipped = backup.skippedLockedTitles ?? [];
      const skippedNote =
        skipped.length > 0
          ? ` Skipped ${skipped.length} Vault-locked notebook(s): ${skipped.join(', ')}.`
          : '';
      setWorkspaceMessage(
        `Exported ${backup.folders.length} folder(s), ${backup.notebooks.length} notebook(s), and ${backup.templates.length} custom template(s).${skippedNote}`,
      );
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Failed to export workspace backup.');
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleImportWorkspaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setWorkspaceBusy(true);
    setWorkspaceMessage(null);
    setWorkspaceError(null);
    try {
      const raw = await file.text();
      const result = await importWorkspaceBackup(raw);
      refreshStorageSummary();
      setWorkspaceMessage(
        `Restored ${result.importedFolders} folder(s), ${result.importedNotebooks} notebook(s), and ${result.importedTemplates} custom template(s).`,
      );
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Failed to import workspace backup.');
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setGeminiApiKeyStore(apiKey);
    if (geminiModelPreset === 'custom') {
      setGeminiModelConfig('custom', customModelDraft);
    }
    setTestResult(null);
    setStatusMessage(
      apiKey.trim()
        ? 'API key saved locally in localStorage.'
        : 'Empty key cleared from localStorage.',
    );
  };

  const handleClear = () => {
    clearStoredGeminiApiKey();
    setApiKey('');
    setTestResult(null);
    setStatusMessage('API key removed from localStorage.');
  };

  const handleTestKey = async () => {
    const keyToTest = apiKey.trim() || storedGeminiApiKey || getGeminiApiKey();
    if (!keyToTest) {
      setTestResult({
        ok: false,
        message: 'Enter or save a Gemini API key first before testing.',
      });
      return;
    }
    const model = resolveActiveGeminiModel({
      geminiModelPreset,
      geminiCustomModelId:
        geminiModelPreset === 'custom' ? customModelDraft : geminiCustomModelId,
    });
    setTestingKey(true);
    setTestResult(null);
    try {
      const res = await testGeminiConnection({ apiKey: keyToTest, model });
      setTestResult(
        res.ok
          ? { ok: true, message: `Connected! Model "${res.model}" responded cleanly.` }
          : { ok: false, message: res.message },
      );
    } finally {
      setTestingKey(false);
    }
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setVaultError(null);
    setVaultNotice(null);

    if (newPassword.length < 6) {
      setVaultError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setVaultError('New passwords do not match.');
      return;
    }

    try {
      setVaultBusy(true);
      await changeVaultPassword(currentPassword, newPassword);
      setVaultNotice('Vault Password updated successfully.');
      setVaultAction('none');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch {
      setVaultError('Current Vault Password is incorrect.');
    } finally {
      setVaultBusy(false);
    }
  };

  const handleRegenerateRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setVaultError(null);
    setVaultNotice(null);
    setFreshRecoveryKey(null);

    try {
      setVaultBusy(true);
      const nextKey = await regenerateVaultRecoveryKey(currentPassword);
      setFreshRecoveryKey(nextKey);
      setVaultNotice('New Recovery Key generated. Previous Recovery Key is now invalid.');
      setCurrentPassword('');
    } catch {
      setVaultError('Current Vault Password is incorrect.');
    } finally {
      setVaultBusy(false);
    }
  };

  const handleCopyRecovery = async () => {
    if (!freshRecoveryKey) return;
    try {
      await navigator.clipboard.writeText(freshRecoveryKey);
      setCopiedRecovery(true);
      window.setTimeout(() => setCopiedRecovery(false), 2000);
    } catch {
      setCopiedRecovery(false);
    }
  };

  const handleDownloadRecovery = () => {
    if (!freshRecoveryKey) return;
    const blob = new Blob([buildRecoveryKeyFileText(freshRecoveryKey)], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'folio-recovery-key.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLockAllNow = async () => {
    const wasLockedOpen = Boolean(activeNotebook?.isLocked);
    await lockAllNotebooksNow();
    setVaultNotice('All locked notebooks are sealed and Master Keys cleared from memory.');
    if (wasLockedOpen) {
      onClose();
    }
  };

  const strengthColors = [
    'bg-[#072D59]/12',
    'bg-[#F95573]',
    'bg-amber-500',
    'bg-[#0A3D7A]',
    'bg-emerald-600',
  ];

  const renderToggleSwitch = (props: {
    testId: string;
    label: string;
    checked: boolean;
    onToggle: () => void;
  }) => (
    <button
      type="button"
      role="switch"
      data-testid={props.testId}
      aria-checked={props.checked}
      aria-label={props.label}
      onClick={props.onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 ${
        props.checked ? 'bg-[#072D59]' : 'bg-[#072D59]/22'
      }`}
    >
      <span
        className={`block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform duration-150 ${
          props.checked ? 'translate-x-5.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );

  return (
    <>
      <div
        className="folio-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
          data-testid="settings-modal"
          className="folio-modal-card flex max-h-[88vh] w-full max-w-[740px] flex-col overflow-hidden rounded-2xl text-[#072D59] sm:h-[580px]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="folio-modal-header flex shrink-0 items-center justify-between px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#DBF2FC] text-[#072D59]">
                <KeyRound className="h-4 w-4" />
              </div>
              <div>
                <h2 id="settings-modal-title" className="text-base font-bold text-[#072D59]">
                  Preferences
                </h2>
                <p className="text-xs text-[#072D59]/65">
                  Workspace defaults, appearance, Gemini BYOK &amp; local backups
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close settings"
              onClick={onClose}
              className="rounded-lg p-1.5 text-[#072D59]/55 transition duration-150 hover:bg-[#DBF2FC]/70 hover:text-[#072D59]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Native Desktop Split Sidebar + Content */}
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* Sidebar Navigation */}
            <nav
              role="tablist"
              aria-label="Preferences sections"
              className="custom-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-[#072D59]/10 bg-[#F4F8FB] p-2.5 md:w-52 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:p-3"
            >
              {SETTINGS_TABS.map((tab) => {
                const selected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    data-testid={`settings-tab-${tab.id}`}
                    aria-selected={selected}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left transition duration-150 md:w-full ${
                      selected
                        ? 'bg-[#072D59] text-white shadow-xs'
                        : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/65 hover:text-[#072D59]'
                    }`}
                  >
                    <span
                      className={`shrink-0 ${
                        selected ? 'text-[#FD6E88]' : 'text-[#072D59]/70'
                      }`}
                    >
                      {tab.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-bold leading-tight">
                        {tab.label}
                      </span>
                      <span
                        className={`hidden truncate text-[10px] md:block ${
                          selected ? 'text-[#DBF2FC]/85' : 'text-[#072D59]/55'
                        }`}
                      >
                        {tab.desc}
                      </span>
                    </span>
                  </button>
                );
              })}

              <div className="mt-auto hidden rounded-xl border border-[#072D59]/10 bg-white/80 p-2.5 text-[11px] text-[#072D59]/75 md:block">
                <div className="flex items-center gap-1.5 font-bold text-[#072D59]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#FD6E88]" />
                  <span>100% Local-First</span>
                </div>
                <p className="mt-1 leading-relaxed text-[10px] text-[#072D59]/65">
                  All notebooks, PDFs &amp; ink live locally in IndexedDB with zero cloud accounts.
                </p>
              </div>
            </nav>

            {/* Right Tab Panel Body */}
            <div
              role="tabpanel"
              data-testid={`settings-panel-${activeTab}`}
              className="custom-scrollbar flex-1 overflow-y-auto p-5"
            >
              {/* Tab 1: General & Editor */}
              {activeTab === 'general' && (
                <div data-testid="settings-defaults-section" className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-[#072D59]">General &amp; Editor</h3>
                    <p className="text-xs text-[#072D59]/65">
                      Configure opening tool behavior, default templates, and workspace dock.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-[#072D59]/10 bg-[#F4F8FB] p-3">
                      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-[#072D59]/65">
                        Default Tool on Open
                      </div>
                      <div className="flex rounded-xl border border-[#072D59]/12 bg-white p-0.5">
                        <button
                          type="button"
                          data-testid="settings-tool-pen"
                          onClick={() => setDefaultTool('pen')}
                          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition duration-150 ${
                            defaultTool === 'pen'
                              ? 'bg-[#072D59] text-white'
                              : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/55'
                          }`}
                        >
                          Pen
                        </button>
                        <button
                          type="button"
                          data-testid="settings-tool-pan"
                          onClick={() => setDefaultTool('pan')}
                          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition duration-150 ${
                            defaultTool === 'pan'
                              ? 'bg-[#072D59] text-white'
                              : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/55'
                          }`}
                        >
                          Select (V)
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#072D59]/10 bg-[#F4F8FB] p-3">
                      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-[#072D59]/65">
                        Default Zoom on Open
                      </div>
                      <div className="flex rounded-xl border border-[#072D59]/12 bg-white p-0.5">
                        <button
                          type="button"
                          data-testid="settings-zoom-100"
                          onClick={() => setDefaultZoomMode('100')}
                          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition duration-150 ${
                            defaultZoomMode === '100'
                              ? 'bg-[#072D59] text-white'
                              : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/55'
                          }`}
                        >
                          100%
                        </button>
                        <button
                          type="button"
                          data-testid="settings-zoom-fit"
                          onClick={() => setDefaultZoomMode('fit-width')}
                          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition duration-150 ${
                            defaultZoomMode === 'fit-width'
                              ? 'bg-[#072D59] text-white'
                              : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/55'
                          }`}
                        >
                          Fit Width
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="settings-default-paper-select"
                      className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65"
                    >
                      Default Paper Pattern (New Notebooks)
                    </label>
                    <select
                      id="settings-default-paper-select"
                      data-testid="settings-default-paper-select"
                      value={defaultPaperPattern}
                      onChange={(e) => setDefaultPaperPattern(e.target.value as PaperPattern)}
                      className="folio-input w-full rounded-xl px-3 py-2 text-xs font-semibold"
                    >
                      <option value="ruled">Ruled</option>
                      <option value="blank">Blank Sheet</option>
                      <option value="grid">Square Grid</option>
                      <option value="dotted">Dot Grid</option>
                      <option value="cornell">Cornell Notes</option>
                    </select>
                  </div>

                  {/* Handwriting Correction Toggle */}
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-[#072D59]/10 bg-white p-3.5">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#DBF2FC]/70 text-[#072D59]">
                        <Sparkles className="h-4 w-4 text-[#FD6E88]" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-[#072D59]">
                          Handwriting Correction
                        </div>
                        <p className="mt-0.5 text-[11px] text-[#072D59]/65">
                          Automatically straighten tilted baselines and smooth jitter after a pause
                          (Ctrl+Z reverts).
                        </p>
                      </div>
                    </div>
                    {renderToggleSwitch({
                      testId: 'settings-handwriting-toggle',
                      label: 'Toggle Handwriting Correction',
                      checked: handwritingCorrectionEnabled,
                      onToggle: () =>
                        setHandwritingCorrectionEnabled(!handwritingCorrectionEnabled),
                    })}
                  </div>

                  {/* Tool Dock Position */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#072D59]/10 bg-[#F4F8FB] p-3.5">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#072D59]">
                        <Layout className="h-3.5 w-3.5" />
                        Tool Dock Position
                      </div>
                      <div className="text-[11px] text-[#072D59]/60">
                        Press Tab in the editor anytime for Zen Mode
                      </div>
                    </div>

                    <div className="flex rounded-xl border border-[#072D59]/12 bg-white p-0.5">
                      {(
                        [
                          { id: 'bottom', label: 'Bottom' },
                          { id: 'top', label: 'Top' },
                          { id: 'left', label: 'Left Edge' },
                        ] as Array<{ id: DockPosition; label: string }>
                      ).map((pos) => (
                        <button
                          key={pos.id}
                          type="button"
                          data-testid={`settings-dock-${pos.id}`}
                          aria-pressed={dockPosition === pos.id}
                          onClick={() => setDockPosition(pos.id)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition duration-150 ${
                            dockPosition === pos.id
                              ? 'bg-[#072D59] text-white'
                              : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/55'
                          }`}
                        >
                          {pos.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="settings-hero-headline-input"
                      className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65"
                    >
                      Home Shelf Headline
                    </label>
                    <input
                      id="settings-hero-headline-input"
                      data-testid="settings-hero-headline-input"
                      type="text"
                      maxLength={80}
                      value={headlineDraft}
                      onChange={(e) => {
                        const next = e.target.value;
                        setHeadlineDraft(next);
                        if (next.trim()) {
                          setHeroHeadline(next);
                        }
                      }}
                      onBlur={() => {
                        setHeroHeadline(headlineDraft);
                        setHeadlineDraft(headlineDraft.trim() || 'Your Notes, Ready.');
                      }}
                      placeholder="Your Notes, Ready."
                      className="folio-input w-full rounded-xl px-3 py-2 text-xs font-semibold"
                    />
                  </div>

                  <div className="flex items-center justify-between border-t border-[#072D59]/10 pt-3 text-xs">
                    <span className="font-medium text-[#072D59]/75">
                      Favorite Pen &amp; Highlighter Slots (Keys 1–5)
                    </span>
                    <button
                      type="button"
                      data-testid="settings-reset-pen-slots"
                      onClick={resetPenSlots}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#072D59]/14 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]/65"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reset 5 Slots
                    </button>
                  </div>
                </div>
              )}

              {/* Tab 2: Appearance */}
              {activeTab === 'appearance' && (
                <div data-testid="settings-appearance-section" className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-[#072D59]">Appearance</h3>
                    <p className="text-xs text-[#072D59]/65">
                      Customize the editor studio desk backdrop, Smart Dark Paper, and UI contrast.
                    </p>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[#072D59]/65">
                      Canvas Desk Backdrop
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {DESK_BACKDROP_PRESETS.map((preset) => {
                        const selected = deskBackdrop === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            data-testid={`settings-backdrop-${preset.id}`}
                            aria-pressed={selected}
                            onClick={() => setDeskBackdrop(preset.id as DeskBackdropPresetId)}
                            className={`flex items-center gap-2 rounded-xl border px-2.5 py-2.5 text-left text-xs font-semibold transition duration-150 ${
                              selected
                                ? 'border-[#FD6E88] bg-white text-[#072D59] ring-2 ring-[#FD6E88]/25'
                                : 'border-[#072D59]/12 bg-[#F4F8FB] text-[#072D59]/80 hover:bg-white'
                            }`}
                          >
                            <span
                              className={`h-4 w-4 shrink-0 rounded-full border border-[#072D59]/20 ${preset.className ?? ''}`}
                              style={{ backgroundColor: preset.previewColor }}
                            />
                            <span className="truncate text-[11px]">{preset.label}</span>
                          </button>
                        );
                      })}

                      <label
                        data-testid="settings-backdrop-custom"
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2.5 text-xs font-semibold transition duration-150 ${
                          deskBackdrop === 'custom'
                            ? 'border-[#FD6E88] bg-white text-[#072D59] ring-2 ring-[#FD6E88]/25'
                            : 'border-[#072D59]/12 bg-[#F4F8FB] text-[#072D59]/80 hover:bg-white'
                        }`}
                      >
                        <input
                          type="color"
                          aria-label="Custom desk backdrop color"
                          value={deskCustomColor}
                          onChange={(e) => setDeskBackdrop('custom', e.target.value)}
                          className="h-4 w-4 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                        />
                        <span className="truncate text-[11px]">Custom ({deskCustomColor})</span>
                      </label>
                    </div>
                  </div>

                  {/* Smart Dark Paper View Toggle */}
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-[#072D59]/10 bg-[#F4F8FB] px-4 py-3">
                    <div className="flex items-start gap-2.5">
                      <Moon className="mt-0.5 h-4 w-4 shrink-0 text-[#072D59]" />
                      <div>
                        <div className="text-xs font-bold text-[#072D59]">
                          Smart Dark Paper View
                        </div>
                        <p className="mt-0.5 text-[11px] text-[#072D59]/65">
                          Renders light papers as dark slate (#131B2E) and near-black ink as off-white
                          (#F1F5F9) on screen without altering saved strokes or photos.
                        </p>
                      </div>
                    </div>
                    {renderToggleSwitch({
                      testId: 'settings-dark-paper-toggle',
                      label: 'Toggle Smart Dark Paper View',
                      checked: darkPaperView,
                      onToggle: () => setDarkPaperView(!darkPaperView),
                    })}
                  </div>

                  {/* Enhanced UI Contrast Toggle */}
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-[#072D59]/10 bg-[#F4F8FB] px-4 py-3">
                    <div className="flex items-start gap-2.5">
                      <Contrast className="mt-0.5 h-4 w-4 shrink-0 text-[#072D59]" />
                      <div>
                        <div className="text-xs font-bold text-[#072D59]">
                          Enhanced UI Border Contrast
                        </div>
                        <p className="mt-0.5 text-[11px] text-[#072D59]/65">
                          Strengthens Seal &amp; Navy control borders, muted labels, and card outlines
                          across shelves and dialogs.
                        </p>
                      </div>
                    </div>
                    {renderToggleSwitch({
                      testId: 'settings-high-contrast-toggle',
                      label: 'Toggle Enhanced UI Border Contrast',
                      checked: highContrastUi,
                      onToggle: () => setHighContrastUi(!highContrastUi),
                    })}
                  </div>
                </div>
              )}

              {/* Tab 3: AI & Gemini */}
              {activeTab === 'ai' && (
                <form
                  data-testid="settings-gemini-section"
                  onSubmit={handleSave}
                  className="space-y-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-[#072D59]">
                        Google AI Studio (Gemini) API Key
                      </h3>
                      <p className="mt-0.5 text-xs text-[#072D59]/65">
                        100% BYOK: connects directly from your device via{' '}
                        <code className="rounded bg-[#DBF2FC]/70 px-1 py-0.5 text-[#072D59]">
                          @google/genai
                        </code>{' '}
                        using your key stored only in local{' '}
                        <code className="rounded bg-[#DBF2FC]/70 px-1 py-0.5 text-[#072D59]">
                          localStorage
                        </code>
                        .
                      </p>
                    </div>

                    <a
                      href={GEMINI_API_STUDIO_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="settings-get-gemini-key-link"
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#DBF2FC]/70 px-2.5 py-1 text-[11px] font-semibold text-[#072D59] transition duration-150 hover:bg-[#DBF2FC]"
                    >
                      <span>AI Studio</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[200px] flex-1">
                      <input
                        id="gemini-api-key-input"
                        type={showKey ? 'text' : 'password'}
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setStatusMessage(null);
                          setTestResult(null);
                        }}
                        placeholder="Paste your AIza... API key"
                        autoComplete="off"
                        className="folio-input w-full rounded-xl py-2.5 pl-3.5 pr-10 text-sm"
                      />
                      <button
                        type="button"
                        aria-label={showKey ? 'Hide API key' : 'Show API key'}
                        onClick={() => setShowKey((prev) => !prev)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#072D59]/50 transition duration-150 hover:bg-[#DBF2FC]/60 hover:text-[#072D59]"
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    <button
                      type="button"
                      data-testid="test-gemini-key-btn"
                      disabled={testingKey}
                      onClick={() => void handleTestKey()}
                      className="folio-btn-secondary inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold disabled:opacity-50"
                    >
                      {testingKey ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FD6E88]" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 text-[#FD6E88]" />
                      )}
                      <span>{testingKey ? 'Testing…' : 'Test API Key'}</span>
                    </button>
                  </div>

                  {/* Model Selector */}
                  <div className="grid gap-3 rounded-xl border border-[#072D59]/10 bg-[#F4F8FB] p-3.5">
                    <div>
                      <label
                        htmlFor="gemini-model-select"
                        className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#072D59]/65"
                      >
                        Gemini Model
                      </label>
                      <select
                        id="gemini-model-select"
                        data-testid="gemini-model-select"
                        value={geminiModelPreset}
                        onChange={(e) => {
                          const nextPreset = e.target.value as GeminiModelPresetId;
                          setGeminiModelConfig(nextPreset, customModelDraft);
                          setTestResult(null);
                        }}
                        className="folio-input w-full rounded-xl px-3 py-2 text-xs font-semibold"
                      >
                        <option value="gemini-4-hydrogen">
                          gemini-4-hydrogen (Default · Multimodal Reasoning, Free &amp; Paid)
                        </option>
                        <option value="gemini-3.5-flash-lite">
                          gemini-3.5-flash-lite (Fastest &amp; Lightest)
                        </option>
                        <option value="custom">Custom Model ID…</option>
                      </select>
                    </div>

                    {geminiModelPreset === 'custom' && (
                      <div>
                        <label
                          htmlFor="gemini-custom-model-input"
                          className="mb-1 block text-[11px] font-semibold text-[#072D59]/70"
                        >
                          Custom Model ID
                        </label>
                        <input
                          id="gemini-custom-model-input"
                          data-testid="gemini-custom-model-input"
                          type="text"
                          value={customModelDraft}
                          onChange={(e) => {
                            setCustomModelDraft(e.target.value);
                            setGeminiModelConfig('custom', e.target.value);
                            setTestResult(null);
                          }}
                          placeholder="e.g. gemini-2.5-pro"
                          className="folio-input w-full rounded-xl px-3 py-2 font-mono text-xs"
                        />
                      </div>
                    )}

                    {/* Vault Lock Privacy Guardrail Toggle */}
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#072D59]/10 bg-white px-3.5 py-2.5">
                      <div className="flex items-start gap-2">
                        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[#072D59]" />
                        <div>
                          <div className="text-xs font-bold text-[#072D59]">
                            Block AI on Vault-Locked Notebooks
                          </div>
                          <p className="text-[11px] text-[#072D59]/65">
                            Keep encrypted notebooks 100% offline by blocking all Gemini sidebar &amp;
                            Lasso AI calls.
                          </p>
                        </div>
                      </div>
                      {renderToggleSwitch({
                        testId: 'settings-block-vault-ai-toggle',
                        label: 'Block AI on Vault-Locked Notebooks',
                        checked: blockAiOnVaultLocked,
                        onToggle: () => setBlockAiOnVaultLocked(!blockAiOnVaultLocked),
                      })}
                    </div>
                  </div>

                  {testResult && (
                    <div
                      data-testid="gemini-test-status"
                      className={`flex items-start gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${
                        testResult.ok
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-[#FD6E88]/40 bg-[#FD6E88]/10 text-[#F95573]'
                      }`}
                    >
                      {testResult.ok ? (
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      )}
                      <span>{testResult.message}</span>
                    </div>
                  )}

                  {statusMessage && (
                    <div
                      data-testid="settings-status-message"
                      className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>{statusMessage}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={handleClear}
                      disabled={!apiKey}
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-[#F95573] transition duration-150 hover:bg-[#FD6E88]/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clear Key
                    </button>

                    <button
                      type="submit"
                      className="folio-btn-crimson rounded-xl px-4 py-2 text-xs font-semibold shadow-xs"
                    >
                      Save Key
                    </button>
                  </div>
                </form>
              )}

              {/* Tab 4: Privacy & Vault */}
              {activeTab === 'vault' && (
                <div data-testid="settings-vault-section" className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-[#072D59]">Privacy &amp; Vault Lock</h3>
                      <p className="text-xs text-[#072D59]/65">
                        Protect private notebooks at rest with AES-GCM-256 and a Recovery Key.
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        vaultConfigured
                          ? 'bg-[#072D59] text-white'
                          : 'bg-[#F4F8FB] text-[#072D59]/70 ring-1 ring-[#072D59]/12'
                      }`}
                    >
                      {vaultConfigured
                        ? `Active · ${lockedNotebookCount} locked`
                        : 'Not Configured'}
                    </span>
                  </div>

                  {!vaultConfigured ? (
                    <div className="space-y-3 rounded-2xl border border-[#072D59]/10 bg-[#F4F8FB] p-4">
                      <p className="text-xs leading-relaxed text-[#072D59]/80">
                        Encrypt individual notebooks locally using Web Crypto AES-GCM-256 and an
                        offline Recovery Key. Your password never leaves this device.
                      </p>
                      <button
                        type="button"
                        onClick={() => setSetupOpen(true)}
                        className="folio-btn-navy inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Set Up Vault Password
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setVaultAction((a) =>
                              a === 'change-password' ? 'none' : 'change-password',
                            );
                            setVaultError(null);
                            setVaultNotice(null);
                            setFreshRecoveryKey(null);
                          }}
                          className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition duration-150 ${
                            vaultAction === 'change-password'
                              ? 'border-[#072D59] bg-[#072D59] text-white'
                              : 'border-[#072D59]/12 bg-white text-[#072D59] hover:bg-[#DBF2FC]/55'
                          }`}
                        >
                          Change Vault Password
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setVaultAction((a) =>
                              a === 'regen-recovery' ? 'none' : 'regen-recovery',
                            );
                            setVaultError(null);
                            setVaultNotice(null);
                            setFreshRecoveryKey(null);
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition duration-150 ${
                            vaultAction === 'regen-recovery'
                              ? 'border-[#072D59] bg-[#072D59] text-white'
                              : 'border-[#072D59]/12 bg-white text-[#072D59] hover:bg-[#DBF2FC]/55'
                          }`}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Regenerate Recovery Key
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleLockAllNow()}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 transition duration-150 hover:bg-amber-100"
                        >
                          <Lock className="h-3.5 w-3.5" />
                          Lock All Notebooks Now
                        </button>
                      </div>

                      {vaultAction === 'change-password' && (
                        <form
                          onSubmit={handleChangePasswordSubmit}
                          className="space-y-2.5 rounded-xl border border-[#072D59]/10 bg-[#F4F8FB] p-3.5"
                        >
                          <input
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder="Current Vault Password"
                            className="folio-input w-full rounded-lg px-3 py-2 text-xs"
                          />
                          <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="New Vault Password (6+ chars)"
                            className="folio-input w-full rounded-lg px-3 py-2 text-xs"
                          />
                          <div className="flex items-center gap-2">
                            <div className="grid flex-1 grid-cols-4 gap-1">
                              {[1, 2, 3, 4].map((bar) => (
                                <div
                                  key={bar}
                                  className={`h-1 rounded-full ${
                                    strength.score >= bar
                                      ? strengthColors[strength.score]
                                      : 'bg-[#072D59]/12'
                                  }`}
                                />
                              ))}
                            </div>
                            <span className="text-[11px] font-semibold text-[#072D59]/65">
                              {newPassword ? strength.label : ''}
                            </span>
                          </div>
                          <input
                            type="password"
                            value={confirmNewPassword}
                            onChange={(e) => setConfirmNewPassword(e.target.value)}
                            placeholder="Confirm New Password"
                            className="folio-input w-full rounded-lg px-3 py-2 text-xs"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setVaultAction('none')}
                              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#072D59]/70 hover:bg-[#DBF2FC]/55"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={vaultBusy}
                              className="folio-btn-navy rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                            >
                              {vaultBusy ? 'Updating...' : 'Update Password'}
                            </button>
                          </div>
                        </form>
                      )}

                      {vaultAction === 'regen-recovery' && (
                        <form
                          onSubmit={handleRegenerateRecoverySubmit}
                          className="space-y-2.5 rounded-xl border border-[#072D59]/10 bg-[#F4F8FB] p-3.5"
                        >
                          <p className="text-[11px] text-[#072D59]/65">
                            Verify your current Vault Password to issue a new Recovery Key and
                            invalidate the previous one.
                          </p>
                          <div className="flex gap-2">
                            <input
                              type="password"
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                              placeholder="Current Vault Password"
                              className="folio-input flex-1 rounded-lg px-3 py-2 text-xs"
                            />
                            <button
                              type="submit"
                              disabled={vaultBusy || !currentPassword}
                              className="folio-btn-navy rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
                            >
                              {vaultBusy ? 'Generating...' : 'Generate Key'}
                            </button>
                          </div>

                          {freshRecoveryKey && (
                            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                              <div
                                data-testid="regenerated-recovery-key"
                                className="rounded-lg border border-amber-300 bg-white px-2.5 py-2 text-center font-mono text-xs font-bold tracking-wider text-[#072D59] select-all"
                              >
                                {freshRecoveryKey}
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={handleCopyRecovery}
                                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#072D59]"
                                >
                                  {copiedRecovery ? (
                                    <>
                                      <Check className="h-3 w-3 text-emerald-600" />
                                      Copied
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" />
                                      Copy Key
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleDownloadRecovery}
                                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#072D59]"
                                >
                                  <Download className="h-3 w-3" />
                                  Download .txt
                                </button>
                              </div>
                            </div>
                          )}
                        </form>
                      )}

                      {vaultError && (
                        <p
                          data-testid="vault-settings-error"
                          className="text-xs font-semibold text-[#F95573]"
                        >
                          {vaultError}
                        </p>
                      )}
                      {vaultNotice && (
                        <p
                          data-testid="vault-settings-notice"
                          className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700"
                        >
                          <Check className="h-3.5 w-3.5" />
                          {vaultNotice}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 5: Backup & Data */}
              {activeTab === 'data' && (
                <div data-testid="settings-workspace-section" className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-[#072D59]">Backup &amp; Data</h3>
                    <p className="text-xs text-[#072D59]/65">
                      Inspect local IndexedDB storage usage and export portable workspace backups.
                    </p>
                  </div>

                  {/* Storage Summary Grid */}
                  <div
                    data-testid="settings-storage-summary"
                    className="space-y-2.5 rounded-2xl border border-[#072D59]/10 bg-[#F4F8FB] p-3.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#072D59]">Local IndexedDB Storage</span>
                      <span className="folio-mono rounded-full bg-[#DBF2FC] px-2.5 py-0.5 text-[11px] font-bold text-[#072D59]">
                        {formatBytesCompact(storageSummary?.estimatedBytes)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded-xl border border-[#072D59]/10 bg-white px-3 py-2">
                        <div
                          data-testid="storage-stat-notebooks"
                          className="folio-mono text-base font-bold text-[#072D59]"
                        >
                          {storageSummary ? storageSummary.notebookCount : '—'}
                        </div>
                        <div className="text-[11px] font-semibold text-[#072D59]/60">
                          Notebooks
                        </div>
                      </div>
                      <div className="rounded-xl border border-[#072D59]/10 bg-white px-3 py-2">
                        <div
                          data-testid="storage-stat-pages"
                          className="folio-mono text-base font-bold text-[#072D59]"
                        >
                          {storageSummary ? storageSummary.pageCount : '—'}
                        </div>
                        <div className="text-[11px] font-semibold text-[#072D59]/60">
                          Pages
                        </div>
                      </div>
                      <div className="rounded-xl border border-[#072D59]/10 bg-white px-3 py-2">
                        <div
                          data-testid="storage-stat-templates"
                          className="folio-mono text-base font-bold text-[#072D59]"
                        >
                          {storageSummary ? storageSummary.templateCount : '—'}
                        </div>
                        <div className="text-[11px] font-semibold text-[#072D59]/60">
                          Templates
                        </div>
                      </div>
                      <div className="rounded-xl border border-[#072D59]/10 bg-white px-3 py-2">
                        <div
                          data-testid="storage-stat-pdf-assets"
                          className="folio-mono text-base font-bold text-[#072D59]"
                        >
                          {storageSummary ? storageSummary.pdfAssetCount : '—'}
                        </div>
                        <div className="text-[11px] font-semibold text-[#072D59]/60">
                          PDF Assets
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Workspace Backup Archive */}
                  <div className="space-y-3 rounded-2xl border border-[#072D59]/10 bg-white p-4">
                    <div className="flex items-start gap-2.5">
                      <div className="rounded-xl bg-[#DBF2FC] p-2 text-[#072D59]">
                        <Archive className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-[#072D59]">
                          Workspace Backup &amp; Restore
                        </h4>
                        <p className="mt-0.5 text-[11px] text-[#072D59]/65">
                          Download a single <code>.folio-workspace.json</code> archive of all
                          folders, unlocked notebooks, PDFs, and custom templates, or restore one
                          cleanly without overwriting existing items.
                        </p>
                      </div>
                    </div>

                    <input
                      ref={workspaceInputRef}
                      type="file"
                      accept=".folio-workspace.json,.json,application/json"
                      data-testid="import-workspace-input"
                      onChange={(e) => void handleImportWorkspaceFile(e)}
                      className="hidden"
                    />

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-testid="export-workspace-btn"
                        disabled={workspaceBusy}
                        onClick={() => void handleExportWorkspace()}
                        className="folio-btn-navy inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>{workspaceBusy ? 'Working…' : 'Export Full Workspace'}</span>
                      </button>
                      <button
                        type="button"
                        data-testid="import-workspace-btn"
                        disabled={workspaceBusy}
                        onClick={() => workspaceInputRef.current?.click()}
                        className="folio-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
                      >
                        <Upload className="h-3.5 w-3.5 text-[#FD6E88]" />
                        <span>Import Workspace Backup</span>
                      </button>
                    </div>

                    {(workspaceMessage || workspaceError) && (
                      <div
                        data-testid="workspace-status-message"
                        className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                          workspaceError
                            ? 'border-[#FD6E88]/40 bg-[#FD6E88]/10 text-[#F95573]'
                            : 'border-[#072D59]/12 bg-[#DBF2FC]/45 text-[#072D59]'
                        }`}
                      >
                        {workspaceError ?? workspaceMessage}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Persistent Footer */}
          <div className="folio-modal-footer flex shrink-0 items-center justify-end px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="folio-btn-secondary rounded-xl px-4 py-1.5 text-xs font-semibold"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      <VaultSetupModal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        onCompleted={() => {
          setVaultConfigured(hasVaultSetup());
          setVaultNotice('Vault Lock activated.');
        }}
      />
    </>
  );
};
