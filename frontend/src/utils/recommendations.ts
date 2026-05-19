import { Collection, Video } from '../types';

export interface RecommendationWeights {
    recency: number;
    frequency: number;
    collection: number;
    tags: number;
    author: number;
    filename: number;
    sequence: number;
    source: number;
    title: number;
    dateProximity: number;
    duration: number;
    watchState: number;
}

export const DEFAULT_WEIGHTS: RecommendationWeights = {
    recency: 0.08,
    frequency: 0.04,
    collection: 0.4,
    tags: 0.35,
    author: 0.3,
    filename: 0.0, // Used as tie-breaker mostly
    sequence: 0.25, // Boost for the immediate next file
    source: 0.08,
    title: 0.25,
    dateProximity: 0.08,
    duration: 0.05,
    watchState: 0.2,
};

const STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'by',
    'for',
    'from',
    'in',
    'is',
    'it',
    'of',
    'on',
    'or',
    'part',
    'the',
    'to',
    'video',
    'with',
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const ONE_YEAR_MS = 365 * DAY_MS;

const normalizeText = (value: string | undefined | null): string =>
    (value ?? '').trim().toLowerCase();

const normalizeTags = (tags: string[] | undefined): string[] =>
    Array.from(new Set((tags ?? []).map(normalizeText).filter(Boolean)));

const getName = (video: Video): string => video.videoFilename || video.title || '';

const tokenize = (value: string | undefined | null): string[] =>
    Array.from(new Set(
        normalizeText(value)
            .replace(/\.[a-z0-9]{2,5}$/i, ' ')
            .replace(/[_-]+/g, ' ')
            .split(/[^a-z0-9]+/i)
            .filter(token => token.length > 1 && !STOP_WORDS.has(token))
    ));

const jaccardScore = (a: string[], b: string[]): number => {
    if (a.length === 0 || b.length === 0) return 0;

    const aSet = new Set(a);
    const bSet = new Set(b);
    let intersection = 0;

    for (const item of aSet) {
        if (bSet.has(item)) intersection++;
    }

    const union = new Set([...aSet, ...bSet]);
    return intersection / union.size;
};

const parseDateValue = (value: string | undefined): number | null => {
    if (!value) return null;

    if (/^\d{8}$/.test(value)) {
        const year = Number(value.slice(0, 4));
        const month = Number(value.slice(4, 6)) - 1;
        const day = Number(value.slice(6, 8));
        const timestamp = new Date(year, month, day).getTime();
        return Number.isNaN(timestamp) ? null : timestamp;
    }

    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
};

const parseDurationSeconds = (duration: string | number | undefined): number | null => {
    if (duration == null) return null;
    if (typeof duration === 'number') return Number.isFinite(duration) ? duration : null;

    const parts = duration.split(':').map(part => Number(part));
    if (parts.some(part => Number.isNaN(part))) return null;

    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];

    return null;
};

const getDateProximityScore = (currentVideo: Video, candidate: Video): number => {
    const currentDate = parseDateValue(currentVideo.date) ?? parseDateValue(currentVideo.addedAt);
    const candidateDate = parseDateValue(candidate.date) ?? parseDateValue(candidate.addedAt);

    if (!currentDate || !candidateDate) return 0;

    const daysApart = Math.abs(currentDate - candidateDate) / DAY_MS;
    return Math.max(0, 1 - daysApart / 90);
};

const getDurationSimilarityScore = (currentVideo: Video, candidate: Video): number => {
    const currentDuration = parseDurationSeconds(currentVideo.duration);
    const candidateDuration = parseDurationSeconds(candidate.duration);

    if (!currentDuration || !candidateDuration) return 0;

    const longerDuration = Math.max(currentDuration, candidateDuration);
    const shorterDuration = Math.min(currentDuration, candidateDuration);
    return shorterDuration / longerDuration;
};

const getWatchStateScore = (video: Video): number => {
    const viewCount = video.viewCount || 0;
    const duration = parseDurationSeconds(video.duration);
    const progress = typeof video.progress === 'number' ? video.progress : 0;

    if (duration && progress > 0) {
        const progressRatio = Math.min(progress / duration, 1);
        if (progressRatio >= 0.9) return -0.8;
        return 0.7;
    }

    if (viewCount === 0) return 1;
    if (viewCount <= 2) return 0.25;

    return -0.1;
};

