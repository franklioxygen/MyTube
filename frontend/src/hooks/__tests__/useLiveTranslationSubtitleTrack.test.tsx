import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveTranslationSubtitleTrack } from '../useLiveTranslationSubtitleTrack';

class FakeVTTCue {
  constructor(
    public startTime: number,
    public endTime: number,
    public text: string,
  ) {}
}

interface FakeTrack {
  mode: string;
  cues: unknown[];
  addCue: (c: unknown) => void;
  removeCue: (c: unknown) => void;
}

function makeFakeVideo(currentTime = 0) {
  const cues: unknown[] = [];
  const track: FakeTrack = {
    mode: 'disabled',
    cues,
    addCue: (c) => cues.push(c),
    removeCue: (c) => {
      const i = cues.indexOf(c);
      if (i >= 0) cues.splice(i, 1);
    },
  };
  const addTextTrack = vi.fn(() => track);
  const listeners: Record<string, Set<EventListener>> = {};
  const el = {
    addTextTrack,
    currentTime,
    addEventListener: (type: string, cb: EventListener) => {
      (listeners[type] ??= new Set()).add(cb);
    },
    removeEventListener: (type: string, cb: EventListener) => {
      listeners[type]?.delete(cb);
    },
  } as unknown as HTMLVideoElement;
  const fire = (type: string) =>
    listeners[type]?.forEach((cb) => cb(new Event(type)));
  return { el, track, addTextTrack, fire };
}

