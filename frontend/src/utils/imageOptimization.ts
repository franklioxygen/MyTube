const RESPONSIVE_THUMBNAIL_WIDTHS = [480, 828, 1080] as const;
const DEFAULT_THUMBNAIL_WIDTH = 828;
const DEFAULT_THUMBNAIL_QUALITY = 72;

export const CARD_THUMBNAIL_SIZES =
  "(max-width: 600px) 100vw, (max-width: 900px) 50vw, (max-width: 1400px) 33vw, 25vw";

const canOptimizeLocalThumbnail = (imageUrl?: string): imageUrl is string => {
  if (!imageUrl) {
    return false;
  }

  try {
    const normalized = new URL(imageUrl, window.location.origin);
    return normalized.pathname.startsWith("/images/") && /\.jpe?g$/i.test(normalized.pathname);
  } catch {
    return false;
  }
};

export const buildOptimizedImageUrl = (
  imageUrl: string,
  width = DEFAULT_THUMBNAIL_WIDTH,
  quality = DEFAULT_THUMBNAIL_QUALITY,
): string => {
  if (!canOptimizeLocalThumbnail(imageUrl)) {
    return imageUrl;
  }

  const normalized = new URL(imageUrl, window.location.origin);
  normalized.searchParams.set("w", String(width));
  normalized.searchParams.set("q", String(quality));
  return normalized.toString();
};

export const buildOptimizedImageSrcSet = (imageUrl: string): string | undefined => {
  if (!canOptimizeLocalThumbnail(imageUrl)) {
    return undefined;
  }

  return RESPONSIVE_THUMBNAIL_WIDTHS
    .map((width) => `${buildOptimizedImageUrl(imageUrl, width)} ${width}w`)
    .join(", ");
};
