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
 * and shows fragments replacing one another — deltas are coalesced into ONE cue
 * that builds up in place, and a fresh cue starts at a caption boundary:
 *
 * - the accumulated text ends a sentence (terminal punctuation) — the natural
 *   per-sentence captioning viewers expect, and the split that keeps working
 *   during continuous speech where `turnComplete` may not arrive for a long time;
 * - the caption would overflow roughly two subtitle lines — a hard cap so a
 *   run-on translation can never grow into a wall of text;
 * - a Gemini `turnComplete` (`finishTurn`, a soft boundary that keeps the caption
 *   open for a brief drain window so late out-of-order trailing deltas coalesce);
 * - a barge-in (`endUtterance`) or a seek (the `seeking` listener), hard
 *   boundaries that discard the in-progress caption at once.
 *
 * A finished cue is truncated when its successor starts and otherwise expires
 * `DEFAULT_CUE_DURATION_S` after its last delta, so captions always leave the
 * screen.
 */

// How long a completed caption lingers after its last delta.
const DEFAULT_CUE_DURATION_S = 4;
// Fixed window after `turnComplete` during which out-of-order trailing chunks of
// the finished turn (the Live API does not order transcription against other
// messages) still coalesce onto its caption. Comfortably longer than the spread
// of a turn's own trailing chunks, yet far shorter than the pause before the next
// translated turn, so it captures the tail without absorbing the next turn.
const TURN_DRAIN_MS = 400;
// Accumulated text ending in terminal punctuation (optionally followed by
// closing quotes/brackets) completes a caption; the next delta starts a new cue.
const SENTENCE_END_RE = /[.。．!！?？…]["'”’」』)）]*\s*$/;
// Maximum caption size before a new cue is forced, measured in terminal columns
// (CJK glyphs are double-width): about two 42-column subtitle lines.
const MAX_CUE_COLUMNS = 84;
// Reading speed used to pace the pieces of an oversized delta, in columns per
// second — the usual subtitling rate, so each piece is on screen long enough to
// read rather than being flashed.
const READING_COLUMNS_PER_S = 18;
// Floor on a piece's screen time, so a very short trailing piece is not flashed.
const MIN_PIECE_DURATION_S = 1.2;
// Ceiling on how far ahead of playback an oversized delta may schedule. Pacing
// text readably takes longer than the speech it came from, so an extreme chunk
// would otherwise push captions tens of seconds behind the video — worse than
// showing less. Pieces beyond this bound are dropped, keeping the earliest text
// (which matches the speech nearest the current position).
const MAX_QUEUE_AHEAD_S = 12;

const setTextTrackMode = (track: TextTrack, mode: TextTrackMode) => {
  track.mode = mode;
};

// Collapse whitespace runs (including any introduced at delta boundaries) and
// trim the ends for display. CJK text has no inter-character spaces, so this is
// a no-op there; latin deltas carry their own spacing, which is preserved.
const normalizeCueText = (text: string): string => text.replace(/\s+/g, ' ').trim();

// Approximate rendered width of one glyph in columns; CJK and other fullwidth
// glyphs (codepoints past the CJK Radicals block) occupy two columns.
const charColumns = (ch: string): number => ((ch.codePointAt(0) ?? 0) > 0x2e7f ? 2 : 1);

const textColumns = (text: string): number => {
  let columns = 0;
  for (const ch of text) {
    columns += charColumns(ch);
  }
  return columns;
};

// Break text into pieces of at most `maxColumns`, so a single oversized delta
// cannot become one wall-of-text caption. Space-delimited text breaks at the last
// space in the piece (kept past the halfway mark so pieces stay substantial),
// leaving words intact; CJK has no spaces and is cut on the column boundary.
const splitIntoCaptions = (text: string, maxColumns: number): string[] => {
  if (textColumns(text) <= maxColumns) {
    return [text];
  }
  const pieces: string[] = [];
  let current = '';
  let columns = 0;
  for (const ch of text) {
    const width = charColumns(ch);
    if (columns + width > maxColumns && current) {
      const lastSpace = current.lastIndexOf(' ');
      if (lastSpace > 0 && textColumns(current.slice(0, lastSpace)) >= maxColumns / 2) {
        pieces.push(current.slice(0, lastSpace));
        current = current.slice(lastSpace + 1);
      } else {
        pieces.push(current);
        current = '';
      }
      columns = textColumns(current);
    }
    current += ch;
    columns += width;
  }
  if (current) {
    pieces.push(current);
  }
  return pieces;
};

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
  // Media time through which content is already scheduled ahead of playback,
  // after splitting an oversized delta. It is a floor for every later anchor, so
  // deltas queue behind those pieces instead of purging or cutting them short.
  // It is never cleared on use — only by a hard boundary — because a caption
  // placed at the watermark is itself in the future; it stops having any effect
  // once media time passes it.
  const queuedUntilRef = useRef(0);
  // Whether the active caption was anchored ahead of its delta's media time (it
  // was pushed past a queue) and so has not played yet.
  const activeCueAheadRef = useRef(false);
  // Cues scheduled ahead of playback, kept so a hard boundary can take them back
  // off the track instead of leaving abandoned translation to play later.
  const queuedCuesRef = useRef<VTTCue[]>([]);
  // Pending `finishTurn` drain timer, if a turn boundary is awaiting late deltas.
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDrainTimer = useCallback(() => {
    if (drainTimerRef.current != null) {
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
  }, []);

  // Stop accumulating, so the next delta opens a fresh caption. The queue
  // watermark is deliberately kept: cues already scheduled ahead of playback are
  // still going to play, and a later delta must not anchor behind them.
  const closeAccumulation = useCallback(() => {
    clearDrainTimer();
    const active = activeCueRef.current;
    if (active && activeCueAheadRef.current) {
      // This caption is itself scheduled ahead of playback and has not been
      // shown. Clearing the refs loses the only record of that, so carry its end
      // into the watermark first — otherwise the watermark still points at the
      // caption's start and the next delta would anchor on top of it and delete
      // text the viewer never saw.
      queuedUntilRef.current = Math.max(queuedUntilRef.current, active.endTime);
    }
    activeCueRef.current = null;
    activeCueTextRef.current = '';
    activeCueAheadRef.current = false;
  }, [clearDrainTimer]);

  // Hard boundary (barge-in / seek): the scheduled queue is abandoned along with
  // the accumulation, so later deltas anchor at their own media time again. Cues
  // already added for that queue are taken back off the track — forgetting the
  // watermark alone would leave the abandoned translation to play whenever
  // playback reached it (e.g. a seek into the queued interval).
  //
  // `staleAfter` additionally discards the in-progress caption when it would
  // still be displayed at that media time. A seek passes the new position: the
  // caption is anchored to the old one, so after seeking back it sits in the
  // future again and would replay stale translation. A barge-in passes nothing,
  // so a caption the viewer is currently reading stays up until the replacement
  // supersedes it; an unplayed one is dropped either way.
  const resetAccumulation = useCallback((staleAfter?: number) => {
    const active = activeCueRef.current;
    const showsAgain =
      !!active && typeof staleAfter === 'number' && active.endTime > staleAfter;
    if (active && (showsAgain || activeCueAheadRef.current)) {
      queuedCuesRef.current.push(active);
    }
    const queued = queuedCuesRef.current;
    queuedCuesRef.current = [];
    if (track) {
      for (const cue of queued) {
        try {
          track.removeCue(cue);
        } catch {
          // Already gone (superseded or cleared): nothing to undo.
        }
      }
    }
    closeAccumulation();
    queuedUntilRef.current = 0;
  }, [closeAccumulation, track]);

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
    // Pass the new position so the in-progress caption is dropped when it would
    // display again there — otherwise a backward seek replays stale translation.
    const onSeeking = () => resetAccumulation(videoElement.currentTime);
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
      // Anchoring behind the queue keeps each caption after the last, but every
      // turn arriving before the queue drains pushes the watermark on by its own
      // cue. Left alone that ratchets forward for the rest of the session, so the
      // cap is enforced here and not only while splitting: once the backlog is
      // further ahead than the bound, it is shed and captions resync to playback.
      // Currency matters more than completeness for a live translation.
      if (queuedUntilRef.current - baseTime > MAX_QUEUE_AHEAD_S) {
        resetAccumulation();
      }
      // Never anchor before pieces already scheduled from an oversized delta:
      // starting inside that queue would truncate or purge those cues and lose
      // the translation they carry.
      let start = Math.max(0, baseTime, queuedUntilRef.current);
      // Queued cues that have already played need no undoing at a later hard
      // boundary, so drop them rather than tracking them for the whole session.
      if (queuedCuesRef.current.length > 0) {
        queuedCuesRef.current = queuedCuesRef.current.filter(
          (cue) => cue.endTime > baseTime,
        );
      }
      const active = activeCueRef.current;
      const priorText = activeCueTextRef.current;

      // Continue the current caption unless a caption boundary is reached.
      // Explicit boundaries (turn complete / barge-in / seek) clear the
      // accumulator elsewhere; here the content itself splits the stream:
      // - the accumulated text already ends a sentence, so the next delta is a
      //   new caption — the per-sentence display viewers expect, and the split
      //   that keeps working through continuous speech with no turnComplete;
      // - appending would overflow ~two subtitle lines, a hard cap so a run-on
      //   translation cannot grow into a wall of text that never leaves;
      // - `start >= active.startTime` still guards a backward timeline (a cue
      //   never extends to an earlier time than it began).
      const sentenceDone = SENTENCE_END_RE.test(priorText);
      const wouldOverflow =
        textColumns(normalizeCueText(priorText + delta)) > MAX_CUE_COLUMNS;
      const continues =
        !!active && start >= active.startTime && !sentenceDone && !wouldOverflow;

      // A caption anchored ahead of playback (pushed past a queue) has not been
      // shown yet, so a successor sharing its anchor must be scheduled after it —
      // the cleanup below removes cues starting at or after `start`, which would
      // otherwise delete text the viewer never saw.
      if (!continues && active && activeCueAheadRef.current && active.startTime >= start) {
        start = active.endTime;
        queuedUntilRef.current = Math.max(queuedUntilRef.current, start);
        // It stops being the active cue below, so register it as queued now:
        // otherwise nothing holds a reference to it and a later hard boundary
        // would leave this abandoned caption on the track to play on its own.
        queuedCuesRef.current.push(active);
      }

      try {
        if (continues && active) {
          // Rebuild the single cue with the accumulated text. Replacing the cue
          // (rather than mutating `text` in place) guarantees the displayed
          // caption updates across browsers.
          const combined = priorText + delta;
          const display = normalizeCueText(combined);
          const end = Math.max(active.endTime, start + DEFAULT_CUE_DURATION_S);
          track.removeCue(active);
          const cue = new VTTCue(active.startTime, end, display);
          track.addCue(cue);
          activeCueRef.current = cue;
          activeCueTextRef.current = combined;
        } else {
          const display = normalizeCueText(delta);
          if (display) {
            // New utterance: end any still-showing prior caption at this start so
            // it does not linger and stack beneath the new one.
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
            // Gemini may deliver a single large chunk, so apply the cap to the
            // delta itself rather than trusting it to be short.
            const pieces = splitIntoCaptions(display, MAX_CUE_COLUMNS);
            if (pieces.length === 1) {
              const cue = new VTTCue(start, start + DEFAULT_CUE_DURATION_S, display);
              track.addCue(cue);
              activeCueRef.current = cue;
              activeCueTextRef.current = delta;
              // Remember whether this caption sits ahead of its own media time,
              // i.e. it was pushed past a queue and has not been shown yet.
              activeCueAheadRef.current = start > baseTime;
              // `queuedUntil` is deliberately left standing: this caption may
              // itself be anchored ahead of playback (it was pushed past the
              // queue), so a delta still arriving with an earlier media time must
              // be lifted to the same anchor and coalesce here, rather than open a
              // caption behind it and purge the queue. The watermark expires on
              // its own once media time passes it, since it only acts as a floor.
            } else {
              // Split pieces play in sequence (never stacked), each on screen long
              // enough to read rather than sharing one caption's window. They are
              // scheduled ahead of playback, so none becomes the active
              // accumulator: a later delta must not coalesce onto — or, arriving at
              // an earlier media time, purge — a cue that has not started yet.
              // Accumulation is closed and `queuedUntil` holds the next delta after
              // the queue instead. The queue is bounded, so pacing an extreme chunk
              // cannot push captions far behind the video.
              let offset = 0;
              for (const piece of pieces) {
                const duration = Math.min(
                  DEFAULT_CUE_DURATION_S,
                  Math.max(
                    MIN_PIECE_DURATION_S,
                    textColumns(piece) / READING_COLUMNS_PER_S,
                  ),
                );
                if (offset > 0 && offset + duration > MAX_QUEUE_AHEAD_S) {
                  break;
                }
                const pieceStart = start + offset;
                const cue = new VTTCue(pieceStart, pieceStart + duration, piece);
                track.addCue(cue);
                queuedCuesRef.current.push(cue);
                offset += duration;
              }
              activeCueRef.current = null;
              activeCueTextRef.current = '';
              activeCueAheadRef.current = false;
              queuedUntilRef.current = start + offset;
            }
          } else {
            // Leading whitespace-only delta of a new utterance: nothing to show
            // yet, but anchor the accumulation so the next delta continues it.
            activeCueRef.current = null;
            activeCueTextRef.current = '';
            activeCueAheadRef.current = false;
          }
        }
      } catch {
        // Malformed cue: drop the in-progress caption so the next delta starts clean.
        activeCueRef.current = null;
        activeCueTextRef.current = '';
        activeCueAheadRef.current = false;
      }
    },
    [ensureTrack, videoElement, resetAccumulation],
  );

  // Barge-in (interrupted): the in-progress response is abandoned, so stop
  // accumulating immediately and let the next delta open a fresh cue. The
  // finished cue stays on screen until the new-utterance path truncates it.
  const endUtterance = useCallback(() => {
    resetAccumulation();
  }, [resetAccumulation]);

  // Gemini `turnComplete`: the turn is done, but its transcription may still be
  // in flight (the Live API does not order transcription against other messages)
  // and may span several deltas. Open a single fixed drain window from this
  // boundary: deltas arriving within it coalesce onto the finishing turn (via the
  // still-active cue), so a burst of out-of-order trailing chunks all stay
  // attached; when it elapses the accumulator resets so the next turn is fresh.
  //
  // The window is FIXED (not re-armed per delta): it bounds how far past the
  // boundary trailing text is absorbed. Timing cannot distinguish a genuine
  // trailing chunk from the first chunk of a promptly-starting next turn — Gemini
  // provides no per-transcript turn id, and the same reordering defeats a backend
  // turn index — so this caps the worst case (a next turn beginning within the
  // window merges only its opening, never unboundedly) instead of chasing an
  // unachievable exact association. Armed even with no active cue, so a
  // `turnComplete` preceding the first delta is not lost. A hard boundary
  // (barge-in / seek, via resetAccumulation) cancels the drain.
  // The drain closes accumulation without discarding the queue: split pieces can
  // span seconds, far longer than this window, and they are still going to play.
  const finishTurn = useCallback(() => {
    clearDrainTimer();
    drainTimerRef.current = setTimeout(() => {
      drainTimerRef.current = null;
      closeAccumulation();
    }, TURN_DRAIN_MS);
  }, [clearDrainTimer, closeAccumulation]);

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
