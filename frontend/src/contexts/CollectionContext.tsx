import { getApiErrorMessage } from '../utils/errors';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { Collection } from '../types';
import { api } from '../utils/apiClient';
import { useAuth } from './AuthContext';
import { useLanguage } from './LanguageContext';
import { useSnackbar } from './SnackbarContext';

interface CollectionContextType {
    collections: Collection[];
    fetchCollections: () => Promise<void>;
    /** Rejects on failure; callers that need retry/open-modal behavior must handle errors. */
    createCollection: (name: string, videoId: string) => Promise<Collection>;
    /** Rejects on failure; callers that need retry/open-modal behavior must handle errors. */
    addToCollection: (collectionId: string, videoId: string) => Promise<Collection>;
    removeFromCollection: (collectionId: string, videoId: string) => Promise<boolean>;
    deleteCollection: (collectionId: string, deleteVideos?: boolean) => Promise<{ success: boolean; error?: string }>;
    updateCollection: (id: string, name: string) => Promise<{ success: boolean; error?: string }>;
}

const CollectionContext = createContext<CollectionContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useCollection = () => {
    const context = useContext(CollectionContext);
    if (!context) {
        throw new Error('useCollection must be used within a CollectionProvider');
    }
    return context;
};

export const CollectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { showSnackbar } = useSnackbar();
    const { t } = useLanguage();
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();

    const { data: collections = [], refetch: fetchCollectionsQuery } = useQuery({
        queryKey: ['collections'],
        queryFn: async () => {
            const response = await api.get('/collections');
            return response.data as Collection[];
        },
        // Only query when authenticated to avoid 401 errors on login page
        enabled: isAuthenticated,
        retry: (failureCount, error: any) => {
            // Don't retry on 401 errors (unauthorized) - user is not authenticated
            if (error?.response?.status === 401) {
                return false;
            }
            // Retry other errors up to 3 times
            return failureCount < 3;
        },
    });

    const fetchCollections = useCallback(async () => {
        await fetchCollectionsQuery();
    }, [fetchCollectionsQuery]);

    const createCollectionMutation = useMutation({
        mutationFn: async ({ name, videoId }: { name: string, videoId: string }) => {
            const response = await api.post('/collections', {
                name,
                videoId
            });
            return response;
        },
        onSuccess: (response) => {
            queryClient.invalidateQueries({ queryKey: ['collections'] });
            queryClient.invalidateQueries({ queryKey: ['videos'] });
            // 200 means the name already existed and the video was merged into
            // the existing collection; 201 means a new collection was created.
            if (response.status === 200) {
                // The merge target may be a favorited collection whose derived
                // videoCount/cover changed, so refresh favorites to avoid a
                // stale rail card (matches addToCollection).
                queryClient.invalidateQueries({ queryKey: ['favorite-collections'] });
                showSnackbar(t('collectionExistsVideoAdded'));
            } else {
                showSnackbar(t('collectionCreatedSuccessfully'));
            }
        },
        onError: (error: unknown) => {
            console.error('Error creating collection:', error);
            showSnackbar(getApiErrorMessage(error) || t('createCollectionFailed'), 'error');
        }
    });

    const createCollection = useCallback(async (name: string, videoId: string) => {
        const response = await createCollectionMutation.mutateAsync({ name, videoId });
        return response.data as Collection;
    }, [createCollectionMutation]);

    const addToCollectionMutation = useMutation({
        mutationFn: async ({ collectionId, videoId }: { collectionId: string, videoId: string }) => {
            const response = await api.put(`/collections/${collectionId}`, {
                videoId,
                action: "add"
            });
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['collections'] });
            queryClient.invalidateQueries({ queryKey: ['videos'] });
            // A favorited collection's derived videoCount/cover changes, so
            // refresh favorites to avoid a stale rail card.
            queryClient.invalidateQueries({ queryKey: ['favorite-collections'] });
            showSnackbar(t('videoAddedToCollection'));
        },
        onError: (error) => {
            console.error('Error adding video to collection:', error);
        }
    });

    const addToCollection = useCallback(async (collectionId: string, videoId: string) => {
        const response = await addToCollectionMutation.mutateAsync({ collectionId, videoId });
        return response as Collection;
    }, [addToCollectionMutation]);

    const removeFromCollection = useCallback(async (collectionId: string, videoId: string) => {
        try {
            await api.put(`/collections/${collectionId}`, {
                videoId,
                action: "remove"
            });

            queryClient.invalidateQueries({ queryKey: ['collections'] });
            queryClient.invalidateQueries({ queryKey: ['videos'] });
            // A favorited collection's derived videoCount/cover changes, so
            // refresh favorites to avoid a stale rail card.
            queryClient.invalidateQueries({ queryKey: ['favorite-collections'] });
            showSnackbar(t('videoRemovedFromCollection'));
            return true;
        } catch (error) {
            console.error('Error removing video from collection:', error);
            return false;
        }
    }, [queryClient, showSnackbar, t]);

    const deleteCollectionMutation = useMutation({
        mutationFn: async ({ collectionId, deleteVideos }: { collectionId: string, deleteVideos: boolean }) => {
            await api.delete(`/collections/${collectionId}`, {
                params: { deleteVideos: deleteVideos ? 'true' : 'false' }
            });
            return { collectionId, deleteVideos };
        },
        onSuccess: ({ deleteVideos }) => {
            queryClient.invalidateQueries({ queryKey: ['collections'] });
            if (deleteVideos) {
                queryClient.invalidateQueries({ queryKey: ['videos'] });
                // Deleting every video in the collection can remove an author's
                // last videos, so refresh the favorite authors rail too.
                queryClient.invalidateQueries({ queryKey: ['favorite-authors'] });
            }
            // The backend cascades favorite_collections when a collection is
            // deleted, so refresh favorites too (all scopes) to avoid rendering
            // a deleted collection that navigates to a not-found page.
            queryClient.invalidateQueries({ queryKey: ['favorite-collections'] });
            showSnackbar(t('collectionDeletedSuccessfully'));
        },
        onError: (error) => {
            console.error('Error deleting collection:', error);
            showSnackbar(t('failedToDeleteCollection'), 'error');
        }
    });

    const deleteCollection = useCallback(async (collectionId: string, deleteVideos = false) => {
        try {
            await deleteCollectionMutation.mutateAsync({ collectionId, deleteVideos });
            return { success: true };
        } catch {
            return { success: false, error: 'Failed to delete collection' };
        }
    }, [deleteCollectionMutation]);

    const updateCollectionMutation = useMutation({
        mutationFn: async ({ id, name }: { id: string, name: string }) => {
            const response = await api.put(`/collections/${id}`, { name });
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['collections'] });
            // Video paths might change if collection renamed, so invalidate videos too
            queryClient.invalidateQueries({ queryKey: ['videos'] });
            // A favorited collection's name/cover changes on rename, so refresh
            // favorites to avoid a stale rail card.
            queryClient.invalidateQueries({ queryKey: ['favorite-collections'] });
            showSnackbar(t('collectionUpdatedSuccessfully') || 'Collection updated');
        },
        onError: (error: any) => {
            console.error('Error updating collection:', error);
            showSnackbar(error.response?.data?.error || t('updateCollectionFailed'), 'error');
        }
    });

    const updateCollection = useCallback(async (id: string, name: string) => {
        try {
            await updateCollectionMutation.mutateAsync({ id, name });
            return { success: true };
        } catch (error: unknown) {
            return { success: false, error: getApiErrorMessage(error) || t('updateCollectionFailed') };
        }
    }, [updateCollectionMutation, t]);

    const value = useMemo<CollectionContextType>(() => ({
        collections,
        fetchCollections,
        createCollection,
        addToCollection,
        removeFromCollection,
        deleteCollection,
        updateCollection,
    }), [
        collections, fetchCollections, createCollection, addToCollection,
        removeFromCollection, deleteCollection, updateCollection,
    ]);

    return (
        <CollectionContext.Provider value={value}>
            {children}
        </CollectionContext.Provider>
    );
};
