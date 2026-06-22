/**
 * Shared same-origin / CORS detection for media sources.
 *
 * This logic was previously an inline IIFE inside the `<video crossOrigin>` JSX
 * in `VideoElement.tsx`. It is extracted here so the `<video>` attribute and the
 * live-translation capture-availability check use exactly the same rule and
 * cannot drift apart.
 */

/**
 * Whether a media `src` points at a different origin than the current page.
 * Relative URLs and same-origin absolute URLs return false. Unparseable URLs
 * are treated as same-origin (false) for safety, matching the prior behavior.
 */
export function isCrossOriginMediaSrc(src: string | null | undefined): boolean {
  if (!src) {
    return false;
  }
  if (src.startsWith("http://") || src.startsWith("https://")) {
    try {
      const srcUrl = new URL(src);
      return srcUrl.origin !== window.location.origin;
    } catch {
      // If URL parsing fails, default to same-origin for safety.
      return false;
    }
  }
  // Relative URLs are same-origin.
  return false;
}

/**
 * The `crossOrigin` attribute value for a `<video>` element: cross-origin
 * sources need `"anonymous"` to enable CORS; same-origin sources need nothing.
 */
export function getMediaCrossOriginAttr(
  src: string | null | undefined
): "anonymous" | undefined {
  return isCrossOriginMediaSrc(src) ? "anonymous" : undefined;
}

/**
 * Whether live-translation audio capture is feasible for a media source.
 *
 * `createMediaElementSource` taints on cross-origin media without CORS, exactly
 * like `captureStream()`. For MVP we conservatively treat any cross-origin
 * source as capture-blocked (most MyTube videos are served same-origin; this
 * mainly affects cloud-drive sources).
 */
export function isCaptureSupportedForSrc(
  src: string | null | undefined
): boolean {
  if (!src) {
    return false;
  }
  return !isCrossOriginMediaSrc(src);
}
