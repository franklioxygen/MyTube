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
    rating: number;
}

export const DEFAULT_WEIGHTS: RecommendationWeights = {
    // Deprecated Phase 1 inputs kept for callers that pass partial custom weights.
    // Recency/watch-state are now represented by the re-watch cooldown multiplier.
    recency: 0,
    frequency: 0,
    collection: 0.3,
    tags: 0.2,
    author: 0.25,
    filename: 0,
    sequence: 0.35,
    source: 0.05,
    title: 0.1,
    dateProximity: 0.05,
    duration: 0.05,
    watchState: 0,
    rating: 0.15,
};

const STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'by',
    'episode',
    'ep',
    'for',
    'from',
    'in',
    'is',
    'it',
    'of',
    'on',
    'or',
    'part',
    'pt',
    'the',
    'to',
    'video',
    'with',
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const REWATCH_HALF_LIFE_MS = 45 * DAY_MS;
const RESUME_WINDOW_MS = 30 * DAY_MS;
const MAX_RECOMMENDATIONS = 10;
const RELATED_AUTHOR_CAP = 3;
const RELATED_COLLECTION_CAP = 3;

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

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

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

const getProgressRatio = (video: Video): number => {
    const duration = parseDurationSeconds(video.duration);
    const progress = typeof video.progress === 'number' ? video.progress : 0;

    if (!duration || progress <= 0) return 0;
    return clamp(progress / duration, 0, 1);
};

const isInProgress = (video: Video): boolean => {
    const progressRatio = getProgressRatio(video);
    return progressRatio > 0.05 && progressRatio < 0.9;
};

const isCompleted = (video: Video): boolean => getProgressRatio(video) >= 0.9;

const isUnwatched = (video: Video): boolean =>
    (video.viewCount || 0) === 0 && getProgressRatio(video) === 0;

const getRewatchMultiplier = (video: Video, now: number): number => {
    if (isInProgress(video)) return 1.15;
    if (!isCompleted(video)) return 1;

    const lastFinishedAt = typeof video.lastPlayedAt === 'number' ? video.lastPlayedAt : null;
    if (!lastFinishedAt) return 1;

    const age = Math.max(0, now - lastFinishedAt);
    const base = 1 - Math.pow(2, -age / REWATCH_HALF_LIFE_MS);
    const rating = typeof video.rating === 'number' ? clamp(video.rating, 1, 5) : 3;
    const ratingBoost = 1 + 0.3 * ((rating - 3) / 2);
    const viewCount = video.viewCount || 0;
    const rewatchRate = viewCount > 0 ? Math.max(0, viewCount - 1) / viewCount : 0;

    return clamp(base * (ratingBoost + 0.5 * rewatchRate), 0, 1);
};

const getRatingAffinity = (video: Video, weight: number): number => {
    if (typeof video.rating !== 'number') return 0;
    return clamp((video.rating - 3) / 2, -1, 1) * weight;
};

const getAuthorKey = (video: Video): string =>
    normalizeText(typeof video.channelUrl === 'string' ? video.channelUrl : video.author);

const sortByNaturalName = (a: Video, b: Video): number =>
    getName(a).localeCompare(getName(b), undefined, { numeric: true, sensitivity: 'base' });

const getAddedAtTimestamp = (video: Video): number =>
    parseDateValue(video.addedAt) ?? parseDateValue(video.date) ?? 0;

const sortByNewest = (a: Video, b: Video): number =>
    getAddedAtTimestamp(b) - getAddedAtTimestamp(a) || sortByNaturalName(a, b);

type CollectionMembership = Map<string, Array<{ id: string; index: number }>>;

const buildCollectionMembership = (collections: Collection[]): CollectionMembership => {
    const membership: CollectionMembership = new Map();

    collections.forEach(collection => {
        collection.videos.forEach((videoId, index) => {
            const existing = membership.get(videoId) ?? [];
            existing.push({ id: collection.id, index });
            membership.set(videoId, existing);
        });
    });

    return membership;
};

const getCollectionPositionScore = (
    currentVideo: Video,
    candidate: Video,
    membership: CollectionMembership
): number => {
    const currentMembership = membership.get(currentVideo.id) ?? [];
    const candidateMembership = membership.get(candidate.id) ?? [];
    let bestScore = 0;

    currentMembership.forEach(currentItem => {
        const candidateItem = candidateMembership.find(item => item.id === currentItem.id);
        if (!candidateItem) return;

        const distance = Math.abs(candidateItem.index - currentItem.index);
        if (distance === 0) return;

        bestScore = Math.max(bestScore, 1 / distance);
    });

    return clamp(bestScore, 0, 1);
};

