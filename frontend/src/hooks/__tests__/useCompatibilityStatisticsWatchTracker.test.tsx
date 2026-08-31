import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackStatus } from '../../components/VideoPlayer/CompatibilityPlayer/playbackEngine';

const mocks = vi.hoisted(() => ({
  recordEvent: vi.fn(),
  flushNow: vi.fn(),
  flushKeepalive: vi.fn(),
}));

vi.mock('../useStatisticsIngestion', () => ({
  useStatisticsIngestion: () => ({
    enabled: true,
    recordEvent: mocks.recordEvent,
    flushNow: mocks.flushNow,
    flushKeepalive: mocks.flushKeepalive,
  }),
}));

import { useCompatibilityStatisticsWatchTracker } from '../useCompatibilityStatisticsWatchTracker';

describe('useCompatibilityStatisticsWatchTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('records canvas playback start and qualified watch time', () => {
    const { rerender, unmount } = renderHook(
      ({ status }) =>
        useCompatibilityStatisticsWatchTracker({
          status,
          videoId: 'video-1',
        }),
      { initialProps: { status: 'ready' as PlaybackStatus } }
    );

    rerender({ status: 'playing' });
    act(() => vi.advanceTimersByTime(2_000));
    rerender({ status: 'paused' });

    const events = mocks.recordEvent.mock.calls.map(([event]) => event);
    expect(events.map((event) => event.eventType)).toContain('video_play_started');
    expect(events).toContainEqual(
      expect.objectContaining({
        eventType: 'video_watch_chunk_recorded',
        videoId: 'video-1',
        durationSeconds: 2,
      })
    );
    unmount();
  });

  it('does not mark naturally ended autoplay as abandoned', () => {
    const { rerender, result, unmount } = renderHook(
      ({ status }) =>
        useCompatibilityStatisticsWatchTracker({
          status,
          videoId: 'next-video',
          autoplayFromVideoId: 'current-video',
        }),
      { initialProps: { status: 'ready' as PlaybackStatus } }
    );

    rerender({ status: 'playing' });
    // The engine invokes this before the parent's onEnded callback can
    // synchronously navigate and unmount the player.
    act(() => result.current.onEnded());
    unmount();

    const eventTypes = mocks.recordEvent.mock.calls.map(
      ([event]) => event.eventType
    );
    expect(eventTypes).toContain('video_play_started');
    expect(eventTypes).not.toContain('autoplay_abandoned');
  });
});
