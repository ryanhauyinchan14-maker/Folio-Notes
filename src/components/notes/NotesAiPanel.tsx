import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  PlusCircle,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { askDocumentNotesWithAi, classifyAiError } from '../../ai/aiClient';
import { useAppStore } from '../../store/useAppStore';
import { AI_PROVIDER_META, resolveActiveAiConfig } from '../../utils/settings';
import { getCssFallbackZoomFactor } from '../../utils/uiZoom';
import {
  AI_SIDEBAR_ABS_MAX_WIDTH,
  AI_SIDEBAR_DEFAULT_WIDTH,
  AI_SIDEBAR_MIN_WIDTH,
} from '../editor/AiSidebar';
import { AiRichText } from '../editor/AiRichText';

interface NotesAiPanelProps {
  open: boolean;
  documentText: string;
  getSelectedText: () => string;
  onInsertAtCursor: (text: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

const QUICK_PROMPTS = [
  'Summarize this document clearly',
  'Extract key action items & takeaways',
  'Polish grammar and clarity',
  'Generate 5 study review questions',
];

export const NotesAiPanel: React.FC<NotesAiPanelProps> = ({
  open,
  documentText,
  getSelectedText,
  onInsertAtCursor,
  onOpenSettings,
  onClose,
}) => {
  const activeNotebook = useAppStore((s) => s.activeNotebook);
  const blockAiOnVaultLocked = useAppStore((s) => s.blockAiOnVaultLocked);
  const activeAiProvider = useAppStore((s) => s.activeAiProvider);
  const aiProviderKeys = useAppStore((s) => s.aiProviderKeys);
  const aiProviderModels = useAppStore((s) => s.aiProviderModels);
  const aiCustomBaseUrl = useAppStore((s) => s.aiCustomBaseUrl);

  const activeAi = resolveActiveAiConfig({
    activeAiProvider,
    aiProviderKeys,
    aiProviderModels,
    aiCustomBaseUrl,
  });
  const isVaultBlocked = Boolean(activeNotebook?.isLocked && blockAiOnVaultLocked);

  const [width, setWidth] = useState(AI_SIDEBAR_DEFAULT_WIDTH);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Array<{ id: string; role: 'user' | 'assistant'; text: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragCleanupRef.current?.();
      const startX = e.clientX;
      const startW = width;
      const zoomFactor = getCssFallbackZoomFactor();
      const onMove = (ev: PointerEvent) => {
        const next = Math.round(startW + (startX - ev.clientX) / zoomFactor);
        setWidth(Math.max(AI_SIDEBAR_MIN_WIDTH, Math.min(AI_SIDEBAR_ABS_MAX_WIDTH, next)));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        dragCleanupRef.current = null;
      };
      dragCleanupRef.current = onUp;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [width],
  );

  if (!open) return null;

  const submitPrompt = async (overrideText?: string) => {
    const q = (overrideText ?? prompt).trim();
    if (!q || busy) return;
    setErrorMsg(null);
    setBusy(true);
    if (!overrideText) setPrompt('');
    const userMsg = { id: `u-${Date.now()}`, role: 'user' as const, text: q };
    setMessages((prev) => [...prev, userMsg]);
    try {
      const res = await askDocumentNotesWithAi({
        config: activeAi,
        prompt: q,
        documentText,
        selectedText: getSelectedText(),
        history: messages.map((m) => ({ role: m.role, text: m.text })),
        guard: { isVaultLocked: Boolean(activeNotebook?.isLocked), blockAiOnVaultLocked },
      });
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', text: res.text },
      ]);
    } catch (err) {
      setErrorMsg(classifyAiError(err, AI_PROVIDER_META[activeAi.provider].label).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      data-testid="notes-ai-panel"
      aria-label="Notes AI Assistant"
      style={{ width: `${width}px` }}
      className="relative z-20 flex h-full max-w-full shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--navy-900)] shadow-[var(--shadow-floating)]"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={handleResizePointerDown}
        onDoubleClick={() => setWidth(AI_SIDEBAR_DEFAULT_WIDTH)}
        className="absolute inset-y-0 -left-1.5 z-30 flex w-3 cursor-col-resize items-center justify-center"
      >
        <div className="h-14 w-1 rounded-full bg-[var(--navy-900)]/18" />
      </div>

      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[linear-gradient(135deg,#DBF2FC_0%,#F6FAFE_65%,#FCE7EE_100%)] px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="folio-glass-badge flex h-8 w-8 items-center justify-center rounded-xl">
            <Sparkles className="h-4 w-4 text-[var(--crimson-500)]" />
          </span>
          <div>
            <h2 className="text-sm font-bold">Notes AI Assistant</h2>
            <div className="font-mono text-[10px] font-semibold text-[var(--navy-600)]">
              {activeAi.shortLabel} · {activeAi.model}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Open AI Settings"
            onClick={onOpenSettings}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-600)] hover:bg-[var(--surface-elevated)]"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Close Notes AI Assistant"
            onClick={onClose}
            className="folio-press rounded-lg p-1.5 text-[var(--navy-600)] hover:bg-[var(--surface-elevated)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isVaultBlocked ? (
        <div className="p-4">
          <div className="folio-badge-warning space-y-2.5 rounded-2xl p-4 text-xs">
            <div className="flex items-center gap-2 font-bold">
              <ShieldAlert className="h-4 w-4 text-[var(--state-warning)]" />
              Vault Privacy Protection Active
            </div>
            <p className="text-[var(--state-warning-text)]">
              Outbound AI requests are blocked while this document is Vault-locked.
            </p>
          </div>
        </div>
      ) : !activeAi.configured ? (
        <div className="p-4">
          <div className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-tint)]/60 p-4 text-xs">
            <KeyRound className="h-5 w-5 text-[var(--crimson-500)]" />
            <div className="font-bold">Connect an AI Provider</div>
            <button
              type="button"
              onClick={onOpenSettings}
              className="folio-btn-crimson w-full rounded-xl px-3 py-2 text-xs font-semibold"
            >
              Open Settings → AI &amp; Providers
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto p-3.5">
            {messages.length === 0 && (
              <div className="space-y-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-seal-muted)] p-3">
                <p className="text-xs font-semibold">Ask AI to summarize, polish, or quiz your notes:</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PROMPTS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={busy}
                      onClick={() => void submitPrompt(q)}
                      className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 py-1 text-[11px] font-semibold hover:border-[var(--crimson-500)]"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="folio-badge-danger rounded-xl px-3 py-2 text-xs font-medium">
                {errorMsg}
              </div>
            )}

            {messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-2xl p-3 text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'folio-glass-badge ml-6'
                    : 'mr-2 border border-[var(--border-subtle)] bg-[var(--surface-canvas)]'
                }`}
              >
                {m.role === 'assistant' ? (
                  <>
                    <AiRichText content={m.text} />
                    <div className="mt-2 flex gap-1.5 border-t border-[var(--border-subtle)] pt-2">
                      <button
                        type="button"
                        data-testid="notes-ai-insert-btn"
                        onClick={() => onInsertAtCursor(m.text)}
                        className="folio-btn-navy inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold"
                      >
                        <PlusCircle className="h-3 w-3" />
                        Insert at Cursor
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(m.text);
                          setCopiedId(m.id);
                          window.setTimeout(() => setCopiedId(null), 1500);
                        }}
                        className="folio-btn-secondary inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold"
                      >
                        {copiedId === m.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copiedId === m.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </>
                ) : (
                  m.text
                )}
              </div>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitPrompt();
            }}
            className="border-t border-[var(--border-subtle)] p-2.5"
          >
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask AI about this document…"
                className="folio-input flex-1 rounded-xl px-3 py-2 text-xs"
              />
              <button
                type="submit"
                disabled={busy || !prompt.trim()}
                aria-label="Send prompt"
                className="folio-btn-crimson flex h-8 w-8 items-center justify-center rounded-xl disabled:opacity-45"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </button>
            </div>
          </form>
        </>
      )}
    </aside>
  );
};
