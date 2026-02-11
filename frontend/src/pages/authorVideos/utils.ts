import { Collection, Video } from '../../types';

type NamedCollection = Collection & {
    title?: string;
};

export const getAuthorVideos = (videos: Video[], authorParam?: string): Video[] => {
    if (!authorParam) {
        return [];
    }
    return videos.filter((video) => video.author === authorParam);
};

export const getAvailableAuthorTags = (authorVideos: Video[]): string[] => {
    const tags = authorVideos.flatMap((video) => video.tags || []);
    return Array.from(new Set(tags)).sort();
};

export const getCommonAuthorTags = (authorVideos: Video[]): string[] => {
    if (authorVideos.length === 0) {
        return [];
    }

    const firstVideoTags = new Set(authorVideos[0].tags || []);
    const intersection = authorVideos.slice(1).reduce((result, video) => {
        const currentTags = new Set(video.tags || []);
        return new Set([...result].filter((tag) => currentTags.has(tag)));
    }, firstVideoTags);

    return Array.from(intersection).sort();
};

export const filterAuthorVideosByTags = (
    authorVideos: Video[],
    selectedTags: string[]
): Video[] => {
    if (selectedTags.length === 0) {
        return authorVideos;
    }

    return authorVideos.filter((video) =>
        selectedTags.every((tag) => (video.tags || []).includes(tag))
    );
};

export const findAuthorCollection = (
    collections: Collection[],
    authorDisplayName: string
): NamedCollection | undefined => {
    return collections.find((collection) => {
        const collectionName = collection.name || (collection as NamedCollection).title || '';
        return collectionName === authorDisplayName;
    }) as NamedCollection | undefined;
};

export const getVideosMissingFromCollection = (
    authorVideos: Video[],
    targetCollection: Collection | null
): Video[] => {
    if (!targetCollection) {
        return authorVideos;
    }
    return authorVideos.filter((video) => !targetCollection.videos.includes(video.id));
};

export const getVideosInOtherCollectionsCount = (
    authorVideos: Video[],
    collections: Collection[],
    targetCollection: Collection | null
): number => {
    return authorVideos.filter((video) => {
        if (targetCollection && targetCollection.videos.includes(video.id)) {
            return false;
        }
        return collections.some((collection) => collection.videos.includes(video.id));
    }).length;
};

export const getVideoCountLabel = (
    totalVideos: number,
    filteredVideos: number,
    selectedTagCount: number,
    videosText: string
): string => {
    if (totalVideos === 0) {
        return `0 ${videosText}`;
    }
    if (selectedTagCount > 0) {
        return `${filteredVideos} / ${totalVideos} ${videosText}`;
    }
    return `${totalVideos} ${videosText}`;
};

export const buildUpdatedTags = (
    originalTags: string[] | undefined,
    tagsToAdd: string[],
    tagsToRemove: string[]
): string[] => {
    const baseTags = originalTags || [];
    const tagsWithAdditions = tagsToAdd.length > 0
        ? Array.from(new Set([...baseTags, ...tagsToAdd]))
        : baseTags;
    return tagsToRemove.length > 0
        ? tagsWithAdditions.filter((tag) => !tagsToRemove.includes(tag))
        : tagsWithAdditions;
};

export const getTagDiff = (
    oldCommonTags: string[],
    newCommonTags: string[]
): { tagsToAdd: string[]; tagsToRemove: string[] } => {
    const tagsToAdd = newCommonTags.filter((tag) => !oldCommonTags.includes(tag));
    const tagsToRemove = oldCommonTags.filter((tag) => !newCommonTags.includes(tag));
    return { tagsToAdd, tagsToRemove };
};
