import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetActiveSessionsForTest,
  BrowserSocketLike,
  GatewayOptions,
  getActiveSessionCount,
  LiveTranslationGateway,
  MAX_AUDIO_BASE64_CHARS_PER_WINDOW,
  MAX_AUDIO_BASE64_LENGTH,
  MAX_AUDIO_FRAMES_PER_WINDOW,
  MAX_ACTIVE_SESSIONS,
  SESSION_DURATION_CAP_MS,
  STALL_TIMEOUT_MS,
} from "../../../services/liveTranslation/liveTranslationGateway";
import { LiveTranslationServerConfig } from "../../../services/liveTranslation/config";
import { GeminiSocketLike } from "../../../services/liveTranslation/geminiLiveTranslationClient";

const config: LiveTranslationServerConfig = {
  enabled: true,
  model: "gemini-3.5-live-translate-preview",
  sourceLanguage: "auto",
  targetLanguage: "en",
  apiKey: "secret-key",
  apiKeyConfigured: true,
};

class FakeBrowser implements BrowserSocketLike {
  readyState = 1;
  bufferedAmount = 0;
  sent: any[] = [];
  private handlers: Record<string, ((...a: any[]) => void)[]> = {};
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  on(event: string, cb: (...a: any[]) => void) {
    (this.handlers[event] ||= []).push(cb);
  }
  emit(event: string, ...args: any[]) {
    for (const cb of this.handlers[event] || []) cb(...args);
  }
  clientMessage(obj: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(obj)));
  }
  typed(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
}

class FakeGemini implements GeminiSocketLike {
  readyState = 0;
  sent: any[] = [];
  private handlers: Record<string, ((...a: any[]) => void)[]> = {};
  on(event: string, cb: (...a: any[]) => void) {
    (this.handlers[event] ||= []).push(cb);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.emit("close", 1000, "");
  }
  emit(event: string, ...args: any[]) {
    for (const cb of this.handlers[event] || []) cb(...args);
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  message(obj: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(obj)), true);
  }
}

function makeGateway(overrides: Partial<GatewayOptions> = {}) {
  const browser = new FakeBrowser();
  const gemini = new FakeGemini();
  const gateway = new LiveTranslationGateway(browser, {
    config,
    videoId: "v1",
    geminiSocketFactory: () => gemini,
    ...overrides,
  });
  return { browser, gemini, gateway };
}

function startBrowserStream(browser: FakeBrowser) {
  browser.clientMessage({
    type: "start",
    videoId: "v1",
    currentTime: 0,
    playbackRate: 1,
  });
}

