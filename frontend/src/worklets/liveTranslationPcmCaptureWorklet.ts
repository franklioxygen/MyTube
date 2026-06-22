/**
 * AudioWorklet that taps the video element's normal-rate audio graph, downmixes
 * to mono, resamples to 16 kHz, converts Float32 -> Int16 PCM, and posts
 * ~100 ms chunks to the main thread.
 *
 * AudioWorklet modules run in a separate realm and must be loaded as plain JS via
 * `audioContext.audioWorklet.addModule(url)`. Vite/Rollup do NOT transpile a
 * `new URL('./x.ts', import.meta.url)` worklet — they inline it as a `data:` URL
 * containing the raw TypeScript, which the worklet realm cannot parse. To stay
 * robust across dev/prod we ship the processor as a plain-JS source string and
 * load it from a Blob URL. The PCM conversion helpers are unit-tested in
 * `./pcmConversion.ts`; this source mirrors those pieces and keeps the streaming
 * resampler local to the worklet.
 */

export const LIVE_TRANSLATION_WORKLET_PROCESSOR = 'live-translation-pcm-capture';

// Plain JS executed in AudioWorkletGlobalScope (where `AudioWorkletProcessor`,
// `sampleRate`, and `registerProcessor` are globals). 100 ms at 16 kHz = 1600
// samples.
const WORKLET_SOURCE = `
const TARGET_SAMPLE_RATE = 16000;
const TARGET_SAMPLES = 1600;
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(TARGET_SAMPLES);
    this.filled = 0;
    this.inputCursor = 0;
    this.nextInputTime = 0;
    this.lastInputSample = null;
    this.inputSamplesPerOutputSample =
      (typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : TARGET_SAMPLE_RATE) /
      TARGET_SAMPLE_RATE;
  }
  appendSample(sample) {
    this.buffer[this.filled] = sample;
    this.filled += 1;
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
    if (mono.length === 0) {
      return true;
    }
    const blockStart = this.lastInputSample === null ? this.inputCursor : this.inputCursor - 1;
    const samples =
      this.lastInputSample === null
        ? mono
        : (() => {
            const withPrevious = new Float32Array(mono.length + 1);
            withPrevious[0] = this.lastInputSample;
            withPrevious.set(mono, 1);
            return withPrevious;
          })();
    const blockEnd = this.inputCursor + mono.length;
    while (this.nextInputTime <= blockEnd - 1) {
      const lowerInputTime = Math.floor(this.nextInputTime);
      const lowerIndex = lowerInputTime - blockStart;
      const upperIndex = Math.min(lowerIndex + 1, samples.length - 1);
      const lower = samples[lowerIndex] || 0;
      const upper = samples[upperIndex] || lower;
      const fraction = this.nextInputTime - lowerInputTime;
      this.appendSample(lower + (upper - lower) * fraction);
      this.nextInputTime += this.inputSamplesPerOutputSample;
    }
    this.inputCursor = blockEnd;
    this.lastInputSample = mono[mono.length - 1];
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
