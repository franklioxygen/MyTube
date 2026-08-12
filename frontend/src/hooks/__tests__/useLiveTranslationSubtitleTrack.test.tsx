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

  it('starts a new cue after a completed sentence, replacing the old caption', () => {
    // Continuous speech may never produce a turnComplete, so the sentence itself
    // is the caption boundary: the finished sentence must not keep growing.
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: '好的，', mediaTime: 2 }));
    act(() => result.current.addCue({ kind: 'output', text: '战斗。', mediaTime: 2 }));
    act(() => result.current.addCue({ kind: 'output', text: '继续', mediaTime: 4 }));
    act(() => result.current.addCue({ kind: 'output', text: '前进。', mediaTime: 4 }));

    expect(track.cues).toHaveLength(2);
    const first = track.cues[0] as FakeVTTCue;
    const second = track.cues[1] as FakeVTTCue;
    expect(first.text).toBe('好的，战斗。');
    // The finished sentence leaves the screen when its successor starts.
    expect(first.endTime).toBe(4);
    expect(second.text).toBe('继续前进。');
    expect(second.startTime).toBe(4);
  });

  it('forces a new cue when the caption would overflow two lines', () => {
    // A run-on translation without punctuation must not grow into a wall of
    // text; ~84 columns (two 42-column lines) caps a single caption.
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'a'.repeat(60), mediaTime: 2 }));
    act(() => result.current.addCue({ kind: 'output', text: 'b'.repeat(20), mediaTime: 3 }));
    // 80 columns so far — still one caption.
    expect(track.cues).toHaveLength(1);

    act(() => result.current.addCue({ kind: 'output', text: 'c'.repeat(10), mediaTime: 4 }));

    // Appending would exceed the cap: the overflow starts a fresh caption.
    expect(track.cues).toHaveLength(2);
    const first = track.cues[0] as FakeVTTCue;
    const second = track.cues[1] as FakeVTTCue;
    expect(first.text).toBe('a'.repeat(60) + 'b'.repeat(20));
    // The completed caption keeps enough time to be read (80 columns from its
    // start at 2), rather than being cut off at the overflowing delta's time.
    expect(first.endTime).toBe(6);
    expect(second.text).toBe('c'.repeat(10));
    expect(second.startTime).toBe(6);
  });

  it('splits a single oversized delta instead of one wall-of-text caption', () => {
    // Gemini is not guaranteed to emit short chunks, so the cap must apply to
    // the incoming delta itself, not only to accumulated text.
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'a'.repeat(200), mediaTime: 0 }));

    expect(track.cues.length).toBeGreaterThan(1);
    const cues = track.cues as FakeVTTCue[];
    // No piece exceeds the cap, and nothing is lost.
    for (const cue of cues) {
      expect(cue.text.length).toBeLessThanOrEqual(84);
    }
    expect(cues.map((c) => c.text).join('')).toBe('a'.repeat(200));
    // Pieces play in sequence rather than stacking on screen.
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startTime).toBeGreaterThan(cues[i - 1].startTime);
      expect(cues[i - 1].endTime).toBeLessThanOrEqual(cues[i].startTime);
    }
  });

  it('keeps split pieces when a later delta arrives at the same media time', () => {
    // Split pieces are scheduled ahead of playback. A following delta (likely,
    // since the pieces span seconds) must not purge them — it queues after.
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'a'.repeat(200), mediaTime: 0 }));
    const splitCount = track.cues.length;
    expect(splitCount).toBeGreaterThan(1);

    // Same media time as the oversized delta, before the queued pieces play out.
    act(() => result.current.addCue({ kind: 'output', text: 'next', mediaTime: 0 }));

    const cues = track.cues as FakeVTTCue[];
    // Every piece survives and the whole translation is still on the track.
    expect(cues).toHaveLength(splitCount + 1);
    expect(
      cues
        .filter((c) => c.text.startsWith('a'))
        .map((c) => c.text)
        .join(''),
    ).toBe('a'.repeat(200));
    // The new caption is queued after the pieces rather than on top of them.
    const added = cues[cues.length - 1];
    expect(added.text).toBe('next');
    expect(added.startTime).toBeGreaterThanOrEqual(
      Math.max(...cues.slice(0, splitCount).map((c) => c.endTime)),
    );
  });

  it('keeps split pieces across several follow-up deltas before the queue plays', () => {
    // The first follow-up is placed at the watermark, i.e. itself ahead of
    // playback. A second delta still arriving at an earlier media time must be
    // lifted to that anchor and coalesce, not open a caption behind it and purge
    // both the follow-up and the queued pieces.
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'a'.repeat(200), mediaTime: 0 }));
    const splitCount = track.cues.length;

    act(() => result.current.addCue({ kind: 'output', text: 'one', mediaTime: 0 }));
    // Playback has not reached the queued interval yet.
    act(() => result.current.addCue({ kind: 'output', text: 'two', mediaTime: 0.2 }));

    const cues = track.cues as FakeVTTCue[];
    // Every split piece survives, with the whole translation still on the track.
    const pieces = cues.filter((c) => c.text.startsWith('a'));
    expect(pieces).toHaveLength(splitCount);
    expect(pieces.map((c) => c.text).join('')).toBe('a'.repeat(200));
    // The two follow-ups coalesced into the single caption after the queue.
    expect(cues).toHaveLength(splitCount + 1);
    const tail = cues[cues.length - 1];
    expect(tail.text).toBe('onetwo');
    expect(tail.startTime).toBeGreaterThanOrEqual(
      Math.max(...pieces.map((c) => c.endTime)),
    );
  });

  it('keeps a completed caption readable when the next turn follows at once', () => {
    // Same guarantee the sentence/overflow boundaries make, but reached through
    // the soft turn boundary: an adjacent turn must not flash the finished cue.
    vi.useFakeTimers();
    try {
      const { el, track } = makeFakeVideo();
      const { result } = renderHook(() =>
        useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
      );
      act(() => result.current.addCue({ kind: 'output', text: 'Hello.', mediaTime: 0 }));
      act(() => result.current.finishTurn());
      act(() => vi.advanceTimersByTime(400));
      // The next turn speaks well before the caption has been readable.
      act(() => result.current.addCue({ kind: 'output', text: 'World', mediaTime: 0.5 }));

      const cues = track.cues as FakeVTTCue[];
      expect(cues).toHaveLength(2);
      const [first, second] = cues;
      expect(first.text).toBe('Hello.');
      expect(first.endTime - first.startTime).toBeGreaterThanOrEqual(1.2);
      expect(second.text).toBe('World');
      expect(second.startTime).toBeGreaterThanOrEqual(first.endTime);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes a soft-closed future caption on a later barge-in', () => {
    // The drain closes an unplayed caption without a replacement arriving, so
    // the barge-in must still be able to find and remove it.
    vi.useFakeTimers();
    try {
      const { el, track } = makeFakeVideo();
      const { result } = renderHook(() =>
        useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
      );
      act(() => result.current.addCue({ kind: 'output', text: 'a'.repeat(120), mediaTime: 0 }));
      act(() => result.current.addCue({ kind: 'output', text: 'pending', mediaTime: 0 }));
      expect((track.cues as FakeVTTCue[]).map((c) => c.text)).toContain('pending');

      act(() => result.current.finishTurn());
      act(() => vi.advanceTimersByTime(400));
      act(() => result.current.endUtterance());

      // Neither the split pieces nor the soft-closed caption are left behind.
      expect(track.cues).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps queued split pieces across a turnComplete drain', () => {
    // Split cues span seconds — far longer than the 400ms drain — so the soft
    // turn reset must close accumulation without discarding the queue.
    vi.useFakeTimers();
    try {
      const { el, track } = makeFakeVideo();
      const { result } = renderHook(() =>
        useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
      );
      act(() => result.current.addCue({ kind: 'output', text: 'a'.repeat(200), mediaTime: 0 }));
      const splitCount = track.cues.length;

      act(() => result.current.finishTurn());
      act(() => vi.advanceTimersByTime(400));
      // The next turn speaks while the queued pieces are still to play.
      act(() => result.current.addCue({ kind: 'output', text: 'next', mediaTime: 0.5 }));

      const cues = track.cues as FakeVTTCue[];
      const pieces = cues.filter((c) => c.text.startsWith('a'));
      expect(pieces).toHaveLength(splitCount);
      expect(pieces.map((c) => c.text).join('')).toBe('a'.repeat(200));
      const tail = cues[cues.length - 1];
      expect(tail.text).toBe('next');
      expect(tail.startTime).toBeGreaterThanOrEqual(
        Math.max(...pieces.map((c) => c.endTime)),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an unplayed follow-up caption across a turnComplete drain', () => {
    // split -> follow-up (anchored at the watermark, so itself unplayed) ->
    // turnComplete. Closing accumulation must carry that caption's end into the
    // watermark, or the next turn anchors on its start and deletes it.
    vi.useFakeTimers();
    try {
      const { el, track } = makeFakeVideo();
      const { result } = renderHook(() =>
        useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
      );
      // Sized so the queue plus the follow-up stays inside the queue-ahead cap;
      // beyond it the backlog is deliberately shed instead (covered separately).
      act(() => result.current.addCue({ kind: 'output', text: 'a'.repeat(120), mediaTime: 0 }));
      const splitCount = track.cues.length;
      act(() => result.current.addCue({ kind: 'output', text: 'pending', mediaTime: 0 }));

      act(() => result.current.finishTurn());
      act(() => vi.advanceTimersByTime(400));
      // The next turn speaks while both the pieces and the follow-up are pending.
      act(() => result.current.addCue({ kind: 'output', text: 'nextturn', mediaTime: 0.5 }));

      const cues = track.cues as FakeVTTCue[];
      const texts = cues.map((c) => c.text);
      // Split pieces, the unplayed follow-up, and the new turn all survive.
      expect(cues.filter((c) => c.text.startsWith('a'))).toHaveLength(splitCount);
      expect(texts).toContain('pending');
      expect(texts).toContain('nextturn');

      const pending = cues.find((c) => c.text === 'pending') as FakeVTTCue;
      const next = cues.find((c) => c.text === 'nextturn') as FakeVTTCue;
      expect(next.startTime).toBeGreaterThanOrEqual(pending.endTime);
    } finally {
      vi.useRealTimers();
    }
  });

  it('queues a same-anchor successor instead of deleting an unplayed caption', () => {
    // Follow-ups after a split share one future anchor. When one completes a
    // sentence, the successor must be scheduled after that unplayed caption
    // rather than replacing it — its text has not been on screen yet.
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'a'.repeat(200), mediaTime: 0 }));
    const splitCount = track.cues.length;

    act(() => result.current.addCue({ kind: 'output', text: 'first.', mediaTime: 0 }));
    // Sentence already complete, so this opens a successor at the same anchor.
    act(() => result.current.addCue({ kind: 'output', text: 'second', mediaTime: 0 }));

    const cues = track.cues as FakeVTTCue[];
    const texts = cues.map((c) => c.text);
    // Neither the queued pieces nor the unplayed caption were dropped.
    expect(texts).toContain('first.');
    expect(texts).toContain('second');
    expect(cues.filter((c) => c.text.startsWith('a'))).toHaveLength(splitCount);

    const firstCue = cues.find((c) => c.text === 'first.') as FakeVTTCue;
    const secondCue = cues.find((c) => c.text === 'second') as FakeVTTCue;
    expect(secondCue.startTime).toBeGreaterThanOrEqual(firstCue.endTime);
  });

  it('gives each split piece readable screen time and bounds the queue', () => {
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    // A very large chunk must not be flashed piece by piece.
    act(() => result.current.addCue({ kind: 'output', text: 'a'.repeat(1000), mediaTime: 0 }));

    const cues = track.cues as FakeVTTCue[];
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      expect(cue.endTime - cue.startTime).toBeGreaterThanOrEqual(1.2);
    }
    // ...and the queue stays close enough to playback to remain useful.
    const queueEnd = Math.max(...cues.map((c) => c.endTime));
    expect(queueEnd).toBeLessThanOrEqual(12 + 4);
  });

  it('removes queued split cues at a hard boundary', () => {
    // Abandoned translation must not surface later — e.g. on a seek into the
    // interval those cues were scheduled for.
    const { el, track, fire } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'a'.repeat(200), mediaTime: 0 }));
    expect(track.cues.length).toBeGreaterThan(1);

    act(() => fire('seeking'));
    expect(track.cues).toHaveLength(0);

    // The same holds for a barge-in.
    act(() => result.current.addCue({ kind: 'output', text: 'b'.repeat(200), mediaTime: 0 }));
    expect(track.cues.length).toBeGreaterThan(1);
    act(() => result.current.endUtterance());
    expect(track.cues).toHaveLength(0);
  });

  it('sheds the backlog so latency cannot grow across later turns', () => {
    vi.useFakeTimers();
    try {
      const { el, track } = makeFakeVideo();
      const { result } = renderHook(() =>
        useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
      );
      // One oversized delta establishes a queue...
      act(() => result.current.addCue({ kind: 'output', text: 'a'.repeat(1000), mediaTime: 0 }));

      // ...then turns keep arriving faster than the queue drains. Each is
      // anchored at the watermark and pushes it on, so without a global cap the
      // anchor would run away from playback.
      let mediaTime = 0;
      for (let turn = 0; turn < 10; turn++) {
        mediaTime += 1;
        const at = mediaTime;
        act(() => result.current.addCue({ kind: 'output', text: `t${turn}`, mediaTime: at }));
        act(() => result.current.finishTurn());
        act(() => vi.advanceTimersByTime(400));
      }

      const cues = track.cues as FakeVTTCue[];
      const last = cues[cues.length - 1];
      // The newest caption stays within the bound of the media time it describes.
      expect(last.startTime - mediaTime).toBeLessThanOrEqual(12);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes a completed caption displaced by a boundary on a backward seek', () => {
    // A cue displaced by a sentence boundary is referenced by neither the
    // accumulator nor the queue, so only sweeping the track catches it.
    const { el, track, fire } = makeFakeVideo(10);
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'One.', mediaTime: 10 }));
    // Sentence already complete: this displaces the first cue and becomes active.
    act(() => result.current.addCue({ kind: 'output', text: 'Two', mediaTime: 10.1 }));
    expect(track.cues).toHaveLength(2);

    act(() => {
      (el as unknown as { currentTime: number }).currentTime = 2;
      fire('seeking');
    });

    // Neither the displaced caption nor the active one can replay later.
    expect(track.cues).toHaveLength(0);
  });

  it('removes a stale in-progress caption on a backward seek', () => {
    // The caption is anchored to the old position: after seeking back it is in
    // the future again and would replay pre-seek translation.
    const { el, track, fire } = makeFakeVideo(10);
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'stale', mediaTime: 10 }));
    expect(track.cues).toHaveLength(1);

    act(() => {
      (el as unknown as { currentTime: number }).currentTime = 2;
      fire('seeking');
    });

    expect(track.cues).toHaveLength(0);
  });

  it('removes a displaced future caption at a hard boundary', () => {
    // split -> future follow-up -> caption boundary displaces it -> hard reset.
    // The displaced cue is no longer the active one, so it must have been
    // registered as queued or it would stay on the track and play by itself.
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'a'.repeat(200), mediaTime: 0 }));
    act(() => result.current.addCue({ kind: 'output', text: 'first.', mediaTime: 0 }));
    // Sentence already complete, so this displaces 'first.' rather than replacing it.
    act(() => result.current.addCue({ kind: 'output', text: 'second', mediaTime: 0 }));
    expect((track.cues as FakeVTTCue[]).map((c) => c.text)).toContain('first.');

    act(() => result.current.endUtterance());

    // Nothing abandoned is left behind to appear later.
    expect(track.cues).toHaveLength(0);
  });

  it('keeps a completed sentence readable when the next delta follows at once', () => {
    // Output transcripts carry no mediaTime, so a burst anchors every delta at
    // nearly the same currentTime. The finished sentence must not be deleted or
    // truncated to milliseconds by the delta right behind it.
    const { el, track } = makeFakeVideo(5);
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'Hello.' }));
    act(() => result.current.addCue({ kind: 'output', text: 'World' }));

    const cues = track.cues as FakeVTTCue[];
    expect(cues).toHaveLength(2);
    const [first, second] = cues;
    expect(first.text).toBe('Hello.');
    expect(first.endTime - first.startTime).toBeGreaterThanOrEqual(1.2);
    expect(second.text).toBe('World');
    expect(second.startTime).toBeGreaterThanOrEqual(first.endTime);
  });

  it('caps a second oversized delta against the transcript media time', () => {
    // A queue already near the cap must not permit another full window on top.
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'a'.repeat(1000), mediaTime: 0 }));
    act(() => result.current.addCue({ kind: 'output', text: 'b'.repeat(1000), mediaTime: 0.1 }));

    const cues = track.cues as FakeVTTCue[];
    const queueEnd = Math.max(...cues.map((c) => c.endTime));
    // Bounded by the cap plus a single caption, measured from the media time —
    // not two stacked windows.
    expect(queueEnd - 0.1).toBeLessThanOrEqual(12 + 4);
  });

  it('breaks an oversized delta at word boundaries for spaced text', () => {
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    const words = 'lorem ipsum dolor sit amet '.repeat(6).trim();
    act(() => result.current.addCue({ kind: 'output', text: words, mediaTime: 0 }));

    const cues = track.cues as FakeVTTCue[];
    expect(cues.length).toBeGreaterThan(1);
    // Every piece is whole words — no word is cut in half.
    for (const cue of cues) {
      expect(words.split(' ')).toEqual(expect.arrayContaining(cue.text.split(' ')));
    }
    expect(cues.map((c) => c.text).join(' ')).toBe(words);
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

  it('drains multiple late chunks onto the completed turn, then seals', () => {
    vi.useFakeTimers();
    try {
      const { el, track } = makeFakeVideo();
      const { result } = renderHook(() =>
        useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
      );
      act(() => result.current.addCue({ kind: 'output', text: '早上', mediaTime: 2 }));
      act(() => result.current.finishTurn());
      // Several trailing chunks of the SAME turn arrive out of order after
      // turnComplete; every one must coalesce onto the finishing caption.
      act(() => result.current.addCue({ kind: 'output', text: '好', mediaTime: 2 }));
      act(() => result.current.addCue({ kind: 'output', text: '。', mediaTime: 2 }));

      expect(track.cues).toHaveLength(1);
      expect((track.cues[0] as FakeVTTCue).text).toBe('早上好。');

      // After the burst goes quiet for a full window, the next turn is fresh.
      act(() => vi.advanceTimersByTime(400));
      act(() => result.current.addCue({ kind: 'output', text: '晚', mediaTime: 6 }));

      expect(track.cues).toHaveLength(2);
      expect((track.cues[1] as FakeVTTCue).text).toBe('晚');
      expect((track.cues[1] as FakeVTTCue).startTime).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the drain window fixed, not extended by late chunks', () => {
    vi.useFakeTimers();
    try {
      const { el, track } = makeFakeVideo();
      const { result } = renderHook(() =>
        useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
      );
      act(() => result.current.addCue({ kind: 'output', text: 'a', mediaTime: 2 }));
      act(() => result.current.finishTurn());
      // A trailing chunk within the window coalesces...
      act(() => vi.advanceTimersByTime(300));
      act(() => result.current.addCue({ kind: 'output', text: 'b', mediaTime: 2 }));
      expect(track.cues).toHaveLength(1);
      expect((track.cues[0] as FakeVTTCue).text).toBe('ab');

      // ...but the window is measured from turnComplete and is NOT extended by
      // that chunk, so it elapses 400ms after the boundary and content beyond it
      // (a promptly-started next turn) opens its own cue instead of extending
      // the completed caption indefinitely.
      act(() => vi.advanceTimersByTime(300));
      act(() => result.current.addCue({ kind: 'output', text: 'c', mediaTime: 6 }));

      expect(track.cues).toHaveLength(2);
      expect((track.cues[0] as FakeVTTCue).text).toBe('ab');
      expect((track.cues[1] as FakeVTTCue).text).toBe('c');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains the boundary when finishTurn precedes the first transcript', () => {
    vi.useFakeTimers();
    try {
      const { el, track } = makeFakeVideo();
      const { result } = renderHook(() =>
        useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
      );
      // The track is created when the session goes active, before any transcript.
      act(() => result.current.activate());
      // turnComplete for a short turn arrives before any output delta.
      act(() => result.current.finishTurn());
      // That turn's only (late) delta then opens its caption within the window.
      act(() => result.current.addCue({ kind: 'output', text: 'a', mediaTime: 2 }));
      // Drain elapses, so the boundary is preserved across the empty-cue case.
      act(() => vi.advanceTimersByTime(400));
      // The next turn must NOT be concatenated onto the finished turn's caption.
      act(() => result.current.addCue({ kind: 'output', text: 'b', mediaTime: 5 }));

      expect(track.cues).toHaveLength(2);
      expect((track.cues[0] as FakeVTTCue).text).toBe('a');
      expect((track.cues[1] as FakeVTTCue).text).toBe('b');
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
