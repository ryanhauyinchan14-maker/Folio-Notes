// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COVER_PRESETS } from '../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../constants/papers';
import { useAppStore } from '../../store/useAppStore';
import type { Page } from '../../types/notes';
import { AiSidebar } from '../../components/editor/AiSidebar';
import {
  askNotesWithGemini,
  classifyGeminiError,
  formatMathSolutionForTextbox,
  generateStudySet,
  generateStudyVisual,
  parseMathTutorResponse,
  parseStudySetResponse,
  runMathTutor,
  transcribeHandwriting,
  VaultAiBlockedError,
} from '../geminiClient';
import {
  captureLassoCropSnapshot,
  captureViewportSnapshot,
  computePaddedCropRect,
  selectMultiPageWindow,
  type SnapshotImagePart,
} from '../pageSnapshot';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { generateContentMock, GoogleGenAIMock } = vi.hoisted(() => {
  const fn = vi.fn();
  const ctor = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.models = { generateContent: fn };
  });
  return { generateContentMock: fn, GoogleGenAIMock: ctor };
});

vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  return {
    ...actual,
    GoogleGenAI: GoogleGenAIMock,
  };
});

const SAMPLE_SNAPSHOT: SnapshotImagePart = {
  label: 'Page 1',
  mimeType: 'image/png',
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAhKmMIQAAAABJRU5ErkJggg==',
  dataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAhKmMIQAAAABJRU5ErkJggg==',
  width: 120,
  height: 160,
  cropRect: { x: 80, y: 100, width: 140, height: 100 },
};

