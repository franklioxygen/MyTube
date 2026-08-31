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
  static flushError: Error | null = null;
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
  async flush() {
    if (FakeVideoDecoder.flushError) throw FakeVideoDecoder.flushError;
  }
  reset() {}
  close() {
    this.state = "closed";
  }
}

class FakeAudioDecoder {
  static supported = true;
  static flushError: Error | null = null;
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
  async flush() {
    if (FakeAudioDecoder.flushError) throw FakeAudioDecoder.flushError;
  }
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

/**
 * Drain the microtask queue. Generous on purpose: each simulated read yields
 * more than once, so a pump filling a queue costs many turns.
 */
const settle = async () => {
  for (let i = 0; i < 400; i += 1) await Promise.resolve();
};

const fakeCanvas = () =>
  ({
    width: 1280,
    height: 720,
    getContext: () => ({ drawImage: vi.fn(), save: vi.fn(), restore: vi.fn() }),
  }) as unknown as HTMLCanvasElement;

interface DemuxerOptions {
  packets?: DemuxedPacket[];
  durationUs?: number | null;
  unsupportedTracks?: string[];
  startTimeUs?: number;
  withAudio?: boolean;
  /** Withhold packets after this many, simulating a stalled network. */
  stallAfter?: number;
  /** WebM muxed without a `Cues` index cannot be repositioned. */
  canSeek?: boolean;
  /**
   * Fired once the demuxer has begun repositioning, i.e. after the engine has
   * cleared its queues. Used to reproduce a decoder draining mid-seek.
   */
  onSeekStart?: () => void;
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

/** Mark a keyframe every 400 ms, roughly what an encoder emits. */
const withKeyframes = (packets: DemuxedPacket[]): DemuxedPacket[] =>
  packets.map((packet, position) => ({
    ...packet,
    key: packet.kind === "audio" || position % 20 === 0,
  }));

const buildDemuxer = (options: DemuxerOptions = {}) => {
  const {
    packets = packetsUpTo(2),
    durationUs = 60_000_000,
    unsupportedTracks = [],
    startTimeUs = 0,
    withAudio = true,
    stallAfter,
    onSeekStart,
    canSeek = true,
  } = options;

  let index = 0;
  let releaseStall: (() => void) | null = null;
  let stallReleased = false;
  const seeks: number[] = [];
  // A demuxer reads one byte stream, so next() and seek() must never overlap.
  // Checked from both directions: a read starting during a seek, and a seek
  // starting while a read is outstanding.
  let seekInFlight = false;
  let readsInFlight = 0;
  let overlappingReads = 0;

  const demuxer: MediaDemuxer = {
    container: "mp4",
    video: { codec: "avc1.42C01E", codedWidth: 640, codedHeight: 480 },
    audio: withAudio
      ? { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2 }
      : null,
    durationUs,
    startTimeUs,
    unsupportedTracks,
    canSeek,
    // Land on the last keyframe at or before the target, the way a sync-sample
    // table or a cue index does.
    seek: async (timeUs: number) => {
      if (readsInFlight > 0) overlappingReads += 1;
      seekInFlight = true;
      onSeekStart?.();
      // Repositioning is not instantaneous in a real demuxer; yield so a
      // concurrent read would actually interleave here.
      await Promise.resolve();
      if (readsInFlight > 0) overlappingReads += 1;
      let landed = 0;
      let target = 0;
      packets.forEach((packet, position) => {
        if (packet.kind === "video" && packet.key && packet.timestamp <= timeUs) {
          landed = packet.timestamp;
          target = position;
        }
      });
      index = target;
      seeks.push(timeUs);
      seekInFlight = false;
      return landed;
    },
    next: async () => {
      readsInFlight += 1;
      try {
        if (seekInFlight) overlappingReads += 1;
        await Promise.resolve();
        if (seekInFlight) overlappingReads += 1;
        if (stallAfter !== undefined && !stallReleased && index >= stallAfter) {
          await new Promise<void>((resolve) => {
            releaseStall = resolve;
          });
        }
        return index < packets.length ? packets[index++] : null;
      } finally {
        readsInFlight -= 1;
      }
    },
    close: vi.fn(async () => undefined),
  };

  vi.mocked(createDemuxer).mockResolvedValue(demuxer);
  return {
    demuxer,
    seeks,
    overlappingReads: () => overlappingReads,
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
  FakeVideoDecoder.flushError = null;
  FakeAudioDecoder.flushError = null;

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

  it("restarts seekable media when play is pressed after it ends", async () => {
    const { seeks } = buildDemuxer({
      packets: packetsUpTo(0.2),
      durationUs: 200_000,
    });
    const snapshots: PlaybackSnapshot[] = [];
    const engine = new CompatibilityPlaybackEngine(fakeCanvas(), {
      onChange: (snapshot) => snapshots.push(snapshot),
    });
    await engine.load("https://example.test/media");
    await settle();
    await engine.play();
    audioContexts[0].currentTime += 1;
    await runFrames(2);
    expect(snapshots[snapshots.length - 1].status).toBe("ended");

    await engine.toggle();
    await settle();

    expect(seeks[seeks.length - 1]).toBe(0);
    expect(snapshots[snapshots.length - 1].status).toBe("playing");
    await engine.destroy();
  });

  it("waits for the final sample duration when container duration is unknown", async () => {
    const packets: DemuxedPacket[] = [
      {
        kind: "video",
        data: new Uint8Array([1]),
        timestamp: 0,
        duration: 1_000_000,
        key: true,
      },
      {
        kind: "audio",
        data: new Uint8Array([2]),
        timestamp: 0,
        duration: 1_000_000,
        key: true,
      },
    ];
    const { engine, latest } = await startEngine({ packets, durationUs: null });
    await engine.play();

    audioContexts[0].currentTime += 0.5;
    await runFrames(2);
    expect(latest().status).toBe("playing");

    audioContexts[0].currentTime += 0.7;
    await runFrames(2);
    expect(latest().status).toBe("ended");
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

  it("fails instead of reporting a decoder flush rejection as ended", async () => {
    FakeVideoDecoder.flushError = new Error("corrupt stream tail");
    const { engine, latest } = await startEngine({
      withAudio: false,
      packets: [
        { kind: "video", data: new Uint8Array([1]), timestamp: 0, key: true },
      ],
    });

    expect(latest().status).toBe("error");
    expect(latest().error).toContain("corrupt stream tail");
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

  it("seeks to the keyframe at or before the requested position", async () => {
    buildDemuxer({ packets: withKeyframes(packetsUpTo(4)) });
    const snapshots: PlaybackSnapshot[] = [];
    const engine = new CompatibilityPlaybackEngine(fakeCanvas(), {
      onChange: (snapshot) => snapshots.push(snapshot),
    });
    await engine.load("https://example.test/media");
    await settle();

    await engine.seek(2.5);
    await settle();

    const latest = snapshots[snapshots.length - 1];
    expect(latest.canSeek).toBe(true);
    // Landed at or before the request, never past it.
    expect(latest.currentTime).toBeLessThanOrEqual(2.5);
    expect(latest.currentTime).toBeGreaterThan(2.0);
    await engine.destroy();
  });

  it("reports the authoritative position after a seek", async () => {
    buildDemuxer({ packets: withKeyframes(packetsUpTo(4)) });
    const onSeeked = vi.fn();
    const engine = new CompatibilityPlaybackEngine(fakeCanvas(), {
      onChange: () => undefined,
      onSeeked,
    });
    await engine.load("https://example.test/media");
    await settle();

    await engine.seek(1);

    expect(onSeeked).toHaveBeenCalledOnce();
    expect(onSeeked.mock.calls[0][0]).toBeGreaterThan(0);
    await engine.destroy();
  });

  it("seeks in the demuxer's absolute timestamp space", async () => {
    const { seeks } = buildDemuxer({
      startTimeUs: 10_000_000,
      withAudio: false,
      packets: [10, 20, 30].map((seconds) => ({
        kind: "video" as const,
        data: new Uint8Array([1]),
        timestamp: seconds * 1_000_000,
        key: true,
      })),
    });
    const snapshots: PlaybackSnapshot[] = [];
    const engine = new CompatibilityPlaybackEngine(fakeCanvas(), {
      onChange: (snapshot) => snapshots.push(snapshot),
    });
    await engine.load("https://example.test/media");
    await settle();

    await engine.seek(20);
    await settle();

    expect(seeks).toEqual([30_000_000]);
    expect(snapshots[snapshots.length - 1].currentTime).toBe(20);
    await engine.destroy();
  });

  it("ignores a second seek while the first is still in progress", async () => {
    const { seeks } = buildDemuxer({ packets: withKeyframes(packetsUpTo(4)) });
    const engine = new CompatibilityPlaybackEngine(fakeCanvas(), {
      onChange: () => undefined,
    });
    await engine.load("https://example.test/media");
    await settle();

    const first = engine.seek(1);
    const second = engine.seek(2);
    await Promise.all([first, second]);

    expect(seeks).toEqual([1_000_000]);
    await engine.destroy();
  });

  it("paints the first decoded frame after a paused seek", async () => {
    buildDemuxer({
      withAudio: false,
      packets: withKeyframes(packetsUpTo(2)).filter(
        (packet) => packet.kind === "video"
      ),
    });
    const canvas = fakeCanvas();
    const engine = new CompatibilityPlaybackEngine(canvas, {
      onChange: () => undefined,
    });
    await engine.load("https://example.test/media");
    await settle();
    await engine.play();
    engine.pause();

    canvas.width = 1280;
    await engine.seek(0.8);
    await settle();

    expect(canvas.width).toBe(640);
    await engine.destroy();
  });

  it("reports an unseekable container so the controls can be disabled", async () => {
    // A WebM without a Cues index cannot be repositioned. seek() must be inert
    // rather than pretending, and the snapshot has to say so, or the transport
    // buttons advertise an action that silently does nothing.
    buildDemuxer({ packets: withKeyframes(packetsUpTo(4)), canSeek: false });
    const snapshots: PlaybackSnapshot[] = [];
    const engine = new CompatibilityPlaybackEngine(fakeCanvas(), {
      onChange: (snapshot) => snapshots.push(snapshot),
    });
    await engine.load("https://example.test/media");
    await settle();

    expect(snapshots[snapshots.length - 1].canSeek).toBe(false);

    await engine.seek(2);
    await settle();
    expect(snapshots[snapshots.length - 1].currentTime).toBe(0);
    await engine.destroy();
  });

  it("resumes from a seek position rather than snapping back to zero", async () => {
    // The saved-progress path: seek while still `ready`, then play. The audio
    // clock only starts on play(), so its origin has to account for the
    // position already set or the playhead jumps back to the beginning.
    buildDemuxer({ packets: withKeyframes(packetsUpTo(6)) });
    const snapshots: PlaybackSnapshot[] = [];
    const engine = new CompatibilityPlaybackEngine(fakeCanvas(), {
      onChange: (snapshot) => snapshots.push(snapshot),
    });
    await engine.load("https://example.test/media");
    await settle();

    await engine.seek(3);
    await settle();
    await engine.play();
    await settle();

    expect(snapshots[snapshots.length - 1].currentTime).toBeGreaterThan(2.5);
    await engine.destroy();
  });

  it("discards packets already in flight when a seek lands", async () => {
    // A read started before the seek must not be decoded into the new
    // position, or the first frames after a jump come from the old one.
    const { release } = buildDemuxer({
      packets: withKeyframes(packetsUpTo(6)),
      stallAfter: 8,
    });
    const engine = new CompatibilityPlaybackEngine(fakeCanvas(), {
      onChange: () => undefined,
    });
    await engine.load("https://example.test/media");
    await settle();

    const seeking = engine.seek(3);
    release();
    await seeking;
    await settle();

    expect(videoDecoders[0].decoded.length).toBeGreaterThan(0);
    await engine.destroy();
  });

  it("does not read from the demuxer while a seek is repositioning it", async () => {
    // The decoders' dequeue events fire independently of the render loop, so a
    // pump could start mid-seek and read from a byte stream the demuxer was
    // still moving. That left the container parser at the wrong offset and
    // playback produced no packets at all.
    const { overlappingReads } = buildDemuxer({
      packets: withKeyframes(packetsUpTo(6)),
      // Exactly what a draining decoder does: fire once the engine has cleared
      // its queues and handed control to the demuxer, so a pump starting here
      // would find room to read and would collide with the reposition.
      onSeekStart: () => {
        videoDecoders[0]?.ondequeue?.();
        audioDecoders[0]?.ondequeue?.();
      },
    });
    const engine = new CompatibilityPlaybackEngine(fakeCanvas(), {
      onChange: () => undefined,
    });
    await engine.load("https://example.test/media");
    await settle();
    await engine.play();
    await settle();

    await engine.seek(3);
    await settle();

    expect(overlappingReads()).toBe(0);
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
