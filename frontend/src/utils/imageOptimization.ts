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
