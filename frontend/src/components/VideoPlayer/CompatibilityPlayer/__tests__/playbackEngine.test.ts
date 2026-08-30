import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemuxer } from "../../../../utils/compatibilityMode/createDemuxer";
import {
  DemuxedPacket,
  MediaDemuxer,
} from "../../../../utils/compatibilityMode/types";
import {
  CompatibilityPlaybackEngine,
  PlaybackSnapshot,
} from "../playbackEngine";

vi.mock("../../../../utils/compatibilityMode/createDemuxer", () => ({
  createDemuxer: vi.fn(),
}));

/* ------------------------------------------------------------------ doubles */

const audioSources: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
let videoDecoders: FakeVideoDecoder[] = [];
let audioDecoders: FakeAudioDecoder[] = [];
let audioContexts: FakeAudioContext[] = [];

class FakeAudioContext {
  static allowStart = true;
  state: AudioContextState = "suspended";
  currentTime = 100;
  destination = {} as AudioNode;

  constructor() {
    audioContexts.push(this);
  }

  resume = vi.fn(async () => {
    if (FakeAudioContext.allowStart) this.state = "running";
  });
  suspend = vi.fn(async () => {
    if (this.state === "running") this.state = "suspended";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });

  createGain() {
    return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  }
  createBuffer(channels: number, frames: number, sampleRate: number) {
    return { copyToChannel: vi.fn(), numberOfChannels: channels, length: frames, sampleRate };
  }
  createBufferSource() {
    const node = {
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
    audioSources.push(node);
    return node;
  }
}

const makeFrame = (timestamp: number) => ({
  timestamp,
  displayWidth: 640,
  displayHeight: 480,
  codedWidth: 640,
  codedHeight: 480,
  close: vi.fn(),
});

class FakeVideoDecoder {
  static supported = true;
  static isConfigSupported = vi.fn(async (config: VideoDecoderConfig) => ({
    supported: FakeVideoDecoder.supported,
    config,
  }));

  state: CodecState = "unconfigured";
  decodeQueueSize = 0;
  ondequeue: (() => void) | null = null;
  readonly decoded: number[] = [];

  constructor(private init: { output: (f: unknown) => void; error: (e: unknown) => void }) {
    videoDecoders.push(this);
  }
  configure() {
    this.state = "configured";
  }
  decode(chunk: { timestamp: number }) {
    this.decoded.push(chunk.timestamp);
    this.init.output(makeFrame(chunk.timestamp));
  }
  /** Simulate a fatal codec error, which per spec also closes the decoder. */
  failWith(error: unknown) {
    this.state = "closed";
    this.init.error(error);
  }
  async flush() {}
  reset() {}
  close() {
    this.state = "closed";
  }
}

class FakeAudioDecoder {
  static supported = true;
  static isConfigSupported = vi.fn(async (config: AudioDecoderConfig) => ({
    supported: FakeAudioDecoder.supported,
    config,
  }));

  state: CodecState = "unconfigured";
  decodeQueueSize = 0;
  ondequeue: (() => void) | null = null;

