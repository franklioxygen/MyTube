import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ensureCsrfToken } from '../utils/apiClient';
import { getBackendUrl } from '../utils/apiUrl';
import { int16ToBase64 } from '../utils/pcmAudio';
import {
  encodeClientMessage,
  LiveTranslationErrorCode,
  parseServerMessage,
} from '../utils/liveTranslationProtocol';
import {
  LiveTranslationAudioCaptureController,
  useLiveTranslationAudioCapture,
} from './useLiveTranslationAudioCapture';
import {
  TranslatedAudioPlaybackController,
  useTranslatedAudioPlayback,
} from './useTranslatedAudioPlayback';

const WS_OPEN = 1;
const UNSUPPORTED_PLAYBACK_RATE_MESSAGE = 'Live translation requires 1x playback speed.';

export type LiveTranslationSessionStatus =
  | 'idle'
  | 'connecting'
  | 'translating'
  | 'paused'
  | 'error';

export interface LiveTranslationTranscriptEvent {
  kind: 'input' | 'output';
  text: string;
  languageCode?: string;
  mediaTime?: number;
}

export interface UseLiveTranslationSessionOptions {
  videoElement: HTMLVideoElement | null;
  videoId: string;
  onTranscript?: (event: LiveTranslationTranscriptEvent) => void;
  /** Injectable for tests; default to the real controllers. */
  captureController?: LiveTranslationAudioCaptureController;
  playbackController?: TranslatedAudioPlaybackController;
}

export interface UseLiveTranslationSessionResult {
  status: LiveTranslationSessionStatus;
  isActive: boolean;
  errorCode: LiveTranslationErrorCode | null;
  errorMessage: string | null;
  retryable: boolean;
  start: () => void;
  stop: () => void;
}

