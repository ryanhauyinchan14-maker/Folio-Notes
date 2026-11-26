import { getCombinedBounds } from '../canvas/geometry';
import { drawCommittedStroke } from '../canvas/strokeRenderer';
import { textToHandwritingStrokes } from '../canvas/vectorHandwritingFont';
import type { BoundingBox, Stroke } from '../types/notes';
import { createId } from '../utils/id';
import {
  type ActiveAiConfig,
  type AiPrivacyGuard,
  assertAiAllowed,
  runMultimodalTextCompletion,
} from './aiClient';
import { type SnapshotImagePart, stripPngDataUrlPrefix } from './pageSnapshot';

/**
 * Picks the most prominent ink color across a stroke cluster so converted
 * Handwriting textboxes match the writer's chosen pen color.
 */
export function pickDominantStrokeColor(strokes: Stroke[]): string {
  const counts = new Map<string, number>();
  for (const s of strokes) {
    if (!s.color) continue;
    const weight = Math.max(1, s.points.length);
    counts.set(s.color, (counts.get(s.color) ?? 0) + weight);
  }
  let best = '#072D59';
  let bestWeight = -1;
  for (const [color, weight] of counts.entries()) {
    if (weight > bestWeight) {
      bestWeight = weight;
      best = color;
    }
  }
  return best;
}

/**
 * Computes the dominant weighted pen stroke width across a stroke cluster.
 */
export function pickDominantStrokeSize(strokes: Stroke[]): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of strokes) {
    if (!Number.isFinite(s.size) || s.size <= 0) continue;
    const weight = Math.max(1, s.points.length);
    weightedSum += s.size * weight;
    totalWeight += weight;
  }
  const avg = totalWeight > 0 ? weightedSum / totalWeight : 3.2;
  return Number(Math.max(1.8, Math.min(18, avg)).toFixed(2));
}

/**
 * Estimates a readable Handwriting font size aligned to the written cluster height.
 */
export function estimateHandwritingFontSize(
  bounds: BoundingBox,
  recognizedText: string,
): number {
  const lineCount = Math.max(1, recognizedText.split('\n').length);
  const height = Math.max(14, bounds.maxY - bounds.minY);
  const perLineHeight = height / lineCount;
  return Math.round(Math.max(18, Math.min(64, perLineHeight * 1.15)));
}

/**
 * Renders ONLY the target handwriting strokes onto a crisp white high-contrast PNG canvas
 * padded by `padding` px on each side for Vision AI recognition.
 */
export function renderStrokeClusterToPng(
  strokes: Stroke[],
  padding = 16,
  scale = 2,
): { snapshot: SnapshotImagePart; bounds: BoundingBox } {
  if (typeof document === 'undefined') {
    throw new Error('Stroke PNG rendering requires a DOM environment.');
  }
  const bounds = getCombinedBounds(strokes);
  if (!bounds) {
    throw new Error('Cannot render empty stroke cluster.');
  }

  const logicalWidth = Math.max(32, Math.ceil(bounds.maxX - bounds.minX + padding * 2));
  const logicalHeight = Math.max(24, Math.ceil(bounds.maxY - bounds.minY + padding * 2));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(logicalWidth * scale));
  canvas.height = Math.max(1, Math.round(logicalHeight * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context for handwriting cleanup.');
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-bounds.minX + padding, -bounds.minY + padding);

  const clusterHeight = Math.max(20, bounds.maxY - bounds.minY);
  for (const s of strokes) {
    const ocrSize = Math.max(
      s.size || 2,
      Math.min(8, Math.max(3.6, clusterHeight * 0.045)),
    );
    const ocrStroke: Stroke = {
      ...s,
      color: '#0F172A',
      opacity: 1,
      size: ocrSize,
      simulatePressure: false,
      isTidied: true,
    };
    drawCommittedStroke(ctx, ocrStroke, false, false);
  }
  ctx.restore();

  const dataUrl = canvas.toDataURL('image/png');
  return {
    bounds,
    snapshot: {
      label: 'Handwriting Stroke Cluster',
      mimeType: 'image/png',
      base64: stripPngDataUrlPrefix(dataUrl),
      dataUrl,
      width: canvas.width,
      height: canvas.height,
    },
  };
}

