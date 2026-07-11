import { useCloudStorageUrl } from '../../hooks/useCloudStorageUrl';
import type { Video } from '../../types';
import { getBackendUrl } from '../../utils/apiUrl';
import { buildSmallThumbnailAbsoluteUrl } from '../../utils/imageOptimization';
import { THUMBNAIL_PLACEHOLDER_SRC } from '../../utils/thumbnailPlaceholder';

export const useFavoriteThumbnail = (video?: Video): string => {
    const cloudThumbnailPath = video?.videoPath?.startsWith('cloud:')
        ? video.thumbnailPath
        : null;
    const cloudThumbnailUrl = useCloudStorageUrl(cloudThumbnailPath, 'thumbnail');

    // Resolve local thumbnails against the backend origin so covers still load
    // when the frontend is served from a different host (VITE_BACKEND_URL),
    // matching VideoCard/CollectionCard.
    return cloudThumbnailUrl
        || buildSmallThumbnailAbsoluteUrl(getBackendUrl(), video?.thumbnailPath, video?.thumbnailUrl)
        || video?.thumbnailUrl
        || THUMBNAIL_PLACEHOLDER_SRC;
};
