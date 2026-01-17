import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiUrl } from '../utils/apiUrl';
import axios from 'axios';
import React, { createContext, useContext } from 'react';
import { Collection } from '../types';
import { useAuth } from './AuthContext';
import { useLanguage } from './LanguageContext';
import { useSnackbar } from './SnackbarContext';

const API_URL = getApiUrl();

interface CollectionContextType {
    collections: Collection[];
    fetchCollections: () => Promise<void>;
    createCollection: (name: string, videoId: string) => Promise<Collection | null>;
    addToCollection: (collectionId: string, videoId: string) => Promise<Collection | null>;
    removeFromCollection: (videoId: string) => Promise<boolean>;
    deleteCollection: (collectionId: string, deleteVideos?: boolean) => Promise<{ success: boolean; error?: string }>;
}

const CollectionContext = createContext<CollectionContextType | undefined>(undefined);

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
            const response = await axios.get(`${API_URL}/collections`);
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

    const fetchCollections = async () => {
        await fetchCollectionsQuery();
    };

    const createCollectionMutation = useMutation({
        mutationFn: async ({ name, videoId }: { name: string, videoId: string }) => {
            const response = await axios.post(`${API_URL}/collections`, {
                name,
                videoId
            });
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['collections'] });
            showSnackbar(t('collectionCreatedSuccessfully'));
        },
        onError: (error) => {
            console.error('Error creating collection:', error);
        }
    });

    const createCollection = async (name: string, videoId: string) => {
        try {
            return await createCollectionMutation.mutateAsync({ name, videoId });
        } catch {
            return null;
        }
    };

    const addToCollectionMutation = useMutation({
        mutationFn: async ({ collectionId, videoId }: { collectionId: string, videoId: string }) => {
            const response = await axios.put(`${API_URL}/collections/${collectionId}`, {
                videoId,
                action: "add"
            });
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['collections'] });
            showSnackbar(t('videoAddedToCollection'));
        },
        onError: (error) => {
            console.error('Error adding video to collection:', error);
        }
    });

    const addToCollection = async (collectionId: string, videoId: string) => {
        try {
            return await addToCollectionMutation.mutateAsync({ collectionId, videoId });
        } catch {
            return null;
        }
    };

    const removeFromCollection = async (videoId: string) => {
        try {
            const collectionsWithVideo = collections.filter(collection =>
                collection.videos.includes(videoId)
            );

            await Promise.all(collectionsWithVideo.map(collection =>
                axios.put(`${API_URL}/collections/${collection.id}`, {
                    videoId,
                    action: "remove"
                })
            ));

            queryClient.invalidateQueries({ queryKey: ['collections'] });
            showSnackbar(t('videoRemovedFromCollection'));
            return true;
        } catch (error) {
            console.error('Error removing video from collection:', error);
            return false;
        }
    };

    const deleteCollectionMutation = useMutation({
        mutationFn: async ({ collectionId, deleteVideos }: { collectionId: string, deleteVideos: boolean }) => {
            await axios.delete(`${API_URL}/collections/${collectionId}`, {
                params: { deleteVideos: deleteVideos ? 'true' : 'false' }
            });
            return { collectionId, deleteVideos };
        },
        onSuccess: ({ deleteVideos }) => {
            queryClient.invalidateQueries({ queryKey: ['collections'] });
            if (deleteVideos) {
                queryClient.invalidateQueries({ queryKey: ['videos'] });
            }
            showSnackbar(t('collectionDeletedSuccessfully'));
        },
        onError: (error) => {
            console.error('Error deleting collection:', error);
            showSnackbar(t('failedToDeleteCollection'), 'error');
        }
    });

    const deleteCollection = async (collectionId: string, deleteVideos = false) => {
        try {
            await deleteCollectionMutation.mutateAsync({ collectionId, deleteVideos });
            return { success: true };
        } catch {
            return { success: false, error: 'Failed to delete collection' };
        }
    };

    return (
        <CollectionContext.Provider value={{
            collections,
            fetchCollections,
            createCollection,
            addToCollection,
            removeFromCollection,
            deleteCollection
        }}>
            {children}
        </CollectionContext.Provider>
    );
};
