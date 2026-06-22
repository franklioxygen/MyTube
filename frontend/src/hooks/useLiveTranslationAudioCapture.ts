import { useMemo } from 'react';
import {
  createCaptureWorkletUrl,
  LIVE_TRANSLATION_WORKLET_PROCESSOR,
} from '../worklets/liveTranslationPcmCaptureWorklet';

/**
 * Live translation audio capture.
 *
 * Routes the video element through a Web Audio graph at the browser's normal
 * output rate and taps it with an AudioWorklet that emits 100 ms Int16 PCM
 * chunks resampled to 16 kHz. Using a
 * `MediaElementAudioSourceNode` (rather than `captureStream()`) decouples capture
 * from speaker output, so muting the original audio to suppress echo does not
 * also silence what we send to Gemini.
 *
 * Browsers allow only one `MediaElementAudioSourceNode` per element for its
 * lifetime, so graphs are cached per element in a WeakMap and reused across
 * start -> stop -> start cycles. Only the worklet tap is recreated.
 */

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function isAudioCaptureSupported(): boolean {
  const Ctor = getAudioContextCtor();
  return (
    Ctor !== null &&
    typeof AudioWorkletNode !== 'undefined' &&
    typeof Ctor.prototype.createMediaElementSource === 'function'
  );
}

class MediaCaptureGraph {
  private readonly ctx: AudioContext;
  private readonly source: MediaElementAudioSourceNode;
  private readonly gain: GainNode;
  // Zero-gain sink that keeps the capture worklet reachable from the
  // destination. Some browsers only pull `process()` for AudioWorklet nodes
  // that are part of the rendered graph, so a disconnected tap never fires; this
  // renders the branch while emitting no audible output.
  private readonly workletSink: GainNode;
  private worklet: AudioWorkletNode | null = null;
  private moduleLoaded = false;
  private startGeneration = 0;

  constructor(element: HTMLMediaElement, Ctor: AudioContextCtor) {
    // Use the browser's normal output rate for the media graph. The worklet
    // resamples only the capture tap to 16 kHz so regular playback is not
    // downsampled after a live-translation start/stop cycle.
    this.ctx = new Ctor();
    this.source = this.ctx.createMediaElementSource(element);
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 1;
    // Original audio reaches the speakers only via this gain node now.
    this.source.connect(this.gain);
    this.gain.connect(this.ctx.destination);

    this.workletSink = this.ctx.createGain();
    this.workletSink.gain.value = 0;
    this.workletSink.connect(this.ctx.destination);
  }

  /** Resume the context within a user gesture (autoplay policy). */
  async prime(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  async start(onChunk: (pcm16: Int16Array) => void): Promise<void> {
    const generation = (this.startGeneration += 1);
    await this.prime();
    if (generation !== this.startGeneration) {
      return;
    }
    if (!this.moduleLoaded) {
      await this.ctx.audioWorklet.addModule(createCaptureWorkletUrl());
      if (generation !== this.startGeneration) {
        return;
      }
      this.moduleLoaded = true;
    }
    if (!this.worklet) {
      if (generation !== this.startGeneration) {
        return;
      }
      this.worklet = new AudioWorkletNode(
        this.ctx,
        LIVE_TRANSLATION_WORKLET_PROCESSOR,
      );
      this.source.connect(this.worklet);
      // Render the tap (silently) so the processor is pulled.
      this.worklet.connect(this.workletSink);
    }
    this.worklet.port.onmessage = (event: MessageEvent) => {
      onChunk(new Int16Array(event.data as ArrayBuffer));
    };
    // Suppress the original audio while translating (translated speech plays via
    // the separate playback context).
    this.gain.gain.value = 0;
  }

  stop(): void {
    this.startGeneration += 1;
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      try {
        this.source.disconnect(this.worklet);
        this.worklet.disconnect();
      } catch {
        // already disconnected
      }
      this.worklet = null;
    }
    // Restore original audio.
    this.gain.gain.value = 1;
  }

  dispose(): void {
    this.stop();
    try {
      this.source.disconnect();
      this.gain.disconnect();
      this.workletSink.disconnect();
    } catch {
      // ignore
    }
    void this.ctx.close().catch(() => undefined);
  }
}

// One graph per media element for its lifetime.
const graphs = new WeakMap<HTMLMediaElement, MediaCaptureGraph>();

function ensureGraph(element: HTMLMediaElement): MediaCaptureGraph | null {
  const Ctor = getAudioContextCtor();
  if (!Ctor || !isAudioCaptureSupported()) {
    return null;
  }
  let graph = graphs.get(element);
  if (!graph) {
    graph = new MediaCaptureGraph(element, Ctor);
    graphs.set(element, graph);
  }
  return graph;
}

export interface LiveTranslationAudioCaptureController {
  isSupported(): boolean;
  /** Synchronously create + resume the graph within a user gesture. */
  prime(element: HTMLMediaElement): void;
  start(
    element: HTMLMediaElement,
    onChunk: (pcm16: Int16Array) => void,
  ): Promise<void>;
  stop(element: HTMLMediaElement): void;
  /** Fully tear down the per-element graph (only on unmount/replace). */
  dispose(element: HTMLMediaElement): void;
}

const controller: LiveTranslationAudioCaptureController = {
  isSupported: isAudioCaptureSupported,
  prime(element) {
    const graph = ensureGraph(element);
    void graph?.prime();
  },
  async start(element, onChunk) {
    const graph = ensureGraph(element);
    if (!graph) {
      throw new Error('Audio capture is not supported in this browser.');
    }
    await graph.start(onChunk);
  },
  stop(element) {
    graphs.get(element)?.stop();
  },
  dispose(element) {
    const graph = graphs.get(element);
    if (graph) {
      graph.dispose();
      graphs.delete(element);
    }
  },
};

export function useLiveTranslationAudioCapture(): LiveTranslationAudioCaptureController {
  // The controller is stateless (state lives in the module WeakMap), so a stable
  // reference is fine.
  return useMemo(() => controller, []);
}
