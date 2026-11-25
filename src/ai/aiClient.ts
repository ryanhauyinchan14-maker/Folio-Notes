import { GoogleGenAI, Type, type Schema } from '@google/genai';
import type { AiProxyFetchRequest, AiProxyFetchResponse } from '../vite-env';
import { formatAiMarkdownForTextbox } from '../utils/aiMarkdown';
import {
  AI_PROVIDER_META,
  type AiProviderId,
  IMAGE_GEMINI_MODEL,
  isLocalhostUrl,
} from '../utils/settings';
import type { SnapshotImagePart } from './pageSnapshot';

export interface ActiveAiConfig {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export class VaultAiBlockedError extends Error {
  constructor(
    message = 'AI access is blocked because this notebook is Vault-locked. Disable "Block AI on Vault-Locked Notebooks" in Settings to override.',
  ) {
    super(message);
    this.name = 'VaultAiBlockedError';
  }
}

export interface AiPrivacyGuard {
  isVaultLocked: boolean;
  blockAiOnVaultLocked?: boolean;
}

export function assertAiAllowed(guard?: AiPrivacyGuard): void {
  if (guard?.isVaultLocked && (guard.blockAiOnVaultLocked ?? true)) {
    throw new VaultAiBlockedError();
  }
}

function assertProviderReady(config: ActiveAiConfig): ActiveAiConfig {
  const provider = config.provider;
  const meta = AI_PROVIDER_META[provider];
  const apiKey = (config.apiKey ?? '').trim();
  const model = (config.model || meta.defaultModel).trim();
  const baseUrl = (config.baseUrl ?? meta.defaultBaseUrl ?? '').trim();

  if (provider === 'custom') {
    if (!baseUrl) {
      throw new Error('Custom provider Base URL is missing. Configure it in Settings → AI & Providers.');
    }
    if (!apiKey && !isLocalhostUrl(baseUrl)) {
      throw new Error(
        `No API key configured for ${meta.label}. Add one in Settings → AI & Providers (optional only for localhost).`,
      );
    }
  } else if (!apiKey) {
    throw new Error(
      `No ${meta.label} API key configured. Add one in Settings → AI & Providers.`,
    );
  }

  return { provider, apiKey, model, baseUrl };
}

export type AiErrorKind =
  | 'vault-blocked'
  | 'invalid-key'
  | 'rate-limit'
  | 'offline'
  | 'tier-unsupported'
  | 'unknown';

export type GeminiErrorKind = AiErrorKind;

export function classifyAiError(
  err: unknown,
  providerLabel = 'AI provider',
): {
  kind: AiErrorKind;
  message: string;
} {
  if (err instanceof VaultAiBlockedError || (err as { name?: string })?.name === 'VaultAiBlockedError') {
    return {
      kind: 'vault-blocked',
      message: (err as Error).message,
    };
  }

  const rawMsg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  const lower = rawMsg.toLowerCase();

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('authentication_error') ||
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('permission_denied') ||
    lower.includes('unauthenticated')
  ) {
    return {
      kind: 'invalid-key',
      message: `${providerLabel} rejected your API key (401/403). Check your key in Settings → AI & Providers.`,
    };
  }

  if (
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit')
  ) {
    return {
      kind: 'rate-limit',
      message: `${providerLabel} rate limit or quota reached (429). Wait a moment or switch models in Settings.`,
    };
  }

  if (
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('offline')
  ) {
    return {
      kind: 'offline',
      message: `Network or CORS error reaching ${providerLabel}. Check your connection (use the Folio Notes desktop app for zero-CORS direct provider requests).`,
    };
  }

  if (
    lower.includes('modality') ||
    lower.includes('image generation') ||
    lower.includes('not supported') ||
    lower.includes('nano-banana') ||
    lower.includes('billing') ||
    lower.includes('paid tier') ||
    lower.includes('404')
  ) {
    return {
      kind: 'tier-unsupported',
      message: `Feature or model unavailable on this ${providerLabel} key or tier (${rawMsg}).`,
    };
  }

