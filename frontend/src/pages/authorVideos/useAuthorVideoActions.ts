import { AlertColor } from '@mui/material';
import { useCallback, useMemo, useState } from 'react';

import { Collection, Video } from '../../types';
import { TranslationKey } from '../../utils/translations';
import {
    buildUpdatedTags,
    findAuthorCollection,
    getTagDiff,
    getVideosInOtherCollectionsCount,
    getVideosMissingFromCollection
} from './utils';

type TranslateFn = (key: TranslationKey, replacements?: Record<string, string | number>) => string;
type ShowSnackbarFn = (message: string, severity?: AlertColor) => void;

interface UseAuthorVideoActionsParams {
    authorDisplayName: string;
    authorVideos: Video[];
    commonTags: string[];
    collections: Collection[];
    deleteVideo: (id: string, options?: { showSnackbar?: boolean }) => Promise<{ success: boolean; error?: string }>;
    updateVideo: (id: string, updates: Partial<Video>) => Promise<{ success: boolean; error?: string }>;
    createCollection: (name: string, videoId: string) => Promise<Collection | null>;
    addToCollection: (collectionId: string, videoId: string) => Promise<Collection | null>;
    showSnackbar: ShowSnackbarFn;
    t: TranslateFn;
    navigateHome: () => void;
}

interface UseAuthorVideoActionsResult {
    isDeleteModalOpen: boolean;
    isDeleting: boolean;
    isCreateCollectionModalOpen: boolean;
    isCreatingCollection: boolean;
    isTagsModalOpen: boolean;
    openDeleteModal: () => void;
    closeDeleteModal: () => void;
    openCreateCollectionModal: () => void;
    closeCreateCollectionModal: () => void;
    openTagsModal: () => void;
    closeTagsModal: () => void;
    handleDeleteAuthor: () => Promise<void>;
    handleSaveAuthorTags: (newCommonTags: string[]) => Promise<void>;
    handleCreateCollectionFromAuthor: () => Promise<void>;
    createCollectionModalTitle: string;
    createCollectionMessage: string;
}

const hasNoWork = (tagsToAdd: string[], tagsToRemove: string[]): boolean => {
    return tagsToAdd.length === 0 && tagsToRemove.length === 0;
};

const hasTagChanges = (before: string[] | undefined, after: string[]): boolean => {
    return JSON.stringify(before || []) !== JSON.stringify(after);
};

const deleteAuthorVideosSequentially = async (
    authorVideos: Video[],
    deleteVideo: UseAuthorVideoActionsParams['deleteVideo']
): Promise<boolean> => {
    let hasFailure = false;
    for (const video of authorVideos) {
        const result = await deleteVideo(video.id, { showSnackbar: false });
        if (!result.success) {
            hasFailure = true;
        }
    }
    return hasFailure;
};

