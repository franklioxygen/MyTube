import axios from 'axios';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getApiUrl } from '../utils/apiUrl';

const API_URL = getApiUrl();

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

export const useHomeSettings = (): UseHomeSettingsReturn => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [infiniteScroll, setInfiniteScroll] = useState(false);
    const [videoColumns, setVideoColumns] = useState(4);
    const [itemsPerPage, setItemsPerPage] = useState(12);
    const [defaultSort, setDefaultSort] = useState('dateDesc');
    const [showTagsOnThumbnail, setShowTagsOnThumbnail] = useState(false);
    const { isAuthenticated } = useAuth();

    // Fetch settings on mount (only when authenticated)
    useEffect(() => {
        if (!isAuthenticated) {
            setSettingsLoaded(true);
            return;
        }

        const fetchSettings = async () => {
            try {
                const response = await axios.get(`${API_URL}/settings`);
                if (response.data) {
                    if (typeof response.data.homeSidebarOpen !== 'undefined') {
                        setIsSidebarOpen(response.data.homeSidebarOpen);
                    }
                    if (typeof response.data.itemsPerPage !== 'undefined') {
                        setItemsPerPage(response.data.itemsPerPage);
                    }
                    if (typeof response.data.infiniteScroll !== 'undefined') {
                        setInfiniteScroll(response.data.infiniteScroll);
                    }
                    if (typeof response.data.videoColumns !== 'undefined') {
                        setVideoColumns(response.data.videoColumns);
                    }
                    if (typeof response.data.defaultSort !== 'undefined') {
                        setDefaultSort(response.data.defaultSort);
                    }
                    if (typeof response.data.showTagsOnThumbnail !== 'undefined') {
                        setShowTagsOnThumbnail(response.data.showTagsOnThumbnail);
                    }
                }
            } catch (error: any) {
                // Silently handle 401 errors (expected when not authenticated)
                if (error?.response?.status !== 401) {
                    console.error('Failed to fetch settings:', error);
                }
            } finally {
                setSettingsLoaded(true);
            }
        };
        fetchSettings();
    }, [isAuthenticated]);

    const handleSidebarToggle = async () => {
        const newState = !isSidebarOpen;
        setIsSidebarOpen(newState);
        
        // Only save to backend if authenticated
        if (!isAuthenticated) {
            return;
        }

        try {
            const response = await axios.get(`${API_URL}/settings`);
            const currentSettings = response.data;
            await axios.post(`${API_URL}/settings`, {
                ...currentSettings,
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
