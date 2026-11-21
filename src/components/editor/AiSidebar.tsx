import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpenCheck,
  Calculator,
  Check,
  Copy,
  ExternalLink,
  FileText,
  ImagePlus,
  KeyRound,
  Layers,
  Loader2,
  MessageSquareText,
  RotateCw,
  Send,
  Settings,
  ShieldAlert,
  Shuffle,
  Sparkles,
  Type as TypeIcon,
  Wand2,
  X,
} from 'lucide-react';
import {
  askNotesWithGemini,
  classifyGeminiError,
  formatMathSolutionForTextbox,
  generateStudySet,
  generateStudyVisual,
  type MathTutorResult,
  runMathTutor,
  type StudySetResult,
  transcribeHandwriting,
} from '../../ai/geminiClient';
import {
  captureLassoCropSnapshot,
  captureMultiPageSnapshots,
  capturePageSnapshot,
  type SnapshotCropRect,
  type SnapshotImagePart,
} from '../../ai/pageSnapshot';
import { repository } from '../../db/repository';
import { useAppStore } from '../../store/useAppStore';
import type { Page } from '../../types/notes';
import {
  GEMINI_API_STUDIO_URL,
  IMAGE_GEMINI_MODEL,
  resolveActiveGeminiModel,
} from '../../utils/settings';

export type AiSidebarMode = 'chat' | 'math' | 'study' | 'transcribe' | 'visual';
export type AiContextScope = 'page' | 'lasso' | 'multi';

export interface PendingLassoAiAction {
  id: number;
  action: 'ask' | 'math-hint' | 'transcribe';
  pageId: string;
  strokeIds: string[];
}

interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  cropRect?: SnapshotCropRect;
}

interface AiSidebarProps {
  open: boolean;
  activePage: Page | null;
  activePageIndex: number;
  pages: Page[];
  pendingLassoAction: PendingLassoAiAction | null;
  onConsumePendingLassoAction: () => void;
  onInsertTextbox: (text: string, nearRect?: SnapshotCropRect) => void;
  onInsertImageDataUrl: (dataUrl: string) => Promise<void>;
  onOpenSettings: () => void;
  onClose: () => void;
}

const MODE_TABS: Array<{
  id: AiSidebarMode;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'chat', label: 'Ask', icon: <MessageSquareText className="h-3.5 w-3.5" /> },
  { id: 'math', label: 'Tutor', icon: <Calculator className="h-3.5 w-3.5" /> },
  { id: 'study', label: 'Quiz', icon: <BookOpenCheck className="h-3.5 w-3.5" /> },
  { id: 'transcribe', label: 'Text', icon: <TypeIcon className="h-3.5 w-3.5" /> },
  { id: 'visual', label: 'Visual', icon: <Wand2 className="h-3.5 w-3.5" /> },
];

const CHAT_STARTERS = [
  'Summarize this page clearly',
  'Explain the key concepts',
  'List action items & takeaways',
];

