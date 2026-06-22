import { useMemo } from 'react';
import { base64ToInt16, int16ToFloat32 } from '../utils/pcmAudio';

/**
 * Plays translated PCM (24 kHz mono Int16, base64) received from the backend.
 *
 * Uses a dedicated AudioContext and a small jitter buffer: chunks are scheduled
 * back-to-back starting a little ahead of the playback clock so brief network
 * jitter does not cause gaps. On seek the queue is flushed; on stop the context
 * is closed.
 */

const OUTPUT_SAMPLE_RATE = 24000;
const JITTER_SECONDS = 0.2; // 200 ms lead

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

class TranslatedAudioPlayer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private nextStart = 0;
  // Mirrors the <video> element volume/mute so the player's volume control also
  // governs translated speech (which bypasses the element and plays via Web Audio).
  private volume = 1;
  private muted = false;
  private readonly sources = new Set<AudioBufferSourceNode>();

  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      return this.ctx;
    }
    const Ctor = getAudioContextCtor();
    if (!Ctor) {
      return null;
    }
    this.ctx = new Ctor();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this.volume;
    this.masterGain.connect(this.ctx.destination);
    return this.ctx;
  }

  /** Sync the output gain with the player's volume/mute state. */
  setVolume(volume: number, muted: boolean): void {
    this.volume = Math.min(Math.max(volume, 0), 1);
    this.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
    }
  }

  /** Create + resume the context within a user gesture (autoplay policy). */
  prime(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume();
    }
  }

  enqueueBase64(base64Pcm24: string): void {
    const ctx = this.ensureContext();
    if (!ctx) {
      return;
    }
    const int16 = base64ToInt16(base64Pcm24);
    if (int16.length === 0) {
      return;
    }
    const float = int16ToFloat32(int16);
    const buffer = ctx.createBuffer(1, float.length, OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(float);

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.masterGain ?? ctx.destination);

    const now = ctx.currentTime;
    if (this.nextStart < now + JITTER_SECONDS) {
      this.nextStart = now + JITTER_SECONDS;
    }
    node.start(this.nextStart);
    this.nextStart += buffer.duration;

    this.sources.add(node);
    node.onended = () => this.sources.delete(node);
  }

  /** Stop and drop all queued audio (used on seek). */
  flush(): void {
    for (const node of this.sources) {
      try {
        node.onended = null;
        node.stop();
        node.disconnect();
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
    this.nextStart = 0;
  }

  pause(): void {
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend();
    }
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  close(): void {
    this.flush();
    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch {
        // ignore
      }
      this.masterGain = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    this.nextStart = 0;
  }
}

export type TranslatedAudioPlaybackController = TranslatedAudioPlayer;

export function createTranslatedAudioPlayer(): TranslatedAudioPlaybackController {
  return new TranslatedAudioPlayer();
}

/** Returns a stable per-mount player instance. */
export function useTranslatedAudioPlayback(): TranslatedAudioPlaybackController {
  return useMemo(() => new TranslatedAudioPlayer(), []);
}
