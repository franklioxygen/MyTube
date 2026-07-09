import { useCloudStorageUrl } from '../../hooks/useCloudStorageUrl';
import type { Video } from '../../types';
import { buildSmallThumbnailUrl } from '../../utils/imageOptimization';
import { THUMBNAIL_PLACEHOLDER_SRC } from '../../utils/thumbnailPlaceholder';

export const useFavoriteThumbnail = (video?: Video): string => {
    const cloudThumbnailPath = video?.videoPath?.startsWith('cloud:')
        ? video.thumbnailPath
        : null;
    const cloudThumbnailUrl = useCloudStorageUrl(cloudThumbnailPath, 'thumbnail');

    return cloudThumbnailUrl
        || buildSmallThumbnailUrl(video?.thumbnailPath, video?.thumbnailUrl)
        || video?.thumbnailUrl
        || THUMBNAIL_PLACEHOLDER_SRC;
};
