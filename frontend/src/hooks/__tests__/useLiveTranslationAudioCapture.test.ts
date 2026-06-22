import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isAudioCaptureSupported,
  useLiveTranslationAudioCapture,
} from '../useLiveTranslationAudioCapture';

class FakeAudioContextWithMediaElementSource {
  createMediaElementSource() {
    return {};
  }
}

class FakeAudioContextWithoutMediaElementSource {}

class FakeAudioWorkletNode {}

describe('isAudioCaptureSupported', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('checks support for the media-element source API actually used by capture', () => {
    vi.stubGlobal(
      'AudioContext',
      FakeAudioContextWithMediaElementSource as unknown as typeof AudioContext,
    );
    vi.stubGlobal(
      'AudioWorkletNode',
      FakeAudioWorkletNode as unknown as typeof AudioWorkletNode,
    );
    // The implementation does not use MediaStreamAudioSourceNode; browsers that
    // support MediaElementAudioSourceNode should not be rejected because this is absent.
    vi.stubGlobal('MediaStreamAudioSourceNode', undefined);

    expect(isAudioCaptureSupported()).toBe(true);
  });

  it('returns false when media-element source capture is unavailable', () => {
    vi.stubGlobal(
      'AudioContext',
      FakeAudioContextWithoutMediaElementSource as unknown as typeof AudioContext,
    );
    vi.stubGlobal(
      'AudioWorkletNode',
      FakeAudioWorkletNode as unknown as typeof AudioWorkletNode,
    );

    expect(isAudioCaptureSupported()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Capture graph wiring (P1 fix: the worklet must be reachable from the
// destination so its `process()` is pulled and chunks are produced).
// ---------------------------------------------------------------------------

const destination = { id: 'destination' };
let gains: FakeGraphNode[];
let worklets: FakeWorkletNode[];
let mediaSourceCalls: number;
let audioContextOptions: Array<AudioContextOptions | undefined>;

class FakeGraphNode {
  gain = { value: 1 };
  connectedTo: unknown[] = [];
  connect(dest: unknown) {
    this.connectedTo.push(dest);
  }
  disconnect() {}
}

class FakeWorkletNode {
  port: { onmessage: ((e: MessageEvent) => void) | null } = { onmessage: null };
  connectedTo: unknown[] = [];
  constructor() {
    worklets.push(this);
  }
  connect(dest: unknown) {
    this.connectedTo.push(dest);
  }
  disconnect() {}
}

class FakeGraphAudioContext {
  state = 'suspended';
  destination = destination;
  audioWorklet = { addModule: () => Promise.resolve() };
  constructor(options?: AudioContextOptions) {
    audioContextOptions.push(options);
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  createMediaElementSource() {
    mediaSourceCalls += 1;
    return new FakeGraphNode();
  }
  createGain() {
    const node = new FakeGraphNode();
    gains.push(node);
    return node;
  }
}

describe('capture graph wiring', () => {
  beforeEach(() => {
    gains = [];
    worklets = [];
    mediaSourceCalls = 0;
    audioContextOptions = [];
    vi.stubGlobal('AudioContext', FakeGraphAudioContext as unknown as typeof AudioContext);
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode as unknown as typeof AudioWorkletNode);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('connects the worklet through a zero-gain sink to the destination', async () => {
    const { result } = renderHook(() => useLiveTranslationAudioCapture());
    const el = {} as HTMLMediaElement;
    await act(async () => {
      await result.current.start(el, () => {});
    });

    // The worklet must connect to a zero-gain node that reaches the destination.
    const sink = worklets[0].connectedTo[0] as FakeGraphNode;
    expect(gains).toContain(sink);
    expect(sink.gain.value).toBe(0);
    expect(sink.connectedTo).toContain(destination);

    result.current.dispose(el);
  });

  it('uses the default output sample rate for the media graph', async () => {
    const { result } = renderHook(() => useLiveTranslationAudioCapture());
    const el = {} as HTMLMediaElement;
    await act(async () => {
      await result.current.start(el, () => {});
    });

    expect(audioContextOptions[0]).toBeUndefined();
    result.current.dispose(el);
  });

  it('reuses createMediaElementSource across start -> stop -> start', async () => {
    const { result } = renderHook(() => useLiveTranslationAudioCapture());
    const el = {} as HTMLMediaElement;
    await act(async () => {
      await result.current.start(el, () => {});
    });
    result.current.stop(el);
    await act(async () => {
      await result.current.start(el, () => {});
    });
    expect(mediaSourceCalls).toBe(1);
    result.current.dispose(el);
  });
});
