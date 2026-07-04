import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { useStatisticsWatchTracker } from '../useStatisticsWatchTracker';

const createVideoRef = (): React.RefObject<HTMLVideoElement | null> => ({
  current: document.createElement('video'),
});

describe('useStatisticsWatchTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not mark a naturally ended short autoplay as abandoned', () => {
    const videoRef = createVideoRef();
    const { unmount } = renderHook(() =>
      useStatisticsWatchTracker({
        videoRef,
        videoId: 'next-video',
        autoplayFromVideoId: 'current-video',
      })
    );

    act(() => {
      videoRef.current?.dispatchEvent(new Event('play'));
      videoRef.current?.dispatchEvent(new Event('ended'));
    });

    unmount();

    const eventTypes = mocks.recordEvent.mock.calls.map(([event]) => event.eventType);
    expect(eventTypes).toContain('video_play_started');
    expect(eventTypes).not.toContain('autoplay_abandoned');
  });
});
