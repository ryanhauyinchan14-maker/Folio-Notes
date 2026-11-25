// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eraseStrokesPrecisionSegment } from '../../canvas/eraser';
import {
  computeBoundsFromPoints,
  doesEraserHitStroke,
  getCombinedBounds,
} from '../../canvas/geometry';
import { textToHandwritingStrokes } from '../../canvas/vectorHandwritingFont';
import { SettingsModal } from '../../components/modals/SettingsModal';
import { AiSidebar } from '../../components/editor/AiSidebar';
import { ContextualSubBar } from '../../components/editor/ContextualSubBar';
import { COVER_PRESETS } from '../../constants/covers';
import { DEFAULT_PAPER_CONFIG } from '../../constants/papers';
import { useAppStore } from '../../store/useAppStore';
import type { Stroke } from '../../types/notes';
import {
  askNotesWithAi,
  buildAnthropicRequest,
  buildOpenAiCompatibleRequest,
  generateStudySetWithAi,
  generateStudyVisualWithAi,
  runMathTutorWithAi,
  testAiConnection,
  transcribeHandwritingWithAi,
  VaultAiBlockedError,
} from '../aiClient';
import {
  cleanHandwritingStrokesWithAi,
  pickDominantStrokeColor,
  pickDominantStrokeSize,
} from '../handwritingAi';
import type { SnapshotImagePart } from '../pageSnapshot';

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
};

function makeStroke(id: string, color: string): Stroke {
  const points = [
    { x: 100, y: 200, pressure: 0.5 },
    { x: 180, y: 220, pressure: 0.5 },
    { x: 260, y: 235, pressure: 0.5 },
  ];
  return {
    id,
    tool: 'pen',
    color,
    size: 4,
    opacity: 1,
    simulatePressure: false,
    points,
    bounds: computeBoundsFromPoints(points, 2.4),
    createdAt: Date.now(),
  };
}