const hasSameSeries = (currentVideo: Video, candidate: Video): boolean =>
    Boolean(
        currentVideo.seriesTitle &&
        candidate.seriesTitle &&
        normalizeText(currentVideo.seriesTitle) === normalizeText(candidate.seriesTitle)
    );

const getSeriesStem = (video: Video): string =>
    tokenize(getName(video))
        .filter(token => !/^\d+$/.test(token))
        .join(' ');

const findNextEpisode = (currentVideo: Video, candidates: Video[]): Video | undefined => {
    if (!currentVideo.seriesTitle || typeof currentVideo.partNumber !== 'number') return undefined;

    const nextPartNumber = currentVideo.partNumber + 1;
    return candidates
        .filter(candidate =>
            hasSameSeries(currentVideo, candidate) &&
            candidate.partNumber === nextPartNumber
        )
        .sort((a, b) => {
            const totalA = typeof a.totalParts === 'number' ? a.totalParts : Number.MAX_SAFE_INTEGER;
            const totalB = typeof b.totalParts === 'number' ? b.totalParts : Number.MAX_SAFE_INTEGER;
            return totalA - totalB || sortByNaturalName(a, b);
        })[0];
};

const findNextSharedCollectionVideo = (
    currentVideo: Video,
    candidatesById: Map<string, Video>,
    collections: Collection[]
): Video | undefined => {
    const options: Array<{ video: Video; distance: number; collectionIndex: number }> = [];

    collections.forEach((collection, collectionIndex) => {
        const currentIndex = collection.videos.indexOf(currentVideo.id);
        if (currentIndex === -1) return;

        for (let index = currentIndex + 1; index < collection.videos.length; index += 1) {
            const candidate = candidatesById.get(collection.videos[index]);
            if (!candidate || isCompleted(candidate)) continue;

            options.push({
                video: candidate,
                distance: index - currentIndex,
                collectionIndex
            });
            break;
        }
    });

    return options.sort((a, b) =>
        a.distance - b.distance ||
        a.collectionIndex - b.collectionIndex ||
        sortByNaturalName(a.video, b.video)
    )[0]?.video;
};

const findFilenameAdjacentVideo = (currentVideo: Video, candidates: Video[]): Video | undefined => {
    const currentAuthor = getAuthorKey(currentVideo);
    const currentStem = getSeriesStem(currentVideo);
    if (!currentAuthor || !currentStem) return undefined;

    const scopedVideos = [currentVideo, ...candidates]
        .filter(video => getAuthorKey(video) === currentAuthor && getSeriesStem(video) === currentStem)
        .sort(sortByNaturalName);
    const currentIndex = scopedVideos.findIndex(video => video.id === currentVideo.id);

    if (currentIndex === -1 || currentIndex >= scopedVideos.length - 1) return undefined;
    return scopedVideos[currentIndex + 1];
};

interface ScoredCandidate {
    video: Video;
    score: number;
    collectionScore: number;
}

const scoreCandidate = (
    currentVideo: Video,
    candidate: Video,
    allVideos: Video[],
    membership: CollectionMembership,
    weights: RecommendationWeights,
    now: number,
    currentTags: string[],
    currentTitleTokens: string[],
    nextScopedSequenceId: string | null
): ScoredCandidate => {
    const candidateTags = normalizeTags(candidate.tags);
    const candidateTitleTokens = tokenize(`${candidate.title} ${candidate.videoFilename ?? ''}`);
    const collectionScore = Math.max(
        getCollectionPositionScore(currentVideo, candidate, membership),
        hasSameSeries(currentVideo, candidate) ? 1 : 0
    );
    const authorScore = getAuthorKey(currentVideo) && getAuthorKey(currentVideo) === getAuthorKey(candidate) ? 1 : 0;
    const sourceScore = currentVideo.source && candidate.source && currentVideo.source === candidate.source ? 1 : 0;
    const maxViewCount = Math.max(...allVideos.map(video => video.viewCount || 0), 1);
    const frequencyScore = (candidate.viewCount || 0) / maxViewCount;
    const sequenceScore = candidate.id === nextScopedSequenceId ? 1 : 0;

    const similarity =
        collectionScore * weights.collection +
        authorScore * weights.author +
        jaccardScore(currentTags, candidateTags) * weights.tags +
        jaccardScore(currentTitleTokens, candidateTitleTokens) * weights.title +
        getDateProximityScore(currentVideo, candidate) * weights.dateProximity +
        getDurationSimilarityScore(currentVideo, candidate) * weights.duration +
        sourceScore * weights.source +
        sequenceScore * weights.sequence +
        frequencyScore * weights.frequency;

    const score = similarity *
        (1 + getRatingAffinity(candidate, weights.rating)) *
        getRewatchMultiplier(candidate, now);

    return {
        video: candidate,
        score,
        collectionScore
    };
};

