import crypto from "crypto";
import { logger } from "../../utils/logger";
import {
  GeminiClientHandlers,
  GeminiLiveTranslationClient,
  GeminiSocketFactory,
} from "./geminiLiveTranslationClient";
import { LiveTranslationServerConfig } from "./config";
import {
  ClientMessage,
  LiveTranslationErrorCode,
  ServerMessage,
} from "./protocol";

/** Server-side view of the browser WebSocket (the `ws` connection). */
export interface BrowserSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", cb: (data: unknown, isBinary?: boolean) => void): void;
  on(event: "close", cb: () => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  readyState: number;
  bufferedAmount: number;
}

export interface GatewayOptions {
  config: LiveTranslationServerConfig;
  videoId: string;
  /** Injectable for tests; defaults to the real Gemini client's `ws` factory. */
  geminiSocketFactory?: GeminiSocketFactory;
  /** Injectable timers for tests. */
  now?: () => number;
}

const WS_OPEN = 1;

// Abuse / resource guards (design §12, §8.5).
export const MAX_ACTIVE_SESSIONS = 2;
export const SESSION_DURATION_CAP_MS = 9 * 60 * 1000;
export const STALL_TIMEOUT_MS = 30 * 1000;
// 100 ms of 16 kHz mono PCM16 is ~3200 bytes -> ~4267 base64 chars. Allow ample
// headroom for JSON overhead while still rejecting absurd payloads.
export const MAX_AUDIO_BASE64_LENGTH = 64 * 1024;
// Close if the server -> browser buffer grows beyond this (unbounded growth).
export const MAX_BROWSER_BUFFERED_BYTES = 8 * 1024 * 1024;

// Single-process registry of active sessions for the per-server cap.
const activeSessions = new Set<string>();

export function getActiveSessionCount(): number {
  return activeSessions.size;
}

export function __resetActiveSessionsForTest(): void {
  activeSessions.clear();
}

type SessionStatus = "connecting" | "translating" | "paused" | "closing";

/**
 * Bridges one browser socket to one Gemini Live Translation session. Owns the
 * lifecycle: registration against the per-server cap, control-message handling,
 * response forwarding, the session duration cap, the stall watchdog, and
 * teardown. Never logs transcript text.
 */
export class LiveTranslationGateway {
  private readonly sessionId = crypto.randomUUID();
  private readonly browser: BrowserSocketLike;
  private readonly opts: GatewayOptions;
  private readonly now: () => number;
  private gemini: GeminiLiveTranslationClient | null = null;
  private status: SessionStatus = "connecting";
  private registered = false;
  private disposed = false;
  private started = false;
  private outboundAudioSeq = 0;

  private durationTimer: NodeJS.Timeout | null = null;
  private stallTimer: NodeJS.Timeout | null = null;

