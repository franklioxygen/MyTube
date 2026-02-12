import { Collection, Video } from '../types';

const NEW_VIDEO_WINDOW_DAYS = 7;
const DAY_IN_MS = 1000 * 60 * 60 * 24;

const getViewCount = (video: Video): number | null | undefined => {
    if (typeof video.viewCount === 'string') {
        return parseInt(video.viewCount, 10);
    }

    return video.viewCount;
};

const hasNoViews = (video: Video): boolean => {
    const viewCount = getViewCount(video);
    return viewCount === 0 || viewCount === null || viewCount === undefined || Number.isNaN(viewCount);
};

const isAddedWithinDays = (addedAt: string, days: number): boolean => {
    const addedDate = new Date(addedAt);
    if (Number.isNaN(addedDate.getTime())) {
        return false;
    }

    const now = new Date();
    const daysDiff = (now.getTime() - addedDate.getTime()) / DAY_IN_MS;
    return daysDiff >= 0 && daysDiff <= days;
};

/**
 * Check if video is new (0 views and added within 7 days)
 */
export const isNewVideo = (video: Video): boolean => {
    if (!hasNoViews(video)) {
        return false;
    }

    if (!video.addedAt) {
        return false;
    }

    return isAddedWithinDays(video.addedAt, NEW_VIDEO_WINDOW_DAYS);
};

/**
 * Get collection information for a video card
 */
export interface VideoCardCollectionInfo {
    videoCollections: Collection[];
    isFirstInAnyCollection: boolean;
    firstInCollectionNames: string[];
    firstCollectionId: string | null;
}

export const getVideoCardCollectionInfo = (
    video: Video,
    collections: Collection[],
    disableCollectionGrouping: boolean
): VideoCardCollectionInfo => {
    // Find collections this video belongs to
    const videoCollections = collections.filter(collection =>
        collection.videos.includes(video.id)
    );

    // Check if this video is the first in any collection
    const isFirstInAnyCollection = !disableCollectionGrouping && videoCollections.some(collection =>
        collection.videos[0] === video.id
    );

    // Get collection names where this video is the first
    const firstInCollectionNames = videoCollections
        .filter(collection => collection.videos[0] === video.id)
        .map(collection => collection.name);

    // Get the first collection ID where this video is the first video
    const firstCollectionId = isFirstInAnyCollection
        ? videoCollections.find(collection => collection.videos[0] === video.id)?.id || null
        : null;

    return {
        videoCollections,
        isFirstInAnyCollection,
        firstInCollectionNames,
        firstCollectionId
    };
};