function cleanRecognizedText(raw: string): string {
  let cleaned = raw.trim();
  const fenced = /^```(?:text|markdown|plain)?\s*\n?([\s\S]*?)\n?```$/i.exec(cleaned);
  if (fenced) {
    cleaned = fenced[1].trim();
  }
  if (
    cleaned.length >= 2 &&
    ((cleaned.startsWith('`') && cleaned.endsWith('`') && !cleaned.slice(1, -1).includes('`')) ||
      (cleaned.startsWith('"') && cleaned.endsWith('"') && !cleaned.slice(1, -1).includes('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'") && !cleaned.slice(1, -1).includes("'")))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

/**
 * Crops handwritten pen strokes into a clean PNG, transcribes them with the active
 * Vision AI provider, and synthesizes neat vector handwriting `Stroke[]` drawings
 * ready for single-Undo replacement — or `null` if the strokes represent a doodle/diagram (`EMPTY`).
 */
export async function cleanHandwritingStrokesWithAi(params: {
  strokes: Stroke[];
  config: ActiveAiConfig;
  guard?: AiPrivacyGuard;
  mode?: 'live' | 'selection';
}): Promise<{
  text: string;
  strokes: Stroke[];
  bounds: BoundingBox;
} | null> {
  assertAiAllowed(params.guard);
  if (params.strokes.length === 0) return null;

  const isLive = params.mode === 'live';
  const rawBounds = getCombinedBounds(params.strokes);
  const maxStrokeSize = Math.max(3, ...params.strokes.map((s) => s.size || 3));
  const padding = Math.max(20, Math.ceil(maxStrokeSize * 1.6 + 14));
  const rawSpanWidth = rawBounds ? rawBounds.maxX - rawBounds.minX + padding * 2 : 320;
  const scale = Math.max(1.25, Math.min(2, 1600 / Math.max(1, rawSpanWidth)));
  const { snapshot, bounds } = renderStrokeClusterToPng(params.strokes, padding, scale);

  const rawText = await runMultimodalTextCompletion(params.config, {
    systemPrompt: isLive
      ? 'Exact handwriting OCR inside a digital notebook. The crop shows a handwritten word, line, or short math fragment. Transcribe what is written verbatim without solving, simplifying, or rewording.'
      : 'You are a precision handwriting OCR engine inside a digital notebook app. Transcribe handwritten words, formulas, or short notes verbatim without rewriting, simplifying, or solving them.',
    userPrompt: isLive
      ? 'Transcribe the handwritten word(s), digits, or math fragment shown verbatim (even if it is just 1-3 characters like y=, 50, x², +, or I am).\n' +
        '- Preserve exponents/superscripts using Unicode superscripts (like 500x²) or ^{...} / ^2 (like 500x^2, e^{-x}).\n' +
        '- Preserve subscripts using Unicode subscripts or _{...} (like H₂O or H_2O).\n' +
        '- Do NOT rewrite, simplify, or solve the math, and do NOT add quotes, $ delimiters, markdown fences, or commentary.\n' +
        '- Reply EMPTY ONLY if this is unmistakably a non-text drawing (box, arrow, star, or pure scribble) with zero readable letters, digits, or math symbols.'
      : 'Transcribe the exact handwritten text shown in this image verbatim, preserving intentional line breaks.\n' +
        '- Keep exponents/superscripts as Unicode superscripts (like 500x²) or ^{...} / ^2 (like 500x^2, e^{-x}), and subscripts as Unicode subscripts or _{...} (like H₂O or H_2O).\n' +
        '- Do NOT simplify, solve, or reword what is written, and do NOT add quotes, $ math delimiters, markdown fences, labels, or explanations.\n' +
        '- If the strokes are purely a doodle, geometric shape, arrow, underline, or drawing with no readable text or math expression, reply with the exact single word: EMPTY',
    snapshots: [snapshot],
    maxTokens: 2048,
    guard: params.guard,
  });

  const cleaned = cleanRecognizedText(rawText);
  if (!cleaned || /^(?:empty|\[\[empty\]\]|none|n\/a)\.?$/i.test(cleaned)) {
    return null;
  }

  const synthesizedStrokes = textToHandwritingStrokes({
    text: cleaned,
    bounds,
    color: pickDominantStrokeColor(params.strokes),
    strokeSize: pickDominantStrokeSize(params.strokes),
    groupId: createId(),
  });
  if (synthesizedStrokes.length === 0) {
    return null;
  }

  return {
    text: cleaned,
    strokes: synthesizedStrokes,
    bounds,
  };
}
