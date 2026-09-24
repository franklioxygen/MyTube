/** Encode a filesystem-backed web path before using it as a browser URL. */
export const encodeLocalMediaPath = (path: string): string =>
    path.split('/').map(encodeURIComponent).join('/');
