/**
 * Pure PCM conversion helpers used by the capture AudioWorklet.
 *
 * These are kept dependency-free (no DOM, no `btoa`) so the worklet — which runs
 * in a separate realm — can import them, and so they can be unit-tested directly
 * (the worklet module itself is not unit-testable in jsdom).
 */

/** Average N channel buffers (equal length) into a single mono Float32Array. */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) {
    return new Float32Array(0);
  }
  if (channels.length === 1) {
    return channels[0];
  }
  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) {
      sum += channels[c][i] ?? 0;
    }
    mono[i] = sum / channels.length;
  }
  return mono;
}

/**
 * Convert Float32 samples in [-1, 1] to little-endian signed 16-bit PCM.
 * Out-of-range values are clamped.
 */
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    let s = input[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    // Asymmetric scaling keeps the full negative range.
    output[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return output;
}
