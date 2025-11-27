import { Collection, Video } from '../types';

export interface RecommendationWeights {
    recency: number;
    frequency: number;
    collection: number;
    tags: number;
    author: number;
    filename: number;
    sequence: number;
}

export const DEFAULT_WEIGHTS: RecommendationWeights = {
    recency: 0.2,
    frequency: 0.1,
    collection: 0.4,
    tags: 0.2,
    author: 0.1,
    filename: 0.0, // Used as tie-breaker mostly
    sequence: 0.5, // Boost for the immediate next file
};

export interface RecommendationContext {
    currentVideo: Video;
    allVideos: Video[];
    collections: Collection[];
    weights?: Partial<RecommendationWeights>;
}

export const getRecommendations = (context: RecommendationContext): Video[] => {
    const { currentVideo, allVideos, collections, weights } = context;
    const finalWeights = { ...DEFAULT_WEIGHTS, ...weights };

    // Filter out current video
    const candidates = allVideos.filter(v => v.id !== currentVideo.id);

    // Pre-calculate collection membership for current video
    const currentVideoCollections = collections.filter(c => c.videos.includes(currentVideo.id)).map(c => c.id);

    // Calculate max values for normalization
    const maxViewCount = Math.max(...allVideos.map(v => v.viewCount || 0), 1);
    const now = Date.now();
    // Normalize recency: 1.0 for now, 0.0 for very old (e.g. 1 year ago)
    const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

    // Determine natural sequence
    // Sort all videos by filename/title to find the "next" one naturally
    const sortedAllVideos = [...allVideos].sort((a, b) => {
        const nameA = a.videoFilename || a.title;
        const nameB = b.videoFilename || b.title;
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
    const currentIndex = sortedAllVideos.findIndex(v => v.id === currentVideo.id);
    const nextInSequenceId = currentIndex !== -1 && currentIndex < sortedAllVideos.length - 1 
        ? sortedAllVideos[currentIndex + 1].id 
        : null;

    const scoredCandidates = candidates.map(video => {
        let score = 0;

        // 1. Recency (lastPlayedAt)
        // Higher score for more recently played.
        // If never played, score is 0.
        if (video.lastPlayedAt) {
            const age = Math.max(0, now - video.lastPlayedAt);
            const recencyScore = Math.max(0, 1 - (age / ONE_YEAR_MS));
            score += recencyScore * finalWeights.recency;
        }

        // 2. Frequency (viewCount)
        const frequencyScore = (video.viewCount || 0) / maxViewCount;
        score += frequencyScore * finalWeights.frequency;

        // 3. Collection/Series
        // Check if video is in the same collection as current video
        const videoCollections = collections.filter(c => c.videos.includes(video.id)).map(c => c.id);
        const inSameCollection = currentVideoCollections.some(id => videoCollections.includes(id));
        
        // Also check seriesTitle if available
        const sameSeriesTitle = currentVideo.seriesTitle && video.seriesTitle && currentVideo.seriesTitle === video.seriesTitle;

        if (inSameCollection || sameSeriesTitle) {
            score += 1.0 * finalWeights.collection;
        }

        // 4. Tags
        // Jaccard index or simple overlap
        const currentTags = currentVideo.tags || [];
        const videoTags = video.tags || [];
        if (currentTags.length > 0 && videoTags.length > 0) {
            const intersection = currentTags.filter(t => videoTags.includes(t));
            const union = new Set([...currentTags, ...videoTags]);
            const tagScore = intersection.length / union.size;
            score += tagScore * finalWeights.tags;
        }

        // 5. Author
        if (currentVideo.author && video.author && currentVideo.author === video.author) {
            score += 1.0 * finalWeights.author;
        }
        
        // 6. Sequence (Natural Order)
        if (video.id === nextInSequenceId) {
            score += 1.0 * finalWeights.sequence;
        }
        
        return {
            video,
            score,
            inSameCollection
        };
    });

    // Sort by score descending
    scoredCandidates.sort((a, b) => {
        if (Math.abs(a.score - b.score) > 0.001) {
            return b.score - a.score;
        }

        // Tie-breakers
        
        // 1. Same collection
        if (a.inSameCollection !== b.inSameCollection) {
            return a.inSameCollection ? -1 : 1;
        }

        // 2. Filename natural order
        const nameA = a.video.videoFilename || a.video.title;
        const nameB = b.video.videoFilename || b.video.title;
        
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });

    return scoredCandidates.map(item => item.video);
};
