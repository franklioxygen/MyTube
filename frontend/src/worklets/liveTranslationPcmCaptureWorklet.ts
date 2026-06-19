/**
 * AudioWorklet that taps the video element's audio graph, downmixes to mono,
 * converts Float32 -> Int16 PCM, and posts ~100 ms chunks to the main thread.
 * The capture AudioContext runs at 16 kHz, so no resampling is needed.
 *
 * AudioWorklet modules run in a separate realm and must be loaded as plain JS via
 * `audioContext.audioWorklet.addModule(url)`. Vite/Rollup do NOT transpile a
 * `new URL('./x.ts', import.meta.url)` worklet — they inline it as a `data:` URL
 * containing the raw TypeScript, which the worklet realm cannot parse. To stay
 * robust across dev/prod we ship the processor as a plain-JS source string and
 * load it from a Blob URL. The canonical, unit-tested conversion logic lives in
 * `./pcmConversion.ts`; this string mirrors it.
 */

export const LIVE_TRANSLATION_WORKLET_PROCESSOR = 'live-translation-pcm-capture';

// Plain JS executed in AudioWorkletGlobalScope (where `AudioWorkletProcessor`
// and `registerProcessor` are globals). 100 ms at 16 kHz = 1600 samples.
const WORKLET_SOURCE = `
const TARGET_SAMPLES = 1600;
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(TARGET_SAMPLES);
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) {
      return true;
    }
    const frameLength = input[0].length;
    const mono = new Float32Array(frameLength);
    if (input.length === 1) {
      mono.set(input[0]);
    } else {
      for (let i = 0; i < frameLength; i++) {
        let sum = 0;
        for (let c = 0; c < input.length; c++) {
          sum += input[c][i] || 0;
        }
        mono[i] = sum / input.length;
      }
    }
    let offset = 0;
    while (offset < mono.length) {
      const space = TARGET_SAMPLES - this.filled;
      const toCopy = Math.min(space, mono.length - offset);
      this.buffer.set(mono.subarray(offset, offset + toCopy), this.filled);
      this.filled += toCopy;
      offset += toCopy;
      if (this.filled >= TARGET_SAMPLES) {
        const pcm16 = new Int16Array(TARGET_SAMPLES);
        for (let i = 0; i < TARGET_SAMPLES; i++) {
          let s = this.buffer[i];
          if (s > 1) s = 1;
          else if (s < -1) s = -1;
          pcm16[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
        }
        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
        this.buffer = new Float32Array(TARGET_SAMPLES);
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor('${LIVE_TRANSLATION_WORKLET_PROCESSOR}', PcmCaptureProcessor);
`;

let cachedUrl: string | null = null;

/** Build (once) a Blob URL for the capture worklet module. */
export function createCaptureWorkletUrl(): string {
  if (cachedUrl) {
    return cachedUrl;
  }
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
  cachedUrl = URL.createObjectURL(blob);
  return cachedUrl;
}