const sortScoredCandidates = (a: ScoredCandidate, b: ScoredCandidate): number => {
    if (Math.abs(a.score - b.score) > 0.001) return b.score - a.score;
    if (Math.abs(a.collectionScore - b.collectionScore) > 0.001) {
        return b.collectionScore - a.collectionScore;
    }

    return sortByNaturalName(a.video, b.video);
};

const addCandidate = (candidateIds: Set<string>, video: Video | undefined, currentVideoId: string) => {
    if (video && video.id !== currentVideoId) candidateIds.add(video.id);
};

const buildCandidatePool = (
    currentVideo: Video,
    allCandidates: Video[],
    collections: Collection[],
    membership: CollectionMembership
): Video[] => {
    const candidateIds = new Set<string>();
    const allCandidatesById = new Map(allCandidates.map(video => [video.id, video]));
    const currentTags = new Set(normalizeTags(currentVideo.tags));
    const currentAuthor = getAuthorKey(currentVideo);

    (membership.get(currentVideo.id) ?? []).forEach(item => {
        const collection = collections.find(collectionItem => collectionItem.id === item.id);
        collection?.videos.forEach(videoId => {
            addCandidate(candidateIds, allCandidatesById.get(videoId), currentVideo.id);
        });
    });

    allCandidates
        .filter(video => getAuthorKey(video) === currentAuthor)
        .sort(sortByNewest)
        .slice(0, 50)
        .forEach(video => addCandidate(candidateIds, video, currentVideo.id));

    allCandidates
        .filter(video => normalizeTags(video.tags).some(tag => currentTags.has(tag)))
        .forEach(video => addCandidate(candidateIds, video, currentVideo.id));

    allCandidates
        .filter(video => hasSameSeries(currentVideo, video))
        .forEach(video => addCandidate(candidateIds, video, currentVideo.id));

    allCandidates
        .filter(video => isInProgress(video))
        .forEach(video => addCandidate(candidateIds, video, currentVideo.id));

    allCandidates
        .filter(video => typeof video.rating === 'number' && video.rating >= 4)
        .sort((a, b) => (b.rating || 0) - (a.rating || 0) || sortByNewest(a, b))
        .slice(0, 30)
        .forEach(video => addCandidate(candidateIds, video, currentVideo.id));

    allCandidates
        .sort(sortByNewest)
        .slice(0, 30)
        .forEach(video => addCandidate(candidateIds, video, currentVideo.id));

    if (candidateIds.size < Math.min(MAX_RECOMMENDATIONS, allCandidates.length)) {
        allCandidates.forEach(video => addCandidate(candidateIds, video, currentVideo.id));
    }

    return Array.from(candidateIds)
        .map(videoId => allCandidatesById.get(videoId))
        .filter((video): video is Video => Boolean(video));
};

interface DiversityState {
    authorCounts: Map<string, number>;
    collectionCounts: Map<string, number>;
}

const createDiversityState = (): DiversityState => ({
    authorCounts: new Map(),
    collectionCounts: new Map(),
});

const recordDiversity = (
    video: Video,
    membership: CollectionMembership,
    state: DiversityState
) => {
    const authorKey = getAuthorKey(video);
    if (authorKey) {
        state.authorCounts.set(authorKey, (state.authorCounts.get(authorKey) || 0) + 1);
    }

    (membership.get(video.id) ?? []).forEach(item => {
        state.collectionCounts.set(item.id, (state.collectionCounts.get(item.id) || 0) + 1);
    });
};

const canSelectByDiversity = (
    video: Video,
    membership: CollectionMembership,
    state: DiversityState
): boolean => {
    const authorKey = getAuthorKey(video);
    if (authorKey && (state.authorCounts.get(authorKey) || 0) >= RELATED_AUTHOR_CAP) return false;

    return (membership.get(video.id) ?? []).every(item =>
        (state.collectionCounts.get(item.id) || 0) < RELATED_COLLECTION_CAP
    );
};

const pickRelatedVideos = (
    scoredCandidates: ScoredCandidate[],
    selectedIds: Set<string>,
    membership: CollectionMembership,
    diversityState: DiversityState,
    limit: number
): Video[] => {
    const selected: Video[] = [];

    for (const item of scoredCandidates) {
        if (selected.length >= limit) break;
        if (selectedIds.has(item.video.id)) continue;
        if (!canSelectByDiversity(item.video, membership, diversityState)) continue;

        selected.push(item.video);
        selectedIds.add(item.video.id);
        recordDiversity(item.video, membership, diversityState);
    }

    return selected;
};

