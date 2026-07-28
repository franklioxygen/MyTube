import { useState } from 'react';
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

const getErrorStatus = (error: unknown): number | undefined => {
    if (typeof error !== 'object' || error === null || !('response' in error)) {
        return undefined;
    }

    const response = (error as { response?: { status?: number } }).response;
    return response?.status;
};

export const useHomeSettings = ({ settings, settingsLoading = false }: UseHomeSettingsParams = {}): UseHomeSettingsReturn => {
    const [isSidebarOpenOverride, setIsSidebarOpen] = useState<boolean | null>(null);
    const [infiniteScrollOverride, setInfiniteScroll] = useState<boolean | null>(null);
    const [videoColumnsOverride, setVideoColumns] = useState<number | null>(null);
    const [itemsPerPageOverride, setItemsPerPage] = useState<number | null>(null);
    const [defaultSortOverride, setDefaultSort] = useState<string | null>(null);
    const [showTagsOnThumbnailOverride, setShowTagsOnThumbnail] = useState<boolean | null>(null);
    const { isAuthenticated } = useAuth();
    const isSidebarOpen = isSidebarOpenOverride ?? settings?.homeSidebarOpen ?? true;
    const itemsPerPage = itemsPerPageOverride ?? settings?.itemsPerPage ?? 12;
    const infiniteScroll = infiniteScrollOverride ?? settings?.infiniteScroll ?? false;
    const videoColumns = videoColumnsOverride ?? settings?.videoColumns ?? 4;
    const defaultSort = defaultSortOverride ?? settings?.defaultSort ?? 'dateDesc';
    const showTagsOnThumbnail =
        showTagsOnThumbnailOverride ?? settings?.showTagsOnThumbnail ?? true;
    const settingsLoaded = !isAuthenticated || !settingsLoading;

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
        } catch (error: unknown) {
            // Silently handle 401 errors (expected when not authenticated)
            if (getErrorStatus(error) !== 401) {
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