describe('useLiveTranslationSubtitleTrack', () => {
  beforeEach(() => {
    vi.stubGlobal('VTTCue', FakeVTTCue);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates a track on activate and exposes it', () => {
    const { el, track, addTextTrack } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live (English)'),
    );
    act(() => result.current.activate());
    expect(addTextTrack).toHaveBeenCalledWith('subtitles', 'Live (English)', 'en');
    expect(result.current.isActive).toBe(true);
    expect(result.current.track).toBe(track);
    expect(track.mode).toBe('hidden');
  });

  it('adds a VTTCue only for output transcripts', () => {
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'input', text: 'hola' }));
    expect(track.cues).toHaveLength(0);

    act(() => result.current.addCue({ kind: 'output', text: 'hello', mediaTime: 2 }));
    expect(track.cues).toHaveLength(1);
    const cue = track.cues[0] as FakeVTTCue;
    expect(cue.text).toBe('hello');
    expect(cue.startTime).toBe(2);
    expect(cue.endTime).toBe(6);
  });

  it('coalesces deltas of one utterance into a single cue', () => {
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: '好的，', mediaTime: 2 }));
    act(() => result.current.addCue({ kind: 'output', text: '战斗。', mediaTime: 2 }));

    // A short sentence stays on a single caption instead of stacking into two.
    expect(track.cues).toHaveLength(1);
    const cue = track.cues[0] as FakeVTTCue;
    expect(cue.text).toBe('好的，战斗。');
    expect(cue.startTime).toBe(2);
    expect(cue.endTime).toBe(6);
  });

  it('keeps coalescing across a delivery gap without an explicit boundary', () => {
    // A slow delta (network hiccup / slow generation) still belongs to the same
    // turn; only an explicit boundary or a seek splits the caption, never latency.
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'a', mediaTime: 0 }));
    // Arrives late and a little further along the timeline, but within normal
    // playback drift (no seek) and with no turnComplete/interrupt in between.
    act(() => result.current.addCue({ kind: 'output', text: 'b', mediaTime: 1 }));

    expect(track.cues).toHaveLength(1);
    const cue = track.cues[0] as FakeVTTCue;
    expect(cue.text).toBe('ab');
    expect(cue.startTime).toBe(0);
    expect(cue.endTime).toBe(5);
  });

  it('starts a new cue on a seek (the media element seeking event)', () => {
    const { el, track, fire } = makeFakeVideo(10);
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'a' }));

    // Viewer seeks forward: the element fires `seeking`, then the next delta
    // lands far down the timeline.
    act(() => {
      (el as unknown as { currentTime: number }).currentTime = 50;
      fire('seeking');
    });
    act(() => result.current.addCue({ kind: 'output', text: 'b' }));

    expect(track.cues).toHaveLength(2);
    const first = track.cues[0] as FakeVTTCue;
    const second = track.cues[1] as FakeVTTCue;
    expect(first.text).toBe('a');
    expect(first.startTime).toBe(10);
    expect(second.text).toBe('b');
    expect(second.startTime).toBe(50);
    expect(second.endTime).toBe(54);
  });

  it('keeps coalescing across a long playback advance without a seek', () => {
    // A delta delayed past several seconds of playback (no seeking event) still
    // belongs to the same turn and must not be split off as a new caption.
    const { el, track } = makeFakeVideo(10);
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'a' }));

    // currentTime has advanced well beyond any inter-delta media gap, but no
    // seek occurred.
    (el as unknown as { currentTime: number }).currentTime = 20;
    act(() => result.current.addCue({ kind: 'output', text: 'b' }));

    expect(track.cues).toHaveLength(1);
    const cue = track.cues[0] as FakeVTTCue;
    expect(cue.text).toBe('ab');
    expect(cue.startTime).toBe(10);
    expect(cue.endTime).toBe(24);
  });

  it('starts a new cue immediately after endUtterance() (barge-in)', () => {
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: '好的，', mediaTime: 2 }));
    // Hard boundary (barge-in): the in-progress caption is abandoned at once.
    act(() => result.current.endUtterance());
    // The replacement translation arrives at the same media time.
    act(() => result.current.addCue({ kind: 'output', text: '你好', mediaTime: 2 }));

    // The replacement opens a fresh cue instead of coalescing onto the abandoned
    // one, so back-to-back utterances do not merge into one line.
    expect(track.cues).toHaveLength(1);
    const cue = track.cues[0] as FakeVTTCue;
    expect(cue.text).toBe('你好');
    expect(cue.startTime).toBe(2);
  });

  it('coalesces a late transcript delivered after finishTurn (out-of-order)', () => {
    vi.useFakeTimers();
    try {
      const { el, track } = makeFakeVideo();
      const { result } = renderHook(() =>
        useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
      );
      act(() => result.current.addCue({ kind: 'output', text: '好的，战斗', mediaTime: 2 }));
      // turnComplete arrives before the turn's final transcription delta.
      act(() => result.current.finishTurn());
      // The trailing delta of the SAME turn is delivered late (within the drain
      // window) and must join the finishing caption, not seed a new cue.
      act(() => result.current.addCue({ kind: 'output', text: '。', mediaTime: 2 }));

      expect(track.cues).toHaveLength(1);
      expect((track.cues[0] as FakeVTTCue).text).toBe('好的，战斗。');

      // After the drain window, the next turn starts a fresh cue.
      act(() => vi.advanceTimersByTime(400));
      act(() => result.current.addCue({ kind: 'output', text: '你好', mediaTime: 5 }));

      expect(track.cues).toHaveLength(2);
      expect((track.cues[1] as FakeVTTCue).text).toBe('你好');
      expect((track.cues[1] as FakeVTTCue).startTime).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a barge-in cancels a pending finishTurn drain', () => {
    vi.useFakeTimers();
    try {
      const { el, track } = makeFakeVideo();
      const { result } = renderHook(() =>
        useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
      );
      act(() => result.current.addCue({ kind: 'output', text: 'a', mediaTime: 2 }));
      act(() => result.current.finishTurn());
      // Barge-in before the drain elapses: hard reset now, so the next delta is
      // a new cue even though the drain window had not fired.
      act(() => result.current.endUtterance());
      act(() => result.current.addCue({ kind: 'output', text: 'b', mediaTime: 2 }));
      // Late timer firing must not clobber the new caption.
      act(() => vi.advanceTimersByTime(400));
      act(() => result.current.addCue({ kind: 'output', text: 'c', mediaTime: 2 }));

      expect(track.cues).toHaveLength(1);
      expect((track.cues[0] as FakeVTTCue).text).toBe('bc');
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces deltas without mediaTime using current playback time', () => {
    const { el, track } = makeFakeVideo(10);
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'a' }));

    el.currentTime = 11;
    act(() => result.current.addCue({ kind: 'output', text: 'b' }));

    expect(track.cues).toHaveLength(1);
    const cue = track.cues[0] as FakeVTTCue;
    expect(cue.text).toBe('ab');
    expect(cue.startTime).toBe(10);
    expect(cue.endTime).toBe(15);
  });

  it('clears cues and disables the track on deactivate', () => {
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'hello', mediaTime: 0 }));
    expect(track.cues).toHaveLength(1);
    act(() => result.current.deactivate());
    expect(track.cues).toHaveLength(0);
    expect(track.mode).toBe('disabled');
    expect(result.current.isActive).toBe(false);
  });

  it('no-ops when there is no video element', () => {
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(null, 'en', 'Live'),
    );
    act(() => result.current.activate());
    expect(result.current.isActive).toBe(false);
    expect(result.current.track).toBeNull();
  });
});
