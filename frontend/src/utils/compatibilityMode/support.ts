/**
 * Feature detection for compatibility mode.
 *
 * The mode replaces `<video>` with WebCodecs + canvas + Web Audio, so it is
 * only offered where those APIs exist (Chrome/Edge 94+, Safari 16.4+,
 * Firefox 130+).
 */

export function isCompatibilityModeSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.VideoDecoder === "function" &&
    typeof window.EncodedVideoChunk === "function" &&
    typeof window.AudioContext === "function"
  );
}
