import { useCallback, useState } from 'react';
import { LiveTranslationTranscriptEvent } from './useLiveTranslationSession';

/**
 * Manages a single dynamic `TextTrack` (created via `video.addTextTrack`) that
 * carries live translated subtitles. Because `TextTrackList` cannot remove
 * tracks, one track is created per video element and reused; `deactivate` clears
 * its cues and disables it rather than removing it.
 *
 * This hook owns track creation and cues only. Track *selection* (showing/hidden
 * mode) is owned by `useSubtitles` so the live option behaves like a normal
 * subtitle entry in the menu.
 */

const DEFAULT_CUE_DURATION_S = 4;

const disableAndClearTrack = (track: TextTrack) => {
  try {
    const cues = track.cues;
    if (cues) {
      for (let i = cues.length - 1; i >= 0; i--) {
        track.removeCue(cues[i]);
      }
    }
    track.mode = 'disabled';
  } catch {
    // ignore
  }
};

export interface LiveTranslationSubtitleTrackController {
  track: TextTrack | null;
  isActive: boolean;
  label: string;
  activate: () => void;
  deactivate: () => void;
  addCue: (event: LiveTranslationTranscriptEvent) => void;
}

export function useLiveTranslationSubtitleTrack(
  videoElement: HTMLVideoElement | null,
  targetLanguageCode: string,
  label: string,
): LiveTranslationSubtitleTrackController {
  const [trackState, setTrackState] = useState<{
    element: HTMLVideoElement | null;
    track: TextTrack | null;
    isActive: boolean;
  }>({
    element: null,
    track: null,
    isActive: false,
  });
  const track = trackState.element === videoElement ? trackState.track : null;
  const isActive = trackState.element === videoElement && trackState.isActive;

  const ensureTrack = useCallback((): TextTrack | null => {
    const el = videoElement;
    if (!el || typeof el.addTextTrack !== 'function') {
      return null;
    }
    if (track) {
      return track;
    }
    const createdTrack = el.addTextTrack('subtitles', label, targetLanguageCode || 'und');
    // Keep it non-disabled so cues can be added/read; selection sets showing/hidden.
    createdTrack.mode = 'hidden';
    setTrackState({
      element: el,
      track: createdTrack,
      isActive: false,
    });
    return createdTrack;
  }, [videoElement, label, targetLanguageCode, track]);

  const activate = useCallback(() => {
    if (isActive) {
      return;
    }
    const activeTrack = ensureTrack();
    if (activeTrack && videoElement) {
      setTrackState({
        element: videoElement,
        track: activeTrack,
        isActive: true,
      });
    }
  }, [ensureTrack, isActive, videoElement]);

  const deactivate = useCallback(() => {
    if (!isActive) {
      return;
    }
    if (track) {
      disableAndClearTrack(track);
    }
    if (videoElement) {
      setTrackState({
        element: videoElement,
        track,
        isActive: false,
      });
    }
  }, [isActive, track, videoElement]);

  const addCue = useCallback(
    (event: LiveTranslationTranscriptEvent) => {
      // Only the translated (output) transcript becomes subtitle cues.
      if (event.kind !== 'output') {
        return;
      }
      const text = event.text?.trim();
      if (!text || typeof VTTCue === 'undefined') {
        return;
      }
      const track = ensureTrack();
      if (!track) {
        return;
      }
      if (videoElement && !isActive) {
        setTrackState({
          element: videoElement,
          track,
          isActive: true,
        });
      }

      const baseTime =
        typeof event.mediaTime === 'number'
          ? event.mediaTime
          : (videoElement?.currentTime ?? 0);
      const start = Math.max(0, baseTime);
      const end = start + DEFAULT_CUE_DURATION_S;
      try {
        const cues = track.cues;
        if (cues) {
          for (let i = cues.length - 1; i >= 0; i--) {
            const cue = cues[i];
            if (!cue || cue.endTime <= start) {
              continue;
            }
            if (cue.startTime >= start) {
              track.removeCue(cue);
            } else {
              cue.endTime = start;
            }
          }
        }
        track.addCue(new VTTCue(start, end, text));
      } catch {
        // ignore malformed cue
      }
    },
    [ensureTrack, isActive, videoElement],
  );

  return {
    track,
    isActive,
    label,
    activate,
    deactivate,
    addCue,
  };
}
