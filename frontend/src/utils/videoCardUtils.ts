import { Collection, Video } from '../types';

/**
 * Check if video is new (0 views and added within 7 days)
 */
export const isNewVideo = (video: Video): boolean => {
    // Check if viewCount is 0 or null/undefined (unwatched)
    // Handle both number and string types
    const viewCountNum = typeof video.viewCount === 'string' 
        ? parseInt(video.viewCount, 10) 
        : video.viewCount;
    const hasNoViews = viewCountNum === 0 || viewCountNum === null || viewCountNum === undefined || isNaN(viewCountNum);
    
    if (!hasNoViews) {
        return false;
    }

    // Check if addedAt exists
    if (!video.addedAt) {
        return false;
    }

    // Check if added within 7 days
    const addedDate = new Date(video.addedAt);
    const now = new Date();

    // Handle invalid dates
    if (isNaN(addedDate.getTime())) {
        return false;
    }

    const daysDiff = (now.getTime() - addedDate.getTime()) / (1000 * 60 * 60 * 24);
    const isWithin7Days = daysDiff >= 0 && daysDiff <= 7; // >= 0 to handle future dates

    return isWithin7Days;
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
