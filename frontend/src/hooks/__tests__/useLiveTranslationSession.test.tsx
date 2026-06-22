import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const ensureCsrfToken = vi.fn().mockResolvedValue(undefined);
vi.mock('../../utils/apiClient', () => ({
  api: { post: (...args: unknown[]) => post(...args) },
  ensureCsrfToken: () => ensureCsrfToken(),
}));
vi.mock('../../utils/apiUrl', () => ({
  getBackendUrl: () => '',
}));

import {
  useLiveTranslationSession,
  LiveTranslationTranscriptEvent,
} from '../useLiveTranslationSession';

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  constructor(public url: string, public protocols?: string | string[]) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({});
  }
  serverOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }
  serverSend(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  parsedSent() {
    return this.sent.map((s) => JSON.parse(s));
  }
  typed(type: string) {
    return this.parsedSent().filter((m) => m.type === type);
  }
}

function createFakeVideo(): HTMLVideoElement {
  const el = new EventTarget() as unknown as HTMLVideoElement & {
    playbackRate: number;
    currentTime: number;
    paused: boolean;
  };
  el.playbackRate = 1;
  el.currentTime = 0;
  el.paused = false;
  return el as HTMLVideoElement;
}

function makeControllers() {
  const capture = {
    isSupported: () => true,
    prime: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  const playback = {
    prime: vi.fn(),
    enqueueBase64: vi.fn(),
    flush: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    close: vi.fn(),
    setVolume: vi.fn(),
  };
  return { capture, playback };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useLiveTranslationSession', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    post.mockReset();
    post.mockResolvedValue({
      data: { ticket: 'ticket-123', wsPath: '/api/live-translation/ws' },
    });
    ensureCsrfToken.mockClear();
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup(onTranscript?: (e: LiveTranslationTranscriptEvent) => void) {
    const videoElement = createFakeVideo();
    const { capture, playback } = makeControllers();
    const hook = renderHook(() =>
      useLiveTranslationSession({
        videoElement,
        videoId: 'video-1',
        onTranscript,
        captureController: capture,
        playbackController: playback as any,
      }),
    );
    return { hook, videoElement, capture, playback };
  }

  async function startAndOpen(s: ReturnType<typeof setup>) {
    act(() => s.hook.result.current.start());
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];
    await act(async () => {
      ws.serverOpen();
    });
    // Gemini reports readiness — this is when capture actually starts.
    await act(async () => {
      ws.serverSend({ type: 'status', status: 'translating' });
    });
    return ws;
  }

  it('mints a ticket and opens a WebSocket with the ticket subprotocol', async () => {
    const s = setup();
    const ws = await startAndOpen(s);
    expect(ensureCsrfToken).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/live-translation/sessions', { videoId: 'video-1' });
    expect(ws.url).not.toContain('ticket=ticket-123');
    expect(ws.protocols).toEqual(['ticket', 'ticket-123']);
    expect(ws.url.startsWith('ws')).toBe(true);
  });

  it('does not open a WebSocket when stopped while CSRF is pending', async () => {
    const csrf = deferred<void>();
    ensureCsrfToken.mockReturnValueOnce(csrf.promise);
    const s = setup();

    act(() => s.hook.result.current.start());
    expect(s.hook.result.current.status).toBe('connecting');

    act(() => s.hook.result.current.stop());
    await act(async () => {
      csrf.resolve();
      await csrf.promise;
    });

    expect(post).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(s.hook.result.current.status).toBe('idle');
  });

  it('does not open a WebSocket when stopped while ticket minting is pending', async () => {
    const ticketMint = deferred<{ data: { ticket: string; wsPath: string } }>();
    post.mockReturnValueOnce(ticketMint.promise);
    const s = setup();

    act(() => s.hook.result.current.start());
    await waitFor(() => expect(post).toHaveBeenCalledWith('/live-translation/sessions', { videoId: 'video-1' }));

    act(() => s.hook.result.current.stop());
    await act(async () => {
      ticketMint.resolve({
        data: { ticket: 'ticket-after-stop', wsPath: '/api/live-translation/ws' },
      });
      await ticketMint.promise;
    });

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(s.hook.result.current.status).toBe('idle');
  });

  it('primes audio synchronously and sends start on open, but defers capture until Gemini is ready', async () => {
    const s = setup();
    // prime happens synchronously inside the click handler (before any await).
    act(() => s.hook.result.current.start());
    expect(s.capture.prime).toHaveBeenCalledWith(s.videoElement);
    expect(s.playback.prime).toHaveBeenCalled();

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0];
    await act(async () => ws.serverOpen());

    // start is sent, but capture must NOT start yet (original audio stays
    // audible) and the status stays 'connecting'.
    expect(ws.typed('start')).toHaveLength(1);
    expect(s.capture.start).not.toHaveBeenCalled();
    expect(s.hook.result.current.status).toBe('connecting');

    // Server signals Gemini is ready -> capture starts, status -> translating.
    await act(async () => ws.serverSend({ type: 'status', status: 'translating' }));
    expect(s.capture.start).toHaveBeenCalledWith(s.videoElement, expect.any(Function));
    expect(s.hook.result.current.status).toBe('translating');
  });

  it('drops translated audio that arrives while paused', async () => {
    const s = setup();
    const ws = await startAndOpen(s);

    await act(async () => {
      (s.videoElement as unknown as { paused: boolean }).paused = true;
      s.videoElement.dispatchEvent(new Event('pause'));
    });
    // The queue is flushed on pause.
    expect(s.playback.flush).toHaveBeenCalled();
    s.playback.enqueueBase64.mockClear();

    // Audio arriving while paused is ignored (not queued).
    await act(async () => {
      ws.serverSend({ type: 'audio', seq: 1, sampleRate: 24000, channels: 1, pcm16Base64: 'QUJD' });
    });
    expect(s.playback.enqueueBase64).not.toHaveBeenCalled();

    // After resume, audio is enqueued again.
    await act(async () => {
      (s.videoElement as unknown as { paused: boolean }).paused = false;
      s.videoElement.dispatchEvent(new Event('play'));
    });
    await act(async () => {
      ws.serverSend({ type: 'audio', seq: 2, sampleRate: 24000, channels: 1, pcm16Base64: 'QUJD' });
    });
    expect(s.playback.enqueueBase64).toHaveBeenCalledWith('QUJD');
  });

  it('sends initial pause when starting from a paused video', async () => {
    const s = setup();
    (s.videoElement as unknown as { paused: boolean }).paused = true;

    const ws = await startAndOpen(s);

    expect(ws.typed('start')).toHaveLength(1);
    expect(ws.typed('pause')).toHaveLength(1);
    expect(s.playback.pause).toHaveBeenCalled();
    expect(s.hook.result.current.status).toBe('paused');
  });

  it('stops capture again when capture startup finishes after Stop', async () => {
    const captureStart = deferred<void>();
    const s = setup();
    s.capture.start.mockReturnValueOnce(captureStart.promise);

    const ws = await startAndOpen(s);
    expect(ws.typed('start')).toHaveLength(1);

    act(() => s.hook.result.current.stop());
    expect(s.capture.stop).toHaveBeenCalledWith(s.videoElement);

    await act(async () => {
      captureStart.resolve();
      await captureStart.promise;
    });

    expect(s.capture.stop).toHaveBeenCalledTimes(2);
    expect(s.hook.result.current.status).toBe('idle');
    expect(s.hook.result.current.errorCode).toBeNull();
  });

  it('does not let stale capture startup stop a restarted session', async () => {
    const firstCaptureStart = deferred<void>();
    const s = setup();
    s.capture.start
      .mockReturnValueOnce(firstCaptureStart.promise)
      .mockResolvedValueOnce(undefined);

    await startAndOpen(s);
    act(() => s.hook.result.current.stop());
    expect(s.capture.stop).toHaveBeenCalledTimes(1);

    act(() => s.hook.result.current.start());
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    const ws2 = MockWebSocket.instances[1];
    await act(async () => {
      ws2.serverOpen();
      ws2.serverSend({ type: 'status', status: 'translating' });
    });
    expect(s.capture.start).toHaveBeenCalledTimes(2);

    await act(async () => {
      firstCaptureStart.resolve();
      await firstCaptureStart.promise;
    });

    expect(s.capture.stop).toHaveBeenCalledTimes(1);
    expect(s.hook.result.current.status).toBe('translating');
  });

  it('ignores capture startup failures after Stop', async () => {
    const captureStart = deferred<void>();
    const s = setup();
    s.capture.start.mockReturnValueOnce(captureStart.promise);

    await startAndOpen(s);
    act(() => s.hook.result.current.stop());

    await act(async () => {
      captureStart.reject(new Error('worklet failed after stop'));
      await captureStart.promise.catch(() => undefined);
    });

    expect(s.hook.result.current.status).toBe('idle');
    expect(s.hook.result.current.errorCode).toBeNull();
  });

  it('enqueues translated audio and forwards transcripts', async () => {
    const onTranscript = vi.fn();
    const s = setup(onTranscript);
    const ws = await startAndOpen(s);

    await act(async () => {
      ws.serverSend({ type: 'audio', seq: 1, sampleRate: 24000, channels: 1, pcm16Base64: 'QUJD' });
      ws.serverSend({ type: 'outputTranscript', text: 'hello', languageCode: 'en' });
    });

    expect(s.playback.enqueueBase64).toHaveBeenCalledWith('QUJD');
    expect(onTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'output', text: 'hello' }),
    );
  });

  it('flushes queued translated audio on a server interruption', async () => {
    const s = setup();
    const ws = await startAndOpen(s);
    s.playback.flush.mockClear();

    await act(async () => {
      ws.serverSend({ type: 'interrupted' });
    });

    expect(s.playback.flush).toHaveBeenCalled();
  });

  it('sends pause/resume/seek from media element events', async () => {
    const s = setup();
    const ws = await startAndOpen(s);

    await act(async () => {
      s.videoElement.dispatchEvent(new Event('pause'));
    });
    expect(ws.typed('pause')).toHaveLength(1);
    expect(s.playback.pause).toHaveBeenCalled();

    await act(async () => {
      s.videoElement.dispatchEvent(new Event('play'));
    });
    expect(ws.typed('resume')).toHaveLength(1);

    await act(async () => {
      s.videoElement.dispatchEvent(new Event('seeking'));
    });
    expect(ws.typed('seek')).toHaveLength(1);
    expect(s.playback.flush).toHaveBeenCalled();
  });

  it('stops the session and cleans up', async () => {
    const s = setup();
    const ws = await startAndOpen(s);
    act(() => s.hook.result.current.stop());
    expect(ws.typed('stop')).toHaveLength(1);
    expect(s.capture.stop).toHaveBeenCalledWith(s.videoElement);
    expect(s.playback.close).toHaveBeenCalled();
    expect(s.hook.result.current.status).toBe('idle');
  });

  it('refuses to start at non-1x playback rate', () => {
    const s = setup();
    (s.videoElement as unknown as { playbackRate: number }).playbackRate = 1.5;
    act(() => s.hook.result.current.start());
    expect(s.hook.result.current.status).toBe('error');
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('surfaces audio capture failure when synchronous priming throws', () => {
    const s = setup();
    s.capture.prime.mockImplementationOnce(() => {
      throw new Error('audio graph failed');
    });

    act(() => s.hook.result.current.start());

    expect(s.hook.result.current.status).toBe('error');
    expect(s.hook.result.current.errorCode).toBe('audio_capture_failed');
    expect(post).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('stops live translation if playback rate changes while active', async () => {
    const s = setup();
    const ws = await startAndOpen(s);

    await act(async () => {
      (s.videoElement as unknown as { playbackRate: number }).playbackRate = 1.25;
      s.videoElement.dispatchEvent(new Event('ratechange'));
    });

    expect(ws.typed('stop')).toHaveLength(1);
    expect(s.capture.stop).toHaveBeenCalledWith(s.videoElement);
    expect(s.playback.close).toHaveBeenCalled();
    expect(s.hook.result.current.status).toBe('error');
    expect(s.hook.result.current.errorCode).toBe('unsupported_playback_rate');
  });

  it('surfaces a server error message', async () => {
    const s = setup();
    const ws = await startAndOpen(s);
    await act(async () => {
      ws.serverSend({
        type: 'error',
        code: 'gemini_rate_limited',
        message: 'Slow down',
        retryable: true,
      });
    });
    expect(s.hook.result.current.status).toBe('error');
    expect(s.hook.result.current.errorCode).toBe('gemini_rate_limited');
    expect(s.hook.result.current.retryable).toBe(true);
  });

  it('disposes the capture graph on unmount', async () => {
    const s = setup();
    await startAndOpen(s);
    act(() => s.hook.unmount());
    expect(s.capture.dispose).toHaveBeenCalledWith(s.videoElement);
  });
});
