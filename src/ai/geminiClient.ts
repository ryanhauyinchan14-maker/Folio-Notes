import { GoogleGenAI, Type, type Schema } from '@google/genai';
import { IMAGE_GEMINI_MODEL } from '../utils/settings';
import type { SnapshotImagePart } from './pageSnapshot';

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

function assertApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error('No Gemini API key configured. Add one in Settings → Google AI Studio.');
  }
  return trimmed;
}

export type GeminiErrorKind =
  | 'vault-blocked'
  | 'invalid-key'
  | 'rate-limit'
  | 'offline'
  | 'tier-unsupported'
  | 'unknown';

export function classifyGeminiError(err: unknown): {
  kind: GeminiErrorKind;
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
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('permission_denied') ||
    lower.includes('unauthenticated')
  ) {
    return {
      kind: 'invalid-key',
      message: 'API key was rejected (401/403). Check your key in Google AI Studio and try again.',
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
      message: 'Rate limit or quota reached (429). Wait a moment or switch to gemini-3.5-flash-lite.',
    };
  }

  if (
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('enotfound') ||
    lower.includes('offline')
  ) {
    return {
      kind: 'offline',
      message: 'Network unavailable. Gemini AI requires an internet connection with your API key.',
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
      message: `Visual generation unavailable on this API key or tier (${rawMsg}).`,
    };
  }

  return {
    kind: 'unknown',
    message: rawMsg || 'Gemini request failed.',
  };
}

function stripJsonCodeFences(rawText: string): string {
  const trimmed = rawText.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
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
    throw new Error('Could not parse Math Tutor JSON response from Gemini.');
  }

  if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error('Gemini Math Tutor response did not include any steps.');
  }

  const steps: MathTutorStep[] = parsed.steps
    .map((s, idx) => ({
      title: String(s?.title ?? `Step ${idx + 1}`).trim() || `Step ${idx + 1}`,
      hint: String(s?.hint ?? '').trim(),
      ...(s?.explanation ? { explanation: String(s.explanation).trim() } : {}),
    }))
    .filter((s) => s.hint.length > 0);

  if (steps.length === 0) {
    throw new Error('Gemini Math Tutor steps were empty.');
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
  const lines: string[] = [result.topic, ''];
  result.steps.forEach((step, idx) => {
    lines.push(`${idx + 1}. ${step.title}: ${step.hint}`);
    if (step.explanation) {
      lines.push(`   ${step.explanation}`);
    }
  });
  if (result.finalAnswer) {
    lines.push('', `Answer: ${result.finalAnswer}`);
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
    throw new Error(`Could not parse ${kind} JSON response from Gemini.`);
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
      throw new Error('Gemini returned no valid quiz questions.');
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
    throw new Error('Gemini returned no valid flashcards.');
  }
  return { kind: 'flashcards', title, cards };
}

function snapshotsToInlineParts(snapshots: SnapshotImagePart[]) {
  return snapshots.map((s) => ({
    inlineData: {
      mimeType: s.mimeType,
      data: s.base64,
    },
  }));
}

export async function testGeminiConnection(params: {
  apiKey: string;
  model: string;
}): Promise<{ ok: true; model: string } | { ok: false; kind: GeminiErrorKind; message: string }> {
  try {
    const key = assertApiKey(params.apiKey);
    const ai = new GoogleGenAI({ apiKey: key });
    await ai.models.generateContent({
      model: params.model,
      contents: 'Reply with OK.',
      config: { maxOutputTokens: 8 },
    });
    return { ok: true, model: params.model };
  } catch (err) {
    const classified = classifyGeminiError(err);
    return { ok: false, kind: classified.kind, message: classified.message };
  }
}

