import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpenCheck,
  Calculator,
  Check,
  Copy,
  ExternalLink,
  Eye,
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
  askNotesWithAi,
  classifyAiError,
  formatMathSolutionForTextbox,
  generateStudySetWithAi,
  generateStudyVisualWithAi,
  type MathTutorResult,
  runMathTutorWithAi,
  type StudySetResult,
  transcribeHandwritingWithAi,
} from '../../ai/aiClient';
import {
  captureLassoCropSnapshot,
  captureMultiPageSnapshots,
  capturePageSnapshot,
  captureViewportSnapshot,
  type SnapshotCropRect,
  type SnapshotImagePart,
} from '../../ai/pageSnapshot';
import { repository } from '../../db/repository';
import { useAppStore } from '../../store/useAppStore';
import type { Page } from '../../types/notes';
import { formatAiMarkdownForTextbox } from '../../utils/aiMarkdown';
import {
  AI_PROVIDER_META,
  IMAGE_GEMINI_MODEL,
  resolveActiveAiConfig,
} from '../../utils/settings';
import { AiRichText } from './AiRichText';
import { MorphingPill, useMorphingIndicator } from '../common/MorphingIndicator';

export type AiSidebarMode = 'chat' | 'math' | 'study' | 'transcribe' | 'visual';
export type AiContextScope = 'view' | 'page' | 'lasso' | 'multi';

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
  getVisibleRect?: () => SnapshotCropRect | null;
  pendingLassoAction: PendingLassoAiAction | null;
  onConsumePendingLassoAction: () => void;
  onTidyHandwritingAi?: () => void;
  tidyingHandwriting?: boolean;
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
  'Summarize these notes clearly',
  'Explain the key concepts',
  'List action items & takeaways',
];

