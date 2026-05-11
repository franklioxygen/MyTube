import { RefObject, useEffect, useRef } from 'react';
import { useStatisticsIngestion } from './useStatisticsIngestion';

const CHUNK_SECONDS = 60;
const TICK_MS = 1_000;

interface Options {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoId: string | null;
  platform?: string | null;
  // optional related event id — use VideoContext.lastSearchEventId for search-origin plays
  relatedEventId?: string | null;
}

// Tracks qualified playback time and emits:
// - video_play_started once per "play session"
// - video_watch_chunk_recorded every CHUNK_SECONDS of qualified seconds (and on
//   pause / unload / visibility change)
//
// "Qualified" means the element is in the playing state and at least one of:
// - the document is visible
// - the video element is in PiP
// - the navigator.mediaSession reports active media
//
// Buffering, seeking, and rate changes do not contribute time. Only wall-clock
// playback advances qualified time.
export function useStatisticsWatchTracker(options: Options): void {
  const { videoRef, videoId, platform, relatedEventId } = options;
  const {
    enabled,
    recordEvent,
    flushNow,
    flushKeepalive,
  } = useStatisticsIngestion();

  const accumulatedRef = useRef<number>(0);
  const lastTickRef = useRef<number | null>(null);
  const playSessionRef = useRef<{ active: boolean; startedAt: number } | null>(
    null
  );
  const isVisibleRef = useRef<boolean>(
    typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true
  );
  const isPiPRef = useRef<boolean>(false);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!videoId) return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const flushChunk = () => {
      if (accumulatedRef.current >= 1) {
        recordEvent({
          eventType: 'video_watch_chunk_recorded',
          surface: 'web',
          videoId,
          platform: (platform ?? null) as any,
          durationSeconds: Math.round(accumulatedRef.current),
          relatedEventId,
          payload: {
            visible: isVisibleRef.current,
            pip: isPiPRef.current,
          },
        });
        accumulatedRef.current = 0;
      }
    };

    const startSessionIfNeeded = () => {
      if (playSessionRef.current?.active) return;
      playSessionRef.current = { active: true, startedAt: Date.now() };
      recordEvent({
        eventType: 'video_play_started',
        surface: 'web',
        videoId,
        platform: (platform ?? null) as any,
        relatedEventId,
        payload: {},
      });
    };

    const endSession = () => {
      flushChunk();
      playSessionRef.current = null;
    };

    const isQualified = () =>
      !videoEl.paused &&
      !videoEl.seeking &&
      videoEl.readyState >= 2 &&
      (isVisibleRef.current ||
        isPiPRef.current ||
        (typeof navigator !== 'undefined' &&
          navigator.mediaSession?.playbackState === 'playing'));

    const tick = () => {
      const now = Date.now();
      if (isQualified()) {
        if (lastTickRef.current !== null) {
          const elapsed = (now - lastTickRef.current) / 1000;
          if (elapsed > 0 && elapsed < 5) {
            accumulatedRef.current += elapsed * (videoEl.playbackRate > 0 ? 1 : 1);
          }
        }
        lastTickRef.current = now;
        if (accumulatedRef.current >= CHUNK_SECONDS) {
          flushChunk();
        }
      } else {
        lastTickRef.current = null;
      }
    };

    const handlePlay = () => {
      startSessionIfNeeded();
      lastTickRef.current = Date.now();
    };
    const handlePause = () => {
      flushChunk();
    };
    const handleEnded = () => {
      endSession();
    };
    const handleSeeking = () => {
      flushChunk();
      lastTickRef.current = null;
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
    const handlePiPEnter = () => {
      isPiPRef.current = true;
    };
    const handlePiPLeave = () => {
      isPiPRef.current = false;
    };

    videoEl.addEventListener('play', handlePlay);
    videoEl.addEventListener('pause', handlePause);
    videoEl.addEventListener('ended', handleEnded);
    videoEl.addEventListener('seeking', handleSeeking);
    videoEl.addEventListener('enterpictureinpicture', handlePiPEnter);
    videoEl.addEventListener('leavepictureinpicture', handlePiPLeave);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePagehide);
    tickTimerRef.current = setInterval(tick, TICK_MS);

    return () => {
      videoEl.removeEventListener('play', handlePlay);
      videoEl.removeEventListener('pause', handlePause);
      videoEl.removeEventListener('ended', handleEnded);
      videoEl.removeEventListener('seeking', handleSeeking);
      videoEl.removeEventListener('enterpictureinpicture', handlePiPEnter);
      videoEl.removeEventListener('leavepictureinpicture', handlePiPLeave);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePagehide);
      if (tickTimerRef.current !== null) {
        clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }
      flushChunk();
      flushNow();
    };
  }, [enabled, flushKeepalive, flushNow, platform, recordEvent, relatedEventId, videoId, videoRef]);
}
