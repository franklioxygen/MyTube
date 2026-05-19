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
