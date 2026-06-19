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
  const el = { addTextTrack, currentTime } as unknown as HTMLVideoElement;
  return { el, track, addTextTrack };
}

describe('useLiveTranslationSubtitleTrack', () => {
  beforeEach(() => {
    vi.stubGlobal('VTTCue', FakeVTTCue);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('avoids overlapping cues by chaining start times', () => {
    const { el, track } = makeFakeVideo();
    const { result } = renderHook(() =>
      useLiveTranslationSubtitleTrack(el, 'en', 'Live'),
    );
    act(() => result.current.addCue({ kind: 'output', text: 'a', mediaTime: 0 }));
    act(() => result.current.addCue({ kind: 'output', text: 'b', mediaTime: 1 }));
    const second = track.cues[1] as FakeVTTCue;
    // First cue ends at 4, so the second must not start before 4.
    expect(second.startTime).toBe(4);
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
