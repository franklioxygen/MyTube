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
let addModuleImpl: () => Promise<void>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
  audioWorklet = { addModule: () => addModuleImpl() };
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
    addModuleImpl = () => Promise.resolve();
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

  it('mutes speaker gain by default and keeps it audible in subtitle-only mode', async () => {
    const { result } = renderHook(() => useLiveTranslationAudioCapture());
    const el = {} as HTMLMediaElement;

    await act(async () => {
      await result.current.start(el, () => {});
    });
    expect(gains[0].gain.value).toBe(0);

    result.current.stop(el);
    expect(gains[0].gain.value).toBe(1);

    await act(async () => {
      await result.current.start(el, () => {}, { keepOriginalAudioAudible: true });
    });
    expect(gains[0].gain.value).toBe(1);

    result.current.stop(el);
    expect(gains[0].gain.value).toBe(1);
    result.current.dispose(el);
  });

  it('does not let a superseded async start apply a stale speaker gain', async () => {
    const firstModule = deferred<void>();
    const secondModule = deferred<void>();
    addModuleImpl = vi
      .fn()
      .mockReturnValueOnce(firstModule.promise)
      .mockReturnValueOnce(secondModule.promise);
    const { result } = renderHook(() => useLiveTranslationAudioCapture());
    const el = {} as HTMLMediaElement;

    const firstStart = result.current.start(el, () => {}, { keepOriginalAudioAudible: false });
    await act(async () => {
      await Promise.resolve();
    });
    const secondStart = result.current.start(el, () => {}, { keepOriginalAudioAudible: true });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      secondModule.resolve();
      await secondStart;
    });
    expect(gains[0].gain.value).toBe(1);

    await act(async () => {
      firstModule.resolve();
      await firstStart;
    });
    expect(gains[0].gain.value).toBe(1);
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

  it('does not let a superseded async start replace the newer chunk handler', async () => {
    const firstModule = deferred<void>();
    const secondModule = deferred<void>();
    addModuleImpl = vi
      .fn()
      .mockReturnValueOnce(firstModule.promise)
      .mockReturnValueOnce(secondModule.promise);
    const onOldChunk = vi.fn();
    const onNewChunk = vi.fn();
    const { result } = renderHook(() => useLiveTranslationAudioCapture());
    const el = {} as HTMLMediaElement;

    const firstStart = result.current.start(el, onOldChunk);
    await act(async () => {
      await Promise.resolve();
    });
    const secondStart = result.current.start(el, onNewChunk);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      secondModule.resolve();
      await secondStart;
    });
    await act(async () => {
      firstModule.resolve();
      await firstStart;
    });

    worklets[0].port.onmessage?.({
      data: new Int16Array([1]).buffer,
    } as MessageEvent);

    expect(onOldChunk).not.toHaveBeenCalled();
    expect(onNewChunk).toHaveBeenCalledTimes(1);
    result.current.dispose(el);
  });
});