  return {
    kind: 'unknown',
    message: rawMsg || `${providerLabel} request failed.`,
  };
}

function stripJsonCodeFences(rawText: string): string {
  const trimmed = rawText.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  if (fenced) return fenced[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace > 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }
  return trimmed;
}

export interface MathTutorStep {
  title: string;
  hint: string;
  explanation?: string;
}

export interface MathTutorResult {
  mode: 'teach' | 'solve';
  topic: string;
  steps: MathTutorStep[];
  finalAnswer?: string;
}

export function parseMathTutorResponse(
  rawText: string,
  mode: 'teach' | 'solve',
): MathTutorResult {
  const cleaned = stripJsonCodeFences(rawText);
  let parsed: {
    topic?: unknown;
    steps?: Array<{ title?: unknown; hint?: unknown; explanation?: unknown }>;
    finalAnswer?: unknown;
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Could not parse Math Tutor JSON response from AI.');
  }

  if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error('AI Math Tutor response did not include any steps.');
  }

  const steps: MathTutorStep[] = parsed.steps
    .map((s, idx) => ({
      title: String(s?.title ?? `Step ${idx + 1}`).trim() || `Step ${idx + 1}`,
      hint: String(s?.hint ?? '').trim(),
      ...(s?.explanation ? { explanation: String(s.explanation).trim() } : {}),
    }))
    .filter((s) => s.hint.length > 0);

  if (steps.length === 0) {
    throw new Error('AI Math Tutor steps were empty.');
  }

  const finalAnswerStr =
    typeof parsed.finalAnswer === 'string' ? parsed.finalAnswer.trim() : '';

  return {
    mode,
    topic:
      typeof parsed.topic === 'string' && parsed.topic.trim()
        ? parsed.topic.trim()
        : 'Problem Breakdown',
    steps,
    // Teach Me mode never leaks finalAnswer even if a model emitted one.
    ...(mode === 'solve' && finalAnswerStr ? { finalAnswer: finalAnswerStr } : {}),
  };
}

export function formatMathSolutionForTextbox(result: MathTutorResult): string {
  const lines: string[] = [formatAiMarkdownForTextbox(result.topic), ''];
  result.steps.forEach((step, idx) => {
    lines.push(
      `${idx + 1}. ${formatAiMarkdownForTextbox(step.title)}: ${formatAiMarkdownForTextbox(step.hint)}`,
    );
    if (step.explanation) {
      lines.push(`   ${formatAiMarkdownForTextbox(step.explanation)}`);
    }
  });
  if (result.finalAnswer) {
    lines.push('', `Answer: ${formatAiMarkdownForTextbox(result.finalAnswer)}`);
  }
  return lines.join('\n');
}

export interface StudyQuizItem {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface StudyFlashcard {
  id: string;
  front: string;
  back: string;
  tag?: string;
}

export type StudySetResult =
  | { kind: 'quiz'; title: string; questions: StudyQuizItem[] }
  | { kind: 'flashcards'; title: string; cards: StudyFlashcard[] };

export function parseStudySetResponse(
  rawText: string,
  kind: 'quiz' | 'flashcards',
): StudySetResult {
  const cleaned = stripJsonCodeFences(rawText);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error(`Could not parse ${kind} JSON response from AI.`);
  }

  const title =
    typeof parsed?.title === 'string' && parsed.title.trim()
      ? parsed.title.trim()
      : kind === 'quiz'
        ? 'Practice Quiz'
        : 'Study Flashcards';

  if (kind === 'quiz') {
    const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const questions: StudyQuizItem[] = rawQuestions
      .map((item, idx) => {
        const obj = item as Record<string, unknown>;
        const options = Array.isArray(obj?.options)
          ? obj.options.map((o) => String(o ?? '').trim()).filter(Boolean)
          : [];
        const rawIdx = Number(obj?.correctIndex ?? 0);
        const clampedIdx = Number.isFinite(rawIdx)
          ? Math.max(0, Math.min(Math.max(0, options.length - 1), Math.round(rawIdx)))
          : 0;
        return {
          id: `q-${idx + 1}`,
          question: String(obj?.question ?? '').trim(),
          options,
          correctIndex: clampedIdx,
          explanation: String(obj?.explanation ?? '').trim(),
        };
      })
      .filter((q) => q.question.length > 0 && q.options.length >= 2);

    if (questions.length === 0) {
      throw new Error('AI returned no valid quiz questions.');
    }
    return { kind: 'quiz', title, questions };
  }

