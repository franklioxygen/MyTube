import { describe, expect, it, vi } from "vitest";
import {
  buildSetupMessage,
  GeminiLiveTranslationClient,
  GeminiSocketLike,
} from "../../../services/liveTranslation/geminiLiveTranslationClient";

class FakeSocket implements GeminiSocketLike {
  readyState = 0;
  sent: string[] = [];
  private handlers: Record<string, ((...args: any[]) => void)[]> = {};

  on(event: string, cb: (...args: any[]) => void): void {
    (this.handlers[event] ||= []).push(cb);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.emit("close", 1000, "");
  }
  emit(event: string, ...args: any[]): void {
    for (const cb of this.handlers[event] || []) cb(...args);
  }
  open(): void {
    this.readyState = 1;
    this.emit("open");
  }
  message(obj: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(obj)), true);
  }
}

function makeClient(handlers = {}) {
  const fake = new FakeSocket();
  const client = new GeminiLiveTranslationClient({
    apiKey: "k",
    model: "gemini-3.5-live-translate-preview",
    targetLanguage: "en",
    handlers,
    socketFactory: () => fake,
  });
  return { client, fake };
}

describe("buildSetupMessage", () => {
  it("nests translationConfig in generationConfig and transcriptions at setup level", () => {
    const msg = buildSetupMessage({ model: "gemini-3.5-live-translate-preview", targetLanguage: "es" }) as any;
    expect(msg.setup.model).toBe("models/gemini-3.5-live-translate-preview");
    expect(msg.setup.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(msg.setup.generationConfig.translationConfig.targetLanguageCode).toBe("es");
    // Transcription configs must NOT be inside generationConfig.
    expect(msg.setup.generationConfig.inputAudioTranscription).toBeUndefined();
    expect(msg.setup.inputAudioTranscription).toEqual({});
    expect(msg.setup.outputAudioTranscription).toEqual({});
  });

  it("does not double-prefix an already-qualified model name", () => {
    const msg = buildSetupMessage({ model: "models/gemini-3.5-live-translate-preview", targetLanguage: "en" }) as any;
    expect(msg.setup.model).toBe("models/gemini-3.5-live-translate-preview");
  });
});

describe("GeminiLiveTranslationClient", () => {
  it("sends the setup message with the target language on open", () => {
    const { client, fake } = makeClient();
    client.connect();
    fake.open();
    expect(fake.sent).toHaveLength(1);
    const setup = JSON.parse(fake.sent[0]);
    expect(setup.setup.generationConfig.translationConfig.targetLanguageCode).toBe("en");
  });

  it("emits ready on setupComplete", () => {
    const onReady = vi.fn();
    const { client, fake } = makeClient({ onReady });
    client.connect();
    fake.open();
    expect(client.ready).toBe(false);
    fake.message({ setupComplete: {} });
    expect(onReady).toHaveBeenCalledOnce();
    expect(client.ready).toBe(true);
  });

  it("forwards audio as audio/pcm;rate=16000 only when ready", () => {
    const { client, fake } = makeClient();
    client.connect();
    fake.open();
    expect(client.sendAudio("AAAA")).toBe(false); // not ready yet
    fake.message({ setupComplete: {} });
    expect(client.sendAudio("AAAA")).toBe(true);
    const audioMsg = JSON.parse(fake.sent[fake.sent.length - 1]);
    expect(audioMsg.realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000");
    expect(audioMsg.realtimeInput.audio.data).toBe("AAAA");
  });

  it("maps input/output transcripts and inline audio", () => {
    const onInputTranscript = vi.fn();
    const onOutputTranscript = vi.fn();
    const onAudio = vi.fn();
    const { client, fake } = makeClient({ onInputTranscript, onOutputTranscript, onAudio });
    client.connect();
    fake.open();
    fake.message({ setupComplete: {} });

    fake.message({ serverContent: { inputTranscription: { text: "hola", languageCode: "es" } } });
    expect(onInputTranscript).toHaveBeenCalledWith("hola", "es");

    fake.message({ serverContent: { outputTranscription: { text: "hello", languageCode: "en" } } });
    expect(onOutputTranscript).toHaveBeenCalledWith("hello", "en");

    fake.message({
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "QUJD" } }] } },
    });
    expect(onAudio).toHaveBeenCalledWith("QUJD");
  });

  it("reports a setup failure when closed before setupComplete (code 1007)", () => {
    const onError = vi.fn();
    const onClose = vi.fn();
    const { client, fake } = makeClient({ onError, onClose });
    client.connect();
    fake.open();
    fake.emit("close", 1007, Buffer.from("Invalid JSON payload"));
    expect(onError).toHaveBeenCalledWith("gemini_setup_failed", expect.any(String), true);
    expect(onClose).toHaveBeenCalled();
  });
});
