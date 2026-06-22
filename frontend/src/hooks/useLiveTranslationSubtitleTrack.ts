import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [isActive, setIsActive] = useState(false);
  // Bump to surface a freshly created track to consumers (refs don't re-render).
  const [, setVersion] = useState(0);
  const trackRef = useRef<TextTrack | null>(null);
  const elementRef = useRef<HTMLVideoElement | null>(null);

  // A track belongs to one element; drop the reference if the element changes.
  useEffect(() => {
    if (elementRef.current !== videoElement) {
      trackRef.current = null;
      elementRef.current = videoElement;
      setIsActive(false);
    }
  }, [videoElement]);

  const ensureTrack = useCallback((): TextTrack | null => {
    const el = videoElement;
    if (!el || typeof el.addTextTrack !== 'function') {
      return null;
    }
    if (trackRef.current) {
      return trackRef.current;
    }
    const track = el.addTextTrack('subtitles', label, targetLanguageCode || 'und');
    // Keep it non-disabled so cues can be added/read; selection sets showing/hidden.
    track.mode = 'hidden';
    trackRef.current = track;
    setVersion((v) => v + 1);
    return track;
  }, [videoElement, label, targetLanguageCode]);

  const activate = useCallback(() => {
    if (ensureTrack()) {
      setIsActive(true);
    }
  }, [ensureTrack]);

  const deactivate = useCallback(() => {
    const track = trackRef.current;
    if (track) {
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
    }
    setIsActive(false);
  }, []);

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
      setIsActive(true);

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
    [ensureTrack, videoElement],
  );

  return {
    track: trackRef.current,
    isActive,
    label,
    activate,
    deactivate,
    addCue,
  };
}
