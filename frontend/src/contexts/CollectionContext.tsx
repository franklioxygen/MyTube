import axios from 'axios';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Collection } from '../types';
import { useSnackbar } from './SnackbarContext';
import { useVideo } from './VideoContext';

const API_URL = import.meta.env.VITE_API_URL;

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
    const { fetchVideos } = useVideo();
    const [collections, setCollections] = useState<Collection[]>([]);

    const fetchCollections = async () => {
        try {
            const response = await axios.get(`${API_URL}/collections`);
            setCollections(response.data);
        } catch (error) {
            console.error('Error fetching collections:', error);
        }
    };

    const createCollection = async (name: string, videoId: string) => {
        try {
            const response = await axios.post(`${API_URL}/collections`, {
                name,
                videoId
            });
            setCollections(prevCollections => [...prevCollections, response.data]);
            showSnackbar('Collection created successfully');
            return response.data;
        } catch (error) {
            console.error('Error creating collection:', error);
            return null;
        }
    };

    const addToCollection = async (collectionId: string, videoId: string) => {
        try {
            const response = await axios.put(`${API_URL}/collections/${collectionId}`, {
                videoId,
                action: "add"
            });
            setCollections(prevCollections => prevCollections.map(collection =>
                collection.id === collectionId ? response.data : collection
            ));
            showSnackbar('Video added to collection');
            return response.data;
        } catch (error) {
            console.error('Error adding video to collection:', error);
            return null;
        }
    };

    const removeFromCollection = async (videoId: string) => {
        try {
            const collectionsWithVideo = collections.filter(collection =>
                collection.videos.includes(videoId)
            );

            for (const collection of collectionsWithVideo) {
                await axios.put(`${API_URL}/collections/${collection.id}`, {
                    videoId,
                    action: "remove"
                });
            }

            setCollections(prevCollections => prevCollections.map(collection => ({
                ...collection,
                videos: collection.videos.filter(v => v !== videoId)
            })));

            showSnackbar('Video removed from collection');
            return true;
        } catch (error) {
            console.error('Error removing video from collection:', error);
            return false;
        }
    };

    const deleteCollection = async (collectionId: string, deleteVideos = false) => {
        try {
            await axios.delete(`${API_URL}/collections/${collectionId}`, {
                params: { deleteVideos: deleteVideos ? 'true' : 'false' }
            });

            setCollections(prevCollections =>
                prevCollections.filter(collection => collection.id !== collectionId)
            );

            if (deleteVideos) {
                await fetchVideos();
            }

            showSnackbar('Collection deleted successfully');
            return { success: true };
        } catch (error) {
            console.error('Error deleting collection:', error);
            showSnackbar('Failed to delete collection', 'error');
            return { success: false, error: 'Failed to delete collection' };
        }
    };

    // Fetch collections on mount
    useEffect(() => {
        fetchCollections();
    }, []);

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