describe('Multi-Provider BYOK AI Client & AI Handwriting Correction', () => {
  const origPath2D = globalThis.Path2D;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    window.localStorage.clear();
    delete window.folioDesktop;
    generateContentMock.mockReset();
    GoogleGenAIMock.mockClear();

    globalThis.Path2D = class MockPath2D {
      moveTo() {}
      lineTo() {}
      quadraticCurveTo() {}
      closePath() {}
    } as unknown as typeof Path2D;

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
        fill: vi.fn(),
        stroke: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        closePath: vi.fn(),
        measureText: vi.fn((t: string) => ({ width: t.length * 9 })),
        fillText: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,SldU',
    );
  });

  afterEach(() => {
    delete window.folioDesktop;
    globalThis.fetch = origFetch;
    globalThis.Path2D = origPath2D;
    vi.restoreAllMocks();
  });

  it('formats accurate multimodal payloads for Grok, Gemini, OpenAI, Claude, and Custom/OpenRouter', async () => {
    // 1. Direct request builders verification
    const grokReq = buildOpenAiCompatibleRequest(
      { provider: 'grok', apiKey: 'xai-123', model: 'grok-4.7' },
      { systemPrompt: 'Sys', userPrompt: 'Explain notes', snapshots: [SAMPLE_SNAPSHOT] },
    );
    expect(grokReq.url).toBe('https://api.x.ai/v1/chat/completions');
    expect(grokReq.headers?.Authorization).toBe('Bearer xai-123');
    expect(JSON.parse(grokReq.body!)).toMatchObject({
      model: 'grok-4.7',
      messages: [
        { role: 'system', content: 'Sys' },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: SAMPLE_SNAPSHOT.dataUrl } },
            { type: 'text', text: 'Explain notes' },
          ],
        },
      ],
    });

    const openaiReq = buildOpenAiCompatibleRequest(
      { provider: 'openai', apiKey: 'sk-123', model: 'gpt-5' },
      { userPrompt: 'Summarize', snapshots: [SAMPLE_SNAPSHOT] },
    );
    expect(openaiReq.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(openaiReq.headers?.Authorization).toBe('Bearer sk-123');

    const claudeReq = buildAnthropicRequest(
      { provider: 'anthropic', apiKey: 'sk-ant-123', model: 'claude-sonnet-5-5' },
      { systemPrompt: 'Tutor', userPrompt: 'Explain', snapshots: [SAMPLE_SNAPSHOT] },
    );
    expect(claudeReq.url).toBe('https://api.anthropic.com/v1/messages');
    expect(claudeReq.headers?.['x-api-key']).toBe('sk-ant-123');
    expect(claudeReq.headers?.['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(claudeReq.body!)).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: 'Tutor',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: SAMPLE_SNAPSHOT.base64,
              },
            },
            { type: 'text', text: 'Explain' },
          ],
        },
      ],
    });

    const localOllamaReq = buildOpenAiCompatibleRequest(
      {
        provider: 'custom',
        apiKey: '',
        model: 'llama3.2-vision',
        baseUrl: 'http://localhost:11434/v1',
      },
      { userPrompt: 'Hi', snapshots: [] },
    );
    expect(localOllamaReq.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(localOllamaReq.headers?.Authorization).toBeUndefined();

    // 2. End-to-end execution via Electron zero-CORS IPC aiFetch mock
    const aiFetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      bodyText: JSON.stringify({
        choices: [{ message: { content: 'Grok notes explanation OK' } }],
      }),
    });
    window.folioDesktop = {
      isElectron: true,
      platform: 'win32',
      setUiZoomFactor: (f) => f,
      getUiZoomFactor: () => 1,
      aiFetch: aiFetchMock,
    };

    const grokRes = await askNotesWithAi({
      config: { provider: 'grok', apiKey: 'xai-key', model: 'grok-4.7' },
      prompt: 'Summarize',
      history: [],
      snapshots: [SAMPLE_SNAPSHOT],
    });
    expect(grokRes.text).toBe('Grok notes explanation OK');
    expect(aiFetchMock).toHaveBeenCalledTimes(1);
    expect(aiFetchMock.mock.calls[0][0].url).toBe('https://api.x.ai/v1/chat/completions');

    // Anthropic IPC execution
    aiFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      bodyText: JSON.stringify({
        content: [{ type: 'text', text: 'Claude response OK' }],
      }),
    });
    const claudeRes = await askNotesWithAi({
      config: {
        provider: 'anthropic',
        apiKey: 'sk-ant-key',
        model: 'claude-sonnet-5-5',
      },
      prompt: 'Explain',
      history: [],
      snapshots: [SAMPLE_SNAPSHOT],
    });
    expect(claudeRes.text).toBe('Claude response OK');
    expect(aiFetchMock.mock.calls[1][0].url).toBe('https://api.anthropic.com/v1/messages');

    // Gemini SDK execution
    generateContentMock.mockResolvedValueOnce({ text: 'Gemini 3 Flash OK' });
    const geminiRes = await testAiConnection({
      provider: 'gemini',
      apiKey: 'AIza-key',
      model: 'gemini-3-flash',
    });
    expect(geminiRes).toEqual({ ok: true, model: 'gemini-3-flash' });
  });

  it('enforces Vault Lock AI privacy blocking across ALL 5 providers and AI handwriting cleanup', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const guardLocked = { isVaultLocked: true, blockAiOnVaultLocked: true };

    const providers = [
      { provider: 'gemini' as const, apiKey: 'AIza-1', model: 'gemini-3-flash' },
      { provider: 'grok' as const, apiKey: 'xai-1', model: 'grok-4.7' },
      { provider: 'openai' as const, apiKey: 'sk-1', model: 'gpt-5' },
      { provider: 'anthropic' as const, apiKey: 'sk-ant-1', model: 'claude-sonnet-5-5' },
      {
        provider: 'custom' as const,
        apiKey: 'sk-or-1',
        model: 'openai/gpt-4o-mini',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
    ];

    for (const cfg of providers) {
      await expect(
        askNotesWithAi({ config: cfg, prompt: 'Q', history: [], snapshots: [SAMPLE_SNAPSHOT], guard: guardLocked }),
      ).rejects.toBeInstanceOf(VaultAiBlockedError);
      await expect(
        runMathTutorWithAi({ config: cfg, mode: 'teach', snapshots: [SAMPLE_SNAPSHOT], guard: guardLocked }),
      ).rejects.toBeInstanceOf(VaultAiBlockedError);
      await expect(
        generateStudySetWithAi({ config: cfg, kind: 'quiz', count: 3, snapshots: [SAMPLE_SNAPSHOT], guard: guardLocked }),
      ).rejects.toBeInstanceOf(VaultAiBlockedError);
      await expect(
        transcribeHandwritingWithAi({ config: cfg, snapshots: [SAMPLE_SNAPSHOT], guard: guardLocked }),
      ).rejects.toBeInstanceOf(VaultAiBlockedError);
      await expect(
        generateStudyVisualWithAi({ config: cfg, prompt: 'Cell', guard: guardLocked }),
      ).rejects.toBeInstanceOf(VaultAiBlockedError);
      await expect(
        cleanHandwritingStrokesWithAi({
          strokes: [makeStroke('s-lock', '#072D59')],
          config: cfg,
          guard: guardLocked,
        }),
      ).rejects.toBeInstanceOf(VaultAiBlockedError);
    }

    expect(GoogleGenAIMock).not.toHaveBeenCalled();
    expect(generateContentMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('converts handwritten strokes into neat Stroke[] drawings (zero Textboxes) via AI with 1-step Undo and leaves EMPTY doodles untouched', async () => {
    await act(async () => {
      await useAppStore.getState().initApp();
      await useAppStore.getState().createNotebook({
        title: 'Handwriting AI Test',
        folderId: null,
        cover: COVER_PRESETS[0].cover,
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: true,
      });
    });

    const pageId = useAppStore.getState().activePageId!;
    const s1 = makeStroke('hw-1', '#2563EB');
    const s2 = makeStroke('hw-2', '#2563EB');
    await act(async () => {
      useAppStore.getState().commitNewStroke(pageId, s1);
      useAppStore.getState().commitNewStroke(pageId, s2);
    });

    expect(pickDominantStrokeColor([s1, s2])).toBe('#2563EB');
    expect(pickDominantStrokeSize([s1, s2])).toBe(4);

    // 1. Mock OpenAI/Grok AI returning "Linear Algebra" -> builds neat vector Stroke[] drawings & swaps in ONE Undo step
    const aiFetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      bodyText: JSON.stringify({
        choices: [{ message: { content: 'Linear Algebra' } }],
      }),
    });
    window.folioDesktop = {
      isElectron: true,
      platform: 'win32',
      setUiZoomFactor: (f) => f,
      getUiZoomFactor: () => 1,
      aiFetch: aiFetchMock,
    };

    const result = await cleanHandwritingStrokesWithAi({
      strokes: [s1, s2],
      config: { provider: 'grok', apiKey: 'xai-test', model: 'grok-4.7' },
    });
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Linear Algebra');
    expect(result!.strokes.length).toBeGreaterThan(5);
    expect(result!.strokes.every((s) => s.tool === 'pen' && s.isTidied && s.color === '#2563EB')).toBe(
      true,
    );

    await act(async () => {
      useAppStore.getState().commitAiHandwritingReplacement(pageId, ['hw-1', 'hw-2'], result!.strokes, {
        selectResult: false,
      });
    });

    const afterPage = useAppStore.getState().pages[0];
    // Corrected text stays classified strictly as drawn strokes — NEVER creates a Textbox
    expect(afterPage.textboxes ?? []).toHaveLength(0);
    expect(afterPage.strokes.length).toBe(result!.strokes.length);
    expect(afterPage.strokes.every((s) => s.tool === 'pen' && s.isTidied === true && s.color === '#2563EB')).toBe(
      true,
    );
    expect(useAppStore.getState().handwritingTidyToast).toBe('Handwriting cleaned by AI');

    // Precision & Stroke erasers work directly on the AI-corrected ink strokes
    const correctedBounds = getCombinedBounds(afterPage.strokes)!;
    const midY = (correctedBounds.minY + correctedBounds.maxY) / 2;
    expect(
      afterPage.strokes.some((s) =>
        doesEraserHitStroke(correctedBounds.minX - 5, midY, correctedBounds.maxX + 5, midY, 12, s),
      ),
    ).toBe(true);
    expect(
      eraseStrokesPrecisionSegment(
        afterPage.strokes,
        correctedBounds.minX - 5,
        midY,
        correctedBounds.maxX + 5,
        midY,
        12,
      ).changed,
    ).toBe(true);

    // Single Undo restores BOTH original raw strokes and leaves Textboxes empty
    await act(async () => {
      useAppStore.getState().undo();
    });
    expect(useAppStore.getState().pages[0].strokes.map((s) => s.id)).toEqual(['hw-1', 'hw-2']);
    expect(useAppStore.getState().pages[0].textboxes ?? []).toHaveLength(0);

    // 2. Doodle returning "EMPTY" returns null and leaves strokes completely untouched
    aiFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      bodyText: JSON.stringify({
        choices: [{ message: { content: 'EMPTY' } }],
      }),
    });
    const doodleRes = await cleanHandwritingStrokesWithAi({
      strokes: [s1, s2],
      config: { provider: 'grok', apiKey: 'xai-test', model: 'grok-4.7' },
    });
    expect(doodleRes).toBeNull();
    expect(useAppStore.getState().pages[0].strokes).toHaveLength(2);

    // 3. Handwriting Correction lives inside AiSidebar (not ContextualSubBar), and toggling ON with no key prompts user cleanly
    const subDiv = document.createElement('div');
    document.body.appendChild(subDiv);
    const subRoot: Root = createRoot(subDiv);
    await act(async () => {
      useAppStore.getState().clearAiProviderKey('gemini');
      useAppStore.getState().setActiveAiProvider('gemini');
      useAppStore.getState().setHandwritingCorrectionEnabled(false);
      useAppStore.getState().setActiveTool('pen');
      subRoot.render(<ContextualSubBar activePage={useAppStore.getState().pages[0]} />);
    });
    expect(subDiv.querySelector('[data-testid="handwriting-correction-toggle"]')).toBeNull();

    const aiDiv = document.createElement('div');
    document.body.appendChild(aiDiv);
    const aiRoot: Root = createRoot(aiDiv);
    await act(async () => {
      aiRoot.render(
        <AiSidebar
          open={true}
          activePage={useAppStore.getState().pages[0]}
          activePageIndex={0}
          pages={useAppStore.getState().pages}
          pendingLassoAction={null}
          onConsumePendingLassoAction={() => {}}
          onInsertTextbox={() => {}}
          onInsertImageDataUrl={async () => {}}
          onOpenSettings={() => {}}
          onClose={() => {}}
        />,
      );
    });
    await act(async () => {
      aiDiv
        .querySelector<HTMLButtonElement>('[data-testid="ai-sidebar-handwriting-toggle"]')!
        .click();
    });
    expect(useAppStore.getState().handwritingCorrectionEnabled).toBe(true);
    expect(useAppStore.getState().editorToast).toBeNull();

    // 4. SettingsModal houses Handwriting Correction in AI & Providers (not General) and saves independent provider keys
    const settingsDiv = document.createElement('div');
    document.body.appendChild(settingsDiv);
    const settingsRoot: Root = createRoot(settingsDiv);
    await act(async () => {
      settingsRoot.render(<SettingsModal open={true} initialTab="general" onClose={() => {}} />);
    });
    expect(settingsDiv.querySelector('[data-testid="settings-handwriting-toggle"]')).toBeNull();

    await act(async () => {
      settingsDiv.querySelector<HTMLButtonElement>('[data-testid="settings-tab-ai"]')!.click();
    });
    expect(settingsDiv.querySelector('[data-testid="settings-handwriting-toggle"]')).not.toBeNull();

    const keyInput = settingsDiv.querySelector<HTMLInputElement>(
      '[data-testid="ai-api-key-input"]',
    )!;
    const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      inputSetter.call(keyInput, 'AIza-multi-1');
      keyInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      settingsDiv.querySelector<HTMLButtonElement>('[data-testid="settings-save-ai-key-btn"]')!.click();
    });
    expect(useAppStore.getState().aiProviderKeys.gemini).toBe('AIza-multi-1');

    // Switch to Grok & save Grok key
    await act(async () => {
      settingsDiv.querySelector<HTMLButtonElement>('[data-testid="ai-provider-btn-grok"]')!.click();
    });
    const grokInput = settingsDiv.querySelector<HTMLInputElement>(
      '[data-testid="ai-api-key-input"]',
    )!;
    await act(async () => {
      inputSetter.call(grokInput, 'xai-multi-2');
      grokInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      settingsDiv.querySelector<HTMLButtonElement>('[data-testid="settings-save-ai-key-btn"]')!.click();
    });
    expect(useAppStore.getState().aiProviderKeys.grok).toBe('xai-multi-2');
    expect(useAppStore.getState().aiProviderKeys.gemini).toBe('AIza-multi-1');

    // Test Connection against Grok via mocked IPC
    aiFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      bodyText: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
    });
    await act(async () => {
      settingsDiv.querySelector<HTMLButtonElement>('[data-testid="test-gemini-key-btn"]')!.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(
      settingsDiv.querySelector('[data-testid="gemini-test-status"]')?.textContent,
    ).toContain('Connected to xAI (Grok)');

    await act(async () => {
      subRoot.unmount();
      aiRoot.unmount();
      settingsRoot.unmount();
    });
    subDiv.remove();
    aiDiv.remove();
    settingsDiv.remove();
    await useAppStore.getState().closeNotebook();
  });

  it('aligns adjacent same-line word drawings quietly during live AI handwriting replacement with 1-step per-word Undo and zero textboxes', async () => {
    await act(async () => {
      await useAppStore.getState().initApp();
      await useAppStore.getState().createNotebook({
        title: 'Live Word Merge Test',
        folderId: null,
        cover: COVER_PRESETS[0].cover,
        paper: { ...DEFAULT_PAPER_CONFIG },
        openImmediately: true,
      });
    });

    const pageId = useAppStore.getState().activePageId!;
    const w1 = makeStroke('word-1', '#072D59');
    const w2Points = [
      { x: 185, y: 205, pressure: 0.5 },
      { x: 220, y: 225, pressure: 0.5 },
      { x: 255, y: 240, pressure: 0.5 },
    ];
    const w2: Stroke = {
      id: 'word-2',
      tool: 'pen',
      color: '#072D59',
      size: 4,
      opacity: 1,
      simulatePressure: false,
      points: w2Points,
      bounds: computeBoundsFromPoints(w2Points, 2.4),
      createdAt: Date.now(),
    };

    await act(async () => {
      useAppStore.getState().commitNewStroke(pageId, w1);
      useAppStore.getState().commitNewStroke(pageId, w2);
    });

    const helloStrokes = textToHandwritingStrokes({
      text: 'Hello',
      bounds: { minX: 100, minY: 200, maxX: 165, maxY: 235 },
      color: '#072D59',
      strokeSize: 3.5,
      groupId: 'grp-hello',
    });

    await act(async () => {
      useAppStore.getState().commitAiHandwritingReplacement(
        pageId,
        ['word-1'],
        helloStrokes,
        {
          selectResult: false,
          requireAllPresent: true,
          toastMessage: null,
          alignWithAdjacentLine: true,
          sourceBounds: { minX: 98, minY: 198, maxX: 165, maxY: 235 },
        },
      );
    });

    expect(useAppStore.getState().handwritingTidyToast).toBeNull();
    expect(useAppStore.getState().pages[0].textboxes ?? []).toHaveLength(0);
    const strokesAfterHello = useAppStore.getState().pages[0].strokes;
    expect(strokesAfterHello.filter((s) => s.groupId === 'grp-hello')).toHaveLength(
      helloStrokes.length,
    );

    const worldStrokes = textToHandwritingStrokes({
      text: 'world',
      bounds: { minX: 175, minY: 205, maxX: 255, maxY: 240 },
      color: '#072D59',
      strokeSize: 3.5,
      groupId: 'grp-world',
    });

    await act(async () => {
      useAppStore.getState().commitAiHandwritingReplacement(
        pageId,
        ['word-2'],
        worldStrokes,
        {
          selectResult: false,
          requireAllPresent: true,
          toastMessage: null,
          alignWithAdjacentLine: true,
          sourceBounds: { minX: 175, minY: 205, maxX: 258, maxY: 240 },
        },
      );
    });

    expect(useAppStore.getState().handwritingTidyToast).toBeNull();
    const afterBoth = useAppStore.getState().pages[0];
    expect(afterBoth.textboxes ?? []).toHaveLength(0);
    const placedHello = afterBoth.strokes.filter((s) => s.groupId === 'grp-hello');
    const placedWorld = afterBoth.strokes.filter((s) => s.groupId === 'grp-world');
    expect(placedHello).toHaveLength(helloStrokes.length);
    expect(placedWorld).toHaveLength(worldStrokes.length);

    // Baseline and non-overlapping spacing aligned neatly next to "Hello"
    const helloBounds = getCombinedBounds(placedHello)!;
    const worldBounds = getCombinedBounds(placedWorld)!;
    expect(Math.abs(worldBounds.maxY - helloBounds.maxY)).toBeLessThan(1.5);
    expect(worldBounds.minX).toBeGreaterThan(helloBounds.maxX);

    // Single Undo reverts only "world", restoring 'word-2' while keeping "Hello" strokes
    await act(async () => {
      useAppStore.getState().undo();
    });
    const afterUndo = useAppStore.getState().pages[0];
    expect(afterUndo.textboxes ?? []).toHaveLength(0);
    expect(afterUndo.strokes.some((s) => s.id === 'word-2')).toBe(true);
    expect(afterUndo.strokes.filter((s) => s.groupId === 'grp-hello')).toHaveLength(
      helloStrokes.length,
    );

    await useAppStore.getState().closeNotebook();
  });
});
