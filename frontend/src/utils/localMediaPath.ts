/** HTTP(S) schemes are case-insensitive; signed URLs should be left untouched. */
export const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/** Encode a filesystem-backed web path before using it as a browser URL. */
export const encodeLocalMediaPath = (path: string): string =>
    path.split('/').map(encodeURIComponent).join('/');