function buildLiveTranslationWsUrl(wsPath: string): string {
  const backend = getBackendUrl();
  const base = backend && backend.length > 0 ? backend : window.location.origin;
  const url = new URL(wsPath, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function useLiveTranslationSession(
  options: UseLiveTranslationSessionOptions,
): UseLiveTranslationSessionResult {
  const { videoElement, videoId, onTranscript } = options;
  const defaultCapture = useLiveTranslationAudioCapture();
  const defaultPlayback = useTranslatedAudioPlayback();
  const capture = options.captureController ?? defaultCapture;
  const playback = options.playbackController ?? defaultPlayback;

  const [status, setStatus] = useState<LiveTranslationSessionStatus>('idle');
  const [errorCode, setErrorCode] = useState<LiveTranslationErrorCode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const startAttemptRef = useRef(0);
  const seqRef = useRef(0);
  const audioSeqRef = useRef(0);
  const mediaListenersRef = useRef<(() => void) | null>(null);
  // Capture is deferred until Gemini reports readiness (server `status:
  // translating`) so the original audio stays audible — and nothing is dropped —
  // during setup latency. `beginCaptureRef` holds the per-session starter.
  const captureStartedRef = useRef(false);
  const beginCaptureRef = useRef<(() => void) | null>(null);
  // Tracks whether the video is paused so translated chunks that arrive while
  // paused are dropped instead of queued (they would otherwise play on resume).
  const pausedRef = useRef(false);
  // Keep latest values for callbacks/cleanup without re-creating handlers.
  const videoElementRef = useRef(videoElement);
  videoElementRef.current = videoElement;
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const detachMediaListeners = useCallback(() => {
    mediaListenersRef.current?.();
    mediaListenersRef.current = null;
  }, []);

  const cleanup = useCallback(
    (nextStatus: LiveTranslationSessionStatus) => {
      startAttemptRef.current += 1;
      captureStartedRef.current = false;
      beginCaptureRef.current = null;
      pausedRef.current = false;
      detachMediaListeners();
      const element = videoElementRef.current;
      if (element) {
        capture.stop(element);
      }
      playback.close();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      setStatus((prev) => (prev === 'error' && nextStatus === 'idle' ? prev : nextStatus));
    },
    [capture, playback, detachMediaListeners],
  );

  const fail = useCallback(
    (code: LiveTranslationErrorCode, message: string, canRetry: boolean) => {
      setErrorCode(code);
      setErrorMessage(message);
      setRetryable(canRetry);
      setStatus('error');
      cleanup('error');
    },
    [cleanup],
  );

  const sendControl = useCallback(
    (message: Parameters<typeof encodeClientMessage>[0]) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WS_OPEN) {
        ws.send(encodeClientMessage(message));
      }
    },
    [],
  );

  const attachMediaListeners = useCallback(() => {
    const element = videoElementRef.current;
    if (!element) {
      return;
    }
    const onPause = () => {
      pausedRef.current = true;
      sendControl({ type: 'pause', currentTime: element.currentTime });
      // Drop any queued translated audio so it cannot overlay later video on
      // resume; new chunks that arrive while paused are ignored (handleServerData).
      playback.flush();
      playback.pause();
      setStatus((prev) => (prev === 'translating' ? 'paused' : prev));
    };
    const onPlay = () => {
      pausedRef.current = false;
      sendControl({ type: 'resume', currentTime: element.currentTime });
      playback.resume();
      setStatus((prev) => (prev === 'paused' ? 'translating' : prev));
    };
    const onSeeking = () => {
      sendControl({ type: 'seek', currentTime: element.currentTime });
      playback.flush();
    };
    const onRateChange = () => {
      if (element.playbackRate === 1) {
        return;
      }
      sendControl({ type: 'stop' });
      fail('unsupported_playback_rate', UNSUPPORTED_PLAYBACK_RATE_MESSAGE, false);
    };
    const onVolumeChange = () => {
      playback.setVolume(element.volume, element.muted);
    };
    // Apply the current volume/mute immediately, then track changes.
    playback.setVolume(element.volume, element.muted);
    element.addEventListener('pause', onPause);
    element.addEventListener('play', onPlay);
    element.addEventListener('seeking', onSeeking);
    element.addEventListener('ratechange', onRateChange);
    element.addEventListener('volumechange', onVolumeChange);
    mediaListenersRef.current = () => {
      element.removeEventListener('pause', onPause);
      element.removeEventListener('play', onPlay);
      element.removeEventListener('seeking', onSeeking);
      element.removeEventListener('ratechange', onRateChange);
      element.removeEventListener('volumechange', onVolumeChange);
    };
  }, [fail, playback, sendControl]);

  const handleServerData = useCallback(
    (data: string) => {
      const message = parseServerMessage(data);
      if (!message) {
        return;
      }
      switch (message.type) {
        case 'status':
          if (message.status === 'translating') {
            // Gemini is ready: now start (and mute via) capture. Until this point
            // the original audio stayed audible so no words were lost.
            beginCaptureRef.current?.();
            setStatus(pausedRef.current ? 'paused' : 'translating');
          } else if (message.status === 'paused') {
            setStatus('paused');
          }
          break;
        case 'inputTranscript':
          onTranscriptRef.current?.({
            kind: 'input',
            text: message.text,
            languageCode: message.languageCode,
            mediaTime: message.mediaTime,
          });
          break;
        case 'outputTranscript':
          onTranscriptRef.current?.({
            kind: 'output',
            text: message.text,
            languageCode: message.languageCode,
            mediaTime: message.mediaTime,
          });
          break;
        case 'audio':
          // Ignore translated audio that arrives while paused; otherwise it
          // would sit in the suspended context and play (stale) on resume.
          if (pausedRef.current) {
            break;
          }
          playback.enqueueBase64(message.pcm16Base64);
          break;
        case 'interrupted':
          // Gemini cut off the in-progress response (barge-in); drop queued
          // translated audio so it does not play over later video.
          playback.flush();
          break;
        case 'error':
          fail(message.code, message.message, message.retryable);
          break;
        case 'closed':
          cleanup('idle');
          break;
        default:
          break;
      }
    },
    [playback, fail, cleanup],
  );

  const start = useCallback(() => {
    const element = videoElementRef.current;
    if (!element || wsRef.current) {
      return;
    }
    // MVP supports only normal playback rate (Gemini expects real-time cadence).
    if (element.playbackRate !== 1) {
      fail(
        'unsupported_playback_rate',
        UNSUPPORTED_PLAYBACK_RATE_MESSAGE,
        false,
      );
      return;
    }

    // Reset any prior error and per-session state.
    setErrorCode(null);
    setErrorMessage(null);
    setRetryable(false);
    captureStartedRef.current = false;
    beginCaptureRef.current = null;
    pausedRef.current = false;

    // Create + resume the audio contexts synchronously within this user gesture
    // so the browser autoplay policy allows them to run.
    try {
      capture.prime(element);
      playback.prime();
    } catch {
      fail('audio_capture_failed', 'Audio capture failed to start.', false);
      return;
    }
    setStatus('connecting');
    const startAttempt = startAttemptRef.current + 1;
    startAttemptRef.current = startAttempt;
    const isCurrentStart = () =>
      startAttemptRef.current === startAttempt && videoElementRef.current === element;

    void (async () => {
      try {
        await ensureCsrfToken();
        if (!isCurrentStart()) {
          return;
        }
        const res = await api.post('/live-translation/sessions', { videoId });
        if (!isCurrentStart()) {
          return;
        }
        const ticket = res.data?.ticket as string;
        const wsPath = (res.data?.wsPath as string) || '/api/live-translation/ws';
        if (!ticket) {
          fail('ticket_missing', 'Failed to obtain a session ticket.', true);
          return;
        }

        // Send the one-use ticket via Sec-WebSocket-Protocol rather than the
        // URL so it does not appear in ordinary access logs.
        const ws = new WebSocket(buildLiveTranslationWsUrl(wsPath), ['ticket', ticket]);
        wsRef.current = ws;
        seqRef.current = 0;
        audioSeqRef.current = 0;

        ws.onopen = () => {
          if (!isCurrentStart() || wsRef.current !== ws) {
            return;
          }
          sendControl({
            type: 'start',
            videoId,
            currentTime: element.currentTime,
            playbackRate: element.playbackRate,
          });

          // Defer starting capture (which mutes the original audio) until the
          // server reports `status: translating`, i.e. Gemini can accept audio.
          // The backend drops audio until setup completes, so muting earlier
          // would silently lose the words playing during setup latency.
          const startCapture = () => {
            if (
              captureStartedRef.current ||
              !isCurrentStart() ||
              wsRef.current !== ws
            ) {
              return;
            }
            captureStartedRef.current = true;
            void capture
              .start(element, (pcm16) => {
                const socket = wsRef.current;
                if (!isCurrentStart() || socket !== ws) {
                  return;
                }
                // Only forward audio while the video is actually playing.
                if (element.paused) {
                  return;
                }
                if (socket && socket.readyState === WS_OPEN) {
                  socket.send(
                    encodeClientMessage({
                      type: 'audio',
                      seq: audioSeqRef.current++,
                      mediaTime: element.currentTime,
                      sampleRate: 16000,
                      channels: 1,
                      pcm16Base64: int16ToBase64(pcm16),
                    }),
                  );
                }
              })
              .then(() => {
                if (!isCurrentStart() || wsRef.current !== ws) {
                  capture.stop(element);
                }
              })
              .catch(() => {
                if (!isCurrentStart() || wsRef.current !== ws) {
                  return;
                }
                fail('audio_capture_failed', 'Audio capture failed to start.', false);
              });
          };
          beginCaptureRef.current = startCapture;

          attachMediaListeners();
          if (element.paused) {
            pausedRef.current = true;
            sendControl({ type: 'pause', currentTime: element.currentTime });
            playback.pause();
          }
          // Status stays 'connecting' until the server reports 'translating';
          // the original audio remains audible until then.
        };
        ws.onmessage = (event: MessageEvent) => {
          if (typeof event.data === 'string') {
            handleServerData(event.data);
          }
        };
        ws.onerror = () => {
          fail('gemini_connect_failed', 'Live translation connection failed.', true);
        };
        ws.onclose = () => {
          if (wsRef.current === ws) {
            cleanup('idle');
          }
        };
      } catch {
        if (!isCurrentStart()) {
          return;
        }
        fail('gemini_connect_failed', 'Failed to start live translation.', true);
      }
    })();
  }, [
    capture,
    playback,
    videoId,
    sendControl,
    attachMediaListeners,
    handleServerData,
    fail,
    cleanup,
  ]);

  const stop = useCallback(() => {
    sendControl({ type: 'stop' });
    cleanup('idle');
  }, [sendControl, cleanup]);

  // Stop the session if the video changes or the component unmounts.
  useEffect(() => {
    return () => {
      cleanup('idle');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // Fully dispose the per-element capture graph when the element is replaced or
  // unmounted (browsers do not allow re-creating a source node for an element).
  useEffect(() => {
    if (!videoElement) {
      return;
    }
    return () => {
      capture.dispose(videoElement);
    };
  }, [videoElement, capture]);

  return {
    status,
    isActive: status === 'connecting' || status === 'translating' || status === 'paused',
    errorCode,
    errorMessage,
    retryable,
    start,
    stop,
  };
}
