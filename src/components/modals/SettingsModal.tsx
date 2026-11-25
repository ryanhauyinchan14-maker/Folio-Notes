import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Globe,
  Layout,
  Loader2,
  Lock,
  Palette,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
  ZoomIn,
} from 'lucide-react';
import { DebouncedColorInput } from '../common/DebouncedColorInput';
import { DraggableRangeSlider } from '../common/DraggableRangeSlider';
import { MorphingPill, useMorphingIndicator } from '../common/MorphingIndicator';
import { PaperShaderBackdrop } from '../common/PaperShaderBackdrop';
import { testAiConnection } from '../../ai/aiClient';
import { type LocalStorageSummary, repository } from '../../db/repository';
import { useAppStore } from '../../store/useAppStore';
import { useUpdaterStore } from '../../store/useUpdaterStore';
import type { PaperPattern } from '../../types/notes';
import { triggerBlobDownload } from '../../utils/exportNotebook';
import {
  AI_PROVIDER_META,
  AI_PROVIDER_ORDER,
  type AiProviderId,
  DESK_BACKDROP_PRESETS,
  type DeskBackdropPresetId,
  type DockPosition,
  type GeminiModelPresetId,
  isLocalhostUrl,
  resolveActiveAiConfig,
} from '../../utils/settings';
import {
  applyInterfaceFontToRuntime,
  DEFAULT_INTERFACE_FONT_ID,
  ensureCuratedPreviewFontsLoaded,
  getActiveInterfaceFontLabel,
  INTERFACE_FONT_PRESETS,
  type InterfaceFontCategory,
  sanitizeCustomFontName,
} from '../../utils/uiFonts';
import { DEFAULT_UI_SCALE } from '../../utils/uiZoom';
import {
  buildRecoveryKeyFileText,
  changeVaultPassword,
  evaluatePasswordStrength,
  hasVaultSetup,
  regenerateVaultRecoveryKey,
} from '../../utils/vaultCrypto';
import { VaultSetupModal } from './VaultSetupModal';