export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export async function askNotesWithGemini(params: {
  apiKey: string;
  model: string;
  prompt: string;
  history: ChatHistoryTurn[];
  snapshots: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<{ text: string }> {
  assertAiAllowed(params.guard);
  const key = assertApiKey(params.apiKey);
  const ai = new GoogleGenAI({ apiKey: key });

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

  const fullPrompt =
    'You are Folio Notes AI Study Assistant. Be concise, accurate, and directly reference the handwritten notes or PDF slides attached.\n\n' +
    `${scopeNote}\n${historyLines}Student request: ${params.prompt}`;

  const response = await ai.models.generateContent({
    model: params.model,
    contents: [
      {
        role: 'user',
        parts: [...snapshotsToInlineParts(params.snapshots), { text: fullPrompt }],
      },
    ],
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }
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

export async function runMathTutor(params: {
  apiKey: string;
  model: string;
  mode: 'teach' | 'solve';
  userNote?: string;
  snapshots: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<MathTutorResult> {
  assertAiAllowed(params.guard);
  const key = assertApiKey(params.apiKey);
  const ai = new GoogleGenAI({ apiKey: key });

  const modeInstruction =
    params.mode === 'teach'
      ? 'Return 3 to 5 progressive Socratic hints in `steps` (`title` and `hint`) that guide the student step-by-step WITHOUT stating or spoiling the final answer. Leave `finalAnswer` empty.'
      : 'Return a clear worked step-by-step derivation in `steps` (`title`, `hint`, and optional `explanation`) and put the exact final result in `finalAnswer`.';

  const focusNote = params.userNote?.trim()
    ? `\nStudent note / question: ${params.userNote.trim()}`
    : '';

  const response = await ai.models.generateContent({
    model: params.model,
    contents: [
      {
        role: 'user',
        parts: [
          ...snapshotsToInlineParts(params.snapshots),
          {
            text: `Analyze the math or science problem in these notes. ${modeInstruction}${focusNote}`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: MATH_TUTOR_SCHEMA,
    },
  });

  return parseMathTutorResponse(response.text ?? '', params.mode);
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

export async function generateStudySet(params: {
  apiKey: string;
  model: string;
  kind: 'quiz' | 'flashcards';
  count: number;
  topicHint?: string;
  snapshots: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<StudySetResult> {
  assertAiAllowed(params.guard);
  const key = assertApiKey(params.apiKey);
  const ai = new GoogleGenAI({ apiKey: key });

  const clampedCount = Math.max(1, Math.min(10, Math.round(params.count)));
  const focus = params.topicHint?.trim() ? ` Focus on: ${params.topicHint.trim()}.` : '';
  const prompt =
    params.kind === 'quiz'
      ? `Generate ${clampedCount} multiple-choice quiz questions strictly from the attached notes.${focus} Each question must have 4 concise options, 0-based correctIndex (0-3), and a short explanation.`
      : `Generate ${clampedCount} concise study flashcards from the attached notes.${focus} Put a clear prompt or term on front and a direct explanation or formula on back.`;

  const response = await ai.models.generateContent({
    model: params.model,
    contents: [
      {
        role: 'user',
        parts: [...snapshotsToInlineParts(params.snapshots), { text: prompt }],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: params.kind === 'quiz' ? QUIZ_SCHEMA : FLASHCARDS_SCHEMA,
    },
  });

  return parseStudySetResponse(response.text ?? '', params.kind);
}

export async function transcribeHandwriting(params: {
  apiKey: string;
  model: string;
  snapshots: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<{ text: string }> {
  assertAiAllowed(params.guard);
  const key = assertApiKey(params.apiKey);
  const ai = new GoogleGenAI({ apiKey: key });

  const response = await ai.models.generateContent({
    model: params.model,
    contents: [
      {
        role: 'user',
        parts: [
          ...snapshotsToInlineParts(params.snapshots),
          {
            text: 'Transcribe the handwriting and any equations/diagrams in these notes into clean, well-structured plain text with line breaks or bullet points. Return ONLY the transcribed content with no preamble.',
          },
        ],
      },
    ],
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Could not detect any text or handwriting to transcribe.');
  }
  return { text };
}

export async function generateStudyVisual(params: {
  apiKey: string;
  prompt: string;
  snapshots?: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<{ dataUrl: string; caption?: string }> {
  assertAiAllowed(params.guard);
  const key = assertApiKey(params.apiKey);
  const ai = new GoogleGenAI({ apiKey: key });

  const parts = [
    ...snapshotsToInlineParts(params.snapshots ?? []),
    {
      text: `Create a clean, crisp educational study diagram or illustration with high contrast on a clean light background: ${params.prompt.trim()}`,
    },
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
