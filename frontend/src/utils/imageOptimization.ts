const stripQuery = (value: string): string => value.split('?')[0];

const normalizePath = (value: string): string => {
    const cleanValue = stripQuery(value).trim();
    if (!cleanValue) {
        return '';
    }

    return cleanValue.startsWith('/') ? cleanValue : `/${cleanValue}`;
};

export const toSmallThumbnailPath = (
    thumbnailPath?: string | null,
): string | undefined => {
    if (!thumbnailPath) {
        return undefined;
    }

    const normalizedPath = normalizePath(thumbnailPath);
    if (!normalizedPath) {
        return undefined;
    }

    if (normalizedPath.startsWith('/images/')) {
        return `/images-small/${normalizedPath.replace(/^\/images\//, '')}`;
    }

    if (normalizedPath.startsWith('/videos/')) {
        return `/images-small/${normalizedPath.replace(/^\/videos\//, '')}`;
    }

    return undefined;
};

export const extractThumbnailCacheSuffix = (
    thumbnailPath?: string | null,
    thumbnailUrl?: string,
): string => {
    if (!thumbnailPath || !thumbnailUrl) {
        return '';
    }

    try {
        const normalizedThumbnailPath = normalizePath(thumbnailPath);
        const normalizedThumbnailUrl = new URL(thumbnailUrl, window.location.origin);
        return normalizedThumbnailUrl.pathname === normalizedThumbnailPath
            ? normalizedThumbnailUrl.search
            : '';
    } catch {
        return '';
    }
};

/**
 * Web path of the original (full size) managed thumbnail, used as the fallback
 * when the /images-small mirror cannot be served.
 */
export const toOriginalThumbnailPath = (
    thumbnailPath?: string | null,
): string | undefined => {
    if (!thumbnailPath) {
        return undefined;
    }

    const normalizedPath = normalizePath(thumbnailPath);
    return normalizedPath.startsWith('/images/') || normalizedPath.startsWith('/videos/')
        ? normalizedPath
        : undefined;
};

export const buildSmallThumbnailUrl = (
    thumbnailPath?: string | null,
    thumbnailUrl?: string,
): string | undefined => {
    const smallThumbnailPath = toSmallThumbnailPath(thumbnailPath);
    if (!smallThumbnailPath) {
        return undefined;
    }

    return `${smallThumbnailPath}${extractThumbnailCacheSuffix(thumbnailPath, thumbnailUrl)}`;
};

export const buildSmallThumbnailAbsoluteUrl = (
    backendUrl: string,
    thumbnailPath?: string | null,
    thumbnailUrl?: string,
): string | undefined => {
    const smallThumbnailUrl = buildSmallThumbnailUrl(thumbnailPath, thumbnailUrl);
    if (!smallThumbnailUrl) {
        return undefined;
    }

    return `${backendUrl}${smallThumbnailUrl}`;
};

/**
 * Ordered list of URLs to try for a video cover, best first.
 *
 * Covers are the only media the frontend addresses through an absolute backend
 * origin (`VITE_BACKEND_URL`); avatars, videos and subtitles are served from the
 * page origin through the nginx proxy. A deployment whose backend origin is not
 * reachable from the browser therefore loses every cover while the rest of the
 * page keeps working (issue #405), and a missing /images-small mirror used to be
 * fatal as well. Trying, in order, the backend origin then the page origin, and
 * the small mirror then the original image, makes both failures self-healing.
 */
export const buildThumbnailCandidates = (
    backendUrl: string,
    thumbnailPath?: string | null,
    thumbnailUrl?: string,
): string[] => {
    const cacheSuffix = extractThumbnailCacheSuffix(thumbnailPath, thumbnailUrl);
    // Same-origin first when there is no configured backend origin to try.
    const origins = backendUrl ? [backendUrl, ''] : [''];
    const candidates: string[] = [];

    for (const mediaPath of [
        toSmallThumbnailPath(thumbnailPath),
        toOriginalThumbnailPath(thumbnailPath),
    ]) {
        if (!mediaPath) {
            continue;
        }
        for (const origin of origins) {
            candidates.push(`${origin}${mediaPath}${cacheSuffix}`);
        }
    }

    if (thumbnailUrl) {
        candidates.push(thumbnailUrl);
    }

    return candidates.filter(
        (candidate, index) => candidates.indexOf(candidate) === index,
    );
};