export const useAuthorVideoActions = ({
    authorDisplayName,
    authorVideos,
    commonTags,
    collections,
    deleteVideo,
    updateVideo,
    createCollection,
    addToCollection,
    showSnackbar,
    t,
    navigateHome
}: UseAuthorVideoActionsParams): UseAuthorVideoActionsResult => {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isCreateCollectionModalOpen, setIsCreateCollectionModalOpen] = useState(false);
    const [isCreatingCollection, setIsCreatingCollection] = useState(false);
    const [isTagsModalOpen, setIsTagsModalOpen] = useState(false);

    const existingCollection = useMemo(
        () => findAuthorCollection(collections, authorDisplayName) || null,
        [collections, authorDisplayName]
    );

    const openDeleteModal = useCallback(() => {
        setIsDeleteModalOpen(true);
    }, []);

    const closeDeleteModal = useCallback(() => {
        setIsDeleteModalOpen(false);
    }, []);

    const openCreateCollectionModal = useCallback(() => {
        if (!authorDisplayName || authorVideos.length === 0) {
            return;
        }
        setIsCreateCollectionModalOpen(true);
    }, [authorDisplayName, authorVideos.length]);

    const closeCreateCollectionModal = useCallback(() => {
        setIsCreateCollectionModalOpen(false);
    }, []);

    const openTagsModal = useCallback(() => {
        setIsTagsModalOpen(true);
    }, []);

    const closeTagsModal = useCallback(() => {
        setIsTagsModalOpen(false);
    }, []);

    const handleDeleteAuthor = useCallback(async () => {
        if (authorVideos.length === 0) {
            return;
        }

        setIsDeleting(true);
        try {
            const hasFailure = await deleteAuthorVideosSequentially(authorVideos, deleteVideo);
            if (hasFailure) {
                throw new Error('Some videos failed to delete');
            }
            showSnackbar(t('authorDeletedSuccessfully'));
            navigateHome();
        } catch (error) {
            console.error('Error deleting author videos:', error);
            showSnackbar(t('failedToDeleteAuthor'));
        } finally {
            setIsDeleting(false);
            setIsDeleteModalOpen(false);
        }
    }, [authorVideos, deleteVideo, navigateHome, showSnackbar, t]);

    const handleSaveAuthorTags = useCallback(async (newCommonTags: string[]) => {
        if (authorVideos.length === 0) {
            return;
        }

        const { tagsToAdd, tagsToRemove } = getTagDiff(commonTags, newCommonTags);
        if (hasNoWork(tagsToAdd, tagsToRemove)) {
            setIsTagsModalOpen(false);
            return;
        }

        try {
            await Promise.all(authorVideos.map(async (video) => {
                const updatedTags = buildUpdatedTags(video.tags, tagsToAdd, tagsToRemove);
                if (hasTagChanges(video.tags, updatedTags)) {
                    await updateVideo(video.id, { tags: updatedTags });
                }
            }));

            showSnackbar(t('videoUpdated'));
            setIsTagsModalOpen(false);
        } catch (error) {
            console.error('Error updating tags:', error);
            showSnackbar(t('error'), 'error');
        }
    }, [authorVideos, commonTags, showSnackbar, t, updateVideo]);

    const handleCreateCollectionFromAuthor = useCallback(async () => {
        if (!authorDisplayName || authorVideos.length === 0) {
            return;
        }

        setIsCreatingCollection(true);
        try {
            let targetCollection = existingCollection;
            if (!targetCollection) {
                const firstVideo = authorVideos[0];
                const createdCollection = await createCollection(authorDisplayName, firstVideo.id);
                if (!createdCollection) {
                    throw new Error('Failed to create collection');
                }
                targetCollection = createdCollection;
            }

            const videosToAdd = getVideosMissingFromCollection(authorVideos, targetCollection);
            if (videosToAdd.length > 0) {
                await Promise.all(videosToAdd.map((video) =>
                    addToCollection(targetCollection.id, video.id)
                ));
            }

            showSnackbar(t(existingCollection ? 'videosAddedToCollection' : 'collectionCreatedFromAuthor'));
            setIsCreateCollectionModalOpen(false);
        } catch (error) {
            console.error('Error creating collection from author:', error);
            showSnackbar(t('failedToCreateCollectionFromAuthor'), 'error');
        } finally {
            setIsCreatingCollection(false);
        }
    }, [
        addToCollection,
        authorDisplayName,
        authorVideos,
        createCollection,
        existingCollection,
        showSnackbar,
        t
    ]);

    const createCollectionMessage = useMemo(() => {
        const videosInOtherCollectionsCount = getVideosInOtherCollectionsCount(
            authorVideos,
            collections,
            existingCollection
        );
        const videosNotInTarget = getVideosMissingFromCollection(authorVideos, existingCollection);

        if (existingCollection) {
            if (videosInOtherCollectionsCount > 0) {
                return t('addVideosToExistingCollectionConfirmationWithMove', {
                    author: authorDisplayName || '',
                    count: videosNotInTarget.length,
                    moveCount: videosInOtherCollectionsCount
                });
            }
            return t('addVideosToExistingCollectionConfirmation', {
                author: authorDisplayName || '',
                count: videosNotInTarget.length
            });
        }

        if (videosInOtherCollectionsCount > 0) {
            return t('createCollectionFromAuthorConfirmationWithMove', {
                author: authorDisplayName || '',
                count: videosInOtherCollectionsCount
            });
        }

        return t('createCollectionFromAuthorConfirmation', {
            author: authorDisplayName || ''
        });
    }, [authorDisplayName, authorVideos, collections, existingCollection, t]);

    const createCollectionModalTitle = useMemo(() => {
        if (existingCollection) {
            return t('addVideosToCollection');
        }
        return t('createCollectionFromAuthor');
    }, [existingCollection, t]);

    return {
        isDeleteModalOpen,
        isDeleting,
        isCreateCollectionModalOpen,
        isCreatingCollection,
        isTagsModalOpen,
        openDeleteModal,
        closeDeleteModal,
        openCreateCollectionModal,
        closeCreateCollectionModal,
        openTagsModal,
        closeTagsModal,
        handleDeleteAuthor,
        handleSaveAuthorTags,
        handleCreateCollectionFromAuthor,
        createCollectionModalTitle,
        createCollectionMessage
    };
};