  const rawCards = Array.isArray(parsed?.cards) ? parsed.cards : [];
  const cards: StudyFlashcard[] = rawCards
    .map((item, idx) => {
      const obj = item as Record<string, unknown>;
      return {
        id: `fc-${idx + 1}`,
        front: String(obj?.front ?? '').trim(),
        back: String(obj?.back ?? '').trim(),
        ...(typeof obj?.tag === 'string' && obj.tag.trim()
          ? { tag: obj.tag.trim() }
          : {}),
      };
    })
    .filter((c) => c.front.length > 0 && c.back.length > 0);

  if (cards.length === 0) {
    throw new Error('AI returned no valid flashcards.');
  }
  return { kind: 'flashcards', title, cards };
}

function snapshotsToGeminiParts(snapshots: SnapshotImagePart[]) {
  return snapshots.map((s) => ({
    inlineData: {
      mimeType: s.mimeType,
      data: s.base64,
    },
  }));
}

function normalizeChatCompletionsEndpoint(baseUrl: string): string {
  const cleaned = baseUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned}/chat/completions`;
}

export async function performAiHttpRequest(
  req: AiProxyFetchRequest,
): Promise<AiProxyFetchResponse> {
  if (typeof window !== 'undefined' && typeof window.folioDesktop?.aiFetch === 'function') {
    return window.folioDesktop.aiFetch(req);
  }
  const resp = await fetch(req.url, {
    method: req.method ?? 'POST',
    headers: req.headers,
    body: req.body,
  });
  const bodyText = await resp.text();
  return {
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    bodyText,
  };
}

export function buildOpenAiCompatibleRequest(
  config: ActiveAiConfig,
  params: {
    systemPrompt?: string;
    userPrompt: string;
    snapshots: SnapshotImagePart[];
    maxTokens?: number;
  },
): AiProxyFetchRequest {
  const defaultBase =
    AI_PROVIDER_META[config.provider]?.defaultBaseUrl ?? 'https://api.openai.com/v1';
  const url = normalizeChatCompletionsEndpoint(config.baseUrl || defaultBase);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey.trim()) {
    headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  }
  if (/openrouter\.ai/i.test(url)) {
    headers['HTTP-Referer'] = 'https://folionotes.app';
    headers['X-Title'] = 'Folio Notes';
  }

  const userContent: Array<Record<string, unknown>> = [
    ...params.snapshots.map((s) => ({
      type: 'image_url',
      image_url: {
        url: s.dataUrl || `data:${s.mimeType};base64,${s.base64}`,
      },
    })),
    {
      type: 'text',
      text: params.userPrompt,
    },
  ];

  const messages: Array<Record<string, unknown>> = [];
  if (params.systemPrompt?.trim()) {
    messages.push({ role: 'system', content: params.systemPrompt.trim() });
  }
  messages.push({
    role: 'user',
    content: params.snapshots.length > 0 ? userContent : params.userPrompt,
  });

  const payload: Record<string, unknown> = {
    model: config.model,
    messages,
  };
  if (params.maxTokens) {
    payload.max_tokens = params.maxTokens;
  }

  return {
    url,
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  };
}

export function buildAnthropicRequest(
  config: ActiveAiConfig,
  params: {
    systemPrompt?: string;
    userPrompt: string;
    snapshots: SnapshotImagePart[];
    maxTokens?: number;
  },
): AiProxyFetchRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey.trim(),
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };

  const contentBlocks: Array<Record<string, unknown>> = [
    ...params.snapshots.map((s) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: s.mimeType,
        data: s.base64,
      },
    })),
    {
      type: 'text',
      text: params.userPrompt,
    },
  ];

  const payload: Record<string, unknown> = {
    model: config.model,
    max_tokens: params.maxTokens ?? 2048,
    ...(params.systemPrompt?.trim() ? { system: params.systemPrompt.trim() } : {}),
    messages: [
      {
        role: 'user',
        content: contentBlocks,
      },
    ],
  };

  return {
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  };
}

function parseErrorMessageFromBody(resp: AiProxyFetchResponse): string {
  try {
    const parsed = JSON.parse(resp.bodyText) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed?.error === 'string' && parsed.error) return `${resp.status} ${parsed.error}`;
    if (parsed?.error && typeof parsed.error === 'object' && parsed.error.message) {
      return `${resp.status} ${parsed.error.message}`;
    }
    if (typeof parsed?.message === 'string' && parsed.message) {
      return `${resp.status} ${parsed.message}`;
    }
  } catch {
    // Non-JSON error body
  }
  return `${resp.status} ${resp.statusText || resp.bodyText || 'Request failed'}`.trim();
}

export async function runMultimodalTextCompletion(
  rawConfig: ActiveAiConfig,
  params: {
    systemPrompt?: string;
    userPrompt: string;
    snapshots: SnapshotImagePart[];
    geminiSchema?: Schema;
    jsonMode?: boolean;
    maxTokens?: number;
    guard?: AiPrivacyGuard;
  },
): Promise<string> {
  assertAiAllowed(params.guard);
  const config = assertProviderReady(rawConfig);

  if (config.provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const promptText = params.systemPrompt?.trim()
      ? `${params.systemPrompt.trim()}\n\n${params.userPrompt}`
      : params.userPrompt;

    const response = await ai.models.generateContent({
      model: config.model,
      contents: [
        {
          role: 'user',
          parts: [...snapshotsToGeminiParts(params.snapshots), { text: promptText }],
        },
      ],
      ...(params.geminiSchema || params.jsonMode || params.maxTokens
        ? {
            config: {
              ...(params.jsonMode || params.geminiSchema
                ? { responseMimeType: 'application/json' }
                : {}),
              ...(params.geminiSchema ? { responseSchema: params.geminiSchema } : {}),
              ...(params.maxTokens ? { maxOutputTokens: params.maxTokens } : {}),
            },
          }
        : {}),
    });

    const text = (response.text ?? '').trim();
    if (!text) {
      throw new Error('Gemini returned an empty response.');
    }
    return text;
  }

  if (config.provider === 'anthropic') {
    const req = buildAnthropicRequest(config, params);
    const resp = await performAiHttpRequest(req);
    if (!resp.ok) {
      throw new Error(parseErrorMessageFromBody(resp));
    }
    const data = JSON.parse(resp.bodyText) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('\n')
      .trim();
    if (!text) {
      throw new Error('Claude returned an empty response.');
    }
    return text;
  }

  // grok | openai | custom (OpenAI-compatible Chat Completions)
  const req = buildOpenAiCompatibleRequest(config, params);
  const resp = await performAiHttpRequest(req);
  if (!resp.ok) {
    throw new Error(parseErrorMessageFromBody(resp));
  }
  const data = JSON.parse(resp.bodyText) as {
    choices?: Array<{
      message?: { content?: string | Array<{ type?: string; text?: string }> };
    }>;
  };
  const msgContent = data.choices?.[0]?.message?.content;
  const text = Array.isArray(msgContent)
    ? msgContent
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('\n')
        .trim()
    : typeof msgContent === 'string'
      ? msgContent.trim()
      : '';
  if (!text) {
    throw new Error(`${AI_PROVIDER_META[config.provider].label} returned an empty response.`);
  }
  return text;
}

export async function testAiConnection(
  config: ActiveAiConfig,
): Promise<{ ok: true; model: string } | { ok: false; kind: AiErrorKind; message: string }> {
  const providerLabel = AI_PROVIDER_META[config.provider]?.label ?? 'AI provider';
  try {
    const ready = assertProviderReady(config);
    await runMultimodalTextCompletion(ready, {
      userPrompt: 'Reply with OK.',
      snapshots: [],
      maxTokens: 16,
    });
    return { ok: true, model: ready.model };
  } catch (err) {
    const classified = classifyAiError(err, providerLabel);
    return { ok: false, kind: classified.kind, message: classified.message };
  }
}

export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export async function askNotesWithAi(params: {
  config: ActiveAiConfig;
  prompt: string;
  history: ChatHistoryTurn[];
  snapshots: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<{ text: string }> {
  const historyLines =
    params.history.length > 0
      ? params.history
          .slice(-8)
          .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.text}`)
          .join('\n') + '\n\n'
      : '';

  const scopeNote =
    params.snapshots.length > 0
      ? `Attached note context (${params.snapshots.map((s) => s.label).join(', ')}):`
      : 'No canvas snapshot attached.';

  const text = await runMultimodalTextCompletion(params.config, {
    systemPrompt:
      'You are Folio Notes AI Study Assistant. Be concise, accurate, and directly reference the handwritten notes or PDF slides attached.',
    userPrompt: `${scopeNote}\n${historyLines}Student request: ${params.prompt}`,
    snapshots: params.snapshots,
    guard: params.guard,
  });

  return { text };
}

