import WebSocket from "ws";
import { logger } from "../../utils/logger";
import { LiveTranslationErrorCode } from "./protocol";

const GEMINI_WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const INPUT_AUDIO_MIME = "audio/pcm;rate=16000";

/** Minimal surface of a WebSocket so tests can inject a fake socket. */
export interface GeminiSocketLike {
  on(event: "open", cb: () => void): void;
  on(event: "message", cb: (data: unknown, isBinary?: boolean) => void): void;
  on(event: "close", cb: (code: number, reason?: unknown) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
}

export type GeminiSocketFactory = (url: string) => GeminiSocketLike;

export interface GeminiClientHandlers {
  onReady?: () => void;
  onInputTranscript?: (text: string, languageCode?: string) => void;
  onOutputTranscript?: (text: string, languageCode?: string) => void;
  onAudio?: (base64Pcm24: string) => void;
  onError?: (
    code: LiveTranslationErrorCode,
    message: string,
    retryable: boolean
  ) => void;
  onClose?: (reason: string) => void;
}

export interface GeminiClientOptions {
  apiKey: string;
  model: string;
  targetLanguage: string;
  echoTargetLanguage?: boolean;
  handlers: GeminiClientHandlers;
  socketFactory?: GeminiSocketFactory;
}

/**
 * Build the Gemini Live `setup` message. Confirmed against the live API on
 * 2026-06-18: `translationConfig` lives inside `generationConfig`, while the
 * transcription configs are siblings of `generationConfig` at the `setup` level.
 */
export function buildSetupMessage(opts: {
  model: string;
  targetLanguage: string;
  echoTargetLanguage?: boolean;
}): Record<string, unknown> {
  const modelName = opts.model.startsWith("models/")
    ? opts.model
    : `models/${opts.model}`;

  return {
    setup: {
      model: modelName,
      generationConfig: {
        responseModalities: ["AUDIO"],
        translationConfig: {
          targetLanguageCode: opts.targetLanguage,
          echoTargetLanguage: opts.echoTargetLanguage === true,
        },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

export function buildGeminiWsUrl(apiKey: string): string {
  return `${GEMINI_WS_BASE}?key=${encodeURIComponent(apiKey)}`;
}

function rawDataToString(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data as Buffer[]).toString("utf8");
  }
  return String(data);
}

const WS_OPEN = 1;

/**
 * Adapter around a single outbound Gemini Live Translation socket. Owns the
 * setup handshake, audio forwarding, and response mapping. Emits typed events
 * through the handler callbacks; never logs transcript text.
 */
export class GeminiLiveTranslationClient {
  private readonly opts: GeminiClientOptions;
  private socket: GeminiSocketLike | null = null;
  private setupComplete = false;
  private closed = false;

  constructor(opts: GeminiClientOptions) {
    this.opts = opts;
  }

  get ready(): boolean {
    return this.setupComplete && !this.closed;
  }

  connect(): void {
    const factory: GeminiSocketFactory =
      this.opts.socketFactory ??
      ((url) => new WebSocket(url) as unknown as GeminiSocketLike);

    let socket: GeminiSocketLike;
    try {
      socket = factory(buildGeminiWsUrl(this.opts.apiKey));
    } catch (err) {
      this.emitError(
        "gemini_connect_failed",
        err instanceof Error ? err.message : "Failed to open Gemini socket",
        true
      );
      return;
    }
    this.socket = socket;

    socket.on("open", () => {
      try {
        socket.send(
          JSON.stringify(
            buildSetupMessage({
              model: this.opts.model,
              targetLanguage: this.opts.targetLanguage,
              echoTargetLanguage: this.opts.echoTargetLanguage,
            })
          )
        );
      } catch (err) {
        this.emitError(
          "gemini_setup_failed",
          err instanceof Error ? err.message : "Failed to send setup",
          true
        );
      }
    });

    socket.on("message", (data) => this.handleMessage(data));
    socket.on("error", (err) => {
      this.emitError(
        this.setupComplete ? "gemini_stream_closed" : "gemini_connect_failed",
        err instanceof Error ? err.message : "Gemini socket error",
        !this.setupComplete
      );
    });
    socket.on("close", (code, reason) => {
      const reasonText =
        typeof reason === "string"
          ? reason
          : Buffer.isBuffer(reason)
            ? reason.toString("utf8")
            : "";
      if (!this.setupComplete) {
        // Closed before the handshake completed: a bad setup (e.g. 1007) or a
        // refused connection.
        this.emitError(
          code === 1007 ? "gemini_setup_failed" : "gemini_connect_failed",
          reasonText || `Gemini closed before setup (code ${code})`,
          true
        );
      }
      this.closed = true;
      this.opts.handlers.onClose?.(reasonText || `closed:${code}`);
    });
  }

  private handleMessage(data: unknown): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(rawDataToString(data));
    } catch {
      return;
    }

    if (msg.setupComplete !== undefined) {
      this.setupComplete = true;
      this.opts.handlers.onReady?.();
      return;
    }

    const serverContent = msg.serverContent as
      | Record<string, unknown>
      | undefined;
    if (!serverContent) {
      return;
    }

    const input = serverContent.inputTranscription as
      | { text?: string; languageCode?: string }
      | undefined;
    if (input && typeof input.text === "string") {
      this.opts.handlers.onInputTranscript?.(input.text, input.languageCode);
    }

    const output = serverContent.outputTranscription as
      | { text?: string; languageCode?: string }
      | undefined;
    if (output && typeof output.text === "string") {
      this.opts.handlers.onOutputTranscript?.(output.text, output.languageCode);
    }

    const modelTurn = serverContent.modelTurn as
      | { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> }
      | undefined;
    if (modelTurn?.parts) {
      for (const part of modelTurn.parts) {
        const inline = part.inlineData;
        if (inline && typeof inline.data === "string" && inline.data.length > 0) {
          this.opts.handlers.onAudio?.(inline.data);
        }
      }
    }
  }

  /** Forward a base64 PCM16 16 kHz mono chunk to Gemini. No-op if not ready. */
  sendAudio(base64Pcm16: string): boolean {
    if (!this.ready || !this.socket || this.socket.readyState !== WS_OPEN) {
      return false;
    }
    try {
      this.socket.send(
        JSON.stringify({
          realtimeInput: {
            audio: { data: base64Pcm16, mimeType: INPUT_AUDIO_MIME },
          },
        })
      );
      return true;
    } catch (err) {
      logger.warn("Failed to forward audio to Gemini", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /** Signal end of the current audio turn (flush). */
  endAudioStream(): void {
    if (!this.ready || !this.socket || this.socket.readyState !== WS_OPEN) {
      return;
    }
    try {
      this.socket.send(
        JSON.stringify({ realtimeInput: { audioStreamEnd: true } })
      );
    } catch {
      // Best-effort flush.
    }
  }

  close(): void {
    this.closed = true;
    if (this.socket) {
      try {
        this.socket.close(1000, "client closing");
      } catch {
        // ignore
      }
    }
  }

  private emitError(
    code: LiveTranslationErrorCode,
    message: string,
    retryable: boolean
  ): void {
    this.opts.handlers.onError?.(code, message, retryable);
  }
}
