/**
 * Main-thread PCM <-> base64 helpers for the live translation audio path.
 * (The capture worklet emits raw Int16 buffers; base64 happens here.)
 */

/** Encode an Int16 PCM buffer as a base64 string. */
export function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  const chunkSize = 0x8000; // avoid call-stack limits on String.fromCharCode
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/** Decode a base64 string into an Int16 PCM buffer. */
export function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  // Reinterpret the byte buffer as little-endian Int16.
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}

/** Convert Int16 PCM samples to Float32 in [-1, 1] for an AudioBuffer. */
export function int16ToFloat32(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}