const MATH_TUTOR_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    topic: { type: Type.STRING },
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          hint: { type: Type.STRING },
          explanation: { type: Type.STRING },
        },
        required: ['title', 'hint'],
      },
    },
    finalAnswer: { type: Type.STRING },
  },
  required: ['topic', 'steps'],
};

export async function runMathTutorWithAi(params: {
  config: ActiveAiConfig;
  mode: 'teach' | 'solve';
  userNote?: string;
  snapshots: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<MathTutorResult> {
  const modeInstruction =
    params.mode === 'teach'
      ? 'Return 3 to 5 progressive Socratic hints in `steps` (`title` and `hint`) that guide the student step-by-step WITHOUT stating or spoiling the final answer. Leave `finalAnswer` empty.'
      : 'Return a clear worked step-by-step derivation in `steps` (`title`, `hint`, and optional `explanation`) and put the exact final result in `finalAnswer`.';

  const focusNote = params.userNote?.trim()
    ? `\nStudent note / question: ${params.userNote.trim()}`
    : '';

  const rawText = await runMultimodalTextCompletion(params.config, {
    userPrompt:
      `Analyze the math or science problem in these notes. ${modeInstruction}${focusNote}\n\n` +
      'Respond ONLY with raw JSON of the form {"topic":"...","steps":[{"title":"...","hint":"...","explanation":"..."}],"finalAnswer":"..."}.',
    snapshots: params.snapshots,
    geminiSchema: MATH_TUTOR_SCHEMA,
    jsonMode: true,
    guard: params.guard,
  });

  return parseMathTutorResponse(rawText, params.mode);
}

const QUIZ_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          options: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          correctIndex: { type: Type.INTEGER },
          explanation: { type: Type.STRING },
        },
        required: ['question', 'options', 'correctIndex', 'explanation'],
      },
    },
  },
  required: ['title', 'questions'],
};

