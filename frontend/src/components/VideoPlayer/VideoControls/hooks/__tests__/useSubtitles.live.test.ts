import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSubtitles } from '../useSubtitles';

const makeTracks = (count: number) => {
  const tracks: { length: number; [k: number]: { mode: string } } = { length: count };
  for (let i = 0; i < count; i++) tracks[i] = { mode: 'hidden' };
  return tracks;
};
const makeVideoRef = (trackCount: number) => ({
  current: { textTracks: makeTracks(trackCount) } as unknown as HTMLVideoElement,
});

const subtitles2 = [
  { language: 'en', filename: 'en.vtt', path: '/subs/en.vtt' },
  { language: 'fr', filename: 'fr.vtt', path: '/subs/fr.vtt' },
];

describe('useSubtitles — live translation option', () => {
  beforeEach(() => vi.clearAllMocks());

  it('auto-selects the live track when it becomes available and subtitles are enabled', () => {
    const liveTrack = { mode: 'hidden' } as unknown as TextTrack;
    const { result } = renderHook(() =>
      useSubtitles({
        subtitles: subtitles2,
        initialSubtitlesEnabled: true,
        videoRef: makeVideoRef(2),
        liveSubtitle: { available: true, label: 'Live', track: liveTrack },
      }),
    );
    expect(result.current.liveSubtitleAvailable).toBe(true);
    expect(result.current.liveSubtitleSelected).toBe(true);
    expect(liveTrack.mode).toBe('showing');
    expect(result.current.subtitlesEnabled).toBe(true);
  });

  it('does not auto-select the live track when subtitles are globally disabled', () => {
    const liveTrack = { mode: 'hidden' } as unknown as TextTrack;
    const { result } = renderHook(() =>
      useSubtitles({
        subtitles: subtitles2,
        initialSubtitlesEnabled: false,
        videoRef: makeVideoRef(2),
        liveSubtitle: { available: true, label: 'Live', track: liveTrack },
      }),
    );
    expect(result.current.liveSubtitleAvailable).toBe(true);
    expect(result.current.liveSubtitleSelected).toBe(false);
    expect(liveTrack.mode).toBe('hidden');
    expect(result.current.subtitlesEnabled).toBe(false);
  });

  it('toggles the live track on and off', () => {
    const liveTrack = { mode: 'hidden' } as unknown as TextTrack;
    const { result } = renderHook(() =>
      useSubtitles({
        subtitles: subtitles2,
        initialSubtitlesEnabled: false,
        videoRef: makeVideoRef(2),
        liveSubtitle: { available: true, label: 'Live', track: liveTrack },
      }),
    );
    // Not auto-selected because subtitles are globally disabled; select it.
    act(() => result.current.handleSelectLiveSubtitle());
    expect(result.current.liveSubtitleSelected).toBe(true);
    expect(liveTrack.mode).toBe('showing');
    // Deselect it.
    act(() => result.current.handleSelectLiveSubtitle());
    expect(result.current.liveSubtitleSelected).toBe(false);
    expect(liveTrack.mode).toBe('hidden');
  });

  it('"Off" clears both file and live selections', () => {
    const liveTrack = { mode: 'hidden' } as unknown as TextTrack;
    const videoRef = makeVideoRef(2);
    const { result } = renderHook(() =>
      useSubtitles({
        subtitles: subtitles2,
        initialSubtitlesEnabled: true, // file [0] selected
        videoRef,
        liveSubtitle: { available: true, label: 'Live', track: liveTrack },
      }),
    );
    act(() => result.current.handleSelectSubtitle(-1));
    expect(result.current.selectedSubtitleIndices).toEqual([]);
    expect(result.current.liveSubtitleSelected).toBe(false);
    expect(liveTrack.mode).toBe('hidden');
    expect(result.current.subtitlesEnabled).toBe(false);
  });

  it('enforces a maximum of two active tracks across file + live', () => {
    const liveTrack = { mode: 'hidden' } as unknown as TextTrack;
    const { result } = renderHook(() =>
      useSubtitles({
        subtitles: subtitles2,
        initialSubtitlesEnabled: false,
        videoRef: makeVideoRef(2),
        liveSubtitle: { available: true, label: 'Live', track: liveTrack },
      }),
    );
    // Select live manually (1), then one file (2 total).
    act(() => result.current.handleSelectLiveSubtitle());
    act(() => result.current.handleSelectSubtitle(0));
    expect(result.current.selectedSubtitleIndices).toEqual([0]);
    // A second file would exceed the cap → ignored.
    act(() => result.current.handleSelectSubtitle(1));
    expect(result.current.selectedSubtitleIndices).toEqual([0]);
  });

  it('replaces the oldest file subtitle when live is selected while full', () => {
    const liveTrack = { mode: 'hidden' } as unknown as TextTrack;
    const { result, rerender } = renderHook(
      ({ available }: { available: boolean }) =>
        useSubtitles({
          subtitles: subtitles2,
          initialSubtitlesEnabled: true,
          videoRef: makeVideoRef(2),
          liveSubtitle: { available, label: 'Live', track: liveTrack },
        }),
      { initialProps: { available: false } },
    );
    // File 0 is initially selected; select file 1 so the cap is reached.
    act(() => result.current.handleSelectSubtitle(1));
    expect(result.current.selectedSubtitleIndices).toEqual([0, 1]);
    // Live becomes available → replaces the oldest file (index 0).
    rerender({ available: true });
    expect(result.current.liveSubtitleSelected).toBe(true);
    expect(result.current.selectedSubtitleIndices).toEqual([1]);
  });

  it('manually selecting live while full replaces the oldest file subtitle', () => {
    const liveTrack = { mode: 'hidden' } as unknown as TextTrack;
    const { result } = renderHook(() =>
      useSubtitles({
        subtitles: subtitles2,
        initialSubtitlesEnabled: false,
        videoRef: makeVideoRef(2),
        liveSubtitle: { available: true, label: 'Live', track: liveTrack },
      }),
    );
    act(() => result.current.handleSelectSubtitle(0));
    act(() => result.current.handleSelectSubtitle(1));
    expect(result.current.selectedSubtitleIndices).toEqual([0, 1]);

    act(() => result.current.handleSelectLiveSubtitle());

    expect(result.current.liveSubtitleSelected).toBe(true);
    expect(result.current.selectedSubtitleIndices).toEqual([1]);
    expect(liveTrack.mode).toBe('showing');
  });
});
