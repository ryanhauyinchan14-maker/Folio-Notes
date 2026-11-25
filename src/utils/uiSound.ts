export type UiSoundKind = 'switch' | 'paper' | 'delete';

let uiSoundEnabled = false;
let sharedAudioCtx: AudioContext | null = null;
let sharedNoiseBuffer: AudioBuffer | null = null;

export function setUiSoundEnabled(enabled: boolean): void {
  uiSoundEnabled = Boolean(enabled);
}

export function isUiSoundEnabled(): boolean {
  return uiSoundEnabled;
}

export function resetUiSoundContextForTests(): void {
  uiSoundEnabled = false;
  sharedAudioCtx = null;
  sharedNoiseBuffer = null;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedAudioCtx) {
    if (sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  }

  const Ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (typeof Ctor !== 'function') return null;

  try {
    sharedAudioCtx = new Ctor();
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
  if (sharedNoiseBuffer && sharedNoiseBuffer.sampleRate === ctx.sampleRate) {
    return sharedNoiseBuffer;
  }
  try {
    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.05));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    sharedNoiseBuffer = buffer;
    return buffer;
  } catch {
    return null;
  }
}

/**
 * Synthesizes subtle (< 50ms) tactile feedback for desktop actions.
 * Strictly silent unless enabled in Settings -> Appearance -> Subtle UI Sounds.
 */
export function playUiSound(kind: UiSoundKind, forceEnabled?: boolean): void {
  const active = forceEnabled !== undefined ? forceEnabled : uiSoundEnabled;
  if (!active) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    if (kind === 'switch') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(780, now);
      osc.frequency.exponentialRampToValueAtTime(420, now + 0.02);

      gain.gain.setValueAtTime(0.028, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.024);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.026);
      return;
    }

    if (kind === 'paper') {
      const noiseBuf = getNoiseBuffer(ctx);
      if (!noiseBuf) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1900, now);
      filter.Q.setValueAtTime(0.9, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.035, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.044);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start(now);
      src.stop(now + 0.046);
      return;
    }

    // 'delete': soft damped low thud
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(92, now + 0.036);

    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.038);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  } catch {
    // Ignore restricted audio environments gracefully
  }
}