const FLASHCARDS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    cards: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          front: { type: Type.STRING },
          back: { type: Type.STRING },
          tag: { type: Type.STRING },
        },
        required: ['front', 'back'],
      },
    },
  },
  required: ['title', 'cards'],
};

export async function generateStudySetWithAi(params: {
  config: ActiveAiConfig;
  kind: 'quiz' | 'flashcards';
  count: number;
  topicHint?: string;
  snapshots: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<StudySetResult> {
  const clampedCount = Math.max(1, Math.min(10, Math.round(params.count)));
  const focus = params.topicHint?.trim() ? ` Focus on: ${params.topicHint.trim()}.` : '';
  const prompt =
    params.kind === 'quiz'
      ? `Generate ${clampedCount} multiple-choice quiz questions strictly from the attached notes.${focus} Each question must have 4 concise options, 0-based correctIndex (0-3), and a short explanation. Respond ONLY with raw JSON: {"title":"...","questions":[{"question":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"..."}]}.`
      : `Generate ${clampedCount} concise study flashcards from the attached notes.${focus} Put a clear prompt or term on front and a direct explanation or formula on back. Respond ONLY with raw JSON: {"title":"...","cards":[{"front":"...","back":"...","tag":"..."}]}.`;

  const rawText = await runMultimodalTextCompletion(params.config, {
    userPrompt: prompt,
    snapshots: params.snapshots,
    geminiSchema: params.kind === 'quiz' ? QUIZ_SCHEMA : FLASHCARDS_SCHEMA,
    jsonMode: true,
    guard: params.guard,
  });

  return parseStudySetResponse(rawText, params.kind);
}

export async function transcribeHandwritingWithAi(params: {
  config: ActiveAiConfig;
  snapshots: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<{ text: string }> {
  const text = await runMultimodalTextCompletion(params.config, {
    userPrompt:
      'Transcribe the handwriting and any equations/diagrams in these notes into clean, well-structured plain text with line breaks or bullet points. Return ONLY the transcribed content with no preamble.',
    snapshots: params.snapshots,
    guard: params.guard,
  });

  return { text };
}

export async function generateStudyVisualWithAi(params: {
  config: ActiveAiConfig;
  prompt: string;
  snapshots?: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<{ dataUrl: string; caption?: string }> {
  assertAiAllowed(params.guard);
  const config = assertProviderReady(params.config);
  const styledPrompt = `Create a clean, crisp educational study diagram or illustration with high contrast on a clean light background: ${params.prompt.trim()}`;

  if (config.provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const parts = [
      ...snapshotsToGeminiParts(params.snapshots ?? []),
      { text: styledPrompt },
    ];
    const response = await ai.models.generateContent({
      model: IMAGE_GEMINI_MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
      },
    });

    const candidates = response.candidates ?? [];
    let caption: string | undefined;
    let imageUrl: string | null = null;
    for (const cand of candidates) {
      const candParts = cand.content?.parts ?? [];
      for (const part of candParts) {
        if (part.inlineData?.data && !imageUrl) {
          const mime = part.inlineData.mimeType || 'image/png';
          imageUrl = `data:${mime};base64,${part.inlineData.data}`;
        }
        if (part.text && !caption) {
          caption = part.text.trim();
        }
      }
      if (imageUrl) {
        return { dataUrl: imageUrl, ...(caption ? { caption } : {}) };
      }
    }
    throw new Error(
      `Image generation unavailable for model "${IMAGE_GEMINI_MODEL}" on this API key/tier.`,
    );
  }

  if (config.provider === 'openai' || config.provider === 'grok') {
    const isOpenAi = config.provider === 'openai';
    const url = isOpenAi
      ? 'https://api.openai.com/v1/images/generations'
      : 'https://api.x.ai/v1/images/generations';
    const bodyPayload = isOpenAi
      ? { model: 'gpt-image-1', prompt: styledPrompt, n: 1, size: '1024x1024' }
      : { model: 'grok-2-image', prompt: styledPrompt, n: 1, response_format: 'b64_json' };

    const resp = await performAiHttpRequest({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(bodyPayload),
    });

    if (!resp.ok) {
      throw new Error(parseErrorMessageFromBody(resp));
    }

    const parsed = JSON.parse(resp.bodyText) as {
      data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    };
    const first = parsed.data?.[0];
    if (first?.b64_json) {
      return {
        dataUrl: `data:image/png;base64,${first.b64_json}`,
        ...(first.revised_prompt ? { caption: first.revised_prompt } : {}),
      };
    }
    if (first?.url) {
      return { dataUrl: first.url };
    }
    throw new Error(`Image generation did not return an image from ${AI_PROVIDER_META[config.provider].label}.`);
  }

  throw new Error(
    `Image generation modality is not supported for ${AI_PROVIDER_META[config.provider].label}. Switch to Google Gemini, OpenAI, or xAI (Grok) in Settings to generate study visuals.`,
  );
}