export const AiSidebar: React.FC<AiSidebarProps> = ({
  open,
  activePage,
  activePageIndex,
  pages,
  getVisibleRect,
  pendingLassoAction,
  onConsumePendingLassoAction,
  onTidyHandwritingAi,
  tidyingHandwriting = false,
  onInsertTextbox,
  onInsertImageDataUrl,
  onOpenSettings,
  onClose,
}) => {
  const activeNotebook = useAppStore((s) => s.activeNotebook);
  const unlockedMasterKey = useAppStore((s) => s.unlockedMasterKey);
  const lassoSelection = useAppStore((s) => s.lassoSelection);
  const activeAiProvider = useAppStore((s) => s.activeAiProvider);
  const aiProviderKeys = useAppStore((s) => s.aiProviderKeys);
  const aiProviderModels = useAppStore((s) => s.aiProviderModels);
  const aiCustomBaseUrl = useAppStore((s) => s.aiCustomBaseUrl);
  const geminiApiKey = useAppStore((s) => s.geminiApiKey);
  const geminiModelPreset = useAppStore((s) => s.geminiModelPreset);
  const geminiCustomModelId = useAppStore((s) => s.geminiCustomModelId);
  const blockAiOnVaultLocked = useAppStore((s) => s.blockAiOnVaultLocked);
  const handwritingCorrectionEnabled = useAppStore((s) => s.handwritingCorrectionEnabled);
  const setHandwritingCorrectionEnabled = useAppStore(
    (s) => s.setHandwritingCorrectionEnabled,
  );

  const activeAi = useMemo(
    () =>
      resolveActiveAiConfig({
        activeAiProvider,
        aiProviderKeys,
        aiProviderModels,
        aiCustomBaseUrl,
        geminiApiKey,
        geminiModelPreset,
        geminiCustomModelId,
      }),
    [
      activeAiProvider,
      aiProviderKeys,
      aiProviderModels,
      aiCustomBaseUrl,
      geminiApiKey,
      geminiModelPreset,
      geminiCustomModelId,
    ],
  );
  const activeMeta = AI_PROVIDER_META[activeAi.provider];
  const aiClientConfig = useMemo(
    () => ({
      provider: activeAi.provider,
      apiKey: activeAi.apiKey,
      model: activeAi.model,
      baseUrl: activeAi.baseUrl,
    }),
    [activeAi.provider, activeAi.apiKey, activeAi.model, activeAi.baseUrl],
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
  const [scope, setScope] = useState<AiContextScope>('view');
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
  const scopeTrackRef = useRef<HTMLDivElement | null>(null);
  const modeTrackRef = useRef<HTMLDivElement | null>(null);

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
      setScope('view');
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
      const isWhiteboard = activeNotebook?.mode === 'whiteboard';

      if (requestedScope === 'lasso') {
        const strokeIds = explicitStrokeIds ?? lassoSelection?.strokeIds ?? [];
        if (strokeIds.length > 0 && (lassoSelection?.pageId === activePage.id || explicitStrokeIds)) {
          const part = await captureLassoCropSnapshot(activePage, pageNum, strokeIds, {
            scale: 1.5,
            padding: 16,
            isWhiteboard,
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
          isWhiteboard,
          resolvePdfBytes,
        });
      }

      if (requestedScope === 'view') {
        const viewportPart = await captureViewportSnapshot(
          activePage,
          pageNum,
          getVisibleRect?.() ?? null,
          {
            scale: 1.5,
            isWhiteboard,
            resolvePdfBytes,
          },
        );
        return [viewportPart];
      }

      const full = await capturePageSnapshot(activePage, pageNum, {
        scale: 1.5,
        isWhiteboard,
        resolvePdfBytes,
      });
      return [full];
    },
    [
      activeNotebook?.mode,
      activePage,
      activePageIndex,
      getVisibleRect,
      lassoPreview,
      lassoSelection,
      pages,
      resolvePdfBytes,
    ],
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
        const { text } = await askNotesWithAi({
          config: aiClientConfig,
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
        setErrorMsg(classifyAiError(err, activeAi.label).message);
      } finally {
        setBusy(false);
      }
    },
    [
      activeAi.label,
      activePage,
      aiClientConfig,
      captureSnapshotsForScope,
      chatInput,
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
        const result = await runMathTutorWithAi({
          config: aiClientConfig,
          mode: targetMode,
          userNote: mathNote,
          snapshots,
          guard: privacyGuard,
        });
        setMathResult(result);
        setRevealedHints(1);
        setMathCropRect(snapshots[0]?.cropRect);
      } catch (err) {
        setErrorMsg(classifyAiError(err, activeAi.label).message);
      } finally {
        setBusy(false);
      }
    },
    [
      activeAi.label,
      activePage,
      aiClientConfig,
      captureSnapshotsForScope,
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
      const res = await generateStudySetWithAi({
        config: aiClientConfig,
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
      setErrorMsg(classifyAiError(err, activeAi.label).message);
    } finally {
      setBusy(false);
    }
  }, [
    activeAi.label,
    activePage,
    aiClientConfig,
    captureSnapshotsForScope,
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
        const { text } = await transcribeHandwritingWithAi({
          config: aiClientConfig,
          snapshots,
          guard: privacyGuard,
        });
        setTranscribedText(text);
        setTranscribeCropRect(snapshots[0]?.cropRect);
      } catch (err) {
        setErrorMsg(classifyAiError(err, activeAi.label).message);
      } finally {
        setBusy(false);
      }
    },
    [activeAi.label, activePage, aiClientConfig, captureSnapshotsForScope, privacyGuard, scope],
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
      const res = await generateStudyVisualWithAi({
        config: aiClientConfig,
        prompt,
        snapshots,
        guard: privacyGuard,
      });
      setGeneratedVisual(res);
    } catch (err) {
      setErrorMsg(classifyAiError(err, activeAi.label).message);
    } finally {
      setBusy(false);
    }
  }, [
    activeAi.label,
    activePage,
    aiClientConfig,
    captureSnapshotsForScope,
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

    if (isVaultBlocked || !activeAi.configured) {
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
    activeAi.configured,
    activePage,
    handleAskSubmit,
    handleRunMathTutor,
    handleTranscribe,
    isVaultBlocked,
    onConsumePendingLassoAction,
    open,
    pendingLassoAction,
  ]);

  const hasUnlockedSelectedPenStrokes = useMemo(() => {
    if (!activePage || !lassoSelection || lassoSelection.pageId !== activePage.id) {
      return false;
    }
    const idSet = new Set(lassoSelection.strokeIds);
    return activePage.strokes.some((s) => idSet.has(s.id) && s.tool === 'pen' && !s.locked);
  }, [activePage, lassoSelection]);

  const showAiWorkspace = open && !isVaultBlocked && activeAi.configured;
  const scopeIndicator = useMorphingIndicator(
    scopeTrackRef,
    showAiWorkspace ? scope : null,
    [open, showAiWorkspace, activePageIndex, activeNotebook?.mode],
  );
  const modeIndicator = useMorphingIndicator(
    modeTrackRef,
    showAiWorkspace ? mode : null,
    [open, showAiWorkspace],
  );

  if (!open) return null;

  const canUseLasso = hasLiveLasso || Boolean(lassoPreview);
  const canUseMulti = pages.length > 1;

  const handleToggleHandwritingCorrection = () => {
    setHandwritingCorrectionEnabled(!handwritingCorrectionEnabled);
  };

  const renderHandwritingCorrectionCard = () => {
    const statusLabel = isVaultBlocked
      ? 'Vault Locked · Blocked'
      : activeAi.configured
        ? `${activeAi.shortLabel} · Ready`
        : 'No AI Key';

    const statusBadgeClass = isVaultBlocked
      ? 'folio-badge-warning'
      : activeAi.configured
        ? 'folio-badge-success'
        : 'folio-badge-warning';

    return (
      <div
        data-testid="ai-handwriting-correction-card"
        className="space-y-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-canvas)] p-3 text-xs"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-bold text-[#072D59]">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#FD6E88]" />
              <span className="truncate">Auto AI Handwriting Correction</span>
            </div>
            <span
              data-testid="ai-handwriting-status-badge"
              className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadgeClass}`}
            >
              {statusLabel}
            </span>
          </div>

          <button
            type="button"
            role="switch"
            data-testid="ai-sidebar-handwriting-toggle"
            aria-checked={handwritingCorrectionEnabled}
            aria-label="Toggle Auto AI Handwriting Correction"
            onClick={handleToggleHandwritingCorrection}
            className={`inline-flex h-5 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150 ${
              handwritingCorrectionEnabled
                ? 'folio-glass-toggle-on'
                : 'bg-[var(--navy-900)]/14 ring-1 ring-inset ring-[var(--border-subtle)]'
            }`}
          >
            <span
              className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow ring-1 ring-[var(--navy-900)]/12 transition-transform duration-150 ${
                handwritingCorrectionEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <p className="text-[11px] leading-relaxed text-[#072D59]/70">
          Cleans completed words live as you write into neat ink strokes (keeps them as drawings; Ctrl+Z reverts).
        </p>

        <button
          type="button"
          data-testid="ai-sidebar-tidy-handwriting-btn"
          disabled={
            tidyingHandwriting ||
            isVaultBlocked ||
            !hasUnlockedSelectedPenStrokes ||
            !onTidyHandwritingAi
          }
          onClick={onTidyHandwritingAi}
          title={
            isVaultBlocked
              ? 'Blocked while notebook is Vault locked'
              : hasUnlockedSelectedPenStrokes
                ? 'Clean selected handwritten pen strokes into neat ink strokes (Ctrl+Z reverts)'
                : 'Select handwritten pen strokes with Lasso (L) or Select (V) first'
          }
          className="folio-btn-navy flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
        >
          {tidyingHandwriting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FD6E88]" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 text-[#FD6E88]" />
          )}
          <span>
            {tidyingHandwriting ? 'Tidying Selection…' : 'Tidy Selected Handwriting (AI)'}
          </span>
        </button>

        {!hasUnlockedSelectedPenStrokes && !isVaultBlocked && (
          <div className="text-[10px] font-medium text-[#072D59]/55">
            Circle or select unlocked handwritten pen strokes first for on demand tidying.
          </div>
        )}
      </div>
    );
  };

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
      aria-label="AI Study Suite"
      className="z-20 flex h-full w-80 shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)] shadow-[var(--shadow-floating)] sm:w-[340px]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[linear-gradient(135deg,#DBF2FC_0%,#F6FAFE_65%,#FCE7EE_100%)] px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="folio-glass-badge flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
            <Sparkles className="h-4 w-4 text-[var(--crimson-500)]" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-[var(--navy-900)]">AI Study Suite</h2>
            <div
              data-testid="ai-active-provider-pill"
              className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-[var(--surface-elevated)]/90 px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--navy-900)] ring-1 ring-[var(--border-subtle)]"
            >
              <span className="font-sans font-bold text-[var(--navy-900)]">{activeAi.shortLabel}</span>
              <span>·</span>
              <span className="truncate">
                {mode === 'visual' && activeAi.provider === 'gemini'
                  ? IMAGE_GEMINI_MODEL
                  : activeAi.model}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            title="AI Provider Settings"
            aria-label="Open AI Provider Settings"
            onClick={onOpenSettings}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-600)] hover:bg-[var(--surface-elevated)] hover:text-[var(--navy-900)]"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Close AI Study Suite Sidebar"
            onClick={onClose}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-600)] hover:bg-[var(--surface-elevated)] hover:text-[var(--navy-900)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Guardrails & Onboarding Gates */}
      {isVaultBlocked ? (
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div
            data-testid="ai-vault-blocked-notice"
            className="folio-badge-warning space-y-3 rounded-2xl p-4 text-xs"
          >
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 shrink-0 text-[var(--state-warning)]" />
              <h3 className="text-sm font-bold text-[var(--navy-900)]">
                Vault Privacy Protection Active
              </h3>
            </div>
            <p className="leading-relaxed text-[var(--state-warning-text)]">
              This notebook is <strong>Vault locked</strong>, and &ldquo;Block AI on Vault Locked
              Notebooks&rdquo; is enabled. Outbound AI requests and canvas snapshots are blocked
              across all providers to keep encrypted notes 100% local.
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
          {renderHandwritingCorrectionCard()}
        </div>
      ) : !activeAi.configured ? (
        <div className="flex-1 space-y-3.5 overflow-y-auto p-4">
          <div
            data-testid="ai-onboarding-card"
            className="space-y-3.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-tint)]/65 p-4 text-xs"
          >
            <div className="folio-glass-badge flex h-10 w-10 items-center justify-center rounded-xl">
              <KeyRound className="h-5 w-5 text-[var(--crimson-500)]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--navy-900)]">
                Connect an AI Provider (BYOK)
              </h3>
              <p className="mt-1 leading-relaxed text-[var(--navy-600)]">
                Bring your own key for <strong>Google Gemini</strong>, <strong>xAI (Grok)</strong>,{' '}
                <strong>OpenAI</strong>, <strong>Anthropic (Claude)</strong>, or{' '}
                <strong>OpenRouter / Local Models</strong>. Keys stay only in your{' '}
                <code>localStorage</code>.
              </p>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                data-testid="ai-open-settings-btn"
                onClick={onOpenSettings}
                className="folio-btn-crimson flex w-full items-center justify-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>Open Settings → AI &amp; Providers</span>
              </button>
              <a
                href={activeMeta.keyConsoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="ai-get-key-link"
                className="folio-btn-secondary flex w-full items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold"
              >
                <span>Open {activeMeta.keyConsoleLabel}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
          {renderHandwritingCorrectionCard()}
        </div>
      ) : (
        <>
          {/* Context Scope Bar */}
          <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-3 py-2">
            <div
              ref={scopeTrackRef}
              data-testid="ai-context-scope"
              className="folio-segmented-track relative grid grid-cols-4 gap-1 rounded-xl p-0.5"
            >
              <MorphingPill indicator={scopeIndicator} className="rounded-lg" />
              <button
                type="button"
                data-morph-key="view"
                data-testid="ai-scope-view"
                title="See only what's currently visible on screen"
                aria-pressed={scope === 'view'}
                onClick={() => setScope('view')}
                className={`folio-press relative z-10 inline-flex items-center justify-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-semibold ${
                  scope === 'view'
                    ? scopeIndicator.ready
                      ? 'bg-transparent text-white'
                      : 'folio-glass-active'
                    : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                }`}
              >
                <Eye className="h-3 w-3 shrink-0" />
                <span>Screen</span>
              </button>
              <button
                type="button"
                data-morph-key="page"
                data-testid="ai-scope-page"
                title="See the entire page"
                aria-pressed={scope === 'page'}
                onClick={() => setScope('page')}
                className={`folio-press relative z-10 inline-flex items-center justify-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-semibold ${
                  scope === 'page'
                    ? scopeIndicator.ready
                      ? 'bg-transparent text-white'
                      : 'folio-glass-active'
                    : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                }`}
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {activeNotebook?.mode === 'whiteboard' ? 'All' : `Pg ${activePageIndex + 1}`}
                </span>
              </button>
              <button
                type="button"
                data-morph-key="lasso"
                data-testid="ai-scope-lasso"
                disabled={!canUseLasso}
                aria-pressed={scope === 'lasso'}
                onClick={() => setScope('lasso')}
                className={`folio-press relative z-10 inline-flex items-center justify-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                  scope === 'lasso'
                    ? scopeIndicator.ready
                      ? 'bg-transparent text-white'
                      : 'folio-glass-active'
                    : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                }`}
              >
                <Sparkles
                  className={`h-3 w-3 shrink-0 ${
                    scope === 'lasso' ? 'text-[var(--crimson-500)]' : 'text-[var(--crimson-500)]'
                  }`}
                />
                <span>Lasso</span>
              </button>
              <button
                type="button"
                data-morph-key="multi"
                data-testid="ai-scope-multi"
                title="Multi page (up to 5 pages)"
                disabled={!canUseMulti}
                aria-pressed={scope === 'multi'}
                onClick={() => setScope('multi')}
                className={`folio-press relative z-10 inline-flex items-center justify-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                  scope === 'multi'
                    ? scopeIndicator.ready
                      ? 'bg-transparent text-white'
                      : 'folio-glass-active'
                    : 'text-[var(--navy-600)] hover:text-[var(--navy-900)]'
                }`}
              >
                <Layers className="h-3 w-3 shrink-0" />
                <span>Multi</span>
              </button>
            </div>

            {scope === 'lasso' && lassoPreview && (
              <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-[var(--crimson-border)] bg-[var(--surface-elevated)] px-2 py-1 text-[10px] font-semibold text-[var(--navy-600)]">
                <img
                  src={lassoPreview.dataUrl}
                  alt="Lasso crop preview"
                  className="h-7 w-10 rounded border border-[var(--border-subtle)] object-contain"
                />
                <span className="truncate">{lassoPreview.label}</span>
              </div>
            )}
          </div>

          {/* 5 Mode Tabs */}
          <div
            ref={modeTrackRef}
            data-testid="ai-mode-tabs"
            className="relative grid grid-cols-5 gap-1 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 py-2"
          >
            <MorphingPill indicator={modeIndicator} className="rounded-xl" />
            {MODE_TABS.map((tab) => {
              const active = mode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-morph-key={tab.id}
                  data-testid={`ai-mode-${tab.id}`}
                  aria-pressed={active}
                  onClick={() => {
                    setMode(tab.id);
                    setErrorMsg(null);
                  }}
                  className={`folio-press relative z-10 flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] font-bold ${
                    active
                      ? modeIndicator.ready
                        ? 'bg-transparent text-white'
                        : 'folio-glass-active'
                      : 'text-[var(--navy-600)] hover:bg-[var(--surface-tint)] hover:text-[var(--navy-900)]'
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
              className="folio-badge-danger mx-3 mt-2.5 flex items-start justify-between gap-2 rounded-xl px-3 py-2 text-xs font-medium"
            >
              <span>{errorMsg}</span>
              <button
                type="button"
                aria-label="Dismiss AI error"
                onClick={() => setErrorMsg(null)}
                className="folio-press rounded p-0.5 hover:bg-[var(--surface-elevated)]"
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
                          ? 'ml-6 folio-glass-badge'
                          : 'mr-2 border border-[#072D59]/10 bg-[#F4F8FB] text-[#072D59]'
                      }`}
                    >
                      {msg.role === 'assistant' ? (
                        <AiRichText content={msg.text} />
                      ) : (
                        <div className="whitespace-pre-wrap">{msg.text}</div>
                      )}
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
                                <Check className="h-3 w-3 text-[var(--state-success)]" />
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
                            onClick={() =>
                              onInsertTextbox(formatAiMarkdownForTextbox(msg.text), msg.cropRect)
                            }
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
                      <span>Thinking with {activeAi.shortLabel} ({activeAi.model})…</span>
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
                        ? 'folio-glass-active'
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
                        ? 'folio-glass-active'
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
                        ? 'Get Step by Step Hints'
                        : 'Solve Problem Completely'}
                  </span>
                </button>

                {mathResult && (
                  <div className="space-y-2.5 rounded-2xl border border-[#072D59]/12 bg-[#F4F8FB] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#072D59]">
                        <AiRichText content={mathResult.topic} inline />
                      </span>
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
                            {idx + 1}. <AiRichText content={step.title} inline />
                          </div>
                          <div className="mt-1 leading-relaxed text-[#072D59]/85">
                            <AiRichText content={step.hint} />
                          </div>
                          {step.explanation && (
                            <div className="mt-1 border-t border-[#072D59]/10 pt-1 text-[11px] text-[#072D59]/65">
                              <AiRichText content={step.explanation} />
                            </div>
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
                        className="folio-badge-success rounded-xl p-2.5 text-xs"
                      >
                        <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--state-success)]">
                          Final Answer
                        </div>
                        <div className="mt-0.5 font-bold text-[var(--navy-900)]">
                          <AiRichText content={mathResult.finalAnswer} />
                        </div>
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
                        ? 'folio-glass-active'
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
                        ? 'folio-glass-active'
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
                            ? 'folio-glass-active'
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
                      <span className="font-bold text-[#072D59]">
                        <AiRichText content={studyResult.title} inline />
                      </span>
                      <span
                        data-testid="quiz-score-badge"
                        className="folio-glass-badge rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
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
                            {qIdx + 1}. <AiRichText content={q.question} inline />
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
                                    'border-[var(--state-success-border)] bg-[var(--state-success-bg)] font-semibold text-[var(--state-success-text)]';
                                } else if (isPicked) {
                                  cls =
                                    'border-[var(--state-danger-border)] bg-[var(--state-danger-bg)] font-semibold text-[var(--state-danger-text)]';
                                } else {
                                  cls =
                                    'border-[var(--border-subtle)] bg-[var(--surface-elevated)]/60 text-[var(--navy-600)]';
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
                                  <AiRichText content={opt} inline />
                                </button>
                              );
                            })}
                          </div>
                          {isAnswered && q.explanation && (
                            <div className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] text-[#072D59]/80">
                              <AiRichText content={q.explanation} />
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
                        <AiRichText
                          content={cardFlipped ? activeCard.back : activeCard.front}
                          inline
                        />
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
                        className="folio-btn-navy rounded-xl py-1.5 text-[11px] font-bold"
                      >
                        Got It ✓
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mode 4: Transcribe & Handwriting */}
            {mode === 'transcribe' && (
              <div className="space-y-3">
                {renderHandwritingCorrectionCard()}

                <div className="border-t border-[#072D59]/10 pt-2.5">
                  <p className="text-xs text-[#072D59]/75">
                    Convert handwritten ink from the{' '}
                    <strong>{scope === 'lasso' ? 'lasso selection' : 'active page'}</strong> into
                    editable typed text.
                  </p>
                </div>

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
                          <Check className="h-3.5 w-3.5 text-[var(--state-success)]" />
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

            {/* Mode 5: Create Visual (Diagram / Sticker) */}
            {mode === 'visual' && (
              <div className="space-y-3">
                <div className="rounded-xl border border-[#072D59]/10 bg-[#DBF2FC]/35 px-3 py-2 text-[11px] font-medium text-[#072D59]/80">
                  {activeAi.provider === 'gemini' ? (
                    <>
                      Uses <code className="font-bold">{IMAGE_GEMINI_MODEL}</code> to create
                      diagrams and study visuals directly as editable Canva-style photos on your
                      page.
                    </>
                  ) : activeAi.provider === 'openai' || activeAi.provider === 'grok' ? (
                    <>
                      Uses{' '}
                      <code className="font-bold">
                        {activeAi.provider === 'openai' ? 'gpt-image-1' : 'grok-2-image'}
                      </code>{' '}
                      via {activeAi.label} to create study visuals directly on your page.
                    </>
                  ) : (
                    <>
                      Image generation is supported on <strong>Google Gemini</strong>,{' '}
                      <strong>OpenAI</strong>, and <strong>xAI (Grok)</strong>. Switch providers in
                      Settings → AI &amp; Providers to generate visuals.
                    </>
                  )}
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
                      <div className="text-[11px] text-[#072D59]/75">
                        <AiRichText content={generatedVisual.caption} />
                      </div>
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
