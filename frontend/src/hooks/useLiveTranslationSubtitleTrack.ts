import { useCallback, useRef, useState } from 'react';
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
 * at an utterance boundary, detected by the wall-clock gap between deltas: within
 * a turn Gemini emits deltas in a rapid burst, while a new turn follows a pause.
 */

// How long a completed caption lingers after its last delta.
const DEFAULT_CUE_DURATION_S = 4;
// Wall-clock gap (ms) between deltas above which the next delta is treated as a
// new utterance instead of a continuation of the current caption. Deltas within
// one turn arrive far faster than this; the pause between turns is longer.
const NEW_UTTERANCE_GAP_MS = 1500;
// Largest media-time jump (s) between consecutive deltas still treated as the
// same caption. Deltas of one turn share nearly the same media time; a seek
// jumps `currentTime` well beyond what 1x playback advances within the burst
// window, so a jump past this starts a fresh caption instead of stretching the
// pre-seek cue across the seek. (Output transcripts carry no `mediaTime`, so the
// hook falls back to the seeked `currentTime`.)
const MAX_CONTINUATION_MEDIA_JUMP_S = 2;

const setTextTrackMode = (track: TextTrack, mode: TextTrackMode) => {
  track.mode = mode;
};

// Collapse whitespace runs (including any introduced at delta boundaries) and
// trim the ends for display. CJK text has no inter-character spaces, so this is
// a no-op there; latin deltas carry their own spacing, which is preserved.
const normalizeCueText = (text: string): string => text.replace(/\s+/g, ' ').trim();

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

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
  const [trackState, setTrackState] = useState<{
    element: HTMLVideoElement;
    track: TextTrack;
  } | null>(null);
  const track = trackState?.element === videoElement ? trackState.track : null;
  const active = isActive && trackState?.element === videoElement;

  // In-progress caption being built from the current utterance's deltas.
  const activeCueRef = useRef<VTTCue | null>(null);
  const activeCueTextRef = useRef('');
  const lastDeltaAtRef = useRef(0);
  const lastDeltaMediaRef = useRef(0);

  const resetAccumulation = useCallback(() => {
    activeCueRef.current = null;
    activeCueTextRef.current = '';
    lastDeltaAtRef.current = 0;
    lastDeltaMediaRef.current = 0;
  }, []);

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
      const at = nowMs();
      const active = activeCueRef.current;
      const gap = at - lastDeltaAtRef.current;
      const mediaJump = Math.abs(start - lastDeltaMediaRef.current);
      lastDeltaAtRef.current = at;
      lastDeltaMediaRef.current = start;

      // Continue the current caption when the delta belongs to the same
      // utterance: it arrived within the burst window, the timeline did not jump
      // backwards before the caption, and it did not jump (forward or back) past
      // what normal playback advances — i.e. the viewer did not seek.
      const continues =
        !!active &&
        gap <= NEW_UTTERANCE_GAP_MS &&
        start >= active.startTime &&
        mediaJump <= MAX_CONTINUATION_MEDIA_JUMP_S;

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

  return {
    track,
    isActive: active,
    label,
    activate,
    deactivate,
    addCue,
  };
}