describe('Gemini AI Study Suite (Offline Mocked @google/genai)', () => {
  const origPath2D = globalThis.Path2D;

  beforeEach(() => {
    generateContentMock.mockReset();
    GoogleGenAIMock.mockClear();
    globalThis.Path2D = class MockPath2D {
      moveTo() {}
      lineTo() {}
      quadraticCurveTo() {}
      closePath() {}
    } as unknown as typeof Path2D;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.Path2D = origPath2D;
  });

  it('blocks all Gemini AI requests on Vault-locked notebooks when blockAiOnVaultLocked is ON and allows when OFF', async () => {
    const guardLocked = { isVaultLocked: true, blockAiOnVaultLocked: true };

    await expect(
      askNotesWithGemini({
        apiKey: 'AIzaTestKey',
        model: 'gemini-4-hydrogen',
        prompt: 'Summarize',
        history: [],
        snapshots: [SAMPLE_SNAPSHOT],
        guard: guardLocked,
      }),
    ).rejects.toBeInstanceOf(VaultAiBlockedError);

    await expect(
      runMathTutor({
        apiKey: 'AIzaTestKey',
        model: 'gemini-4-hydrogen',
        mode: 'teach',
        snapshots: [SAMPLE_SNAPSHOT],
        guard: guardLocked,
      }),
    ).rejects.toBeInstanceOf(VaultAiBlockedError);

    await expect(
      generateStudySet({
        apiKey: 'AIzaTestKey',
        model: 'gemini-4-hydrogen',
        kind: 'quiz',
        count: 3,
        snapshots: [SAMPLE_SNAPSHOT],
        guard: guardLocked,
      }),
    ).rejects.toBeInstanceOf(VaultAiBlockedError);

    await expect(
      transcribeHandwriting({
        apiKey: 'AIzaTestKey',
        model: 'gemini-4-hydrogen',
        snapshots: [SAMPLE_SNAPSHOT],
        guard: guardLocked,
      }),
    ).rejects.toBeInstanceOf(VaultAiBlockedError);

    await expect(
      generateStudyVisual({
        apiKey: 'AIzaTestKey',
        prompt: 'Mitosis stages',
        snapshots: [SAMPLE_SNAPSHOT],
        guard: guardLocked,
      }),
    ).rejects.toBeInstanceOf(VaultAiBlockedError);

    expect(GoogleGenAIMock).not.toHaveBeenCalled();
    expect(generateContentMock).not.toHaveBeenCalled();

    // When override guard blockAiOnVaultLocked is false, outbound request proceeds cleanly
    generateContentMock.mockResolvedValueOnce({ text: 'Unlocked summary OK' });
    const res = await askNotesWithGemini({
      apiKey: 'AIzaTestKey',
      model: 'gemini-4-hydrogen',
      prompt: 'Summarize',
      history: [],
      snapshots: [SAMPLE_SNAPSHOT],
      guard: { isVaultLocked: true, blockAiOnVaultLocked: false },
    });
    expect(res.text).toBe('Unlocked summary OK');
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('crops lasso selections tightly with +16px padding and caps multi-page window at 5 pages', async () => {
    const padded = computePaddedCropRect(
      { minX: 100, minY: 120, maxX: 220, maxY: 190 },
      816,
      1056,
      16,
    );
    expect(padded).toEqual({ x: 84, y: 104, width: 152, height: 102 });

    const edgeClamped = computePaddedCropRect(
      { minX: 4, minY: 6, maxX: 18, maxY: 14 },
      816,
      1056,
      16,
    );
    expect(edgeClamped.x).toBe(0);
    expect(edgeClamped.y).toBe(0);
    expect(edgeClamped.width).toBeGreaterThanOrEqual(32);
    expect(edgeClamped.height).toBeGreaterThanOrEqual(32);

    expect(selectMultiPageWindow(12, 0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(selectMultiPageWindow(12, 6, 5)).toEqual([4, 5, 6, 7, 8]);
    expect(selectMultiPageWindow(12, 11, 5)).toEqual([7, 8, 9, 10, 11]);
    expect(selectMultiPageWindow(3, 1, 10)).toEqual([0, 1, 2]);

    const drawCalls: Array<{ sx: number; sy: number; sw: number; sh: number }> = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const ctx: Record<string, unknown> = {
        fillStyle: '#FFFFFF',
        strokeStyle: '#000000',
        lineWidth: 1,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        translate: vi.fn(),
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        arc: vi.fn(),
        drawImage: vi.fn((...args: unknown[]) => {
          if (args.length >= 9) {
            drawCalls.push({
              sx: Number(args[1]),
              sy: Number(args[2]),
              sw: Number(args[3]),
              sh: Number(args[4]),
            });
          }
        }),
      };
      return ctx as unknown as CanvasRenderingContext2D;
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,QUI=',
    );

    const page: Page = {
      id: 'pg-lasso',
      notebookId: 'nb-1',
      paper: { ...DEFAULT_PAPER_CONFIG },
      strokes: [
        {
          id: 's-1',
          tool: 'pen',
          color: '#072D59',
          size: 4,
          opacity: 1,
          simulatePressure: false,
          points: [
            { x: 100, y: 120, pressure: 0.5 },
            { x: 220, y: 190, pressure: 0.5 },
          ],
          bounds: { minX: 100, minY: 120, maxX: 220, maxY: 190 },
          createdAt: 1,
        },
        {
          id: 's-other',
          tool: 'pen',
          color: '#072D59',
          size: 4,
          opacity: 1,
          simulatePressure: false,
          points: [
            { x: 600, y: 700, pressure: 0.5 },
            { x: 700, y: 800, pressure: 0.5 },
          ],
          bounds: { minX: 600, minY: 700, maxX: 700, maxY: 800 },
          createdAt: 2,
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    const snap = await captureLassoCropSnapshot(page, 1, ['s-1'], {
      scale: 1.5,
      padding: 16,
    });
    expect(snap.cropRect).toEqual({ x: 84, y: 104, width: 152, height: 102 });
    expect(snap.width).toBe(228);
    expect(snap.height).toBe(153);
    expect(snap.base64).toBe('QUI=');
    expect(drawCalls).toEqual([{ sx: 126, sy: 156, sw: 228, sh: 153 }]);
  });

  it('parses structured Math Tutor hints (hiding answer in teach mode), Quiz JSON, Flashcards & error kinds', () => {
    const fencedMath = [
      '```json',
      JSON.stringify({
        topic: 'Linear Equation',
        steps: [
          { title: 'Isolate variable term', hint: 'Subtract 5 from both sides.' },
          { title: 'Solve for x', hint: 'Divide both sides by 3.' },
        ],
        finalAnswer: 'x = 4',
      }),
      '```',
    ].join('\n');

    const teachParsed = parseMathTutorResponse(fencedMath, 'teach');
    expect(teachParsed.mode).toBe('teach');
    expect(teachParsed.steps).toHaveLength(2);
    expect(teachParsed.finalAnswer).toBeUndefined();

    const solveParsed = parseMathTutorResponse(fencedMath, 'solve');
    expect(solveParsed.finalAnswer).toBe('x = 4');
    expect(formatMathSolutionForTextbox(solveParsed)).toContain('Answer: x = 4');

    const quizParsed = parseStudySetResponse(
      JSON.stringify({
        title: 'Optics Check',
        questions: [
          {
            question: 'What is Snells Law?',
            options: ['n1 sin θ1 = n2 sin θ2', 'F = ma', 'E = mc^2', 'V = IR'],
            correctIndex: 9,
            explanation: 'Relates angles of incidence and refraction.',
          },
        ],
      }),
      'quiz',
    );
    expect(quizParsed.kind).toBe('quiz');
    if (quizParsed.kind === 'quiz') {
      expect(quizParsed.questions[0].correctIndex).toBe(3); // clamped within [0, 3]
    }

    const cardsParsed = parseStudySetResponse(
      JSON.stringify({
        title: 'Key Terms',
        cards: [{ front: 'Refraction', back: 'Bending of wave across media', tag: 'Optics' }],
      }),
      'flashcards',
    );
    expect(cardsParsed.kind).toBe('flashcards');
    if (cardsParsed.kind === 'flashcards') {
      expect(cardsParsed.cards[0].front).toBe('Refraction');
    }

    expect(classifyGeminiError(new VaultAiBlockedError()).kind).toBe('vault-blocked');
    expect(classifyGeminiError(new Error('403 API_KEY_INVALID')).kind).toBe('invalid-key');
    expect(classifyGeminiError(new Error('429 RESOURCE_EXHAUSTED')).kind).toBe('rate-limit');
    expect(classifyGeminiError(new Error('Failed to fetch')).kind).toBe('offline');
    expect(
      classifyGeminiError(new Error('Image generation modality not supported on free tier')).kind,
    ).toBe('tier-unsupported');
  });

  it('renders onboarding & Vault guardrails, reveals progressive Math Hints, scores Quizzes, and inserts AI Textboxes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      return {
        fillStyle: '#FFFFFF',
        strokeStyle: '#000000',
        lineWidth: 1,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        translate: vi.fn(),
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        arc: vi.fn(),
        drawImage: vi.fn(),
        measureText: vi.fn((t: string) => ({ width: t.length * 8 })),
        fillText: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,QUI=',
    );

    await act(async () => {
      await useAppStore.getState().initApp();
      useAppStore.getState().clearStoredGeminiApiKey();
      useAppStore.getState().setBlockAiOnVaultLocked(true);
      await useAppStore.getState().createNotebook({
        title: 'AI Study Test',
        folderId: null,
        cover: COVER_PRESETS[0].cover,
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: true,
      });
    });

    const insertedTexts: string[] = [];
    const insertTextbox = (text: string) => {
      insertedTexts.push(text);
      const page = useAppStore.getState().pages[0];
      const tb = useAppStore.getState().spawnTextbox({
        pageId: page.id,
        x: 100,
        y: 120,
        initialText: text,
        wrapWidth: 420,
      });
      if (tb) {
        useAppStore.getState().commitTextboxSession(page.id, tb.id, true);
      }
    };

    const renderSidebar = async () => {
      const state = useAppStore.getState();
      await act(async () => {
        root.render(
          <AiSidebar
            open={true}
            activePage={state.pages[0]}
            activePageIndex={0}
            pages={state.pages}
            pendingLassoAction={null}
            onConsumePendingLassoAction={() => {}}
            onInsertTextbox={insertTextbox}
            onInsertImageDataUrl={async () => {}}
            onOpenSettings={() => {}}
            onClose={() => {}}
          />,
        );
      });
    };

    // 1. Zero-key state -> onboarding card with Google AI Studio link
    await renderSidebar();
    expect(container.querySelector('[data-testid="ai-onboarding-card"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="ai-get-key-link"]')?.getAttribute('href'),
    ).toBe('https://aistudio.google.com/apikey');

    // 2. Save local key & test Ask Notes -> Insert as Textbox
    await act(async () => {
      useAppStore.getState().setGeminiApiKey('AIzaUnitTestKey');
    });
    await renderSidebar();
    expect(container.querySelector('[data-testid="ai-onboarding-card"]')).toBeNull();

    generateContentMock.mockResolvedValueOnce({
      text: 'Key takeaway: Force equals mass times acceleration.',
    });

    const chatInput = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="ai-chat-input"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!;
      setter.call(chatInput, 'What is the main formula?');
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="ai-chat-send-btn"]')!
        .click();
      await new Promise((r) => setTimeout(r, 20));
    });

    const insertBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="ai-insert-textbox-btn"]',
    )!;
    expect(insertBtn).not.toBeNull();
    await act(async () => {
      insertBtn.click();
    });
    expect(insertedTexts[0]).toBe('Key takeaway: Force equals mass times acceleration.');
    expect(useAppStore.getState().pages[0].textboxes).toHaveLength(1);

    // 3. Math Tutor Teach Me reveals 1 hint at a time
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        topic: 'Derivative of x^2',
        steps: [
          { title: 'Identify Rule', hint: 'Use the power rule d/dx(x^n) = n x^(n-1).' },
          { title: 'Substitute n = 2', hint: 'Multiply 2 by x^(2-1).' },
        ],
        finalAnswer: '2x',
      }),
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="ai-mode-math"]')!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="math-run-btn"]')!.click();
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(container.querySelectorAll('[data-testid="math-step-card"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="math-final-answer"]')).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="math-next-hint-btn"]')!.click();
    });
    expect(container.querySelectorAll('[data-testid="math-step-card"]')).toHaveLength(2);

    // 4. Quiz Mode interactive scoring
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        title: 'Physics Quick Check',
        questions: [
          {
            question: 'Unit of Force?',
            options: ['Newton', 'Watt', 'Joule', 'Volt'],
            correctIndex: 0,
            explanation: 'Force is measured in Newtons (N).',
          },
        ],
      }),
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="ai-mode-study"]')!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="study-generate-btn"]')!.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="quiz-q1-opt-0"]')!.click();
    });
    expect(
      container.querySelector('[data-testid="quiz-score-badge"]')?.textContent,
    ).toContain('1 / 1');

    // 5. Vault-locked notebook with guard ON displays privacy block notice & blocks SDK calls
    await act(async () => {
      const nb = useAppStore.getState().activeNotebook!;
      useAppStore.setState({ activeNotebook: { ...nb, isLocked: true } });
    });
    await renderSidebar();
    expect(container.querySelector('[data-testid="ai-vault-blocked-notice"]')).not.toBeNull();

    await act(async () => {
      useAppStore.getState().clearStoredGeminiApiKey();
      root.unmount();
    });
    container.remove();
    await useAppStore.getState().closeNotebook();
  });

  it('captures current Screen viewport at full sharpness on 24000x24000 pages, fixes oversized Lasso crops, and defaults AiSidebar to Screen scope', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      return {
        fillStyle: '#FFFFFF',
        strokeStyle: '#000000',
        lineWidth: 1,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        translate: vi.fn(),
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        arc: vi.fn(),
        drawImage: vi.fn(),
        measureText: vi.fn((t: string) => ({ width: t.length * 8 })),
        fillText: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,QUI=',
    );

    const hugePage: Page = {
      id: 'huge-ai-pg',
      notebookId: 'nb-huge-ai',
      paper: {
        ...DEFAULT_PAPER_CONFIG,
        sizePreset: 'custom',
        width: 24000,
        height: 24000,
      },
      strokes: [
        {
          id: 's-visible',
          tool: 'pen',
          color: '#072D59',
          size: 4,
          opacity: 1,
          simulatePressure: false,
          points: [
            { x: 5100, y: 6100, pressure: 0.5 },
            { x: 5400, y: 6250, pressure: 0.5 },
          ],
          bounds: { minX: 5100, minY: 6100, maxX: 5400, maxY: 6250 },
          createdAt: 1,
        },
        {
          id: 's-far-away',
          tool: 'pen',
          color: '#072D59',
          size: 4,
          opacity: 1,
          simulatePressure: false,
          points: [
            { x: 22000, y: 22000, pressure: 0.5 },
            { x: 22300, y: 22200, pressure: 0.5 },
          ],
          bounds: { minX: 22000, minY: 22000, maxX: 22300, maxY: 22200 },
          createdAt: 2,
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    // 1. Viewport snapshot captures only the current visible rect at 1.5x sharpness and omits cropRect
    const viewSnap = await captureViewportSnapshot(
      hugePage,
      1,
      { x: 5000, y: 6000, width: 1000, height: 700 },
      { scale: 1.5 },
    );
    expect(viewSnap.label).toBe('Current Screen (Page 1)');
    expect(viewSnap.width).toBe(1500);
    expect(viewSnap.height).toBe(1050);
    expect(viewSnap.cropRect).toBeUndefined();

    // 2. Whiteboard negative-coordinate viewport snapshot captures cleanly
    const wbViewSnap = await captureViewportSnapshot(
      hugePage,
      1,
      { x: -800, y: -500, width: 900, height: 600 },
      { scale: 1.5, isWhiteboard: true },
    );
    expect(wbViewSnap.label).toBe('Current Screen (Whiteboard)');
    expect(wbViewSnap.width).toBe(1350);
    expect(wbViewSnap.height).toBe(900);

    // 3. Fallback to full page if viewportRect is null
    const fallbackSnap = await captureViewportSnapshot(hugePage, 1, null, { scale: 1.5 });
    expect(fallbackSnap.label).toBe('Page 1');

    // 4. Oversized fixed-page Lasso crop renders directly at crisp coordinates
    const oversizedLasso = await captureLassoCropSnapshot(hugePage, 1, ['s-visible'], {
      scale: 1.5,
      padding: 16,
    });
    expect(oversizedLasso.cropRect).toEqual({ x: 5084, y: 6084, width: 332, height: 182 });
    expect(oversizedLasso.width).toBe(498);
    expect(oversizedLasso.height).toBe(273);

    // 5. AiSidebar defaults to 'Screen' (ai-scope-view) and invokes getVisibleRect on submit
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      await useAppStore.getState().initApp();
      useAppStore.getState().setGeminiApiKey('AIzaScreenScopeTest');
      useAppStore.getState().setBlockAiOnVaultLocked(false);
    });

    const getVisibleRectMock = vi.fn(() => ({
      x: 5000,
      y: 6000,
      width: 1000,
      height: 700,
    }));

    await act(async () => {
      root.render(
        <AiSidebar
          open={true}
          activePage={hugePage}
          activePageIndex={0}
          pages={[hugePage]}
          getVisibleRect={getVisibleRectMock}
          pendingLassoAction={null}
          onConsumePendingLassoAction={() => {}}
          onInsertTextbox={() => {}}
          onInsertImageDataUrl={async () => {}}
          onOpenSettings={() => {}}
          onClose={() => {}}
        />,
      );
    });

    const screenBtn = container.querySelector<HTMLButtonElement>('[data-testid="ai-scope-view"]');
    expect(screenBtn).not.toBeNull();
    expect(screenBtn?.getAttribute('aria-pressed')).toBe('true');

    generateContentMock.mockResolvedValueOnce({
      text: 'Summary of visible area only.',
    });

    const chatInput = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="ai-chat-input"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!;
      setter.call(chatInput, 'What am I looking at?');
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="ai-chat-send-btn"]')!.click();
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(getVisibleRectMock).toHaveBeenCalledTimes(1);
    expect(generateContentMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      useAppStore.getState().clearStoredGeminiApiKey();
      root.unmount();
    });
    container.remove();
  });

  it('renders Markdown headings, lists, and KaTeX equations in AiSidebar and inserts Unicode-formatted text into textboxes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      return {
        fillStyle: '#FFFFFF',
        strokeStyle: '#000000',
        lineWidth: 1,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        translate: vi.fn(),
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        arc: vi.fn(),
        drawImage: vi.fn(),
        measureText: vi.fn((t: string) => ({ width: t.length * 8 })),
        fillText: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,QUI=',
    );

    const insertedTexts: string[] = [];
    const page: Page = {
      id: 'pg-math-render',
      notebookId: 'nb-1',
      paper: { ...DEFAULT_PAPER_CONFIG },
      strokes: [],
      createdAt: 1,
      updatedAt: 1,
    };

    await act(async () => {
      await useAppStore.getState().initApp();
      useAppStore.getState().setGeminiApiKey('AIzaKatexRenderKey');
      useAppStore.getState().setBlockAiOnVaultLocked(false);
    });

    await act(async () => {
      root.render(
        <AiSidebar
          open={true}
          activePage={page}
          activePageIndex={0}
          pages={[page]}
          pendingLassoAction={null}
          onConsumePendingLassoAction={() => {}}
          onInsertTextbox={(txt) => insertedTexts.push(txt)}
          onInsertImageDataUrl={async () => {}}
          onOpenSettings={() => {}}
          onClose={() => {}}
        />,
      );
    });

    generateContentMock.mockResolvedValueOnce({
      text: [
        '### 1. Outer Boundary',
        '* **Vertex:** $V_1 \\approx (0.73, 0.95)$',
        '$$\\partial\\Omega = \\bigcup_{i=1}^{4} \\overline{V_i V_{i+1}}$$',
      ].join('\n'),
    });

    const chatInput = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="ai-chat-input"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!;
      setter.call(chatInput, 'Describe the geometry');
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="ai-chat-send-btn"]')!.click();
      await new Promise((r) => setTimeout(r, 20));
    });

    const msgEl = container.querySelector('[data-testid="ai-chat-assistant-msg"]')!;
    expect(msgEl).not.toBeNull();
    expect(msgEl.querySelector('h3')?.textContent).toBe('1. Outer Boundary');
    expect(msgEl.querySelector('ul > li strong')?.textContent).toBe('Vertex:');
    expect(msgEl.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    expect(msgEl.querySelectorAll('.katex-display')).toHaveLength(1);
    expect(msgEl.textContent).not.toContain('###');
    expect(msgEl.textContent).not.toContain('$$');

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="ai-insert-textbox-btn"]')!
        .click();
    });

    expect(insertedTexts[0]).not.toContain('###');
    expect(insertedTexts[0]).not.toContain('$$');
    expect(insertedTexts[0]).toContain('• Vertex: V₁ ≈ (0.73, 0.95)');
    expect(insertedTexts[0]).toContain('∂Ω = ⋃');

    await act(async () => {
      useAppStore.getState().clearStoredGeminiApiKey();
      root.unmount();
    });
    container.remove();
  });
});
