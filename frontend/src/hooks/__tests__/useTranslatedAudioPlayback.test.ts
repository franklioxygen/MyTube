import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslatedAudioPlayer } from '../useTranslatedAudioPlayback';

// Minimal Web Audio fakes for asserting graph wiring + volume routing.
const destination = { id: 'destination' };
let gains: FakeNode[];
let bufferSources: FakeNode[];

class FakeNode {
  gain = { value: 1 };
  buffer: unknown = null;
  connectedTo: unknown[] = [];
  onended: (() => void) | null = null;
  connect(dest: unknown) {
    this.connectedTo.push(dest);
  }
  disconnect() {}
  start() {}
  stop() {}
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = destination;
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  createGain() {
    const node = new FakeNode();
    gains.push(node);
    return node;
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(4), duration: 0.04 };
  }
  createBufferSource() {
    const node = new FakeNode();
    bufferSources.push(node);
    return node;
  }
}

// 4 Int16 samples = 8 bytes -> base64 of zeros.
const SAMPLE_BASE64 = Buffer.from(new Uint8Array(8)).toString('base64');

describe('useTranslatedAudioPlayback — volume routing', () => {
  beforeEach(() => {
    gains = [];
    bufferSources = [];
    vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('routes translated chunks through a master gain, not directly to destination', () => {
    const player = createTranslatedAudioPlayer();
    player.prime();
    player.enqueueBase64(SAMPLE_BASE64);

    expect(gains).toHaveLength(1);
    const master = gains[0];
    expect(master.connectedTo).toContain(destination);
    // The buffer source connects to the master gain, not the destination.
    expect(bufferSources[0].connectedTo).toContain(master);
    expect(bufferSources[0].connectedTo).not.toContain(destination);
  });

  it('applies volume and mute to the master gain', () => {
    const player = createTranslatedAudioPlayer();
    player.prime();
    player.setVolume(0.4, false);
    expect(gains[0].gain.value).toBeCloseTo(0.4, 5);

    player.setVolume(0.4, true);
    expect(gains[0].gain.value).toBe(0);
  });

  it('honors volume set before the context exists', () => {
    const player = createTranslatedAudioPlayer();
    player.setVolume(0.25, false);
    player.prime();
    player.enqueueBase64(SAMPLE_BASE64);
    expect(gains[0].gain.value).toBeCloseTo(0.25, 5);
  });
});
