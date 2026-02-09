import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Settings } from '../types';
import { api } from '../utils/apiClient';

interface HomeSettings {
    isSidebarOpen: boolean;
    itemsPerPage: number;
    infiniteScroll: boolean;
    videoColumns: number;
    defaultSort: string;
    showTagsOnThumbnail: boolean;
    settingsLoaded: boolean;
}

interface UseHomeSettingsReturn extends HomeSettings {
    setIsSidebarOpen: (value: boolean) => void;
    setItemsPerPage: (value: number) => void;
    setInfiniteScroll: (value: boolean) => void;
    setVideoColumns: (value: number) => void;
    setDefaultSort: (value: string) => void;
    setShowTagsOnThumbnail: (value: boolean) => void;
    handleSidebarToggle: () => Promise<void>;
}

interface UseHomeSettingsParams {
    settings?: Settings;
    settingsLoading?: boolean;
}

export const useHomeSettings = ({ settings, settingsLoading = false }: UseHomeSettingsParams = {}): UseHomeSettingsReturn => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [infiniteScroll, setInfiniteScroll] = useState(false);
    const [videoColumns, setVideoColumns] = useState(4);
    const [itemsPerPage, setItemsPerPage] = useState(12);
    const [defaultSort, setDefaultSort] = useState('dateDesc');
    const [showTagsOnThumbnail, setShowTagsOnThumbnail] = useState(true);
    const { isAuthenticated } = useAuth();

    // Sync local home settings state from shared settings query
    useEffect(() => {
        if (!isAuthenticated) {
            setSettingsLoaded(true);
            return;
        }

        if (settingsLoading) return;

        if (settings) {
            if (typeof settings.homeSidebarOpen !== 'undefined') {
                setIsSidebarOpen(settings.homeSidebarOpen);
            }
            if (typeof settings.itemsPerPage !== 'undefined') {
                setItemsPerPage(settings.itemsPerPage);
            }
            if (typeof settings.infiniteScroll !== 'undefined') {
                setInfiniteScroll(settings.infiniteScroll);
            }
            if (typeof settings.videoColumns !== 'undefined') {
                setVideoColumns(settings.videoColumns);
            }
            if (typeof settings.defaultSort !== 'undefined') {
                setDefaultSort(settings.defaultSort);
            }
            if (typeof settings.showTagsOnThumbnail !== 'undefined') {
                setShowTagsOnThumbnail(settings.showTagsOnThumbnail);
            }
        }

        setSettingsLoaded(true);
    }, [isAuthenticated, settingsLoading, settings]);

    const handleSidebarToggle = async () => {
        const newState = !isSidebarOpen;
        setIsSidebarOpen(newState);
        
        // Only save to backend if authenticated
        if (!isAuthenticated) {
            return;
        }

        try {
            await api.patch('/settings', {
                homeSidebarOpen: newState
            });
        } catch (error: any) {
            // Silently handle 401 errors (expected when not authenticated)
            if (error?.response?.status !== 401) {
                console.error('Failed to save sidebar state:', error);
            }
        }
    };

    return {
        isSidebarOpen,
        itemsPerPage,
        infiniteScroll,
        videoColumns,
        defaultSort,
        showTagsOnThumbnail,
        settingsLoaded,
        setIsSidebarOpen,
        setItemsPerPage,
        setInfiniteScroll,
        setVideoColumns,
        setDefaultSort,
        setShowTagsOnThumbnail,
        handleSidebarToggle
    };
};
