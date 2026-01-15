import axios from 'axios';
import { useEffect, useState } from 'react';
import { getApiUrl } from '../utils/apiUrl';

const API_URL = getApiUrl();

interface HomeSettings {
    isSidebarOpen: boolean;
    itemsPerPage: number;
    infiniteScroll: boolean;
    videoColumns: number;
    defaultSort: string;
    settingsLoaded: boolean;
}

interface UseHomeSettingsReturn extends HomeSettings {
    setIsSidebarOpen: (value: boolean) => void;
    setItemsPerPage: (value: number) => void;
    setInfiniteScroll: (value: boolean) => void;
    setVideoColumns: (value: number) => void;
    setDefaultSort: (value: string) => void;
    handleSidebarToggle: () => Promise<void>;
}

export const useHomeSettings = (): UseHomeSettingsReturn => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [infiniteScroll, setInfiniteScroll] = useState(false);
    const [videoColumns, setVideoColumns] = useState(4);
    const [itemsPerPage, setItemsPerPage] = useState(12);
    const [defaultSort, setDefaultSort] = useState('dateDesc');

    // Fetch settings on mount
    useEffect(() => {
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
                }
            } catch (error) {
                console.error('Failed to fetch settings:', error);
            } finally {
                setSettingsLoaded(true);
            }
        };
        fetchSettings();
    }, []);

    const handleSidebarToggle = async () => {
        const newState = !isSidebarOpen;
        setIsSidebarOpen(newState);
        try {
            const response = await axios.get(`${API_URL}/settings`);
            const currentSettings = response.data;
            await axios.post(`${API_URL}/settings`, {
                ...currentSettings,
                homeSidebarOpen: newState
            });
        } catch (error) {
            console.error('Failed to save sidebar state:', error);
        }
    };

    return {
        isSidebarOpen,
        itemsPerPage,
        infiniteScroll,
        videoColumns,
        defaultSort,
        settingsLoaded,
        setIsSidebarOpen,
        setItemsPerPage,
        setInfiniteScroll,
        setVideoColumns,
        setDefaultSort,
        handleSidebarToggle
    };
};
