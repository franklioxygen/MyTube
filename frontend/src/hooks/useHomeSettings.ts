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
    const { isAuthenticated } = useAuth();
    const settingsKey = JSON.stringify([
        isAuthenticated,
        settingsLoading,
        settings?.homeSidebarOpen,
        settings?.itemsPerPage,
        settings?.infiniteScroll,
        settings?.videoColumns,
        settings?.defaultSort,
        settings?.showTagsOnThumbnail,
    ]);
    const externalState = {
        isSidebarOpen: settings?.homeSidebarOpen ?? true,
        itemsPerPage: settings?.itemsPerPage ?? 12,
        infiniteScroll: settings?.infiniteScroll ?? false,
        videoColumns: settings?.videoColumns ?? 4,
        defaultSort: settings?.defaultSort ?? 'dateDesc',
        showTagsOnThumbnail: settings?.showTagsOnThumbnail ?? true,
    };
    const [localState, setLocalState] = useState(() => ({
        key: settingsKey,
        ...externalState,
    }));
    const currentState =
        localState.key === settingsKey
            ? localState
            : { key: settingsKey, ...externalState };
    const {
        isSidebarOpen,
        itemsPerPage,
        infiniteScroll,
        videoColumns,
        defaultSort,
        showTagsOnThumbnail,
    } = currentState;
    const settingsLoaded = !isAuthenticated || !settingsLoading;
    const updateState = <
        Key extends keyof Omit<typeof currentState, 'key'>
    >(key: Key, value: Omit<typeof currentState, 'key'>[Key]) => {
        setLocalState({ ...currentState, [key]: value });
    };
    const setIsSidebarOpen = (value: boolean) => updateState('isSidebarOpen', value);
    const setItemsPerPage = (value: number) => updateState('itemsPerPage', value);
    const setInfiniteScroll = (value: boolean) => updateState('infiniteScroll', value);
    const setVideoColumns = (value: number) => updateState('videoColumns', value);
    const setDefaultSort = (value: string) => updateState('defaultSort', value);
    const setShowTagsOnThumbnail = (value: boolean) =>
        updateState('showTagsOnThumbnail', value);

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
