/**
 * Browser <-> backend live translation WebSocket protocol (design §8.5).
 * Mirrors `backend/src/services/liveTranslation/protocol.ts`.
 */

export type ClientMessage =
  | {
      type: 'start';
      videoId: string;
      currentTime: number;
      playbackRate: number;
    }
  | {
      type: 'audio';
      seq: number;
      mediaTime: number;
      sampleRate: 16000;
      channels: 1;
      pcm16Base64: string;
    }
  | { type: 'pause'; currentTime: number }
  | { type: 'resume'; currentTime: number }
  | { type: 'seek'; currentTime: number }
  | { type: 'stop' }
  | { type: 'ping'; ts: number };

export type LiveTranslationStatus =
  | 'connecting'
  | 'translating'
  | 'paused'
  | 'closing';

export type LiveTranslationErrorCode =
  | 'feature_disabled'
  | 'admin_required'
  | 'api_key_missing'
  | 'invalid_settings'
  | 'ticket_missing'
  | 'ticket_expired'
  | 'ticket_used'
  | 'origin_forbidden'
  | 'gemini_connect_failed'
  | 'gemini_setup_failed'
  | 'gemini_rate_limited'
  | 'gemini_stream_closed'
  | 'gemini_not_ready'
  | 'audio_payload_invalid'
  | 'audio_backpressure'
  | 'session_timeout'
  | 'too_many_sessions'
  | 'protocol_error'
  // Client-only conditions (the backend never emits these).
  | 'unsupported_playback_rate'
  | 'audio_capture_failed'
  | 'websocket_connect_failed';

export type ServerMessage =
  | { type: 'ready'; sessionId: string }
  | { type: 'status'; status: LiveTranslationStatus }
  | {
      type: 'inputTranscript';
      text: string;
      languageCode?: string;
      mediaTime?: number;
    }
  | {
      type: 'outputTranscript';
      text: string;
      languageCode?: string;
      mediaTime?: number;
      durationMs?: number;
    }
  | {
      type: 'audio';
      seq: number;
      sampleRate: 24000;
      channels: 1;
      pcm16Base64: string;
    }
  | { type: 'pong'; ts: number }
  // Gemini interrupted the in-progress response (barge-in); flush queued audio.
  | { type: 'interrupted' }
  | {
      type: 'error';
      code: LiveTranslationErrorCode;
      message: string;
      retryable: boolean;
    }
  | { type: 'closed'; reason: string };

export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

export function parseServerMessage(data: string): ServerMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed.type === 'string') {
      return parsed as ServerMessage;
    }
    return null;
  } catch {
    return null;
  }
}