export type SettingsTabId = 'general' | 'appearance' | 'ai' | 'vault' | 'data' | 'updates';

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
    desc: 'Backdrop & UI scale',
    icon: <Palette className="h-4 w-4" />,
  },
  {
    id: 'ai',
    label: 'AI & Providers',
    desc: '5-provider BYOK keys',
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
  {
    id: 'updates',
    label: 'App Updates',
    desc: 'Auto update & version',
    icon: <RefreshCw className="h-4 w-4" />,
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
  const uiScale = useAppStore((s) => s.uiScale);
  const setUiScale = useAppStore((s) => s.setUiScale);
  const deskBackdrop = useAppStore((s) => s.deskBackdrop);
  const deskCustomColor = useAppStore((s) => s.deskCustomColor);
  const setDeskBackdrop = useAppStore((s) => s.setDeskBackdrop);
  const interfaceFontId = useAppStore((s) => s.interfaceFontId);
  const interfaceCustomFont = useAppStore((s) => s.interfaceCustomFont);
  const uploadedFonts = useAppStore((s) => s.uploadedFonts);
  const setInterfaceFont = useAppStore((s) => s.setInterfaceFont);
  const importCustomInterfaceFont = useAppStore((s) => s.importCustomInterfaceFont);
  const deleteCustomInterfaceFont = useAppStore((s) => s.deleteCustomInterfaceFont);
  const uiSoundsEnabled = useAppStore((s) => s.uiSoundsEnabled);
  const setUiSoundsEnabled = useAppStore((s) => s.setUiSoundsEnabled);
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
  const activeAiProvider = useAppStore((s) => s.activeAiProvider);
  const setActiveAiProvider = useAppStore((s) => s.setActiveAiProvider);
  const aiProviderKeys = useAppStore((s) => s.aiProviderKeys);
  const setAiProviderKey = useAppStore((s) => s.setAiProviderKey);
  const clearAiProviderKey = useAppStore((s) => s.clearAiProviderKey);
  const aiProviderModels = useAppStore((s) => s.aiProviderModels);
  const setAiProviderModel = useAppStore((s) => s.setAiProviderModel);
  const aiCustomBaseUrl = useAppStore((s) => s.aiCustomBaseUrl);
  const setAiCustomBaseUrl = useAppStore((s) => s.setAiCustomBaseUrl);
  const geminiModelPreset = useAppStore((s) => s.geminiModelPreset);
  const geminiCustomModelId = useAppStore((s) => s.geminiCustomModelId);
  const setGeminiModelConfig = useAppStore((s) => s.setGeminiModelConfig);
  const blockAiOnVaultLocked = useAppStore((s) => s.blockAiOnVaultLocked);
  const setBlockAiOnVaultLocked = useAppStore((s) => s.setBlockAiOnVaultLocked);
  const updateStatus = useUpdaterStore((s) => s.status);
  const updateRestarting = useUpdaterStore((s) => s.restarting);
  const updateActionError = useUpdaterStore((s) => s.actionError);
  const initUpdater = useUpdaterStore((s) => s.initUpdater);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const restartAndInstall = useUpdaterStore((s) => s.restartAndInstall);
  const setLocalUpdateConfig = useUpdaterStore((s) => s.setLocalConfig);
  const pickLocalUpdateDir = useUpdaterStore((s) => s.pickLocalDir);
  const hasDesktopUpdater =
    typeof window !== 'undefined' && Boolean(window.folioDesktop?.updater);

  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [customModelDraft, setCustomModelDraft] = useState(geminiCustomModelId);
  const [testingKey, setTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [headlineDraft, setHeadlineDraft] = useState(heroHeadline);
  const [uiScaleDraftPct, setUiScaleDraftPct] = useState<number | null>(null);

  // Interface Font picker state
  const [fontSearch, setFontSearch] = useState('');
  const [fontCategory, setFontCategory] = useState<
    'all' | InterfaceFontCategory | 'system' | 'imported'
  >('all');
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [systemFontsLoaded, setSystemFontsLoaded] = useState(false);
  const [fontStatusMessage, setFontStatusMessage] = useState<string | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);
  const fontFileInputRef = useRef<HTMLInputElement | null>(null);

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

  const navTrackRef = useRef<HTMLElement | null>(null);
  const defaultToolTrackRef = useRef<HTMLDivElement | null>(null);
  const defaultZoomTrackRef = useRef<HTMLDivElement | null>(null);
  const dockPosTrackRef = useRef<HTMLDivElement | null>(null);

  const navIndicator = useMorphingIndicator(navTrackRef, open ? activeTab : null, [open]);
  const defaultToolIndicator = useMorphingIndicator(
    defaultToolTrackRef,
    open && activeTab === 'general' ? defaultTool : null,
    [open, activeTab],
  );
  const defaultZoomIndicator = useMorphingIndicator(
    defaultZoomTrackRef,
    open && activeTab === 'general' ? defaultZoomMode : null,
    [open, activeTab],
  );
  const dockPosIndicator = useMorphingIndicator(
    dockPosTrackRef,
    open && activeTab === 'general' ? dockPosition : null,
    [open, activeTab],
  );

  useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab);
    setApiKey(aiProviderKeys[activeAiProvider] ?? '');
    setCustomModelDraft(geminiCustomModelId);
    setTestingKey(false);
    setTestResult(null);
    setHeadlineDraft(heroHeadline);
    setUiScaleDraftPct(null);
    setFontSearch('');
    setFontStatusMessage(null);
    setFontError(null);
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
    if (!open || activeTab !== 'appearance') return;
    ensureCuratedPreviewFontsLoaded();
    if (systemFontsLoaded) return;
    let cancelled = false;
    const loader = window.folioDesktop?.fonts?.listSystemFonts;
    if (typeof loader === 'function') {
      void loader()
        .then((fonts) => {
          if (!cancelled && Array.isArray(fonts)) {
            setSystemFonts(fonts);
            setSystemFontsLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled) setSystemFontsLoaded(true);
        });
    } else {
      setSystemFontsLoaded(true);
    }
    return () => {
      cancelled = true;
    };
  }, [open, activeTab, systemFontsLoaded]);

  useEffect(() => {
    if (!open || !hasDesktopUpdater || updateStatus) return;
    return initUpdater();
  }, [open, hasDesktopUpdater, updateStatus, initUpdater]);

  useEffect(() => {
    if (!open) return;
    setApiKey(aiProviderKeys[activeAiProvider] ?? '');
  }, [activeAiProvider, aiProviderKeys, open]);

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
          ? ` Skipped ${skipped.length} Vault locked notebook(s): ${skipped.join(', ')}.`
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

  const handleSelectProvider = (provider: AiProviderId) => {
    setActiveAiProvider(provider);
    setApiKey(aiProviderKeys[provider] ?? '');
    setStatusMessage(null);
    setTestResult(null);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setAiProviderKey(activeAiProvider, apiKey);
    if (activeAiProvider === 'gemini' && geminiModelPreset === 'custom') {
      setGeminiModelConfig('custom', customModelDraft);
    }
    setTestResult(null);
    const meta = AI_PROVIDER_META[activeAiProvider];
    setStatusMessage(
      apiKey.trim()
        ? `${meta.label} API key saved locally in localStorage.`
        : `${meta.label} key cleared from localStorage.`,
    );
  };

  const handleClear = () => {
    clearAiProviderKey(activeAiProvider);
    setApiKey('');
    setTestResult(null);
    setStatusMessage(`${AI_PROVIDER_META[activeAiProvider].label} key removed from localStorage.`);
  };

  const handleTestKey = async () => {
    const resolved = resolveActiveAiConfig({
      activeAiProvider,
      aiProviderKeys: { ...aiProviderKeys, [activeAiProvider]: apiKey.trim() || aiProviderKeys[activeAiProvider] || '' },
      aiProviderModels,
      aiCustomBaseUrl,
      geminiModelPreset,
      geminiCustomModelId:
        geminiModelPreset === 'custom' ? customModelDraft : geminiCustomModelId,
    });
    const meta = AI_PROVIDER_META[activeAiProvider];
    const keyRequired =
      activeAiProvider !== 'custom' || !isLocalhostUrl(resolved.baseUrl ?? '');

    if (keyRequired && !resolved.apiKey) {
      setTestResult({
        ok: false,
        message: `Enter or save a ${meta.label} API key first before testing.`,
      });
      return;
    }

    setTestingKey(true);
    setTestResult(null);
    try {
      const res = await testAiConnection({
        provider: resolved.provider,
        apiKey: resolved.apiKey,
        model: resolved.model,
        baseUrl: resolved.baseUrl,
      });
      setTestResult(
        res.ok
          ? { ok: true, message: `Connected to ${meta.label}! Model "${res.model}" responded cleanly.` }
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
    'bg-[var(--state-danger)]',
    'bg-[var(--state-warning)]',
    'bg-[#38BDF8]',
    'bg-[var(--state-success)]',
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
      className={`folio-press inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150 ${
        props.checked
          ? 'folio-glass-toggle-on'
          : 'bg-[var(--navy-900)]/14 ring-1 ring-inset ring-[var(--border-subtle)]'
      }`}
    >
      <span
        className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow ring-1 ring-[var(--navy-900)]/12 transition-transform duration-150 ${
          props.checked ? 'translate-x-5' : 'translate-x-0'
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
          className="folio-modal-card flex max-h-[88vh] w-full max-w-[740px] flex-col overflow-hidden rounded-2xl text-[var(--navy-900)] sm:h-[580px]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="folio-modal-header flex shrink-0 items-center justify-between px-5 py-3.5">
            <div>
              <h2 id="settings-modal-title" className="text-base font-bold text-[var(--navy-900)]">
                Preferences
              </h2>
              <p className="text-xs text-[var(--navy-600)]">
                Workspace defaults, UI scale, multi provider AI &amp; local backups
              </p>
            </div>
            <button
              type="button"
              aria-label="Close settings"
              onClick={onClose}
              className="folio-press rounded-lg p-1.5 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Native Desktop Split Sidebar + Content */}
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* Sidebar Navigation */}
            <nav
              ref={navTrackRef}
              role="tablist"
              aria-label="Preferences sections"
              className="custom-scrollbar relative flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-2.5 md:w-52 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:p-3"
            >
              <MorphingPill indicator={navIndicator} className="rounded-xl" />
              {SETTINGS_TABS.map((tab) => {
                const selected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    data-morph-key={tab.id}
                    data-testid={`settings-tab-${tab.id}`}
                    aria-selected={selected}
                    onClick={() => setActiveTab(tab.id)}
                    className={`folio-press relative z-10 flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left md:w-full ${
                      selected
                        ? navIndicator.ready
                          ? 'bg-transparent text-white'
                          : 'folio-glass-active'
                        : 'text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]'
                    }`}
                  >
                    <span
                      className={`shrink-0 ${
                        selected ? 'text-[var(--crimson-500)]' : 'text-[var(--navy-600)]'
                      }`}
                    >
                      {tab.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-xs font-bold leading-tight">
                        <span className="truncate">{tab.label}</span>
                        {tab.id === 'updates' && updateStatus?.phase === 'ready' && (
                          <span
                            data-testid="settings-tab-updates-dot"
                            className="h-2 w-2 shrink-0 rounded-full bg-[var(--crimson-500)]"
                          />
                        )}
                      </span>
                      <span
                        className={`hidden truncate text-[10px] md:block ${
                          selected ? 'text-[#DBF2FC]/90' : 'text-[var(--navy-600)]'
                        }`}
                      >
                        {tab.desc}
                      </span>
                    </span>
                  </button>
                );
              })}

              <div className="relative z-10 mt-auto hidden overflow-hidden rounded-xl border border-[var(--border-subtle)] p-2.5 text-[11px] text-[var(--navy-900)] md:block">
                <PaperShaderBackdrop variant="static-accent" />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-[var(--surface-elevated)]/82"
                />
                <div className="relative z-10 flex items-center gap-1.5 font-bold text-[var(--navy-900)]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
                  <span>100% Local First</span>
                </div>
                <p className="relative z-10 mt-1 leading-relaxed text-[10px] text-[var(--navy-600)]">
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
                    <h3 className="text-sm font-bold text-[var(--navy-900)]">General &amp; Editor</h3>
                    <p className="text-xs text-[var(--navy-600)]">
                      Configure opening tool behavior, default templates, and workspace dock.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-3">
                      <div className="folio-section-label mb-1.5">
                        Default Tool on Open
                      </div>
                      <div
                        ref={defaultToolTrackRef}
                        className="folio-segmented-track flex rounded-xl p-0.5"
                      >
                        <MorphingPill indicator={defaultToolIndicator} className="rounded-lg" />
                        <button
                          type="button"
                          data-morph-key="pen"
                          data-testid="settings-tool-pen"
                          onClick={() => setDefaultTool('pen')}
                          className={`folio-press relative z-10 flex-1 rounded-lg py-1.5 text-xs font-semibold ${
                            defaultTool === 'pen'
                              ? defaultToolIndicator.ready
                                ? 'bg-transparent text-white'
                                : 'folio-glass-active'
                              : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                          }`}
                        >
                          Pen
                        </button>
                        <button
                          type="button"
                          data-morph-key="pan"
                          data-testid="settings-tool-pan"
                          onClick={() => setDefaultTool('pan')}
                          className={`folio-press relative z-10 flex-1 rounded-lg py-1.5 text-xs font-semibold ${
                            defaultTool === 'pan'
                              ? defaultToolIndicator.ready
                                ? 'bg-transparent text-white'
                                : 'folio-glass-active'
                              : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                          }`}
                        >
                          Select (V)
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-3">
                      <div className="folio-section-label mb-1.5">
                        Default Zoom on Open
                      </div>
                      <div
                        ref={defaultZoomTrackRef}
                        className="folio-segmented-track flex rounded-xl p-0.5"
                      >
                        <MorphingPill indicator={defaultZoomIndicator} className="rounded-lg" />
                        <button
                          type="button"
                          data-morph-key="100"
                          data-testid="settings-zoom-100"
                          onClick={() => setDefaultZoomMode('100')}
                          className={`folio-press relative z-10 flex-1 rounded-lg py-1.5 text-xs font-semibold ${
                            defaultZoomMode === '100'
                              ? defaultZoomIndicator.ready
                                ? 'bg-transparent text-white'
                                : 'folio-glass-active'
                              : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                          }`}
                        >
                          100%
                        </button>
                        <button
                          type="button"
                          data-morph-key="fit-width"
                          data-testid="settings-zoom-fit"
                          onClick={() => setDefaultZoomMode('fit-width')}
                          className={`folio-press relative z-10 flex-1 rounded-lg py-1.5 text-xs font-semibold ${
                            defaultZoomMode === 'fit-width'
                              ? defaultZoomIndicator.ready
                                ? 'bg-transparent text-white'
                                : 'folio-glass-active'
                              : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
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
                      className="folio-section-label mb-1.5 block"
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
                      <option value="ruled">Lined</option>
                      <option value="blank">Blank</option>
                      <option value="grid">Graph</option>
                      <option value="dotted">Dotted</option>
                      <option value="cornell">Study Notes (Cornell)</option>
                    </select>
                  </div>

                  {/* Tool Dock Position */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-3.5">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--navy-900)]">
                        <Layout className="h-3.5 w-3.5" />
                        Tool Dock Position
                      </div>
                      <div className="text-[11px] text-[var(--navy-600)]">
                        Press Tab in the editor anytime for Zen Mode
                      </div>
                    </div>

                    <div
                      ref={dockPosTrackRef}
                      className="folio-segmented-track flex rounded-xl p-0.5"
                    >
                      <MorphingPill indicator={dockPosIndicator} className="rounded-lg" />
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
                          data-morph-key={pos.id}
                          data-testid={`settings-dock-${pos.id}`}
                          aria-pressed={dockPosition === pos.id}
                          onClick={() => setDockPosition(pos.id)}
                          className={`folio-press relative z-10 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                            dockPosition === pos.id
                              ? dockPosIndicator.ready
                                ? 'bg-transparent text-white'
                                : 'folio-glass-active'
                              : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
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
                      className="folio-section-label mb-1.5 block"
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

                  <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 text-xs">
                    <span className="font-medium text-[var(--navy-600)]">
                      Favorite Pen &amp; Highlighter Slots (Keys 1–5)
                    </span>
                    <button
                      type="button"
                      data-testid="settings-reset-pen-slots"
                      onClick={resetPenSlots}
                      className="folio-btn-secondary inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold"
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
                    <h3 className="text-sm font-bold text-[var(--navy-900)]">Appearance</h3>
                    <p className="text-xs text-[var(--navy-600)]">
                      Customize the editor studio desk backdrop, interface font, scale, and sound.
                    </p>
                  </div>

                  <div>
                    <div className="folio-section-label mb-2">
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
                            className={`folio-press flex items-center gap-2 rounded-xl border px-2.5 py-2.5 text-left text-xs font-semibold ${
                              selected
                                ? 'border-[var(--crimson-500)] bg-[var(--surface-elevated)] text-[var(--navy-900)] ring-2 ring-[var(--crimson-glow)]'
                                : 'border-[var(--border-subtle)] bg-[var(--surface-canvas)] text-[var(--navy-600)] hover:bg-[var(--surface-elevated)] hover:text-[var(--navy-900)]'
                            }`}
                          >
                            <span
                              className={`h-4 w-4 shrink-0 rounded-full border border-[var(--border-strong)] ${preset.className ?? ''}`}
                              style={{ backgroundColor: preset.previewColor }}
                            />
                            <span className="truncate text-[11px]">{preset.label}</span>
                          </button>
                        );
                      })}

                      <label
                        data-testid="settings-backdrop-custom"
                        className={`folio-press flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2.5 text-xs font-semibold ${
                          deskBackdrop === 'custom'
                            ? 'border-[var(--crimson-500)] bg-[var(--surface-elevated)] text-[var(--navy-900)] ring-2 ring-[var(--crimson-glow)]'
                            : 'border-[var(--border-subtle)] bg-[var(--surface-canvas)] text-[var(--navy-600)] hover:bg-[var(--surface-elevated)] hover:text-[var(--navy-900)]'
                        }`}
                      >
                        <DebouncedColorInput
                          value={deskCustomColor}
                          ariaLabel="Custom desk backdrop color"
                          className="h-4 w-4 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                          onPreview={(c) => setDeskBackdrop('custom', c)}
                          onCommit={(c) => setDeskBackdrop('custom', c)}
                        />
                        <span className="folio-mono truncate text-[11px]">
                          Custom ({deskCustomColor})
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Interface Font Picker */}
                  {(() => {
                    const activeFontLabel = getActiveInterfaceFontLabel(
                      interfaceFontId,
                      interfaceCustomFont,
                      uploadedFonts,
                    );
                    const normalizedFontQuery = fontSearch.trim().toLowerCase();
                    const cleanedCustomCandidate = sanitizeCustomFontName(fontSearch);
                    const exactPresetMatch = INTERFACE_FONT_PRESETS.some(
                      (p) => p.name.toLowerCase() === cleanedCustomCandidate.toLowerCase(),
                    );
                    const matchingPresets = INTERFACE_FONT_PRESETS.filter((preset) => {
                      if (
                        fontCategory !== 'all' &&
                        fontCategory !== preset.category
                      ) {
                        return false;
                      }
                      if (!normalizedFontQuery) return true;
                      return (
                        preset.name.toLowerCase().includes(normalizedFontQuery) ||
                        preset.subtitle.toLowerCase().includes(normalizedFontQuery)
                      );
                    });
                    const showUploaded =
                      fontCategory === 'all' || fontCategory === 'imported';
                    const matchingUploaded = showUploaded
                      ? uploadedFonts.filter(
                          (f) =>
                            !normalizedFontQuery ||
                            f.name.toLowerCase().includes(normalizedFontQuery) ||
                            f.fileName.toLowerCase().includes(normalizedFontQuery),
                        )
                      : [];
                    const showSystemList =
                      systemFonts.length > 0 &&
                      (fontCategory === 'system' ||
                        (fontCategory === 'all' && normalizedFontQuery.length > 0));
                    const matchingSystem = showSystemList
                      ? systemFonts
                          .filter(
                            (name) =>
                              !normalizedFontQuery ||
                              name.toLowerCase().includes(normalizedFontQuery),
                          )
                          .slice(0, 60)
                      : [];

                    const categoryTabs: Array<{
                      id: 'all' | InterfaceFontCategory | 'system' | 'imported';
                      label: string;
                    }> = [
                      { id: 'all', label: 'All' },
                      { id: 'sans', label: 'Sans' },
                      { id: 'serif', label: 'Serif' },
                      { id: 'accessible', label: 'Accessible' },
                      { id: 'mono', label: 'Mono & Script' },
                      ...(systemFonts.length > 0
                        ? [{ id: 'system' as const, label: `System (${systemFonts.length})` }]
                        : []),
                      ...(uploadedFonts.length > 0
                        ? [{ id: 'imported' as const, label: `Imported (${uploadedFonts.length})` }]
                        : []),
                    ];

                    const applyNamedCustomFont = (rawName: string, knownSystem = false) => {
                      const clean = sanitizeCustomFontName(rawName);
                      if (!clean) return;
                      setFontError(null);
                      setFontStatusMessage(null);
                      setInterfaceFont('custom', clean);
                      void applyInterfaceFontToRuntime('custom', clean, {
                        skipGoogleLookup: knownSystem,
                      }).then((res) => {
                        setFontStatusMessage(
                          res.source === 'google'
                            ? `Loaded Google Font "${res.label}".`
                            : `Applied local system font "${res.label}".`,
                        );
                      });
                    };

                    return (
                      <div
                        data-testid="settings-interface-font-section"
                        className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-3.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="folio-section-label">Interface Font</span>
                            <span
                              data-testid="settings-active-font-badge"
                              className="rounded-full bg-[var(--surface-elevated)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--navy-900)] ring-1 ring-[var(--border-subtle)]"
                            >
                              {activeFontLabel}
                            </span>
                          </div>
                          {interfaceFontId !== DEFAULT_INTERFACE_FONT_ID && (
                            <button
                              type="button"
                              data-testid="settings-interface-font-reset"
                              onClick={() => {
                                setFontError(null);
                                setFontStatusMessage(null);
                                setInterfaceFont(DEFAULT_INTERFACE_FONT_ID, '');
                                void applyInterfaceFontToRuntime(DEFAULT_INTERFACE_FONT_ID, '');
                              }}
                              className="folio-btn-secondary rounded-lg px-2 py-0.5 text-[11px] font-semibold"
                            >
                              Reset
                            </button>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            data-testid="settings-font-search-input"
                            value={fontSearch}
                            onChange={(e) => setFontSearch(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && cleanedCustomCandidate) {
                                e.preventDefault();
                                applyNamedCustomFont(
                                  cleanedCustomCandidate,
                                  systemFonts.some(
                                    (s) => s.toLowerCase() === cleanedCustomCandidate.toLowerCase(),
                                  ),
                                );
                              }
                            }}
                            placeholder="Search fonts or type any font name…"
                            className="folio-input min-w-[180px] flex-1 rounded-xl px-3 py-1.5 text-xs"
                          />
                          {cleanedCustomCandidate && !exactPresetMatch && (
                            <button
                              type="button"
                              data-testid="settings-apply-custom-font-btn"
                              onClick={() =>
                                applyNamedCustomFont(
                                  cleanedCustomCandidate,
                                  systemFonts.some(
                                    (s) => s.toLowerCase() === cleanedCustomCandidate.toLowerCase(),
                                  ),
                                )
                              }
                              className="folio-btn-navy rounded-xl px-3 py-1.5 text-xs font-semibold"
                            >
                              Use &ldquo;{cleanedCustomCandidate}&rdquo;
                            </button>
                          )}
                          <button
                            type="button"
                            data-testid="settings-import-font-btn"
                            onClick={() => fontFileInputRef.current?.click()}
                            className="folio-btn-secondary rounded-xl px-3 py-1.5 text-xs font-semibold"
                          >
                            Import File
                          </button>
                          <input
                            ref={fontFileInputRef}
                            type="file"
                            data-testid="settings-import-font-input"
                            accept=".ttf,.otf,.woff,.woff2"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (!file) return;
                              setFontError(null);
                              setFontStatusMessage(null);
                              void importCustomInterfaceFont(file).then((res) => {
                                if (res.ok && res.fontId) {
                                  setFontStatusMessage(`Imported offline font "${res.name}".`);
                                  void applyInterfaceFontToRuntime(res.fontId, res.name);
                                } else {
                                  setFontError(res.error ?? 'Failed to import font file.');
                                }
                              });
                            }}
                          />
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {categoryTabs.map((cat) => {
                            const active = fontCategory === cat.id;
                            return (
                              <button
                                key={cat.id}
                                type="button"
                                data-testid={`settings-font-cat-${cat.id}`}
                                aria-pressed={active}
                                onClick={() => setFontCategory(cat.id)}
                                className={`folio-press rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                                  active
                                    ? 'folio-glass-active'
                                    : 'border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                                }`}
                              >
                                {cat.label}
                              </button>
                            );
                          })}
                        </div>

                        <div className="custom-scrollbar grid max-h-56 grid-cols-1 gap-2 overflow-y-auto pr-0.5 sm:grid-cols-2">
                          {fontCategory !== 'system' &&
                            fontCategory !== 'imported' &&
                            matchingPresets.map((preset) => {
                              const selected = interfaceFontId === preset.id;
                              return (
                                <button
                                  key={preset.id}
                                  type="button"
                                  data-testid={`settings-font-preset-${preset.id}`}
                                  aria-pressed={selected}
                                  onClick={() => {
                                    setFontError(null);
                                    setFontStatusMessage(null);
                                    setInterfaceFont(preset.id);
                                    void applyInterfaceFontToRuntime(preset.id);
                                  }}
                                  className={`folio-press flex flex-col items-start rounded-xl border px-3 py-2 text-left ${
                                    selected
                                      ? 'border-[var(--crimson-500)] bg-[var(--surface-elevated)] text-[var(--navy-900)] ring-2 ring-[var(--crimson-glow)]'
                                      : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)] hover:border-[var(--border-strong)]'
                                  }`}
                                >
                                  <span
                                    style={{ fontFamily: preset.previewStack }}
                                    className="text-xs font-bold leading-snug text-[var(--navy-900)]"
                                  >
                                    {preset.name}
                                  </span>
                                  <span className="mt-0.5 text-[10px] text-[var(--navy-600)]">
                                    {preset.subtitle}
                                  </span>
                                </button>
                              );
                            })}

                          {matchingUploaded.map((uf) => {
                            const ufId = `uploaded:${uf.id}`;
                            const selected = interfaceFontId === ufId;
                            return (
                              <div
                                key={uf.id}
                                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${
                                  selected
                                    ? 'border-[var(--crimson-500)] bg-[var(--surface-elevated)] ring-2 ring-[var(--crimson-glow)]'
                                    : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)]'
                                }`}
                              >
                                <button
                                  type="button"
                                  data-testid={`settings-font-uploaded-${uf.id}`}
                                  aria-pressed={selected}
                                  onClick={() => {
                                    setFontError(null);
                                    setFontStatusMessage(null);
                                    setInterfaceFont(ufId, uf.name);
                                    void applyInterfaceFontToRuntime(ufId, uf.name);
                                  }}
                                  className="min-w-0 flex-1 text-left"
                                >
                                  <div className="truncate text-xs font-bold text-[var(--navy-900)]">
                                    {uf.name}
                                  </div>
                                  <div className="truncate text-[10px] text-[var(--navy-600)]">
                                    Imported file · {uf.fileName}
                                  </div>
                                </button>
                                <button
                                  type="button"
                                  data-testid={`settings-font-uploaded-delete-${uf.id}`}
                                  aria-label={`Remove ${uf.name}`}
                                  onClick={() => {
                                    setFontError(null);
                                    setFontStatusMessage(null);
                                    const wasActive = interfaceFontId === ufId;
                                    void deleteCustomInterfaceFont(uf.id).then(() => {
                                      if (wasActive) {
                                        void applyInterfaceFontToRuntime(
                                          DEFAULT_INTERFACE_FONT_ID,
                                          '',
                                        );
                                      }
                                    });
                                  }}
                                  className="folio-press rounded-lg p-1 text-[var(--navy-600)] hover:bg-[var(--state-danger-bg)] hover:text-[var(--state-danger-text)]"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            );
                          })}

                          {matchingSystem.map((sysName) => {
                            const selected =
                              interfaceFontId === 'custom' &&
                              interfaceCustomFont.toLowerCase() === sysName.toLowerCase();
                            return (
                              <button
                                key={sysName}
                                type="button"
                                data-testid="settings-system-font-btn"
                                aria-pressed={selected}
                                onClick={() => applyNamedCustomFont(sysName, true)}
                                className={`folio-press flex flex-col items-start rounded-xl border px-3 py-2 text-left ${
                                  selected
                                    ? 'border-[var(--crimson-500)] bg-[var(--surface-elevated)] text-[var(--navy-900)] ring-2 ring-[var(--crimson-glow)]'
                                    : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)] hover:border-[var(--border-strong)]'
                                }`}
                              >
                                <span
                                  style={{ fontFamily: `"${sysName}", system-ui, sans-serif` }}
                                  className="truncate text-xs font-bold leading-snug text-[var(--navy-900)]"
                                >
                                  {sysName}
                                </span>
                                <span className="mt-0.5 text-[10px] text-[var(--navy-600)]">
                                  Installed system font
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        <div
                          data-testid="settings-font-live-preview"
                          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2"
                        >
                          <div className="folio-display-heading text-sm font-bold text-[var(--navy-900)]">
                            Your Notes, Ready.
                          </div>
                          <p className="mt-0.5 text-[11px] text-[var(--navy-600)]">
                            Clean workspace menus, buttons, and 123 labels.
                          </p>
                        </div>

                        {fontStatusMessage && (
                          <div
                            data-testid="settings-font-status"
                            className="text-[11px] font-semibold text-[var(--state-success-text)]"
                          >
                            {fontStatusMessage}
                          </div>
                        )}
                        {fontError && (
                          <div
                            data-testid="settings-font-error"
                            className="text-[11px] font-semibold text-[var(--state-danger-text)]"
                          >
                            {fontError}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* UI Scale (75% - 150%) */}
                  {(() => {
                    const displayUiScalePct = uiScaleDraftPct ?? Math.round(uiScale * 100);
                    return (
                      <div className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <ZoomIn className="h-4 w-4 text-[var(--navy-900)]" />
                            <div className="text-xs font-bold text-[var(--navy-900)]">
                              Whole App UI Scale
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              data-testid="settings-ui-scale-value"
                              className="folio-mono rounded-full bg-[var(--surface-elevated)] px-2.5 py-0.5 text-xs font-bold text-[var(--navy-900)] ring-1 ring-[var(--border-subtle)] tabular-nums"
                            >
                              {displayUiScalePct}%
                            </span>
                            <button
                              type="button"
                              data-testid="settings-ui-scale-reset"
                              onClick={() => {
                                setUiScaleDraftPct(null);
                                setUiScale(DEFAULT_UI_SCALE);
                              }}
                              className="folio-btn-secondary rounded-lg px-2 py-0.5 text-[11px] font-semibold"
                            >
                              Reset
                            </button>
                          </div>
                        </div>
                        <DraggableRangeSlider
                          testId="settings-ui-scale-slider"
                          ariaLabel="Whole App UI Scale"
                          min={75}
                          max={150}
                          step={5}
                          value={displayUiScalePct}
                          onChange={(pct) => setUiScaleDraftPct(pct)}
                          onCommit={(pct) => {
                            setUiScaleDraftPct(null);
                            setUiScale(pct / 100);
                          }}
                          className="w-full"
                        />
                      </div>
                    );
                  })()}

                  {/* Optional Tactile UI Sounds Toggle (Off by Default) */}
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-4 py-3">
                    <div className="flex items-start gap-2.5">
                      <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--navy-900)]" />
                      <div>
                        <div className="text-xs font-bold text-[var(--navy-900)]">
                          Subtle UI Sounds
                        </div>
                        <p className="mt-0.5 text-[11px] text-[var(--navy-600)]">
                          Plays gentle tactile Web Audio cues for tool switching, adding pages, and
                          deletions (off by default).
                        </p>
                      </div>
                    </div>
                    {renderToggleSwitch({
                      testId: 'settings-ui-sounds-toggle',
                      label: 'Toggle Subtle UI Sounds',
                      checked: uiSoundsEnabled,
                      onToggle: () => setUiSoundsEnabled(!uiSoundsEnabled),
                    })}
                  </div>
                </div>
              )}

              {/* Tab 3: AI & Providers */}
              {activeTab === 'ai' &&
                (() => {
                  const activeMeta = AI_PROVIDER_META[activeAiProvider];
                  const currentModel = aiProviderModels[activeAiProvider] ?? activeMeta.defaultModel;
                  const savedKeysCount = AI_PROVIDER_ORDER.filter(
                    (p) => (aiProviderKeys[p] ?? '').trim().length > 0,
                  ).length;

                  return (
                    <form
                      data-testid="settings-gemini-section"
                      onSubmit={handleSave}
                      className="space-y-3.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-bold text-[var(--navy-900)]">
                            AI Providers (100% BYOK)
                          </h3>
                          <p className="mt-0.5 text-xs text-[var(--navy-600)]">
                            Each provider&apos;s key and model stays isolated in local{' '}
                            <code className="rounded bg-[var(--surface-seal)] px-1 py-0.5 text-[var(--navy-900)]">
                              localStorage
                            </code>{' '}
                            ({savedKeysCount} saved).
                          </p>
                        </div>

                        <a
                          href={activeMeta.keyConsoleUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid="settings-get-gemini-key-link"
                          className="folio-press inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--surface-seal)] px-2.5 py-1 text-[11px] font-semibold text-[var(--navy-900)] hover:bg-[var(--surface-tint)]"
                        >
                          <span>{activeMeta.keyConsoleLabel}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>

                      {/* 5-Provider Switcher */}
                      <div
                        data-testid="ai-provider-selector"
                        className="grid grid-cols-2 gap-1.5 sm:grid-cols-5"
                      >
                        {AI_PROVIDER_ORDER.map((providerId) => {
                          const meta = AI_PROVIDER_META[providerId];
                          const isSelected = activeAiProvider === providerId;
                          const hasKey = (aiProviderKeys[providerId] ?? '').trim().length > 0;
                          return (
                            <button
                              key={providerId}
                              type="button"
                              data-testid={`ai-provider-btn-${providerId}`}
                              aria-pressed={isSelected}
                              onClick={() => handleSelectProvider(providerId)}
                              className={`folio-press relative flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-bold ${
                                isSelected
                                  ? 'folio-glass-active'
                                  : 'border-[var(--border-subtle)] bg-[var(--surface-canvas)] text-[var(--navy-600)] hover:bg-[var(--surface-elevated)] hover:text-[var(--navy-900)]'
                              }`}
                            >
                              <span className="truncate">{meta.shortLabel}</span>
                              {hasKey && (
                                <span
                                  title="Key saved"
                                  className={`h-2 w-2 shrink-0 rounded-full ${
                                    isSelected ? 'bg-[var(--crimson-500)]' : 'bg-[var(--state-success)]'
                                  }`}
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* API Key Input + Test Connection */}
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative min-w-[200px] flex-1">
                          <input
                            id="gemini-api-key-input"
                            data-testid="ai-api-key-input"
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => {
                              setApiKey(e.target.value);
                              setStatusMessage(null);
                              setTestResult(null);
                            }}
                            placeholder={activeMeta.keyPlaceholder}
                            autoComplete="off"
                            className="folio-input w-full rounded-xl py-2.5 pl-3.5 pr-10 text-sm"
                          />
                          <button
                            type="button"
                            aria-label={showKey ? 'Hide API key' : 'Show API key'}
                            onClick={() => setShowKey((prev) => !prev)}
                            className="folio-press absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]"
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
                          {testingKey && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--crimson-500)]" />
                          )}
                          <span>{testingKey ? 'Testing…' : 'Test Connection'}</span>
                        </button>
                      </div>

                      {/* Model / Endpoint Card */}
                      <div className="grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-3.5">
                        {activeAiProvider === 'gemini' ? (
                          <>
                            <div>
                              <label
                                htmlFor="gemini-model-select"
                                className="folio-section-label mb-1 block"
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
                                <option value="gemini-3-flash">
                                  gemini-3-flash (Default · Multimodal Reasoning, Free &amp; Paid)
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
                                  className="mb-1 block text-[11px] font-semibold text-[var(--navy-600)]"
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
                          </>
                        ) : (
                          <>
                            {activeAiProvider === 'custom' && (
                              <div>
                                <label
                                  htmlFor="ai-custom-base-url-input"
                                  className="folio-section-label mb-1 block"
                                >
                                  Base URL (OpenAI Compatible)
                                </label>
                                <input
                                  id="ai-custom-base-url-input"
                                  data-testid="ai-custom-base-url-input"
                                  type="text"
                                  value={aiCustomBaseUrl}
                                  onChange={(e) => {
                                    setAiCustomBaseUrl(e.target.value);
                                    setTestResult(null);
                                  }}
                                  placeholder="https://openrouter.ai/api/v1 or http://localhost:11434/v1"
                                  className="folio-input w-full rounded-xl px-3 py-2 font-mono text-xs"
                                />
                              </div>
                            )}

                            <div>
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <label
                                  htmlFor="ai-model-input"
                                  className="folio-section-label"
                                >
                                  {activeMeta.label} Model ID
                                </label>
                                {activeMeta.modelPresets && activeMeta.modelPresets.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {activeMeta.modelPresets.map((preset) => (
                                      <button
                                        key={preset}
                                        type="button"
                                        onClick={() => {
                                          setAiProviderModel(activeAiProvider, preset);
                                          setTestResult(null);
                                        }}
                                        className={`folio-press rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                                          currentModel === preset
                                            ? 'folio-glass-active'
                                            : 'bg-[var(--surface-elevated)] text-[var(--navy-600)] ring-1 ring-[var(--border-subtle)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]'
                                        }`}
                                      >
                                        {preset}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <input
                                id="ai-model-input"
                                data-testid="ai-model-input"
                                type="text"
                                value={currentModel}
                                onChange={(e) => {
                                  setAiProviderModel(activeAiProvider, e.target.value);
                                  setTestResult(null);
                                }}
                                placeholder={activeMeta.defaultModel}
                                className="folio-input w-full rounded-xl px-3 py-2 font-mono text-xs"
                              />
                            </div>
                          </>
                        )}

                        {/* Vault Lock Privacy Guardrail Toggle */}
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3.5 py-2.5">
                          <div className="flex items-start gap-2">
                            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--navy-900)]" />
                            <div>
                              <div className="text-xs font-bold text-[var(--navy-900)]">
                                Block AI on Vault Locked Notebooks
                              </div>
                              <p className="text-[11px] text-[var(--navy-600)]">
                                Keep encrypted notebooks 100% offline by blocking AI calls across ALL
                                providers.
                              </p>
                            </div>
                          </div>
                          {renderToggleSwitch({
                            testId: 'settings-block-vault-ai-toggle',
                            label: 'Block AI on Vault Locked Notebooks',
                            checked: blockAiOnVaultLocked,
                            onToggle: () => setBlockAiOnVaultLocked(!blockAiOnVaultLocked),
                          })}
                        </div>
                      </div>

                      {/* Auto AI Handwriting Correction */}
                      <div className="space-y-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-start gap-2.5">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-seal)] text-[var(--navy-900)]">
                              <Sparkles className="h-4 w-4 text-[var(--crimson-500)]" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-[var(--navy-900)]">
                                Auto AI Handwriting Correction
                              </div>
                              <p className="mt-0.5 text-[11px] text-[var(--navy-600)]">
                                Cleans completed words into neat vector ink strokes live as you
                                write using your active AI provider (keeps them as drawings; Ctrl+Z
                                reverts).
                              </p>
                            </div>
                          </div>
                          {renderToggleSwitch({
                            testId: 'settings-handwriting-toggle',
                            label: 'Toggle Auto AI Handwriting Correction',
                            checked: handwritingCorrectionEnabled,
                            onToggle: () =>
                              setHandwritingCorrectionEnabled(!handwritingCorrectionEnabled),
                          })}
                        </div>
                      </div>

                      {testResult && (
                        <div
                          data-testid="gemini-test-status"
                          className={`flex items-start gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold ${
                            testResult.ok ? 'folio-badge-success' : 'folio-badge-danger'
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
                          className="flex items-center gap-1.5 text-xs font-semibold text-[var(--state-success-text)]"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>{statusMessage}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <button
                          type="button"
                          onClick={handleClear}
                          disabled={!apiKey && !(aiProviderKeys[activeAiProvider] ?? '').trim()}
                          className="folio-press inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-[var(--state-danger-text)] hover:bg-[var(--state-danger-bg)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Clear {activeMeta.shortLabel} Key
                        </button>

                        <button
                          type="submit"
                          data-testid="settings-save-ai-key-btn"
                          className="folio-btn-crimson rounded-xl px-4 py-2 text-xs font-semibold"
                        >
                          Save {activeMeta.shortLabel} Key
                        </button>
                      </div>
                    </form>
                  );
                })()}

              {/* Tab 4: Privacy & Vault */}
              {activeTab === 'vault' && (
                <div data-testid="settings-vault-section" className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-[var(--navy-900)]">
                        Privacy &amp; Vault Lock
                      </h3>
                      <p className="text-xs text-[var(--navy-600)]">
                        Protect private notebooks at rest with AES-GCM-256 and a Recovery Key.
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold tabular-nums ${
                        vaultConfigured
                          ? 'folio-glass-badge'
                          : 'bg-[var(--surface-canvas)] text-[var(--navy-600)] ring-1 ring-[var(--border-subtle)]'
                      }`}
                    >
                      {vaultConfigured
                        ? `Active · ${lockedNotebookCount} locked`
                        : 'Not Configured'}
                    </span>
                  </div>

                  {!vaultConfigured ? (
                    <div className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-4">
                      <p className="text-xs leading-relaxed text-[var(--navy-600)]">
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
                          className={`folio-press rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                            vaultAction === 'change-password'
                              ? 'folio-glass-active'
                              : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
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
                          className={`folio-press inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                            vaultAction === 'regen-recovery'
                              ? 'folio-glass-active'
                              : 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)] hover:bg-[var(--surface-tint)]'
                          }`}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Regenerate Recovery Key
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleLockAllNow()}
                          className="folio-press folio-badge-warning inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold hover:opacity-90"
                        >
                          <Lock className="h-3.5 w-3.5" />
                          Lock All Notebooks Now
                        </button>
                      </div>

                      {vaultAction === 'change-password' && (
                        <form
                          onSubmit={handleChangePasswordSubmit}
                          className="space-y-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-3.5"
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
                                      : 'bg-[var(--border-strong)]'
                                  }`}
                                />
                              ))}
                            </div>
                            <span className="text-[11px] font-semibold text-[var(--navy-600)]">
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
                              className="folio-press rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--navy-600)] hover:bg-[var(--surface-tint)]"
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
                          className="space-y-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-3.5"
                        >
                          <p className="text-[11px] text-[var(--navy-600)]">
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
                            <div className="folio-badge-warning space-y-2 rounded-xl p-3">
                              <div
                                data-testid="regenerated-recovery-key"
                                className="rounded-lg border border-[var(--state-warning-border)] bg-[var(--surface-elevated)] px-2.5 py-2 text-center font-mono text-xs font-bold tracking-wider text-[var(--navy-900)] select-all"
                              >
                                {freshRecoveryKey}
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={handleCopyRecovery}
                                  className="folio-btn-secondary inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold"
                                >
                                  {copiedRecovery ? (
                                    <>
                                      <Check className="h-3 w-3 text-[var(--state-success)]" />
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
                                  className="folio-btn-secondary inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold"
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
                          className="text-xs font-semibold text-[var(--state-danger-text)]"
                        >
                          {vaultError}
                        </p>
                      )}
                      {vaultNotice && (
                        <p
                          data-testid="vault-settings-notice"
                          className="flex items-center gap-1.5 text-xs font-semibold text-[var(--state-success-text)]"
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
                    <h3 className="text-sm font-bold text-[var(--navy-900)]">Backup &amp; Data</h3>
                    <p className="text-xs text-[var(--navy-600)]">
                      Inspect local IndexedDB storage usage and export portable workspace backups.
                    </p>
                  </div>

                  {/* Storage Summary Grid */}
                  <div
                    data-testid="settings-storage-summary"
                    className="space-y-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-3.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[var(--navy-900)]">
                        Local IndexedDB Storage
                      </span>
                      <span className="folio-mono rounded-full bg-[var(--surface-seal)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--navy-900)] tabular-nums">
                        {formatBytesCompact(storageSummary?.estimatedBytes)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2">
                        <div
                          data-testid="storage-stat-notebooks"
                          className="folio-mono text-base font-bold text-[var(--navy-900)] tabular-nums"
                        >
                          {storageSummary ? storageSummary.notebookCount : '—'}
                        </div>
                        <div className="text-[11px] font-semibold text-[var(--navy-600)]">
                          Notebooks
                        </div>
                      </div>
                      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2">
                        <div
                          data-testid="storage-stat-pages"
                          className="folio-mono text-base font-bold text-[var(--navy-900)] tabular-nums"
                        >
                          {storageSummary ? storageSummary.pageCount : '—'}
                        </div>
                        <div className="text-[11px] font-semibold text-[var(--navy-600)]">
                          Pages
                        </div>
                      </div>
                      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2">
                        <div
                          data-testid="storage-stat-templates"
                          className="folio-mono text-base font-bold text-[var(--navy-900)] tabular-nums"
                        >
                          {storageSummary ? storageSummary.templateCount : '—'}
                        </div>
                        <div className="text-[11px] font-semibold text-[var(--navy-600)]">
                          Templates
                        </div>
                      </div>
                      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2">
                        <div
                          data-testid="storage-stat-pdf-assets"
                          className="folio-mono text-base font-bold text-[var(--navy-900)] tabular-nums"
                        >
                          {storageSummary ? storageSummary.pdfAssetCount : '—'}
                        </div>
                        <div className="text-[11px] font-semibold text-[var(--navy-600)]">
                          PDF Assets
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Workspace Backup Archive */}
                  <div className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4">
                    <div>
                      <h4 className="text-xs font-bold text-[var(--navy-900)]">
                        Workspace Backup &amp; Restore
                      </h4>
                      <p className="mt-0.5 text-[11px] text-[var(--navy-600)]">
                        Download a single <code>.folio-workspace.json</code> archive of all
                        folders, unlocked notebooks, PDFs, and custom templates, or restore one
                        cleanly without overwriting existing items.
                      </p>
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
                        <Upload className="h-3.5 w-3.5 text-[var(--crimson-500)]" />
                        <span>Import Workspace Backup</span>
                      </button>
                    </div>

                    {(workspaceMessage || workspaceError) && (
                      <div
                        data-testid="workspace-status-message"
                        className={`rounded-xl px-3 py-2 text-xs font-medium ${
                          workspaceError
                            ? 'folio-badge-danger'
                            : 'border border-[var(--border-subtle)] bg-[var(--surface-tint)] text-[var(--navy-900)]'
                        }`}
                      >
                        {workspaceError ?? workspaceMessage}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 6: App Updates */}
              {activeTab === 'updates' && (
                <div data-testid="settings-updates-section" className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--navy-900)]">App Updates</h3>
                    <p className="text-xs text-[var(--navy-600)]">
                      One click Restart to Update from your local build folder or public GitHub Releases.
                    </p>
                  </div>

                  {hasDesktopUpdater ? (
                    updateStatus ? (
                      <>
                      {/* Current Build & Action Card */}
                      <div className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-[var(--navy-900)] tabular-nums">
                                Folio Notes v{updateStatus.currentVersion}
                              </span>
                              <span
                                data-testid="settings-updater-phase-badge"
                                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                                  updateStatus.phase === 'ready'
                                    ? 'bg-[var(--crimson-soft)] text-[var(--crimson-600)]'
                                    : updateStatus.phase === 'error'
                                      ? 'folio-badge-warning'
                                      : 'bg-[var(--surface-seal)] text-[var(--navy-900)]'
                                }`}
                              >
                                {updateStatus.phase === 'ready'
                                  ? updateStatus.source === 'local'
                                    ? `Ready · Local v${updateStatus.availableVersion ?? updateStatus.currentVersion}`
                                    : `Ready · v${updateStatus.availableVersion ?? updateStatus.currentVersion}`
                                  : updateStatus.phase === 'checking'
                                    ? 'Checking…'
                                    : updateStatus.phase === 'downloading'
                                      ? `Downloading ${updateStatus.downloadProgress ?? 0}%`
                                      : updateStatus.phase === 'error'
                                        ? 'Attention'
                                        : 'Up to Date'}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--navy-600)]">
                              <span>
                                Build ID:{' '}
                                <code
                                  data-testid="settings-updater-build-id"
                                  className="folio-mono rounded bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--navy-900)]"
                                >
                                  {updateStatus.currentBuildId}
                                </code>
                              </span>
                              <span>
                                Last checked:{' '}
                                {updateStatus.lastCheckedAt
                                  ? new Date(updateStatus.lastCheckedAt).toLocaleString()
                                  : 'Not checked yet'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <p
                          data-testid="settings-updater-status-message"
                          className="text-xs font-medium text-[var(--navy-900)]/85"
                        >
                          {updateStatus.message}
                        </p>

                        {(updateActionError || updateStatus.error) && (
                          <div className="folio-badge-danger flex items-start gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{updateActionError ?? updateStatus.error}</span>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            data-testid="settings-check-updates-btn"
                            disabled={updateStatus.phase === 'checking' || updateRestarting}
                            onClick={() => void checkForUpdates()}
                            className="folio-btn-navy inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
                          >
                            {updateStatus.phase === 'checking' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            <span>
                              {updateStatus.phase === 'checking'
                                ? 'Checking…'
                                : 'Check for Updates'}
                            </span>
                          </button>

                          {updateStatus.phase === 'ready' && (
                            <button
                              type="button"
                              data-testid="settings-restart-update-btn"
                              disabled={updateRestarting}
                              onClick={() => void restartAndInstall()}
                              className="folio-btn-crimson inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold disabled:cursor-wait disabled:opacity-75"
                            >
                              {updateRestarting ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5" />
                              )}
                              <span>
                                {updateRestarting ? 'Restarting…' : 'Restart to Update'}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Local Build Folder (Instant PC Updates) */}
                      <div className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h4 className="text-xs font-bold text-[var(--navy-900)]">
                              Local Build Folder (Instant PC Updates)
                            </h4>
                            <p className="mt-0.5 text-[11px] text-[var(--navy-600)]">
                              Automatically detects rebuilt installers in your local{' '}
                              <code>release/</code> folder with zero GitHub upload needed.
                            </p>
                          </div>
                          {renderToggleSwitch({
                            testId: 'settings-local-watch-toggle',
                            label: 'Toggle Local Build Folder Watch',
                            checked: updateStatus.localWatchEnabled,
                            onToggle: () =>
                              void setLocalUpdateConfig({
                                enabled: !updateStatus.localWatchEnabled,
                              }),
                          })}
                        </div>

                        <div
                          data-testid="settings-local-release-dir"
                          className="folio-mono truncate rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-3 py-2 text-[11px] font-medium text-[var(--navy-900)]/80"
                          title={updateStatus.localReleaseDir ?? 'No folder selected'}
                        >
                          {updateStatus.localReleaseDir ?? 'No folder selected'}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            data-testid="settings-pick-local-dir-btn"
                            onClick={() => void pickLocalUpdateDir()}
                            className="folio-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
                          >
                            <FolderOpen className="h-3.5 w-3.5 text-[var(--navy-900)]" />
                            <span>Choose Folder…</span>
                          </button>

                          {updateStatus.localReleaseDir && (
                            <button
                              type="button"
                              data-testid="settings-clear-local-dir-btn"
                              onClick={() =>
                                void setLocalUpdateConfig({ enabled: false, releaseDir: null })
                              }
                              className="folio-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--state-danger-text)] hover:bg-[var(--state-danger-bg)]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Clear</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* GitHub Releases Channel */}
                      <div className="space-y-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-4">
                        <div className="flex items-center gap-2 text-xs font-bold text-[var(--navy-900)]">
                          <Globe className="h-4 w-4 text-[var(--navy-900)]" />
                          <span>GitHub Releases Channel</span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-[var(--navy-600)]">
                          Connected repository:{' '}
                          <code className="folio-mono rounded bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--navy-900)]">
                            ryanhauyinchan14-maker/Folio-Notes
                          </code>
                          . When your repository is Public and a tagged version release (
                          <code>v*</code>) is published, every installed copy of Folio Notes checks
                          and downloads updates automatically in the background.
                        </p>
                      </div>
                    </>
                    ) : (
                      <div className="flex items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-4 text-xs font-semibold text-[var(--navy-600)]">
                        <Loader2 className="h-4 w-4 animate-spin text-[var(--navy-900)]" />
                        <span>Loading desktop updater status…</span>
                      </div>
                    )
                  ) : (
                    <div
                      data-testid="settings-updates-web-fallback"
                      className="space-y-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-4"
                    >
                      <div className="flex items-center gap-2 text-xs font-bold text-[var(--navy-900)]">
                        <RefreshCw className="h-4 w-4 text-[var(--crimson-500)]" />
                        <span>Desktop Auto Updater</span>
                      </div>
                      <p className="text-xs leading-relaxed text-[var(--navy-600)]">
                        You are currently viewing Folio Notes in a web browser. In the Folio Notes
                        Windows desktop app, one click <strong>Restart to Update</strong> runs
                        automatically from both your local build folder and GitHub Releases.
                      </p>
                    </div>
                  )}
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
