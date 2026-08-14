export const THUMBNAIL_PLACEHOLDER_SRC =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='480' height='270' viewBox='0 0 480 270'%3E%3Crect width='480' height='270' fill='%23212529'/%3E%3Cpath d='M206 115h68a12 12 0 0 1 12 12v42a12 12 0 0 1-12 12h-68a12 12 0 0 1-12-12v-42a12 12 0 0 1 12-12zm22 17v32l32-16-32-16z' fill='%236b7280'/%3E%3Ctext x='240' y='211' text-anchor='middle' font-family='Arial, Helvetica, sans-serif' font-size='20' fill='%239ca3af'%3ENo Thumbnail%3C/text%3E%3C/svg%3E";

export const setThumbnailPlaceholder = (image: HTMLImageElement): void => {
  image.onerror = null;
  image.srcset = "";
  image.sizes = "";
  image.removeAttribute("srcset");
  image.removeAttribute("sizes");
  image.src = THUMBNAIL_PLACEHOLDER_SRC;
};

const resolveAgainstPage = (value: string): string => {
  try {
    return new URL(value, window.location.href).href;
  } catch {
    return value;
  }
};

/**
 * Move an <img> to the next cover candidate after a load error, and only fall
 * back to the placeholder once every candidate has failed.
 *
 * The current position is derived from the element's resolved `src` rather than
 * from component state, so a re-render that resets `src` cannot strand the image
 * mid-chain. Candidates that resolve to the URL that just failed are skipped
 * rather than ending the walk: when the backend origin is the page's own origin,
 * the absolute and relative form of a path collapse to the same URL, and treating
 * that duplicate as the end would drop the still-untried full-size candidates.
 *
 * Anchoring on the *last* match makes the position strictly increase on every
 * call, so the walk is finite whatever the candidate list looks like.
 */
export const handleThumbnailError = (
  image: HTMLImageElement,
  candidates: readonly string[]
): void => {
  const resolvedCandidates = candidates.map(resolveAgainstPage);
  let currentIndex = -1;
  for (let index = 0; index < resolvedCandidates.length; index += 1) {
    if (resolvedCandidates[index] === image.src) {
      currentIndex = index;
    }
  }

  const nextIndex = resolvedCandidates.findIndex(
    (resolvedCandidate, index) =>
      index > currentIndex && resolvedCandidate !== image.src
  );

  if (nextIndex === -1) {
    setThumbnailPlaceholder(image);
    return;
  }

  image.srcset = "";
  image.sizes = "";
  image.removeAttribute("srcset");
  image.removeAttribute("sizes");
  image.src = candidates[nextIndex];
};