const pickDiscoverVideos = (
    scoredCandidates: ScoredCandidate[],
    selectedIds: Set<string>,
    membership: CollectionMembership,
    diversityState: DiversityState,
    now: number,
    limit: number
): Video[] => {
    const selected: Video[] = [];
    const candidateVideos = scoredCandidates.map(item => item.video);
    const freshestUnwatched = candidateVideos
        .filter(video => !selectedIds.has(video.id) && isUnwatched(video))
        .sort((a, b) => (b.rating || 0) - (a.rating || 0) || sortByNewest(a, b))[0];

    if (
        freshestUnwatched &&
        canSelectByDiversity(freshestUnwatched, membership, diversityState)
    ) {
        selected.push(freshestUnwatched);
        selectedIds.add(freshestUnwatched.id);
        recordDiversity(freshestUnwatched, membership, diversityState);
    }

    if (selected.length >= limit) return selected;

    const rewatchPick = candidateVideos
        .filter(video => {
            if (selectedIds.has(video.id) || !isCompleted(video)) return false;
            return getRewatchMultiplier(video, now) >= 0.5 &&
                ((video.rating || 0) >= 4 || (video.viewCount || 0) > 1);
        })
        .sort((a, b) =>
            (getRewatchMultiplier(b, now) * (1 + getRatingAffinity(b, DEFAULT_WEIGHTS.rating))) -
            (getRewatchMultiplier(a, now) * (1 + getRatingAffinity(a, DEFAULT_WEIGHTS.rating))) ||
            sortByNewest(a, b)
        )[0];

    if (rewatchPick && canSelectByDiversity(rewatchPick, membership, diversityState)) {
        selected.push(rewatchPick);
        selectedIds.add(rewatchPick.id);
        recordDiversity(rewatchPick, membership, diversityState);
    }

    return selected;
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

    const candidates = allVideos.filter(video => video.id !== currentVideo.id);
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

    if (candidates.length === 0) return [];

    const now = Date.now();
    const membership = buildCollectionMembership(collections);
    const candidatePool = buildCandidatePool(currentVideo, candidates, collections, membership);
    const currentTags = normalizeTags(currentVideo.tags);
    const currentTitleTokens = tokenize(`${currentVideo.title} ${currentVideo.videoFilename ?? ''}`);
    const nextEpisode = findNextEpisode(currentVideo, candidatePool);
    const nextSharedCollectionVideo = findNextSharedCollectionVideo(currentVideo, candidateById, collections);
    const filenameAdjacentVideo = findFilenameAdjacentVideo(currentVideo, candidatePool);
    const nextScopedSequenceId =
        nextEpisode?.id ??
        nextSharedCollectionVideo?.id ??
        filenameAdjacentVideo?.id ??
        null;
    const scoredCandidates = candidatePool
        .map(candidate => scoreCandidate(
            currentVideo,
            candidate,
            allVideos,
            membership,
            finalWeights,
            now,
            currentTags,
            currentTitleTokens,
            nextScopedSequenceId
        ))
        .sort(sortScoredCandidates);

    const selectedIds = new Set<string>();
    const diversityState = createDiversityState();
    const slate: Video[] = [];

    [nextEpisode, nextSharedCollectionVideo, filenameAdjacentVideo].forEach(video => {
        if (!video || selectedIds.has(video.id) || slate.length >= 3) return;

        slate.push(video);
        selectedIds.add(video.id);
        recordDiversity(video, membership, diversityState);
    });

    const resumeVideo = scoredCandidates
        .map(item => item.video)
        .filter(video =>
            !selectedIds.has(video.id) &&
            isInProgress(video) &&
            typeof video.lastPlayedAt === 'number' &&
            now - video.lastPlayedAt <= RESUME_WINDOW_MS
        )[0];

    if (resumeVideo && slate.length < 3) {
        slate.push(resumeVideo);
        selectedIds.add(resumeVideo.id);
        recordDiversity(resumeVideo, membership, diversityState);
    }

    const discoverSlots = Math.min(2, Math.max(0, MAX_RECOMMENDATIONS - slate.length));
    const relatedSlots = Math.max(0, MAX_RECOMMENDATIONS - slate.length - discoverSlots);
    slate.push(...pickRelatedVideos(scoredCandidates, selectedIds, membership, diversityState, relatedSlots));
    slate.push(...pickDiscoverVideos(scoredCandidates, selectedIds, membership, diversityState, now, discoverSlots));

    if (slate.length < Math.min(MAX_RECOMMENDATIONS, candidates.length)) {
        slate.push(...pickRelatedVideos(
            scoredCandidates,
            selectedIds,
            membership,
            diversityState,
            Math.min(MAX_RECOMMENDATIONS, candidates.length) - slate.length
        ));
    }

    return slate;
};
