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
 * at an explicit utterance boundary — never on elapsed playback time, so a slow
 * delta within a turn does not split the sentence. Boundaries are: a Gemini
 * `turnComplete` (`finishTurn`, a soft boundary that keeps the caption open for a
 * brief drain window so a late out-of-order transcription delta still coalesces);
 * a barge-in (`endUtterance`, a hard boundary that discards at once); and a seek
 * (the media element's `seeking` event, also a hard boundary).
 */

// How long a completed caption lingers after its last delta.
const DEFAULT_CUE_DURATION_S = 4;
// After `turnComplete`, keep the caption open this long so a final transcription
// delta delivered out of order (the Live API does not order transcription against
// other messages) still coalesces onto the finishing turn. Comfortably longer
// than the gap between a turn's own frames, yet far shorter than the pause before
// the next translated turn, so it neither splits this turn nor merges the next.
const TURN_DRAIN_MS = 400;

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
   * Hard utterance boundary — a barge-in (`interrupted`) — that discards the
   * in-progress caption immediately, so the replacement translation starts a
   * fresh cue. Seeks are handled the same way via the `seeking` listener.
   */
  endUtterance: () => void;
  /**
   * Soft utterance boundary — a Gemini `turnComplete`. The Live API does not
   * guarantee transcription is ordered against other server messages, so the
   * turn's final `outputTranscription` delta can arrive *after* `turnComplete`.
   * The caption is therefore kept open for a brief drain window: late deltas of
   * the finishing turn still coalesce onto it, and only then does the next turn
   * start a fresh cue.
   */
  finishTurn: () => void;
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
  // Pending `finishTurn` drain timer, if a turn boundary is awaiting late deltas.
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDrainTimer = useCallback(() => {
    if (drainTimerRef.current != null) {
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
  }, []);

  const resetAccumulation = useCallback(() => {
    clearDrainTimer();
    activeCueRef.current = null;
    activeCueTextRef.current = '';
  }, [clearDrainTimer]);

  // Cancel any pending drain timer if the element/hook goes away.
  useEffect(() => clearDrainTimer, [clearDrainTimer]);

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

  // Barge-in (interrupted): the in-progress response is abandoned, so stop
  // accumulating immediately and let the next delta open a fresh cue. The
  // finished cue stays on screen until the new-utterance path truncates it.
  const endUtterance = useCallback(() => {
    resetAccumulation();
  }, [resetAccumulation]);

  // Gemini `turnComplete`: the turn is done, but its final transcription delta
  // may still be in flight. Keep the caption open for a short drain window so a
  // late delta coalesces onto it; when the window elapses the accumulator resets
  // and the next turn starts a fresh cue. A hard boundary (barge-in / seek, via
  // resetAccumulation) cancels the pending drain.
  const finishTurn = useCallback(() => {
    if (!activeCueRef.current) {
      return;
    }
    clearDrainTimer();
    drainTimerRef.current = setTimeout(() => {
      drainTimerRef.current = null;
      resetAccumulation();
    }, TURN_DRAIN_MS);
  }, [clearDrainTimer, resetAccumulation]);

  return {
    track,
    isActive: active,
    label,
    activate,
    deactivate,
    addCue,
    endUtterance,
    finishTurn,
  };
}
