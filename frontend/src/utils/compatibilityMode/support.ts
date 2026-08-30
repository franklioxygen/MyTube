/**
 * Feature detection for compatibility mode.
 *
 * The mode replaces `<video>` with WebCodecs + canvas + Web Audio, so every API
 * on that path has to be checked — not just the video half. Safari 16.4, for
 * example, shipped video WebCodecs without the audio interfaces; accepting it
 * on a `VideoDecoder` check alone would produce silent playback on a screen
 * that has no other player to fall back to.
 */

const hasConstructor = (name: string): boolean =>
  typeof (globalThis as Record<string, unknown>)[name] === "function";

/** Individual API results, so a failure can say what is actually missing. */
export function getCompatibilityModeSupport(): Record<string, boolean> {
  return {
    VideoDecoder: hasConstructor("VideoDecoder"),
    AudioDecoder: hasConstructor("AudioDecoder"),
    EncodedVideoChunk: hasConstructor("EncodedVideoChunk"),
    EncodedAudioChunk: hasConstructor("EncodedAudioChunk"),
    VideoFrame: hasConstructor("VideoFrame"),
    AudioData: hasConstructor("AudioData"),
    AudioContext: hasConstructor("AudioContext"),
  };
}

/** Names of the APIs this runtime is missing; empty when the mode can run. */
export function getMissingCompatibilityModeApis(): string[] {
  return Object.entries(getCompatibilityModeSupport())
    .filter(([, available]) => !available)
    .map(([name]) => name);
}

export function isCompatibilityModeSupported(): boolean {
  return typeof window !== "undefined" && getMissingCompatibilityModeApis().length === 0;
}
