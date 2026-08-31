import { useCallback, useEffect, useRef } from 'react';
import type { PlaybackStatus } from '../components/VideoPlayer/CompatibilityPlayer/playbackEngine';
import { useStatisticsIngestion } from './useStatisticsIngestion';

const CHUNK_SECONDS = 60;
const TICK_MS = 1_000;

interface Options {
  status: PlaybackStatus;
  videoId: string | null;
  platform?: string | null;
  relatedEventId?: string | null;
  autoplayFromVideoId?: string | null;
}

/** Statistics instrumentation for the canvas/WebCodecs playback path. */
export function useCompatibilityStatisticsWatchTracker(
  options: Options
): { onEnded: () => void } {
  const { status, videoId, platform, relatedEventId, autoplayFromVideoId } = options;
  const { enabled, recordEvent, flushNow, flushKeepalive } =
    useStatisticsIngestion();

  const statusRef = useRef(status);
  const accumulatedRef = useRef(0);
  const qualifiedSessionSecondsRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const playSessionActiveRef = useRef(false);
  const autoplayAbandonedRecordedRef = useRef(false);
  const isVisibleRef = useRef(
    typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true
  );

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const flushChunk = useCallback(() => {
    if (accumulatedRef.current < 1 || !videoId) return;
    recordEvent({
      eventType: 'video_watch_chunk_recorded',
      surface: 'web',
      videoId,
      platform,
      durationSeconds: Math.round(accumulatedRef.current),
      relatedEventId,
      payload: { visible: isVisibleRef.current, pip: false },
    });
    accumulatedRef.current = 0;
  }, [platform, recordEvent, relatedEventId, videoId]);

  const recordAutoplayAbandonedIfNeeded = useCallback(() => {
    if (
      !videoId ||
      !autoplayFromVideoId ||
      !playSessionActiveRef.current ||
      autoplayAbandonedRecordedRef.current
    ) {
      return;
    }
    const qualifiedSeconds = Math.round(qualifiedSessionSecondsRef.current);
    if (qualifiedSeconds >= 30) return;

    autoplayAbandonedRecordedRef.current = true;
    recordEvent({
      eventType: 'autoplay_abandoned',
      surface: 'web',
      videoId,
      platform,
      durationSeconds: qualifiedSeconds,
      relatedEventId,
      payload: {
        fromVideoId: autoplayFromVideoId,
        toVideoId: videoId,
        qualifiedSeconds,
      },
    });
  }, [autoplayFromVideoId, platform, recordEvent, relatedEventId, videoId]);

  const startSessionIfNeeded = useCallback(() => {
    if (!videoId || playSessionActiveRef.current) return;
    playSessionActiveRef.current = true;
    qualifiedSessionSecondsRef.current = 0;
    autoplayAbandonedRecordedRef.current = false;
    recordEvent({
      eventType: 'video_play_started',
      surface: 'web',
      videoId,
      platform,
      relatedEventId,
      payload: {},
    });
  }, [platform, recordEvent, relatedEventId, videoId]);

  const endSession = useCallback(
    (recordAbandonment: boolean) => {
      flushChunk();
      if (recordAbandonment) recordAutoplayAbandonedIfNeeded();
      playSessionActiveRef.current = false;
      lastTickRef.current = null;
    },
    [flushChunk, recordAutoplayAbandonedIfNeeded]
  );
  const handleEnded = useCallback(() => {
    if (enabled && videoId) endSession(false);
  }, [enabled, endSession, videoId]);

  useEffect(() => {
    if (!enabled || !videoId) return;

    accumulatedRef.current = 0;
    qualifiedSessionSecondsRef.current = 0;
    lastTickRef.current = null;
    playSessionActiveRef.current = false;
    autoplayAbandonedRecordedRef.current = false;

    const isQualified = () =>
      statusRef.current === 'playing' &&
      (isVisibleRef.current ||
        (typeof navigator !== 'undefined' &&
          navigator.mediaSession?.playbackState === 'playing'));

    const tick = () => {
      const now = Date.now();
      if (isQualified()) {
        if (lastTickRef.current !== null) {
          const elapsed = (now - lastTickRef.current) / 1000;
          if (elapsed > 0 && elapsed < 5) {
            accumulatedRef.current += elapsed;
            qualifiedSessionSecondsRef.current += elapsed;
          }
        }
        lastTickRef.current = now;
        if (accumulatedRef.current >= CHUNK_SECONDS) flushChunk();
      } else {
        lastTickRef.current = null;
      }
    };

    const handleVisibility = () => {
      isVisibleRef.current = document.visibilityState !== 'hidden';
      if (!isVisibleRef.current) {
        flushChunk();
        flushKeepalive();
      }
    };
    const handlePagehide = () => {
      flushChunk();
      flushKeepalive();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePagehide);
    const timer = setInterval(tick, TICK_MS);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePagehide);
      clearInterval(timer);
      endSession(true);
      flushNow();
    };
  }, [enabled, endSession, flushChunk, flushKeepalive, flushNow, videoId]);

  // Declared after the per-video lifecycle effect so a route change resets the
  // old session before a new source that is already playing starts its own.
  useEffect(() => {
    if (!enabled || !videoId) return;

    if (status === 'playing' || status === 'buffering') {
      startSessionIfNeeded();
      lastTickRef.current = status === 'playing' ? Date.now() : null;
      return;
    }

    lastTickRef.current = null;
    if (status === 'ended') {
      handleEnded();
    } else if (status === 'paused' || status === 'error') {
      flushChunk();
    }
  }, [enabled, flushChunk, handleEnded, startSessionIfNeeded, status, videoId]);

  return { onEnded: handleEnded };
}
