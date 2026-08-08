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
 *
 * Gemini streams the translation of one spoken utterance as many small
 * `outputTranscript` deltas (e.g. "好的，" then "战斗。"). Rather than turning each
 * delta into its own cue — which stacks a short sentence into two caption boxes
 * and shows fragments replacing one another — the deltas of a single utterance
 * are coalesced into ONE cue that builds up in place. A fresh cue is started only
 * at an explicit utterance boundary — a Gemini turn boundary or barge-in, both
 * delivered via `endUtterance`, or a seek (the media element's `seeking` event) —
 * never on elapsed playback time, so a slow delta within a turn does not split
 * the sentence.
 */

// How long a completed caption lingers after its last delta.
const DEFAULT_CUE_DURATION_S = 4;

const setTextTrackMode = (track: TextTrack, mode: TextTrackMode) => {
  track.mode = mode;
};

// Collapse whitespace runs (including any introduced at delta boundaries) and
// trim the ends for display. CJK text has no inter-character spaces, so this is
// a no-op there; latin deltas carry their own spacing, which is preserved.
const normalizeCueText = (text: string): string => text.replace(/\s+/g, ' ').trim();

export interface LiveTranslationSubtitleTrackController {
  track: TextTrack | null;
  isActive: boolean;
  label: string;
  activate: () => void;
  deactivate: () => void;
  addCue: (event: LiveTranslationTranscriptEvent) => void;
  /**
   * Mark an utterance boundary that inter-delta timing alone cannot detect: a
   * Gemini turn boundary (`generationComplete`/`turnComplete`) or a barge-in
   * (`interrupted`). The in-progress caption is closed so the next translation
   * starts a fresh cue instead of being coalesced onto the finished/abandoned
   * one. The displayed cue stays until the next delta supersedes it.
   */
  endUtterance: () => void;
}

export function useLiveTranslationSubtitleTrack(
  videoElement: HTMLVideoElement | null,
  targetLanguageCode: string,
  label: string,
): LiveTranslationSubtitleTrackController {
  const [isActive, setIsActive] = useState(false);
  const [trackState, setTrackState] = useState<{
    element: HTMLVideoElement;
    track: TextTrack;
  } | null>(null);
  const track = trackState?.element === videoElement ? trackState.track : null;
  const active = isActive && trackState?.element === videoElement;

  // In-progress caption being built from the current utterance's deltas.
  const activeCueRef = useRef<VTTCue | null>(null);
  const activeCueTextRef = useRef('');

  const resetAccumulation = useCallback(() => {
    activeCueRef.current = null;
    activeCueTextRef.current = '';
  }, []);

  // A seek is the only timeline discontinuity that ends an utterance without a
  // Gemini boundary. Detect it explicitly from the media element rather than
  // inferring it from elapsed playback time, so a slow delta during continuous
  // playback is never mistaken for a seek and split off.
  useEffect(() => {
    if (!videoElement) {
      return;
    }
    const onSeeking = () => resetAccumulation();
    videoElement.addEventListener('seeking', onSeeking);
    return () => videoElement.removeEventListener('seeking', onSeeking);
  }, [videoElement, resetAccumulation]);

  const ensureTrack = useCallback((): TextTrack | null => {
    const el = videoElement;
    if (!el || typeof el.addTextTrack !== 'function') {
      return null;
    }
    if (track) {
      return track;
    }
    const newTrack = el.addTextTrack('subtitles', label, targetLanguageCode || 'und');
    // Keep it non-disabled so cues can be added/read; selection sets showing/hidden.
    setTextTrackMode(newTrack, 'hidden');
    setTrackState({ element: el, track: newTrack });
    // A new element means a fresh track with no in-progress caption.
    resetAccumulation();
    return newTrack;
  }, [videoElement, label, targetLanguageCode, track, resetAccumulation]);

  const activate = useCallback(() => {
    if (ensureTrack()) {
      setIsActive(true);
    }
  }, [ensureTrack]);

  const deactivate = useCallback(() => {
    if (track) {
      try {
        const cues = track.cues;
        if (cues) {
          for (let i = cues.length - 1; i >= 0; i--) {
            track.removeCue(cues[i]);
          }
        }
        setTextTrackMode(track, 'disabled');
      } catch {
        // ignore
      }
    }
    resetAccumulation();
    setIsActive(false);
  }, [track, resetAccumulation]);

  const addCue = useCallback(
    (event: LiveTranslationTranscriptEvent) => {
      // Only the translated (output) transcript becomes subtitle cues.
      if (event.kind !== 'output') {
        return;
      }
      const delta = event.text;
      if (delta == null || delta === '' || typeof VTTCue === 'undefined') {
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
      const active = activeCueRef.current;

      // Continue the current caption. Utterance boundaries arrive explicitly —
      // Gemini turn complete / barge-in via `endUtterance`, and seeks via the
      // `seeking` listener above, both of which clear the accumulator — so
      // neither delivery latency nor elapsed playback time splits the sentence.
      // `start >= active.startTime` still guards a backward timeline (a cue never
      // extends to an earlier time than it began).
      const continues = !!active && start >= active.startTime;

      try {
        if (continues && active) {
          // Rebuild the single cue with the accumulated text. Replacing the cue
          // (rather than mutating `text` in place) guarantees the displayed
          // caption updates across browsers.
          const combined = activeCueTextRef.current + delta;
          const display = normalizeCueText(combined);
          const end = Math.max(active.endTime, start + DEFAULT_CUE_DURATION_S);
          track.removeCue(active);
          const cue = new VTTCue(active.startTime, end, display);
          track.addCue(cue);
          activeCueRef.current = cue;
          activeCueTextRef.current = combined;
          return;
        }

        const display = normalizeCueText(delta);
        if (!display) {
          // Leading whitespace-only delta of a new utterance: nothing to show
          // yet, but anchor the accumulation so the next delta continues it.
          activeCueRef.current = null;
          activeCueTextRef.current = '';
          return;
        }

        // New utterance: end any still-showing prior caption at this start so it
        // does not linger and stack beneath the new one.
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
        const cue = new VTTCue(start, start + DEFAULT_CUE_DURATION_S, display);
        track.addCue(cue);
        activeCueRef.current = cue;
        activeCueTextRef.current = delta;
      } catch {
        // Malformed cue: drop the in-progress caption so the next delta starts clean.
        activeCueRef.current = null;
        activeCueTextRef.current = '';
      }
    },
    [ensureTrack, videoElement],
  );

  // A Gemini turn boundary (generationComplete/turnComplete) or barge-in
  // (interrupted) ends the current utterance. Stop accumulating so the next
  // delta opens a fresh cue; the finished cue is left on screen until then, when
  // the new-utterance path truncates it — matching how any new utterance
  // supersedes the previous one.
  const endUtterance = useCallback(() => {
    resetAccumulation();
  }, [resetAccumulation]);

  return {
    track,
    isActive: active,
    label,
    activate,
    deactivate,
    addCue,
    endUtterance,
  };
}
