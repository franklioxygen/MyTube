import { useEffect, useMemo, useState } from 'react';
import { useCollection } from '../contexts/CollectionContext';
import { Collection } from '../types';

interface UseVideoCollectionsProps {
    videoId: string | undefined;
}

/**
 * Custom hook to manage video collection operations
 */
export function useVideoCollections({ videoId }: UseVideoCollectionsProps) {
    const {
        collections,
        addToCollection,
        createCollection,
        removeFromCollection
    } = useCollection();

    const [showCollectionModal, setShowCollectionModal] = useState<boolean>(false);
    const [activeCollectionVideoId, setActiveCollectionVideoId] = useState<string | null>(null);
    const [videoCollections, setVideoCollections] = useState<Collection[]>([]);

    // Find collections that contain the current video
    useEffect(() => {
        if (collections && collections.length > 0 && videoId) {
            const belongsToCollections = collections.filter(collection =>
                collection.videos.includes(videoId)
            );
            setVideoCollections(belongsToCollections);
        } else {
            setVideoCollections([]);
        }
    }, [collections, videoId]);

    // Calculate collections for the modal (can be current video or sidebar video)
    const modalVideoCollections = useMemo(() => {
        if (collections && collections.length > 0 && activeCollectionVideoId) {
            return collections.filter(collection =>
                collection.videos.includes(activeCollectionVideoId)
            );
        }
        return [];
    }, [collections, activeCollectionVideoId]);

    const handleAddToCollection = (targetVideoId?: string) => {
        setActiveCollectionVideoId(targetVideoId || videoId || null);
        setShowCollectionModal(true);
    };

    const handleCloseModal = () => {
        setShowCollectionModal(false);
        setActiveCollectionVideoId(null);
    };

    const handleCreateCollection = async (name: string) => {
        if (!activeCollectionVideoId) return;
        try {
            await createCollection(name, activeCollectionVideoId);
        } catch (error) {
            console.error('Error creating collection:', error);
        }
    };

    const handleAddToExistingCollection = async (collectionId: string) => {
        if (!activeCollectionVideoId) return;
        try {
            await addToCollection(collectionId, activeCollectionVideoId);
        } catch (error) {
            console.error('Error adding to collection:', error);
        }
    };

    const handleRemoveFromCollection = async () => {
        if (!activeCollectionVideoId) return;

        try {
            await removeFromCollection(activeCollectionVideoId);
        } catch (error) {
            console.error('Error removing from collection:', error);
        }
    };

    return {
        collections,
        videoCollections,
        modalVideoCollections,
        showCollectionModal,
        activeCollectionVideoId,
        handleAddToCollection,
        handleCloseModal,
        handleCreateCollection,
        handleAddToExistingCollection,
        handleRemoveFromCollection
    };
}