export interface RecommendationContext {
    currentVideo: Video;
    allVideos: Video[];
    collections: Collection[];
    weights?: Partial<RecommendationWeights>;
    sourceCollectionId?: string | null;
    playbackQueueVideoIds?: string[];
}

export const getRecommendations = (context: RecommendationContext): Video[] => {
    const { currentVideo, allVideos, collections, weights, sourceCollectionId, playbackQueueVideoIds } = context;
    const finalWeights = { ...DEFAULT_WEIGHTS, ...weights };

    // Filter out current video
    const candidates = allVideos.filter(v => v.id !== currentVideo.id);
    const candidateById = new Map(candidates.map(video => [video.id, video]));

    const sourceCollection = sourceCollectionId
        ? collections.find(collection =>
            collection.id === sourceCollectionId &&
            collection.videos.includes(currentVideo.id)
        )
        : undefined;

    const sourceQueueIds = playbackQueueVideoIds?.includes(currentVideo.id)
        ? playbackQueueVideoIds
        : sourceCollection?.videos;

    if (sourceQueueIds) {
        const currentQueueIndex = sourceQueueIds.indexOf(currentVideo.id);
        if (currentQueueIndex !== -1) {
            const queuedRecommendations = sourceQueueIds
                .slice(currentQueueIndex + 1)
                .map(videoId => candidateById.get(videoId))
                .filter((video): video is Video => Boolean(video));

            const queuedVideoIds = new Set(
                sourceQueueIds.filter(videoId => videoId !== currentVideo.id)
            );
            const fallbackRecommendations = getRecommendations({
                currentVideo,
                allVideos: allVideos.filter(video =>
                    video.id === currentVideo.id || !queuedVideoIds.has(video.id)
                ),
                collections,
                weights
            });

            return [...queuedRecommendations, ...fallbackRecommendations];
        }
    }

    // Pre-calculate collection membership for current video
    const currentVideoCollections = collections.filter(c => c.videos.includes(currentVideo.id)).map(c => c.id);

    // Calculate max values for normalization
    const maxViewCount = Math.max(...allVideos.map(v => v.viewCount || 0), 1);
    const now = Date.now();
    const currentTags = normalizeTags(currentVideo.tags);
    const currentTitleTokens = tokenize(`${currentVideo.title} ${currentVideo.videoFilename ?? ''}`);

    // Determine natural sequence
    // Sort all videos by filename/title to find the "next" one naturally
    const sortedAllVideos = [...allVideos].sort((a, b) => {
        const nameA = getName(a);
        const nameB = getName(b);
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

        // 2. Frequency (viewCount). Kept intentionally weak so watched videos
        // do not dominate topic relevance.
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
        const videoTags = normalizeTags(video.tags);
        score += jaccardScore(currentTags, videoTags) * finalWeights.tags;

        // 5. Author
        if (currentVideo.author && video.author && currentVideo.author === video.author) {
            score += 1.0 * finalWeights.author;
        }

        // 6. Platform/source
        if (currentVideo.source && video.source && currentVideo.source === video.source) {
            score += 1.0 * finalWeights.source;
        }

        // 7. Title/filename similarity
        const videoTitleTokens = tokenize(`${video.title} ${video.videoFilename ?? ''}`);
        score += jaccardScore(currentTitleTokens, videoTitleTokens) * finalWeights.title;

        // 8. Video/add date proximity
        score += getDateProximityScore(currentVideo, video) * finalWeights.dateProximity;

        // 9. Duration similarity
        score += getDurationSimilarityScore(currentVideo, video) * finalWeights.duration;

        // 10. Watch state: prefer discovery and resumable videos.
        score += getWatchStateScore(video) * finalWeights.watchState;
        
        // 11. Sequence (Natural Order)
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
        const nameA = getName(a.video);
        const nameB = getName(b.video);
        
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });

    return scoredCandidates.map(item => item.video);
};