  constructor(private init: { output: (d: unknown) => void; error: (e: unknown) => void }) {
    audioDecoders.push(this);
  }
  configure() {
    this.state = "configured";
  }
  decode(chunk: { timestamp: number }) {
    this.init.output({
      timestamp: chunk.timestamp,
      duration: 20_000,
      numberOfChannels: 2,
      numberOfFrames: 960,
      sampleRate: 48000,
      copyTo: vi.fn(),
      close: vi.fn(),
    });
  }
  async flush() {}
  reset() {}
  close() {
    this.state = "closed";
  }
}

class FakeChunk {
  timestamp: number;
  type: string;
  constructor(init: { timestamp: number; type: string }) {
    this.timestamp = init.timestamp;
    this.type = init.type;
  }
}

/* ------------------------------------------------------------------ harness */

let rafQueue: FrameRequestCallback[] = [];
let timerQueue: Array<() => void> = [];
/** When false, requested animation frames are dropped, as a hidden page does. */
let deliverFrames = true;

const runFrames = async (count = 1) => {
  for (let i = 0; i < count; i += 1) {
    const queue = rafQueue;
    rafQueue = [];
    if (deliverFrames) {
      for (const callback of queue) callback(0);
    }
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
};

/** Fire the fallback timers the render loop schedules alongside each frame. */
const runFallbackTimers = async (count = 1) => {
  for (let i = 0; i < count; i += 1) {
    const queue = timerQueue;
    timerQueue = [];
    for (const callback of queue) callback();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
};

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

const fakeCanvas = () =>
  ({
    width: 1280,
    height: 720,
    getContext: () => ({ drawImage: vi.fn(), save: vi.fn(), restore: vi.fn() }),
  }) as unknown as HTMLCanvasElement;

interface DemuxerOptions {
  packets?: DemuxedPacket[];
  unsupportedTracks?: string[];
  startTimeUs?: number;
  withAudio?: boolean;
  /** Withhold packets after this many, simulating a stalled network. */
  stallAfter?: number;
}

/** Interleaved video and audio, the shape both demuxers actually produce. */
const packetsUpTo = (seconds: number, stepMs = 40): DemuxedPacket[] => {
  const packets: DemuxedPacket[] = [];
  for (let t = 0; t < seconds * 1000; t += stepMs) {
    packets.push({
      kind: "video",
      data: new Uint8Array([1]),
      timestamp: t * 1000,
      key: t === 0,
    });
    packets.push({
      kind: "audio",
      data: new Uint8Array([2]),
      timestamp: t * 1000,
      duration: stepMs * 1000,
      key: true,
    });
  }
  return packets;
};

const buildDemuxer = (options: DemuxerOptions = {}) => {
  const {
    packets = packetsUpTo(2),
    unsupportedTracks = [],
    startTimeUs = 0,
    withAudio = true,
    stallAfter,
  } = options;

  let index = 0;
  let releaseStall: (() => void) | null = null;
  let stallReleased = false;

  const demuxer: MediaDemuxer = {
    container: "mp4",
    video: { codec: "avc1.42C01E", codedWidth: 640, codedHeight: 480 },
    audio: withAudio
      ? { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2 }
      : null,
    durationUs: 60_000_000,
    startTimeUs,
    unsupportedTracks,
    next: async () => {
      if (stallAfter !== undefined && !stallReleased && index >= stallAfter) {
        await new Promise<void>((resolve) => {
          releaseStall = resolve;
        });
      }
      return index < packets.length ? packets[index++] : null;
    },
    close: vi.fn(async () => undefined),
  };

  vi.mocked(createDemuxer).mockResolvedValue(demuxer);
  return {
    demuxer,
    release: () => {
      stallReleased = true;
      releaseStall?.();
      releaseStall = null;
    },
  };
};

const startEngine = async (options: DemuxerOptions = {}) => {
  buildDemuxer(options);
  const snapshots: PlaybackSnapshot[] = [];
  const engine = new CompatibilityPlaybackEngine(fakeCanvas(), {
    onChange: (snapshot) => snapshots.push(snapshot),
  });
  await engine.load("https://example.test/media");
  await settle();
  return {
    engine,
    snapshots,
    latest: () => snapshots[snapshots.length - 1],
  };
};

/* -------------------------------------------------------------------- setup */

beforeEach(() => {
  videoDecoders = [];
  audioDecoders = [];
  audioContexts = [];
  audioSources.length = 0;
  rafQueue = [];
  timerQueue = [];
  deliverFrames = true;
  FakeAudioContext.allowStart = true;
  FakeVideoDecoder.supported = true;
  FakeAudioDecoder.supported = true;

  vi.stubGlobal("VideoDecoder", FakeVideoDecoder);
  vi.stubGlobal("AudioDecoder", FakeAudioDecoder);
  vi.stubGlobal("EncodedVideoChunk", FakeChunk);
  vi.stubGlobal("EncodedAudioChunk", FakeChunk);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    rafQueue.push(cb)
  );
  vi.stubGlobal("cancelAnimationFrame", () => undefined);

  // Capture only the render loop's own fallback timer; leave every other
  // setTimeout (the autoplay race, for one) on real timers.
  const realSetTimeout = globalThis.setTimeout;
  vi.stubGlobal(
    "setTimeout",
    ((fn: () => void, delay?: number, ...rest: unknown[]) => {
      if (delay === 100) {
        timerQueue.push(fn);
        return timerQueue.length;
      }
      return (realSetTimeout as typeof globalThis.setTimeout)(
        fn,
        delay,
        ...(rest as [])
      );
    }) as typeof globalThis.setTimeout
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/* --------------------------------------------------------------------- spec */

describe("CompatibilityPlaybackEngine", () => {
  it("becomes ready and reports the decode pipeline", async () => {
    const { engine, latest } = await startEngine();

    expect(latest().status).toBe("ready");
    expect(latest().pipeline).toBe("MP4 · avc1.42C01E · mp4a.40.2");
    await engine.destroy();
  });

  it("refuses a file that carries a track it cannot decode", async () => {
    const { engine, latest } = await startEngine({
      unsupportedTracks: ["A_VORBIS"],
    });

    expect(latest().status).toBe("error");
    expect(latest().error).toContain("A_VORBIS");
    expect(latest().unsupported).toBe(true);
    await engine.destroy();
  });

  it("refuses a file whose video codec the platform rejects", async () => {
    FakeVideoDecoder.supported = false;
    const { engine, latest } = await startEngine();

    expect(latest().status).toBe("error");
    expect(latest().error).toContain("avc1.42C01E");
    await engine.destroy();
  });

  it("uses the container's start time as the clock origin", async () => {
    // A track whose first presentation time is 1s must not be shifted by the
    // first packet's own timestamp; every chunk lands one second earlier.
    const { engine } = await startEngine({
      startTimeUs: 1_000_000,
      packets: [
        { kind: "video", data: new Uint8Array([1]), timestamp: 1_000_000, key: true },
        { kind: "video", data: new Uint8Array([1]), timestamp: 1_040_000, key: false },
      ],
    });

    expect(videoDecoders[0].decoded).toEqual([0, 40_000]);
    await engine.destroy();
  });

  it("stays ready when autoplay is refused, and plays on a later gesture", async () => {
    FakeAudioContext.allowStart = false;
    const { engine, latest } = await startEngine();

    await engine.play();
    await settle();
    // The clock never started, so claiming "playing" would be a lie.
    expect(latest().status).toBe("ready");

    FakeAudioContext.allowStart = true;
    await engine.play();
    await settle();
    expect(latest().status).toBe("playing");
    await engine.destroy();
  });

  it("freezes the clock on pause", async () => {
    const { engine, latest } = await startEngine();
    const context = audioContexts[0];

    await engine.play();
    await settle();
    context.currentTime += 0.5;

    engine.pause();
    await settle();
    expect(latest().status).toBe("paused");
    expect(context.suspend).toHaveBeenCalled();
    // Half a second elapsed, less the lead the audio clock starts with.
    const atPause = latest().currentTime;
    expect(atPause).toBeCloseTo(0.42, 2);

    // A real suspended context does not advance, so resuming picks up exactly
    // where the pause left off rather than jumping.
    await engine.play();
    await settle();
    expect(latest().currentTime).toBeCloseTo(atPause, 2);
    await engine.destroy();
  });

  it("buffers instead of running the clock past data that has not arrived", async () => {
    const { release } = buildDemuxer({ packets: packetsUpTo(4), stallAfter: 12 });
    const snapshots: PlaybackSnapshot[] = [];
    const engine = new CompatibilityPlaybackEngine(fakeCanvas(), {
      onChange: (snapshot) => snapshots.push(snapshot),
    });
    await engine.load("https://example.test/media");
    await settle();
    await engine.play();
    await settle();

    const context = audioContexts[0];
    context.currentTime += 3;             // playhead runs past what was demuxed
    await runFrames(2);
    expect(snapshots[snapshots.length - 1].status).toBe("buffering");
    expect(snapshots[snapshots.length - 1].buffering).toBe(true);

    release();                            // data arrives again
    await settle();
    await runFrames(6);
    await settle();
    expect(snapshots[snapshots.length - 1].status).toBe("playing");
    await engine.destroy();
  });

  it("rebuilds a decoder that errors and keeps playing", async () => {
    const { engine, latest } = await startEngine();
    await engine.play();
    await settle();

    videoDecoders[0].failWith(new Error("transient decode error"));
    await settle();

    expect(videoDecoders).toHaveLength(2);
    expect(videoDecoders[1].state).toBe("configured");
    expect(latest().status).not.toBe("error");
    await engine.destroy();
  });

  it("gives up after repeated decoder errors", async () => {
    const { engine, latest } = await startEngine();
    await engine.play();
    await settle();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      videoDecoders[videoDecoders.length - 1].failWith(new Error("bad stream"));
      await settle();
    }

    expect(latest().status).toBe("error");
    await engine.destroy();
  });

  it("stops audio, decoders and the audio graph when playback fails", async () => {
    const { engine, latest } = await startEngine();
    await engine.play();
    await settle();
    await runFrames(2);

    expect(audioSources.length).toBeGreaterThan(0);
    const context = audioContexts[0];

    // Exhaust the recovery budget so the failure becomes terminal.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      videoDecoders[videoDecoders.length - 1].failWith(new Error("bad stream"));
      await settle();
    }

    expect(latest().status).toBe("error");
    expect(context.state).toBe("closed");
    expect(audioDecoders.every((decoder) => decoder.state === "closed")).toBe(true);
    for (const source of audioSources) {
      expect(source.stop).toHaveBeenCalled();
    }
    await engine.destroy();
  });

  it("reports the decoded frame's aspect ratio", async () => {
    const { engine, latest } = await startEngine();
    await engine.play();
    await settle();
    await runFrames(2);

    expect(latest().aspectRatio).toBeCloseTo(640 / 480, 5);
    await engine.destroy();
  });

  it("keeps rendering when animation frames stop being delivered", async () => {
    // Regression: the loop used to be a bare requestAnimationFrame chain in
    // which tick() scheduled its own successor, so a single dropped callback —
    // which a hidden or occluded page causes — stopped playback for good while
    // audio carried on from the Web Audio clock.
    const { engine, latest } = await startEngine();
    const context = audioContexts[0];
    await engine.play();
    await settle();

    deliverFrames = false;
    context.currentTime += 0.2;
    await runFallbackTimers(3);

    expect(latest().status).toBe("playing");
    // Frames were drawn from the timer alone, so the canvas took a real size.
    expect(videoDecoders[0].decoded.length).toBeGreaterThan(0);
    await engine.destroy();
  });

  it("leaves buffering even when only the frame queue can refill", async () => {
    // Regression: rebuffering waited for a minimum audio queue, but pump()
    // stops as soon as *any* queue reaches its cap. A full frame queue with an
    // empty audio queue therefore deadlocked — no further packets could be read
    // until frames were drawn, and frames were only drawn once playback resumed.
    const { release } = buildDemuxer({
      packets: [
        ...packetsUpTo(0.2),
        // Video only from here, so the audio queue can never refill.
        ...packetsUpTo(6).filter((packet) => packet.kind === "video"),
      ],
      stallAfter: 10,
    });
    const snapshots: PlaybackSnapshot[] = [];
    const engine = new CompatibilityPlaybackEngine(fakeCanvas(), {
      onChange: (snapshot) => snapshots.push(snapshot),
    });
    await engine.load("https://example.test/media");
    await settle();
    await engine.play();
    await settle();

    audioContexts[0].currentTime += 3;
    await runFrames(2);
    expect(snapshots[snapshots.length - 1].status).toBe("buffering");

    release();
    await settle();
    await runFrames(4);
    expect(snapshots[snapshots.length - 1].status).toBe("playing");
    await engine.destroy();
  });

});