  constructor(browser: BrowserSocketLike, opts: GatewayOptions) {
    this.browser = browser;
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  /** Begin the session. Enforces the per-server cap, then opens Gemini. */
  start(): void {
    if (activeSessions.size >= MAX_ACTIVE_SESSIONS) {
      this.sendError(
        "too_many_sessions",
        "Too many active live translation sessions. Try again shortly.",
        true
      );
      this.close("too_many_sessions");
      return;
    }
    activeSessions.add(this.sessionId);
    this.registered = true;
    // Operational metric only — never log transcript/audio content.
    logger.info("Live translation session started", {
      sessionId: this.sessionId,
      activeSessions: activeSessions.size,
    });

    this.browser.on("message", (data) => this.handleBrowserMessage(data));
    this.browser.on("close", () => this.dispose("browser_closed"));
    this.browser.on("error", () => this.dispose("browser_error"));

    this.send({ type: "ready", sessionId: this.sessionId });
    this.setStatus("connecting");
    this.openGemini();

    this.durationTimer = setTimeout(() => {
      this.sendError(
        "session_timeout",
        "Live translation session reached its time limit. Restart to continue.",
        true
      );
      this.close("session_timeout");
    }, SESSION_DURATION_CAP_MS);
    this.durationTimer.unref?.();
  }

  private openGemini(): void {
    const handlers: GeminiClientHandlers = {
      onReady: () => {
        if (this.status === "paused") {
          this.clearStallTimer();
          return;
        }
        this.setStatus("translating");
        this.armStallTimer();
      },
      onInputTranscript: (text, languageCode) => {
        this.bumpStallTimer();
        this.send({ type: "inputTranscript", text, languageCode });
      },
      onOutputTranscript: (text, languageCode) => {
        this.bumpStallTimer();
        this.send({ type: "outputTranscript", text, languageCode });
      },
      onAudio: (base64) => {
        this.bumpStallTimer();
        this.forwardTranslatedAudio(base64);
      },
      onInterrupted: () => {
        // Barge-in: tell the browser to drop any queued translated audio.
        this.send({ type: "interrupted" });
      },
      onError: (code, message, retryable) => {
        this.sendError(code, message, retryable);
      },
      onClose: () => {
        if (!this.disposed) {
          this.sendError(
            "gemini_stream_closed",
            "Translation stream closed.",
            true
          );
          this.close("gemini_closed");
        }
      },
    };

    this.gemini = new GeminiLiveTranslationClient({
      apiKey: this.opts.config.apiKey,
      model: this.opts.config.model,
      targetLanguage: this.opts.config.targetLanguage,
      handlers,
      socketFactory: this.opts.geminiSocketFactory,
    });
    this.gemini.connect();
  }

  private handleBrowserMessage(data: unknown): void {
    if (this.disposed) {
      return;
    }
    let msg: ClientMessage;
    try {
      const text =
        typeof data === "string"
          ? data
          : Buffer.isBuffer(data)
            ? data.toString("utf8")
            : String(data);
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      this.sendError("protocol_error", "Malformed control message.", false);
      return;
    }

    switch (msg.type) {
      case "start":
        if (!this.isValidStartMessage(msg)) {
          this.sendError(
            "protocol_error",
            "Invalid live translation start message.",
            false
          );
          return;
        }
        this.started = true;
        return;
      case "audio":
        this.handleAudio(msg);
        return;
      case "pause":
        // Stop forwarding audio but keep the Gemini socket warm; suppress the
        // stall watchdog so a long pause does not kill the session.
        this.setStatus("paused");
        this.clearStallTimer();
        return;
      case "resume":
        if (this.gemini?.ready) {
          this.setStatus("translating");
          this.armStallTimer();
        } else {
          this.setStatus("connecting");
          this.clearStallTimer();
        }
        return;
      case "seek":
        // Backend has no Gemini seek concept; flushing browser-side queues is a
        // client concern. Flush the current Gemini turn so context restarts.
        this.gemini?.endAudioStream();
        return;
      case "stop":
        this.close("client_stop");
        return;
      case "ping":
        this.send({ type: "pong", ts: msg.ts });
        return;
      default:
        this.sendError("protocol_error", "Unknown message type.", false);
    }
  }

  private isValidStartMessage(msg: ClientMessage): boolean {
    return (
      msg.type === "start" &&
      msg.videoId === this.opts.videoId &&
      typeof msg.currentTime === "number" &&
      Number.isFinite(msg.currentTime) &&
      msg.playbackRate === 1
    );
  }

  private handleAudio(msg: Extract<ClientMessage, { type: "audio" }>): void {
    if (!this.started) {
      this.sendError(
        "protocol_error",
        "Live translation session has not been started.",
        false
      );
      return;
    }

    const { channels, mediaTime, pcm16Base64: base64, sampleRate, seq } = msg;
    if (
      sampleRate !== 16000 ||
      channels !== 1 ||
      typeof seq !== "number" ||
      !Number.isFinite(seq) ||
      typeof mediaTime !== "number" ||
      !Number.isFinite(mediaTime)
    ) {
      this.sendError(
        "audio_payload_invalid",
        "Audio payload metadata is invalid.",
        false
      );
      return;
    }

    if (typeof base64 !== "string" || base64.length === 0) {
      this.sendError("audio_payload_invalid", "Empty audio payload.", false);
      return;
    }
    if (base64.length > MAX_AUDIO_BASE64_LENGTH) {
      this.sendError("audio_payload_invalid", "Audio payload too large.", false);
      return;
    }
    if (this.status === "paused") {
      return;
    }
    if (!this.gemini || !this.gemini.ready) {
      // Drop until Gemini is ready rather than buffering unbounded audio.
      return;
    }
    this.bumpStallTimer();
    this.gemini.sendAudio(base64);
  }

  private forwardTranslatedAudio(base64: string): void {
    if (this.browser.bufferedAmount > MAX_BROWSER_BUFFERED_BYTES) {
      this.sendError(
        "audio_backpressure",
        "Translated audio is backing up; connection is too slow.",
        true
      );
      this.close("backpressure");
      return;
    }
    this.outboundAudioSeq += 1;
    this.send({
      type: "audio",
      seq: this.outboundAudioSeq,
      sampleRate: 24000,
      channels: 1,
      pcm16Base64: base64,
    });
  }

  private armStallTimer(): void {
    this.clearStallTimer();
    if (this.status !== "translating") {
      return;
    }
    this.stallTimer = setTimeout(() => {
      this.sendError(
        "gemini_stream_closed",
        "No translation activity; closing the session.",
        true
      );
      this.close("stall_timeout");
    }, STALL_TIMEOUT_MS);
    this.stallTimer.unref?.();
  }

  private bumpStallTimer(): void {
    if (this.status === "translating") {
      this.armStallTimer();
    }
  }

  private clearStallTimer(): void {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  private setStatus(status: SessionStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    if (status !== "closing") {
      this.send({ type: "status", status });
    }
  }

  private send(message: ServerMessage): void {
    if (this.disposed || this.browser.readyState !== WS_OPEN) {
      return;
    }
    try {
      this.browser.send(JSON.stringify(message));
    } catch (err) {
      logger.warn("Failed to send to live translation browser socket", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private sendError(
    code: LiveTranslationErrorCode,
    message: string,
    retryable: boolean
  ): void {
    this.send({ type: "error", code, message, retryable });
  }

  /** Graceful close: notify the browser, then tear down. */
  close(reason: string): void {
    if (this.disposed) {
      return;
    }
    this.setStatus("closing");
    this.send({ type: "closed", reason });
    this.dispose(reason);
  }

  /** Idempotent teardown of all resources. */
  private dispose(reason: string): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
    this.clearStallTimer();

    try {
      this.gemini?.close();
    } catch {
      // ignore
    }
    this.gemini = null;

    if (this.registered) {
      activeSessions.delete(this.sessionId);
      this.registered = false;
      logger.info("Live translation session ended", {
        sessionId: this.sessionId,
        reason,
        activeSessions: activeSessions.size,
      });
    }

    try {
      if (this.browser.readyState === WS_OPEN) {
        this.browser.close(1000, reason.slice(0, 120));
      }
    } catch {
      // ignore
    }
  }
}
