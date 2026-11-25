// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isUiSoundEnabled,
  playUiSound,
  resetUiSoundContextForTests,
  setUiSoundEnabled,
} from '../uiSound';

describe('uiSound tactile synthesizer', () => {
  const originalAudioContext = window.AudioContext;
  const originalWebkitAudioContext = (
    window as Window & { webkitAudioContext?: typeof AudioContext }
  ).webkitAudioContext;

  beforeEach(() => {
    resetUiSoundContextForTests();
  });

  afterEach(() => {
    resetUiSoundContextForTests();
    window.AudioContext = originalAudioContext;
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext =
      originalWebkitAudioContext;
  });

  it('is strictly off by default and never constructs AudioContext until enabled', () => {
    const ctorSpy = vi.fn();
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    expect(isUiSoundEnabled()).toBe(false);
    playUiSound('switch');
    playUiSound('paper');
    playUiSound('delete');

    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('no-ops gracefully when AudioContext is missing or restricted', () => {
    setUiSoundEnabled(true);
    delete (window as unknown as Record<string, unknown>).AudioContext;
    delete (window as unknown as Record<string, unknown>).webkitAudioContext;

    expect(() => {
      playUiSound('switch');
      playUiSound('paper');
      playUiSound('delete');
    }).not.toThrow();

    window.AudioContext = vi.fn(function BlockedAudioCtx() {
      throw new Error('Blocked AudioContext');
    }) as unknown as typeof AudioContext;

    expect(() => playUiSound('switch')).not.toThrow();
  });

  it('synthesizes switch, paper, and delete micro-sounds cleanly when enabled', () => {
    const oscStart = vi.fn();
    const oscStop = vi.fn();
    const oscConnect = vi.fn();
    const srcStart = vi.fn();
    const srcStop = vi.fn();
    const srcConnect = vi.fn();
    const filterConnect = vi.fn();
    const gainConnect = vi.fn();

    const makeParam = () => ({
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    });

    const mockCtx = {
      state: 'running',
      currentTime: 1.5,
      sampleRate: 44100,
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      createOscillator: vi.fn(() => ({
        type: 'sine',
        frequency: makeParam(),
        connect: oscConnect,
        start: oscStart,
        stop: oscStop,
      })),
      createGain: vi.fn(() => ({
        gain: makeParam(),
        connect: gainConnect,
      })),
      createBuffer: vi.fn((_ch: number, len: number) => ({
        sampleRate: 44100,
        getChannelData: () => new Float32Array(len),
      })),
      createBufferSource: vi.fn(() => ({
        buffer: null,
        connect: srcConnect,
        start: srcStart,
        stop: srcStop,
      })),
      createBiquadFilter: vi.fn(() => ({
        type: 'bandpass',
        frequency: makeParam(),
        Q: makeParam(),
        connect: filterConnect,
      })),
    };

    const ctorSpy = vi.fn(function AudioCtxMock() {
      return mockCtx;
    });
    window.AudioContext = ctorSpy as unknown as typeof AudioContext;

    setUiSoundEnabled(true);
    playUiSound('switch');
    playUiSound('paper');
    playUiSound('delete');

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
    expect(oscStart).toHaveBeenCalledTimes(2);
    expect(oscStop).toHaveBeenCalledTimes(2);
    expect(mockCtx.createBufferSource).toHaveBeenCalledTimes(1);
    expect(mockCtx.createBiquadFilter).toHaveBeenCalledTimes(1);
    expect(srcStart).toHaveBeenCalledTimes(1);
    expect(srcStop).toHaveBeenCalledTimes(1);
  });
});
