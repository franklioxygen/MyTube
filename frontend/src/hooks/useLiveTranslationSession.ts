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
      sendControl({ type: 'pause', currentTime: element.currentTime });
      playback.pause();
      setStatus((prev) => (prev === 'translating' ? 'paused' : prev));
    };
    const onPlay = () => {
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
    element.addEventListener('pause', onPause);
    element.addEventListener('play', onPlay);
    element.addEventListener('seeking', onSeeking);
    element.addEventListener('ratechange', onRateChange);
    mediaListenersRef.current = () => {
      element.removeEventListener('pause', onPause);
      element.removeEventListener('play', onPlay);
      element.removeEventListener('seeking', onSeeking);
      element.removeEventListener('ratechange', onRateChange);
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
          if (message.status === 'translating') setStatus('translating');
          else if (message.status === 'paused') setStatus('paused');
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
          playback.enqueueBase64(message.pcm16Base64);
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

    // Reset any prior error.
    setErrorCode(null);
    setErrorMessage(null);
    setRetryable(false);

    // Create + resume the audio contexts synchronously within this user gesture
    // so the browser autoplay policy allows them to run.
    capture.prime(element);
    playback.prime();
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
          attachMediaListeners();
          if (element.paused) {
            sendControl({ type: 'pause', currentTime: element.currentTime });
            playback.pause();
            setStatus('paused');
          } else {
            setStatus('translating');
          }
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
