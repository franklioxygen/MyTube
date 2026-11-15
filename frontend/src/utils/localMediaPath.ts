/** HTTP(S) schemes are case-insensitive; signed URLs should be left untouched. */
export const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/** Encode a filesystem-backed web path before using it as a browser URL. */
export const encodeLocalMediaPath = (path: string): string =>
    path.split('/').map(encodeURIComponent).join('/');

/**
 * An absolute URL for an app that is not the browser (an external player, the
 * clipboard). Media URLs resolved for the page are often root-relative, which
 * only the page itself can resolve.
 */
export const toAbsoluteMediaUrl = (url: string): string =>
    isHttpUrl(url) ? url : `${window.location.origin}${url.startsWith('/') ? url : `/${url}`}`;