export const AiSidebar: React.FC<AiSidebarProps> = ({
  open,
  activePage,
  activePageIndex,
  pages,
  pendingLassoAction,
  onConsumePendingLassoAction,
  onInsertTextbox,
  onInsertImageDataUrl,
  onOpenSettings,
  onClose,
}) => {
  const activeNotebook = useAppStore((s) => s.activeNotebook);
  const unlockedMasterKey = useAppStore((s) => s.unlockedMasterKey);
  const lassoSelection = useAppStore((s) => s.lassoSelection);
  const geminiApiKey = useAppStore((s) => s.geminiApiKey);
  const geminiModelPreset = useAppStore((s) => s.geminiModelPreset);
  const geminiCustomModelId = useAppStore((s) => s.geminiCustomModelId);
  const blockAiOnVaultLocked = useAppStore((s) => s.blockAiOnVaultLocked);

  const activeModel = useMemo(
    () => resolveActiveGeminiModel({ geminiModelPreset, geminiCustomModelId }),
    [geminiModelPreset, geminiCustomModelId],
  );

  const isVaultBlocked = Boolean(activeNotebook?.isLocked && blockAiOnVaultLocked);
  const privacyGuard = useMemo(
    () => ({
      isVaultLocked: Boolean(activeNotebook?.isLocked),
      blockAiOnVaultLocked,
    }),
    [activeNotebook?.isLocked, blockAiOnVaultLocked],
  );

  const hasLiveLasso = Boolean(
    activePage &&
      lassoSelection &&
      lassoSelection.pageId === activePage.id &&
      lassoSelection.strokeIds.length > 0,
  );

  const [mode, setMode] = useState<AiSidebarMode>('chat');
  const [scope, setScope] = useState<AiContextScope>('page');
  const [lassoPreview, setLassoPreview] = useState<SnapshotImagePart | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Ask Notes Chat state
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);

  // Math Tutor state
  const [mathMode, setMathMode] = useState<'teach' | 'solve'>('teach');
  const [mathNote, setMathNote] = useState('');
  const [mathResult, setMathResult] = useState<MathTutorResult | null>(null);
  const [revealedHints, setRevealedHints] = useState(1);
  const [mathCropRect, setMathCropRect] = useState<SnapshotCropRect | undefined>(undefined);

  // Quiz & Flashcards state
  const [studyKind, setStudyKind] = useState<'quiz' | 'flashcards'>('quiz');
  const [studyCount, setStudyCount] = useState<3 | 5 | 8>(5);
  const [studyResult, setStudyResult] = useState<StudySetResult | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [deckOrder, setDeckOrder] = useState<number[]>([]);
  const [deckPos, setDeckPos] = useState(0);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [masteredIds, setMasteredIds] = useState<Set<string>>(() => new Set());
  const [reviewIds, setReviewIds] = useState<Set<string>>(() => new Set());

  // Transcribe state
  const [transcribedText, setTranscribedText] = useState('');
  const [transcribeCropRect, setTranscribeCropRect] = useState<SnapshotCropRect | undefined>(
    undefined,
  );

  // Visual Generator state
  const [visualPrompt, setVisualPrompt] = useState('');
  const [visualUsePageRef, setVisualUsePageRef] = useState(false);
  const [generatedVisual, setGeneratedVisual] = useState<{
    dataUrl: string;
    caption?: string;
  } | null>(null);

  const lastHandledLassoActionIdRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  // Reset ephemeral AI results when switching to a different notebook
  useEffect(() => {
    setMessages([]);
    setMathResult(null);
    setStudyResult(null);
    setTranscribedText('');
    setGeneratedVisual(null);
    setErrorMsg(null);
    setLassoPreview(null);
  }, [activeNotebook?.id]);

  const resolvePdfBytes = useCallback(
    (assetId: string) => repository.getPdfAssetData(assetId, unlockedMasterKey),
    [unlockedMasterKey],
  );

  // Reset lasso preview if active page changes away from the captured lasso page
  useEffect(() => {
    setLassoPreview(null);
    if (scope === 'lasso' && !hasLiveLasso) {
      setScope('page');
    }
  }, [activePage?.id]);

  const markCopied = (id: string, text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedId(id);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopiedId((cur) => (cur === id ? null : cur));
    }, 1800);
  };

  const captureSnapshotsForScope = useCallback(
    async (
      requestedScope: AiContextScope,
      explicitStrokeIds?: string[],
    ): Promise<SnapshotImagePart[]> => {
      if (!activePage) return [];
      const pageNum = activePageIndex + 1;

      if (requestedScope === 'lasso') {
        const strokeIds = explicitStrokeIds ?? lassoSelection?.strokeIds ?? [];
        if (strokeIds.length > 0 && (lassoSelection?.pageId === activePage.id || explicitStrokeIds)) {
          const part = await captureLassoCropSnapshot(activePage, pageNum, strokeIds, {
            scale: 1.5,
            padding: 16,
            resolvePdfBytes,
          });
          setLassoPreview(part);
          return [part];
        }
        if (lassoPreview) {
          return [lassoPreview];
        }
      }

      if (requestedScope === 'multi' && pages.length > 1) {
        return captureMultiPageSnapshots(pages, activePageIndex, {
          maxPages: 5,
          scale: 1.25,
          resolvePdfBytes,
        });
      }

      const full = await capturePageSnapshot(activePage, pageNum, {
        scale: 1.5,
        resolvePdfBytes,
      });
      return [full];
    },
    [activePage, activePageIndex, lassoPreview, lassoSelection, pages, resolvePdfBytes],
  );

  const handleAskSubmit = useCallback(
    async (
      promptOverride?: string,
      scopeOverride?: AiContextScope,
      strokeIdsOverride?: string[],
    ) => {
      const prompt = (promptOverride ?? chatInput).trim();
      if (!prompt || !activePage) return;

      const userMsg: ChatMessageItem = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: prompt,
      };
      if (!promptOverride) setChatInput('');
      setMessages((prev) => [...prev, userMsg]);
      setErrorMsg(null);
      setBusy(true);

      try {
        const usedScope = scopeOverride ?? scope;
        const snapshots = await captureSnapshotsForScope(usedScope, strokeIdsOverride);
        const history = messages.map((m) => ({ role: m.role, text: m.text }));
        const { text } = await askNotesWithGemini({
          apiKey: geminiApiKey,
          model: activeModel,
          prompt,
          history,
          snapshots,
          guard: privacyGuard,
        });
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text,
            cropRect: snapshots[0]?.cropRect,
          },
        ]);
      } catch (err) {
        setErrorMsg(classifyGeminiError(err).message);
      } finally {
        setBusy(false);
      }
    },
    [
      activeModel,
      activePage,
      captureSnapshotsForScope,
      chatInput,
      geminiApiKey,
      messages,
      privacyGuard,
      scope,
    ],
  );

  const handleRunMathTutor = useCallback(
    async (
      overrideMode?: 'teach' | 'solve',
      scopeOverride?: AiContextScope,
      strokeIdsOverride?: string[],
    ) => {
      if (!activePage) return;
      const targetMode = overrideMode ?? mathMode;
      if (overrideMode) setMathMode(overrideMode);
      setErrorMsg(null);
      setBusy(true);

      try {
        const snapshots = await captureSnapshotsForScope(
          scopeOverride ?? scope,
          strokeIdsOverride,
        );
        const result = await runMathTutor({
          apiKey: geminiApiKey,
          model: activeModel,
          mode: targetMode,
          userNote: mathNote,
          snapshots,
          guard: privacyGuard,
        });
        setMathResult(result);
        setRevealedHints(1);
        setMathCropRect(snapshots[0]?.cropRect);
      } catch (err) {
        setErrorMsg(classifyGeminiError(err).message);
      } finally {
        setBusy(false);
      }
    },
    [
      activeModel,
      activePage,
      captureSnapshotsForScope,
      geminiApiKey,
      mathMode,
      mathNote,
      privacyGuard,
      scope,
    ],
  );

  const handleGenerateStudy = useCallback(async () => {
    if (!activePage) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const snapshots = await captureSnapshotsForScope(scope);
      const res = await generateStudySet({
        apiKey: geminiApiKey,
        model: activeModel,
        kind: studyKind,
        count: studyCount,
        snapshots,
        guard: privacyGuard,
      });
      setStudyResult(res);
      if (res.kind === 'quiz') {
        setQuizAnswers({});
      } else {
        setDeckOrder(res.cards.map((_, i) => i));
        setDeckPos(0);
        setCardFlipped(false);
        setMasteredIds(new Set());
        setReviewIds(new Set());
      }
    } catch (err) {
      setErrorMsg(classifyGeminiError(err).message);
    } finally {
      setBusy(false);
    }
  }, [
    activeModel,
    activePage,
    captureSnapshotsForScope,
    geminiApiKey,
    privacyGuard,
    scope,
    studyCount,
    studyKind,
  ]);

  const handleTranscribe = useCallback(
    async (scopeOverride?: AiContextScope, strokeIdsOverride?: string[]) => {
      if (!activePage) return;
      setErrorMsg(null);
      setBusy(true);
      try {
        const snapshots = await captureSnapshotsForScope(
          scopeOverride ?? scope,
          strokeIdsOverride,
        );
        const { text } = await transcribeHandwriting({
          apiKey: geminiApiKey,
          model: activeModel,
          snapshots,
          guard: privacyGuard,
        });
        setTranscribedText(text);
        setTranscribeCropRect(snapshots[0]?.cropRect);
      } catch (err) {
        setErrorMsg(classifyGeminiError(err).message);
      } finally {
        setBusy(false);
      }
    },
    [activeModel, activePage, captureSnapshotsForScope, geminiApiKey, privacyGuard, scope],
  );

  const handleGenerateVisual = useCallback(async () => {
    const prompt = visualPrompt.trim();
    if (!prompt || !activePage) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const snapshots = visualUsePageRef
        ? await captureSnapshotsForScope(scope)
        : undefined;
      const res = await generateStudyVisual({
        apiKey: geminiApiKey,
        prompt,
        snapshots,
        guard: privacyGuard,
      });
      setGeneratedVisual(res);
    } catch (err) {
      setErrorMsg(classifyGeminiError(err).message);
    } finally {
      setBusy(false);
    }
  }, [
    activePage,
    captureSnapshotsForScope,
    geminiApiKey,
    privacyGuard,
    scope,
    visualPrompt,
    visualUsePageRef,
  ]);

  // Execute pending Lasso -> AI quick trigger immediately when triggered
  useEffect(() => {
    if (!open || !pendingLassoAction) return;
    if (lastHandledLassoActionIdRef.current === pendingLassoAction.id) return;
    lastHandledLassoActionIdRef.current = pendingLassoAction.id;

    const { action, pageId, strokeIds } = pendingLassoAction;
    onConsumePendingLassoAction();

    if (action === 'ask') setMode('chat');
    else if (action === 'math-hint') {
      setMode('math');
      setMathMode('teach');
    } else if (action === 'transcribe') {
      setMode('transcribe');
    }

    setScope('lasso');

    if (isVaultBlocked || !geminiApiKey.trim()) {
      return;
    }
    if (!activePage || activePage.id !== pageId) return;

    if (action === 'ask') {
      void handleAskSubmit('Explain what I circled in these notes.', 'lasso', strokeIds);
    } else if (action === 'math-hint') {
      void handleRunMathTutor('teach', 'lasso', strokeIds);
    } else if (action === 'transcribe') {
      void handleTranscribe('lasso', strokeIds);
    }
  }, [
    activePage,
    geminiApiKey,
    handleAskSubmit,
    handleRunMathTutor,
    handleTranscribe,
    isVaultBlocked,
    onConsumePendingLassoAction,
    open,
    pendingLassoAction,
  ]);

  if (!open) return null;

  const canUseLasso = hasLiveLasso || Boolean(lassoPreview);
  const canUseMulti = pages.length > 1;

  // Derived Flashcards view values
  const flashcards = studyResult?.kind === 'flashcards' ? studyResult.cards : [];
  const currentCardIdx = deckOrder[deckPos] ?? 0;
  const activeCard = flashcards[currentCardIdx] ?? null;

  // Derived Quiz view values
  const quizQuestions = studyResult?.kind === 'quiz' ? studyResult.questions : [];
  const answeredCount = Object.keys(quizAnswers).length;
  const correctCount = quizQuestions.filter(
    (q) => quizAnswers[q.id] !== undefined && quizAnswers[q.id] === q.correctIndex,
  ).length;

  return (
    <aside
      data-testid="ai-sidebar"
      aria-label="Gemini AI Study Suite"
      className="z-20 flex h-full w-80 shrink-0 flex-col border-l border-[#072D59]/12 bg-white text-[#072D59] shadow-xl sm:w-[340px]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#072D59]/10 bg-[linear-gradient(135deg,#DBF2FC_0%,#F6FAFE_65%,#FCE7EE_100%)] px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#072D59] text-[#DBF2FC] shadow-xs">
            <Sparkles className="h-4 w-4 text-[#FD6E88]" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-[#072D59]">Gemini Study Suite</h2>
            <div className="truncate font-mono text-[10px] font-semibold text-[#072D59]/65">
              {mode === 'visual' ? IMAGE_GEMINI_MODEL : activeModel}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Gemini API Settings"
            aria-label="Open Gemini Settings"
            onClick={onOpenSettings}
            className="rounded-lg p-1.5 text-[#072D59]/65 transition duration-150 hover:bg-white/80 hover:text-[#072D59]"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Close Gemini AI Sidebar"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#072D59]/65 transition duration-150 hover:bg-white/80 hover:text-[#072D59]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Guardrails & Onboarding Gates */}
      {isVaultBlocked ? (
        <div className="flex-1 overflow-y-auto p-4">
          <div
            data-testid="ai-vault-blocked-notice"
            className="space-y-3 rounded-2xl border border-amber-300/80 bg-amber-50 p-4 text-xs text-amber-950"
          >
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 shrink-0 text-amber-700" />
              <h3 className="text-sm font-bold">Vault Privacy Protection Active</h3>
            </div>
            <p className="leading-relaxed text-amber-900/90">
              This notebook is <strong>Vault-locked</strong>, and &ldquo;Block AI on Vault-Locked
              Notebooks&rdquo; is enabled. Outbound Gemini API calls and canvas snapshots are blocked
              to keep encrypted notes 100% local.
            </p>
            <button
              type="button"
              data-testid="ai-vault-open-settings-btn"
              onClick={onOpenSettings}
              className="folio-btn-navy inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
            >
              <Settings className="h-3.5 w-3.5" />
              Open Privacy Settings
            </button>
          </div>
        </div>
      ) : !geminiApiKey.trim() ? (
        <div className="flex-1 overflow-y-auto p-4">
          <div
            data-testid="ai-onboarding-card"
            className="space-y-3.5 rounded-2xl border border-[#072D59]/12 bg-[#DBF2FC]/35 p-4 text-xs"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#072D59] text-white shadow-xs">
              <KeyRound className="h-5 w-5 text-[#FD6E88]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#072D59]">
                Connect Your Gemini API Key (BYOK)
              </h3>
              <p className="mt-1 leading-relaxed text-[#072D59]/75">
                Folio Notes connects directly from your device using Google&apos;s{' '}
                <code>@google/genai</code> SDK. Your key stays in your local{' '}
                <code>localStorage</code> with no intermediary servers.
              </p>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                data-testid="ai-open-settings-btn"
                onClick={onOpenSettings}
                className="folio-btn-crimson flex w-full items-center justify-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold shadow-xs"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>Open Settings → Gemini API Key</span>
              </button>
              <a
                href={GEMINI_API_STUDIO_URL}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="ai-get-key-link"
                className="folio-btn-secondary flex w-full items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold"
              >
                <span>Open Google AI Studio</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Context Scope Bar */}
          <div className="border-b border-[#072D59]/10 bg-[#F4F8FB] px-3 py-2">
            <div
              data-testid="ai-context-scope"
              className="grid grid-cols-3 gap-1 rounded-xl border border-[#072D59]/10 bg-white p-0.5"
            >
              <button
                type="button"
                data-testid="ai-scope-page"
                aria-pressed={scope === 'page'}
                onClick={() => setScope('page')}
                className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition duration-150 ${
                  scope === 'page'
                    ? 'bg-[#072D59] text-white'
                    : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/55'
                }`}
              >
                <FileText className="h-3 w-3" />
                <span>Page {activePageIndex + 1}</span>
              </button>
              <button
                type="button"
                data-testid="ai-scope-lasso"
                disabled={!canUseLasso}
                aria-pressed={scope === 'lasso'}
                onClick={() => setScope('lasso')}
                className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
                  scope === 'lasso'
                    ? 'bg-[#FD6E88] text-white'
                    : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/55'
                }`}
              >
                <Sparkles className="h-3 w-3" />
                <span>Lasso</span>
              </button>
              <button
                type="button"
                data-testid="ai-scope-multi"
                disabled={!canUseMulti}
                aria-pressed={scope === 'multi'}
                onClick={() => setScope('multi')}
                className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
                  scope === 'multi'
                    ? 'bg-[#072D59] text-white'
                    : 'text-[#072D59]/75 hover:bg-[#DBF2FC]/55'
                }`}
              >
                <Layers className="h-3 w-3" />
                <span>Multi (≤5)</span>
              </button>
            </div>

            {scope === 'lasso' && lassoPreview && (
              <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-[#FD6E88]/30 bg-white px-2 py-1 text-[10px] font-semibold text-[#072D59]/75">
                <img
                  src={lassoPreview.dataUrl}
                  alt="Lasso crop preview"
                  className="h-7 w-10 rounded border border-[#072D59]/12 object-contain"
                />
                <span className="truncate">{lassoPreview.label}</span>
              </div>
            )}
          </div>

          {/* 5 Mode Tabs */}
          <div
            data-testid="ai-mode-tabs"
            className="grid grid-cols-5 gap-1 border-b border-[#072D59]/10 bg-white px-2.5 py-2"
          >
            {MODE_TABS.map((tab) => {
              const active = mode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`ai-mode-${tab.id}`}
                  aria-pressed={active}
                  onClick={() => {
                    setMode(tab.id);
                    setErrorMsg(null);
                  }}
                  className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] font-bold transition duration-150 ${
                    active
                      ? 'bg-[#072D59] text-white shadow-2xs'
                      : 'text-[#072D59]/70 hover:bg-[#DBF2FC]/55 hover:text-[#072D59]'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Error Banner */}
          {errorMsg && (
            <div
              data-testid="ai-error-banner"
              className="mx-3 mt-2.5 flex items-start justify-between gap-2 rounded-xl border border-[#FD6E88]/40 bg-[#FD6E88]/10 px-3 py-2 text-xs font-medium text-[#F95573]"
            >
              <span>{errorMsg}</span>
              <button
                type="button"
                aria-label="Dismiss AI error"
                onClick={() => setErrorMsg(null)}
                className="rounded p-0.5 hover:bg-white/60"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Mode Body */}
          <div className="custom-scrollbar flex-1 overflow-y-auto p-3.5">
            {/* Mode 1: Ask Notes (Multimodal Chat) */}
            {mode === 'chat' && (
              <div className="flex h-full flex-col justify-between gap-3">
                <div className="space-y-3">
                  {messages.length === 0 && (
                    <div className="space-y-2 rounded-2xl border border-[#072D59]/10 bg-[#DBF2FC]/25 p-3">
                      <p className="text-xs font-semibold text-[#072D59]">
                        Ask anything about your page, PDF slide, or lasso selection:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {CHAT_STARTERS.map((starter) => (
                          <button
                            key={starter}
                            type="button"
                            disabled={busy}
                            onClick={() => void handleAskSubmit(starter)}
                            className="rounded-full border border-[#072D59]/14 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#072D59] transition duration-150 hover:border-[#FD6E88] hover:text-[#F95573]"
                          >
                            {starter}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      data-testid={
                        msg.role === 'assistant' ? 'ai-chat-assistant-msg' : 'ai-chat-user-msg'
                      }
                      className={`rounded-2xl p-3 text-xs leading-relaxed ${
                        msg.role === 'user'
                          ? 'ml-6 bg-[#072D59] text-white'
                          : 'mr-2 border border-[#072D59]/10 bg-[#F4F8FB] text-[#072D59]'
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{msg.text}</div>
                      {msg.role === 'assistant' && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-[#072D59]/10 pt-2">
                          <button
                            type="button"
                            data-testid="ai-copy-response-btn"
                            onClick={() => markCopied(msg.id, msg.text)}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#072D59]/12 bg-white px-2 py-1 text-[10px] font-semibold text-[#072D59] hover:bg-[#DBF2FC]/60"
                          >
                            {copiedId === msg.id ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-600" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                Copy
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            data-testid="ai-insert-textbox-btn"
                            onClick={() => onInsertTextbox(msg.text, msg.cropRect)}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#FD6E88] px-2.5 py-1 text-[10px] font-semibold text-white shadow-2xs hover:bg-[#F95573]"
                          >
                            <TypeIcon className="h-3 w-3" />
                            Insert as Textbox
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {busy && (
                    <div className="flex items-center gap-2 rounded-xl border border-[#072D59]/10 bg-[#DBF2FC]/35 px-3 py-2 text-xs font-semibold text-[#072D59]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FD6E88]" />
                      <span>Thinking with {activeModel}…</span>
                    </div>
                  )}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleAskSubmit();
                  }}
                  className="sticky bottom-0 space-y-2 border-t border-[#072D59]/10 bg-white pt-2.5"
                >
                  <div className="flex items-end gap-1.5 rounded-2xl border border-[#072D59]/15 bg-[#F4F8FB] p-2 focus-within:border-[#FD6E88] focus-within:bg-white">
                    <textarea
                      data-testid="ai-chat-input"
                      rows={2}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleAskSubmit();
                        }
                      }}
                      placeholder="Ask a question about these notes…"
                      className="max-h-28 flex-1 resize-none bg-transparent px-1.5 py-1 text-xs text-[#072D59] placeholder:text-[#072D59]/45 outline-none"
                    />
                    <button
                      type="submit"
                      data-testid="ai-chat-send-btn"
                      disabled={busy || !chatInput.trim()}
                      aria-label="Send message to Gemini"
                      className="folio-btn-crimson flex h-8 w-8 shrink-0 items-center justify-center rounded-xl disabled:opacity-40"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Mode 2: Math & Problem Tutor */}
            {mode === 'math' && (
              <div className="space-y-3.5">
                <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-[#072D59]/12 bg-[#F4F8FB] p-1">
                  <button
                    type="button"
                    data-testid="math-mode-teach"
                    aria-pressed={mathMode === 'teach'}
                    onClick={() => setMathMode('teach')}
                    className={`rounded-lg py-1.5 text-xs font-bold transition duration-150 ${
                      mathMode === 'teach'
                        ? 'bg-[#072D59] text-white shadow-2xs'
                        : 'text-[#072D59]/75 hover:bg-white'
                    }`}
                  >
                    Teach Me (Hints)
                  </button>
                  <button
                    type="button"
                    data-testid="math-mode-solve"
                    aria-pressed={mathMode === 'solve'}
                    onClick={() => setMathMode('solve')}
                    className={`rounded-lg py-1.5 text-xs font-bold transition duration-150 ${
                      mathMode === 'solve'
                        ? 'bg-[#072D59] text-white shadow-2xs'
                        : 'text-[#072D59]/75 hover:bg-white'
                    }`}
                  >
                    Solve Full Steps
                  </button>
                </div>

                <input
                  type="text"
                  data-testid="math-focus-input"
                  value={mathNote}
                  onChange={(e) => setMathNote(e.target.value)}
                  placeholder="Optional: specify problem # or where you got stuck…"
                  className="folio-input w-full rounded-xl px-3 py-2 text-xs"
                />

                <button
                  type="button"
                  data-testid="math-run-btn"
                  disabled={busy}
                  onClick={() => void handleRunMathTutor()}
                  className="folio-btn-crimson flex w-full items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold shadow-xs disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Calculator className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {busy
                      ? 'Analyzing problem…'
                      : mathMode === 'teach'
                        ? 'Get Step-by-Step Hints'
                        : 'Solve Problem Completely'}
                  </span>
                </button>

                {mathResult && (
                  <div className="space-y-2.5 rounded-2xl border border-[#072D59]/12 bg-[#F4F8FB] p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#072D59]">{mathResult.topic}</span>
                      <span className="rounded-full bg-[#DBF2FC] px-2 py-0.5 text-[10px] font-bold text-[#072D59]">
                        {mathResult.mode === 'teach' ? 'Teach Me' : 'Solved'}
                      </span>
                    </div>

                    {mathResult.steps
                      .slice(
                        0,
                        mathResult.mode === 'teach'
                          ? Math.min(revealedHints, mathResult.steps.length)
                          : mathResult.steps.length,
                      )
                      .map((step, idx) => (
                        <div
                          key={`${idx}-${step.title}`}
                          data-testid="math-step-card"
                          className="rounded-xl border border-[#072D59]/10 bg-white p-2.5 text-xs"
                        >
                          <div className="font-bold text-[#072D59]">
                            {idx + 1}. {step.title}
                          </div>
                          <p className="mt-1 leading-relaxed text-[#072D59]/85">{step.hint}</p>
                          {step.explanation && (
                            <p className="mt-1 border-t border-[#072D59]/10 pt-1 text-[11px] text-[#072D59]/65">
                              {step.explanation}
                            </p>
                          )}
                        </div>
                      ))}

                    {mathResult.mode === 'teach' && revealedHints < mathResult.steps.length && (
                      <button
                        type="button"
                        data-testid="math-next-hint-btn"
                        onClick={() => setRevealedHints((n) => n + 1)}
                        className="folio-btn-navy flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
                      >
                        Next Hint ({revealedHints} / {mathResult.steps.length})
                      </button>
                    )}

                    {mathResult.mode === 'teach' && revealedHints >= mathResult.steps.length && (
                      <button
                        type="button"
                        data-testid="math-switch-to-solve-btn"
                        disabled={busy}
                        onClick={() => void handleRunMathTutor('solve')}
                        className="folio-btn-secondary flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
                      >
                        Still stuck? Reveal Full Solution
                      </button>
                    )}

                    {mathResult.mode === 'solve' && mathResult.finalAnswer && (
                      <div
                        data-testid="math-final-answer"
                        className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-950"
                      >
                        <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                          Final Answer
                        </div>
                        <div className="mt-0.5 font-bold">{mathResult.finalAnswer}</div>
                      </div>
                    )}

                    {mathResult.mode === 'solve' && (
                      <button
                        type="button"
                        data-testid="math-insert-solution-btn"
                        onClick={() =>
                          onInsertTextbox(
                            formatMathSolutionForTextbox(mathResult),
                            mathCropRect,
                          )
                        }
                        className="folio-btn-crimson flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
                      >
                        <TypeIcon className="h-3.5 w-3.5" />
                        Insert Solution
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Mode 3: Quiz & Flashcards */}
            {mode === 'study' && (
              <div className="space-y-3.5">
                <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-[#072D59]/12 bg-[#F4F8FB] p-1">
                  <button
                    type="button"
                    data-testid="study-kind-quiz"
                    aria-pressed={studyKind === 'quiz'}
                    onClick={() => setStudyKind('quiz')}
                    className={`rounded-lg py-1.5 text-xs font-bold transition duration-150 ${
                      studyKind === 'quiz'
                        ? 'bg-[#072D59] text-white'
                        : 'text-[#072D59]/75 hover:bg-white'
                    }`}
                  >
                    Quiz (MCQ)
                  </button>
                  <button
                    type="button"
                    data-testid="study-kind-flashcards"
                    aria-pressed={studyKind === 'flashcards'}
                    onClick={() => setStudyKind('flashcards')}
                    className={`rounded-lg py-1.5 text-xs font-bold transition duration-150 ${
                      studyKind === 'flashcards'
                        ? 'bg-[#072D59] text-white'
                        : 'text-[#072D59]/75 hover:bg-white'
                    }`}
                  >
                    Flashcards
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#072D59]/75">Items</span>
                  <div className="flex rounded-lg border border-[#072D59]/12 bg-white p-0.5">
                    {([3, 5, 8] as const).map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setStudyCount(cnt)}
                        className={`rounded-md px-2.5 py-1 text-xs font-bold transition duration-150 ${
                          studyCount === cnt
                            ? 'bg-[#072D59] text-white'
                            : 'text-[#072D59]/70 hover:bg-[#DBF2FC]/50'
                        }`}
                      >
                        {cnt}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="study-generate-btn"
                  disabled={busy}
                  onClick={() => void handleGenerateStudy()}
                  className="folio-btn-crimson flex w-full items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold shadow-xs disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <BookOpenCheck className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {busy
                      ? 'Generating from notes…'
                      : studyKind === 'quiz'
                        ? 'Generate Practice Quiz'
                        : 'Generate Flashcards'}
                  </span>
                </button>

                {studyResult?.kind === 'quiz' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between rounded-xl border border-[#072D59]/10 bg-[#DBF2FC]/45 px-3 py-2 text-xs">
                      <span className="font-bold text-[#072D59]">{studyResult.title}</span>
                      <span
                        data-testid="quiz-score-badge"
                        className="rounded-full bg-[#072D59] px-2 py-0.5 text-[10px] font-bold text-white tabular-nums"
                      >
                        {correctCount} / {quizQuestions.length} ({answeredCount} answered)
                      </span>
                    </div>

                    {quizQuestions.map((q, qIdx) => {
                      const picked = quizAnswers[q.id];
                      const isAnswered = picked !== undefined;
                      return (
                        <div
                          key={q.id}
                          data-testid={`quiz-question-${qIdx + 1}`}
                          className="space-y-2 rounded-2xl border border-[#072D59]/12 bg-[#F4F8FB] p-3 text-xs"
                        >
                          <div className="font-bold text-[#072D59]">
                            {qIdx + 1}. {q.question}
                          </div>
                          <div className="space-y-1">
                            {q.options.map((opt, optIdx) => {
                              const isPicked = picked === optIdx;
                              const isCorrect = q.correctIndex === optIdx;
                              let cls =
                                'border-[#072D59]/12 bg-white text-[#072D59] hover:border-[#072D59]/35';
                              if (isAnswered) {
                                if (isCorrect) {
                                  cls =
                                    'border-emerald-400 bg-emerald-50 font-semibold text-emerald-950';
                                } else if (isPicked) {
                                  cls =
                                    'border-[#FD6E88] bg-[#FD6E88]/12 font-semibold text-[#F95573]';
                                } else {
                                  cls = 'border-[#072D59]/10 bg-white/60 text-[#072D59]/55';
                                }
                              }
                              return (
                                <button
                                  key={optIdx}
                                  type="button"
                                  data-testid={`quiz-q${qIdx + 1}-opt-${optIdx}`}
                                  disabled={isAnswered}
                                  onClick={() =>
                                    setQuizAnswers((prev) => ({ ...prev, [q.id]: optIdx }))
                                  }
                                  className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-xs transition duration-150 ${cls}`}
                                >
                                  <span className="font-mono text-[10px] font-bold opacity-70">
                                    {String.fromCharCode(65 + optIdx)}.
                                  </span>
                                  <span>{opt}</span>
                                </button>
                              );
                            })}
                          </div>
                          {isAnswered && q.explanation && (
                            <div className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] text-[#072D59]/80">
                              {q.explanation}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {answeredCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setQuizAnswers({})}
                        className="folio-btn-secondary w-full rounded-xl py-2 text-xs font-semibold"
                      >
                        Retake Quiz
                      </button>
                    )}
                  </div>
                )}

                {studyResult?.kind === 'flashcards' && activeCard && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#072D59]/75 tabular-nums">
                        Card {deckPos + 1} / {flashcards.length}
                      </span>
                      <span
                        data-testid="flashcard-progress-badge"
                        className="rounded-full bg-[#DBF2FC] px-2 py-0.5 text-[10px] font-bold text-[#072D59] tabular-nums"
                      >
                        Got It: {masteredIds.size} · Review: {reviewIds.size}
                      </span>
                    </div>

                    <button
                      type="button"
                      data-testid="flashcard-flip-btn"
                      onClick={() => setCardFlipped((f) => !f)}
                      className="flex min-h-[150px] w-full flex-col items-center justify-center rounded-2xl border border-[#072D59]/14 bg-[linear-gradient(145deg,#DBF2FC_0%,#FFFFFF_65%,#FCE7EE_100%)] p-5 text-center shadow-sm transition duration-150 hover:border-[#FD6E88]"
                    >
                      <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#072D59]/65">
                        <RotateCw className="h-2.5 w-2.5" />
                        {cardFlipped ? 'Back (Click to Flip)' : 'Front (Click to Flip)'}
                      </span>
                      <div className="text-sm font-bold leading-snug text-[#072D59]">
                        {cardFlipped ? activeCard.back : activeCard.front}
                      </div>
                      {activeCard.tag && !cardFlipped && (
                        <span className="mt-2 rounded-full bg-[#072D59]/10 px-2 py-0.5 text-[10px] font-semibold text-[#072D59]/70">
                          {activeCard.tag}
                        </span>
                      )}
                    </button>

                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        data-testid="flashcard-review-again-btn"
                        onClick={() => {
                          setReviewIds((prev) => new Set(prev).add(activeCard.id));
                          setMasteredIds((prev) => {
                            const next = new Set(prev);
                            next.delete(activeCard.id);
                            return next;
                          });
                          setCardFlipped(false);
                          setDeckPos((p) => (p + 1) % flashcards.length);
                        }}
                        className="rounded-xl border border-[#FD6E88]/40 bg-[#FD6E88]/10 py-1.5 text-[11px] font-bold text-[#F95573] hover:bg-[#FD6E88]/20"
                      >
                        Review Again
                      </button>
                      <button
                        type="button"
                        data-testid="flashcard-shuffle-btn"
                        onClick={() => {
                          const next = [...deckOrder];
                          for (let i = next.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [next[i], next[j]] = [next[j], next[i]];
                          }
                          setDeckOrder(next);
                          setDeckPos(0);
                          setCardFlipped(false);
                        }}
                        className="inline-flex items-center justify-center gap-1 rounded-xl border border-[#072D59]/12 bg-white py-1.5 text-[11px] font-semibold text-[#072D59] hover:bg-[#DBF2FC]/55"
                      >
                        <Shuffle className="h-3 w-3" />
                        Shuffle
                      </button>
                      <button
                        type="button"
                        data-testid="flashcard-got-it-btn"
                        onClick={() => {
                          setMasteredIds((prev) => new Set(prev).add(activeCard.id));
                          setReviewIds((prev) => {
                            const next = new Set(prev);
                            next.delete(activeCard.id);
                            return next;
                          });
                          setCardFlipped(false);
                          setDeckPos((p) => (p + 1) % flashcards.length);
                        }}
                        className="rounded-xl bg-[#072D59] py-1.5 text-[11px] font-bold text-white hover:bg-[#0A3D7A]"
                      >
                        Got It ✓
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mode 4: Transcribe Handwriting */}
            {mode === 'transcribe' && (
              <div className="space-y-3">
                <p className="text-xs text-[#072D59]/75">
                  Convert handwritten ink from the{' '}
                  <strong>{scope === 'lasso' ? 'lasso selection' : 'active page'}</strong> into
                  editable typed text.
                </p>

                <button
                  type="button"
                  data-testid="transcribe-run-btn"
                  disabled={busy}
                  onClick={() => void handleTranscribe()}
                  className="folio-btn-crimson flex w-full items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold shadow-xs disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <TypeIcon className="h-3.5 w-3.5" />
                  )}
                  <span>{busy ? 'Transcribing…' : 'Transcribe Handwriting'}</span>
                </button>

                <textarea
                  data-testid="transcribe-result-textarea"
                  rows={8}
                  value={transcribedText}
                  onChange={(e) => setTranscribedText(e.target.value)}
                  placeholder="Transcribed handwriting will appear here…"
                  className="folio-input w-full rounded-xl p-3 text-xs leading-relaxed"
                />

                {transcribedText.trim() && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => markCopied('transcribe', transcribedText)}
                      className="folio-btn-secondary inline-flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-xs font-semibold"
                    >
                      {copiedId === 'transcribe' ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copy
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      data-testid="transcribe-insert-btn"
                      onClick={() => onInsertTextbox(transcribedText, transcribeCropRect)}
                      className="folio-btn-navy inline-flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-xs font-semibold"
                    >
                      <TypeIcon className="h-3.5 w-3.5" />
                      Insert as Textbox
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Mode 5: Create Visual (Diagram / Sticker via gemini-nano-banana-2.1) */}
            {mode === 'visual' && (
              <div className="space-y-3">
                <div className="rounded-xl border border-[#072D59]/10 bg-[#DBF2FC]/35 px-3 py-2 text-[11px] font-medium text-[#072D59]/80">
                  Uses <code className="font-bold">{IMAGE_GEMINI_MODEL}</code> to create diagrams
                  and study visuals directly as editable Canva-style photos on your page.
                </div>

                <textarea
                  data-testid="visual-prompt-input"
                  rows={3}
                  value={visualPrompt}
                  onChange={(e) => setVisualPrompt(e.target.value)}
                  placeholder="e.g. Clean labeled diagram of photosynthesis inside a chloroplast"
                  className="folio-input w-full rounded-xl p-2.5 text-xs"
                />

                <label className="flex items-center gap-2 text-xs font-medium text-[#072D59]/80">
                  <input
                    type="checkbox"
                    checked={visualUsePageRef}
                    onChange={(e) => setVisualUsePageRef(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#FD6E88]"
                  />
                  <span>Use current page context as reference</span>
                </label>

                <button
                  type="button"
                  data-testid="visual-generate-btn"
                  disabled={busy || !visualPrompt.trim()}
                  onClick={() => void handleGenerateVisual()}
                  className="folio-btn-crimson flex w-full items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold shadow-xs disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5" />
                  )}
                  <span>{busy ? 'Generating visual…' : 'Generate Visual'}</span>
                </button>

                {generatedVisual && (
                  <div className="space-y-2.5 rounded-2xl border border-[#072D59]/12 bg-[#F4F8FB] p-3">
                    <img
                      data-testid="visual-preview-img"
                      src={generatedVisual.dataUrl}
                      alt="Generated study visual"
                      className="max-h-56 w-full rounded-xl border border-[#072D59]/10 bg-white object-contain"
                    />
                    {generatedVisual.caption && (
                      <p className="text-[11px] text-[#072D59]/75">{generatedVisual.caption}</p>
                    )}
                    <button
                      type="button"
                      data-testid="visual-insert-btn"
                      onClick={() => void onInsertImageDataUrl(generatedVisual.dataUrl)}
                      className="folio-btn-navy flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold"
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                      Insert onto Page
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
};