describe("LiveTranslationGateway", () => {
  beforeEach(() => __resetActiveSessionsForTest());
  afterEach(() => {
    __resetActiveSessionsForTest();
    vi.useRealTimers();
  });

  it("sends ready and reaches translating after Gemini setup", () => {
    const { browser, gemini, gateway } = makeGateway();
    gateway.start();
    expect(browser.typed("ready")).toHaveLength(1);
    expect(getActiveSessionCount()).toBe(1);

    gemini.open();
    gemini.message({ setupComplete: {} });
    expect(browser.typed("status").map((m) => m.status)).toContain("translating");
  });

  it("forwards browser audio to Gemini once ready", () => {
    const { browser, gemini, gateway } = makeGateway();
    gateway.start();
    gemini.open();
    gemini.message({ setupComplete: {} });
    startBrowserStream(browser);

    browser.clientMessage({
      type: "audio",
      seq: 1,
      mediaTime: 0,
      sampleRate: 16000,
      channels: 1,
      pcm16Base64: "AAAA",
    });
    const audioOut = gemini.sent.filter((m) => m.realtimeInput?.audio);
    expect(audioOut).toHaveLength(1);
    expect(audioOut[0].realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000");
  });

  it("rate-limits browser audio frame cadence before forwarding to Gemini", () => {
    const now = 1_000;
    const { browser, gemini, gateway } = makeGateway({ now: () => now });
    gateway.start();
    gemini.open();
    gemini.message({ setupComplete: {} });
    startBrowserStream(browser);

    for (let seq = 1; seq <= MAX_AUDIO_FRAMES_PER_WINDOW; seq += 1) {
      browser.clientMessage({
        type: "audio",
        seq,
        mediaTime: seq / 10,
        sampleRate: 16000,
        channels: 1,
        pcm16Base64: "AAAA",
      });
    }

    expect(gemini.sent.filter((m) => m.realtimeInput?.audio)).toHaveLength(
      MAX_AUDIO_FRAMES_PER_WINDOW
    );

    browser.clientMessage({
      type: "audio",
      seq: MAX_AUDIO_FRAMES_PER_WINDOW + 1,
      mediaTime: 2.1,
      sampleRate: 16000,
      channels: 1,
      pcm16Base64: "AAAA",
    });

    expect(browser.typed("error")[0].code).toBe("audio_backpressure");
    expect(browser.typed("closed")[0].reason).toBe("audio_rate_limited");
    expect(gemini.sent.filter((m) => m.realtimeInput?.audio)).toHaveLength(
      MAX_AUDIO_FRAMES_PER_WINDOW
    );
  });

  it("rate-limits browser audio bytes before forwarding to Gemini", () => {
    const { browser, gemini, gateway } = makeGateway({ now: () => 2_000 });
    gateway.start();
    gemini.open();
    gemini.message({ setupComplete: {} });
    startBrowserStream(browser);

    const largePayload = "A".repeat(MAX_AUDIO_BASE64_LENGTH);
    expect(MAX_AUDIO_BASE64_LENGTH * 2).toBeGreaterThan(
      MAX_AUDIO_BASE64_CHARS_PER_WINDOW
    );

    browser.clientMessage({
      type: "audio",
      seq: 1,
      mediaTime: 0,
      sampleRate: 16000,
      channels: 1,
      pcm16Base64: largePayload,
    });
    browser.clientMessage({
      type: "audio",
      seq: 2,
      mediaTime: 0.1,
      sampleRate: 16000,
      channels: 1,
      pcm16Base64: largePayload,
    });

    expect(browser.typed("error")[0].code).toBe("audio_backpressure");
    expect(gemini.sent.filter((m) => m.realtimeInput?.audio)).toHaveLength(1);
  });

  it("rejects audio before a valid start message", () => {
    const { browser, gemini, gateway } = makeGateway();
    gateway.start();
    gemini.open();
    gemini.message({ setupComplete: {} });

    browser.clientMessage({
      type: "audio",
      seq: 1,
      mediaTime: 0,
      sampleRate: 16000,
      channels: 1,
      pcm16Base64: "AAAA",
    });

    expect(browser.typed("error")[0].code).toBe("protocol_error");
    expect(gemini.sent.filter((m) => m.realtimeInput?.audio)).toHaveLength(0);
  });

  it("rejects audio with invalid format metadata", () => {
    const { browser, gemini, gateway } = makeGateway();
    gateway.start();
    gemini.open();
    gemini.message({ setupComplete: {} });
    startBrowserStream(browser);

    browser.clientMessage({
      type: "audio",
      seq: 1,
      mediaTime: 0,
      sampleRate: 48000,
      channels: 2,
      pcm16Base64: "AAAA",
    });

    expect(browser.typed("error")[0].code).toBe("audio_payload_invalid");
    expect(gemini.sent.filter((m) => m.realtimeInput?.audio)).toHaveLength(0);
  });

  it("maps Gemini transcripts and audio back to the browser", () => {
    const { browser, gemini, gateway } = makeGateway();
    gateway.start();
    gemini.open();
    gemini.message({ setupComplete: {} });

    gemini.message({ serverContent: { outputTranscription: { text: "hello", languageCode: "en" } } });
    expect(browser.typed("outputTranscript")[0].text).toBe("hello");

    gemini.message({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "QUJD" } }] } } });
    const audio = browser.typed("audio");
    expect(audio[0].sampleRate).toBe(24000);
    expect(audio[0].pcm16Base64).toBe("QUJD");
  });

  it("forwards a Gemini interruption to the browser", () => {
    const { browser, gemini, gateway } = makeGateway();
    gateway.start();
    gemini.open();
    gemini.message({ setupComplete: {} });

    gemini.message({ serverContent: { interrupted: true } });
    expect(browser.typed("interrupted")).toHaveLength(1);
  });

  it("does not forward audio while paused", () => {
    const { browser, gemini, gateway } = makeGateway();
    gateway.start();
    gemini.open();
    gemini.message({ setupComplete: {} });
    startBrowserStream(browser);
    browser.clientMessage({ type: "pause", currentTime: 1 });

    browser.clientMessage({
      type: "audio",
      seq: 1,
      mediaTime: 1,
      sampleRate: 16000,
      channels: 1,
      pcm16Base64: "AAAA",
    });
    expect(gemini.sent.filter((m) => m.realtimeInput?.audio)).toHaveLength(0);
  });

  it("stays paused when pause arrives before Gemini setup completes", () => {
    vi.useFakeTimers();
    const { browser, gemini, gateway } = makeGateway();
    gateway.start();
    startBrowserStream(browser);
    browser.clientMessage({ type: "pause", currentTime: 1 });

    gemini.open();
    gemini.message({ setupComplete: {} });

    expect(browser.typed("status").map((m) => m.status)).toContain("paused");
    expect(browser.typed("status").map((m) => m.status)).not.toContain("translating");

    vi.advanceTimersByTime(STALL_TIMEOUT_MS + 10);
    expect(browser.typed("closed")).toHaveLength(0);
  });

  it("keeps resume in connecting until Gemini setup completes", () => {
    vi.useFakeTimers();
    const { browser, gemini, gateway } = makeGateway();
    gateway.start();
    startBrowserStream(browser);
    browser.clientMessage({ type: "pause", currentTime: 1 });

    browser.clientMessage({ type: "resume", currentTime: 2 });

    expect(browser.typed("status").map((m) => m.status)).toEqual([
      "paused",
      "connecting",
    ]);

    vi.advanceTimersByTime(STALL_TIMEOUT_MS + 10);
    expect(browser.typed("closed")).toHaveLength(0);

    gemini.open();
    gemini.message({ setupComplete: {} });
    expect(browser.typed("status").map((m) => m.status)).toEqual([
      "paused",
      "connecting",
      "translating",
    ]);
  });

  it("stops cleanly on a client stop message", () => {
    const { browser, gateway } = makeGateway();
    gateway.start();
    browser.clientMessage({ type: "stop" });
    expect(browser.typed("closed")).toHaveLength(1);
    expect(getActiveSessionCount()).toBe(0);
  });

  it("rejects a session beyond the per-server cap", () => {
    const gateways = [];
    for (let i = 0; i < MAX_ACTIVE_SESSIONS; i++) {
      const g = makeGateway();
      g.gateway.start();
      gateways.push(g);
    }
    expect(getActiveSessionCount()).toBe(MAX_ACTIVE_SESSIONS);

    const extra = makeGateway();
    extra.gateway.start();
    expect(extra.browser.typed("error")[0].code).toBe("too_many_sessions");
    expect(extra.browser.typed("closed")).toHaveLength(1);
    expect(getActiveSessionCount()).toBe(MAX_ACTIVE_SESSIONS);
  });

  it("closes with session_timeout when the duration cap is hit", () => {
    vi.useFakeTimers();
    const { browser, gateway } = makeGateway();
    gateway.start();
    vi.advanceTimersByTime(SESSION_DURATION_CAP_MS + 10);
    expect(browser.typed("error")[0].code).toBe("session_timeout");
    expect(browser.typed("closed")).toHaveLength(1);
  });
});
