import {
  type ActiveAiConfig,
  type AiErrorKind,
  type AiPrivacyGuard,
  askNotesWithAi,
  assertAiAllowed,
  type ChatHistoryTurn,
  classifyAiError,
  formatMathSolutionForTextbox,
  generateStudySetWithAi,
  generateStudyVisualWithAi,
  type GeminiErrorKind,
  type MathTutorResult,
  type MathTutorStep,
  parseMathTutorResponse,
  parseStudySetResponse,
  runMathTutorWithAi,
  type StudyFlashcard,
  type StudyQuizItem,
  type StudySetResult,
  testAiConnection,
  transcribeHandwritingWithAi,
  VaultAiBlockedError,
} from './aiClient';
import type { SnapshotImagePart } from './pageSnapshot';

export {
  assertAiAllowed,
  formatMathSolutionForTextbox,
  parseMathTutorResponse,
  parseStudySetResponse,
  VaultAiBlockedError,
};

export type {
  ActiveAiConfig,
  AiErrorKind,
  AiPrivacyGuard,
  ChatHistoryTurn,
  GeminiErrorKind,
  MathTutorResult,
  MathTutorStep,
  StudyFlashcard,
  StudyQuizItem,
  StudySetResult,
};

export function classifyGeminiError(err: unknown): {
  kind: GeminiErrorKind;
  message: string;
} {
  return classifyAiError(err, 'Google Gemini');
}

export async function testGeminiConnection(params: {
  apiKey: string;
  model: string;
}) {
  return testAiConnection({
    provider: 'gemini',
    apiKey: params.apiKey,
    model: params.model,
  });
}

export async function askNotesWithGemini(params: {
  apiKey: string;
  model: string;
  prompt: string;
  history: ChatHistoryTurn[];
  snapshots: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<{ text: string }> {
  return askNotesWithAi({
    config: { provider: 'gemini', apiKey: params.apiKey, model: params.model },
    prompt: params.prompt,
    history: params.history,
    snapshots: params.snapshots,
    guard: params.guard,
  });
}

export async function runMathTutor(params: {
  apiKey: string;
  model: string;
  mode: 'teach' | 'solve';
  userNote?: string;
  snapshots: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<MathTutorResult> {
  return runMathTutorWithAi({
    config: { provider: 'gemini', apiKey: params.apiKey, model: params.model },
    mode: params.mode,
    userNote: params.userNote,
    snapshots: params.snapshots,
    guard: params.guard,
  });
}

export async function generateStudySet(params: {
  apiKey: string;
  model: string;
  kind: 'quiz' | 'flashcards';
  count: number;
  topicHint?: string;
  snapshots: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<StudySetResult> {
  return generateStudySetWithAi({
    config: { provider: 'gemini', apiKey: params.apiKey, model: params.model },
    kind: params.kind,
    count: params.count,
    topicHint: params.topicHint,
    snapshots: params.snapshots,
    guard: params.guard,
  });
}

export async function transcribeHandwriting(params: {
  apiKey: string;
  model: string;
  snapshots: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<{ text: string }> {
  return transcribeHandwritingWithAi({
    config: { provider: 'gemini', apiKey: params.apiKey, model: params.model },
    snapshots: params.snapshots,
    guard: params.guard,
  });
}

export async function generateStudyVisual(params: {
  apiKey: string;
  prompt: string;
  snapshots?: SnapshotImagePart[];
  guard?: AiPrivacyGuard;
}): Promise<{ dataUrl: string; caption?: string }> {
  return generateStudyVisualWithAi({
    config: { provider: 'gemini', apiKey: params.apiKey, model: '' },
    prompt: params.prompt,
    snapshots: params.snapshots,
    guard: params.guard,
  });
}
