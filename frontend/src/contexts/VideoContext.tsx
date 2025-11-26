import axios from 'axios';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Video } from '../types';
import { useLanguage } from './LanguageContext';
import { useSnackbar } from './SnackbarContext';

const API_URL = import.meta.env.VITE_API_URL;

interface VideoContextType {
    videos: Video[];
    loading: boolean;
    error: string | null;
    fetchVideos: () => Promise<void>;
    deleteVideo: (id: string) => Promise<{ success: boolean; error?: string }>;
    updateVideo: (id: string, updates: Partial<Video>) => Promise<{ success: boolean; error?: string }>;
    refreshThumbnail: (id: string) => Promise<{ success: boolean; error?: string }>;
    searchLocalVideos: (query: string) => Video[];
    searchResults: any[];
    localSearchResults: Video[];
    isSearchMode: boolean;
    searchTerm: string;
    youtubeLoading: boolean;
    handleSearch: (query: string) => Promise<any>;
    resetSearch: () => void;
    setVideos: React.Dispatch<React.SetStateAction<Video[]>>;
    setIsSearchMode: React.Dispatch<React.SetStateAction<boolean>>;
}

const VideoContext = createContext<VideoContextType | undefined>(undefined);

export const useVideo = () => {
    const context = useContext(VideoContext);
    if (!context) {
        throw new Error('useVideo must be used within a VideoProvider');
    }
    return context;
};

export const VideoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { showSnackbar } = useSnackbar();
    const { t } = useLanguage();
    const [videos, setVideos] = useState<Video[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    // Search state
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [localSearchResults, setLocalSearchResults] = useState<Video[]>([]);
    const [isSearchMode, setIsSearchMode] = useState<boolean>(false);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [youtubeLoading, setYoutubeLoading] = useState<boolean>(false);

    // Reference to the current search request's abort controller
    const searchAbortController = useRef<AbortController | null>(null);

    const fetchVideos = async () => {
        try {
            setLoading(true);
            const response = await axios.get(`${API_URL}/videos`);
            setVideos(response.data);
            setError(null);
        } catch (err) {
            console.error('Error fetching videos:', err);
            setError(t('failedToLoadVideos'));
        } finally {
            setLoading(false);
        }
    };

    const deleteVideo = async (id: string) => {
        try {
            setLoading(true);
            await axios.delete(`${API_URL}/videos/${id}`);
            setVideos(prevVideos => prevVideos.filter(video => video.id !== id));
            setLoading(false);
            showSnackbar(t('videoRemovedSuccessfully'));
            return { success: true };
        } catch (error) {
            console.error('Error deleting video:', error);
            setLoading(false);
            return { success: false, error: t('failedToDeleteVideo') };
        }
    };

    const searchLocalVideos = (query: string) => {
        if (!query || !videos.length) return [];
        const searchTermLower = query.toLowerCase();
        return videos.filter(video =>
            video.title.toLowerCase().includes(searchTermLower) ||
            video.author.toLowerCase().includes(searchTermLower)
        );
    };

    const resetSearch = () => {
        if (searchAbortController.current) {
            searchAbortController.current.abort();
            searchAbortController.current = null;
        }
        setIsSearchMode(false);
        setSearchTerm('');
        setSearchResults([]);
        setLocalSearchResults([]);
        setYoutubeLoading(false);
    };

    const handleSearch = async (query: string): Promise<any> => {
        if (!query || query.trim() === '') {
            resetSearch();
            return { success: false, error: t('pleaseEnterSearchTerm') };
        }

        try {
            if (searchAbortController.current) {
                searchAbortController.current.abort();
            }

            searchAbortController.current = new AbortController();
            const signal = searchAbortController.current.signal;

            setIsSearchMode(true);
            setSearchTerm(query);

            const localResults = searchLocalVideos(query);
            setLocalSearchResults(localResults);

            setYoutubeLoading(true);

            try {
                const response = await axios.get(`${API_URL}/search`, {
                    params: { query },
                    signal: signal
                });

                if (!signal.aborted) {
                    setSearchResults(response.data.results);
                }
            } catch (youtubeErr: any) {
                if (youtubeErr.name !== 'CanceledError' && youtubeErr.name !== 'AbortError') {
                    console.error('Error searching YouTube:', youtubeErr);
                }
            } finally {
                if (!signal.aborted) {
                    setYoutubeLoading(false);
                }
            }

            return { success: true };
        } catch (err: any) {
            if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
                console.error('Error in search process:', err);
                const localResults = searchLocalVideos(query);
                if (localResults.length > 0) {
                    setLocalSearchResults(localResults);
                    setIsSearchMode(true);
                    setSearchTerm(query);
                    return { success: true };
                }
                return { success: false, error: t('failedToSearch') };
            }
            return { success: false, error: t('searchCancelled') };
        } finally {
            if (searchAbortController.current && !searchAbortController.current.signal.aborted) {
                setLoading(false);
            }
        }
    };

    // Fetch videos on mount
    useEffect(() => {
        fetchVideos();
    }, []);

    // Cleanup search on unmount
    useEffect(() => {
        return () => {
            if (searchAbortController.current) {
                searchAbortController.current.abort();
                searchAbortController.current = null;
            }
        };
    }, []);

    const refreshThumbnail = async (id: string) => {
        try {
            const response = await axios.post(`${API_URL}/videos/${id}/refresh-thumbnail`);
            if (response.data.success) {
                setVideos(prevVideos => prevVideos.map(video =>
                    video.id === id
                        ? { ...video, thumbnailUrl: response.data.thumbnailUrl, thumbnailPath: response.data.thumbnailUrl }
                        : video
                ));
                showSnackbar(t('thumbnailRefreshed'));
                return { success: true };
            }
            return { success: false, error: t('thumbnailRefreshFailed') };
        } catch (error) {
            console.error('Error refreshing thumbnail:', error);
            return { success: false, error: t('thumbnailRefreshFailed') };
        }
    };

    const updateVideo = async (id: string, updates: Partial<Video>) => {
        try {
            const response = await axios.put(`${API_URL}/videos/${id}`, updates);
            if (response.data.success) {
                setVideos(prevVideos => prevVideos.map(video =>
                    video.id === id ? { ...video, ...updates } : video
                ));
                showSnackbar(t('videoUpdated'));
                return { success: true };
            }
            return { success: false, error: t('videoUpdateFailed') };
        } catch (error) {
            console.error('Error updating video:', error);
            return { success: false, error: t('videoUpdateFailed') };
        }
    };

    return (
        <VideoContext.Provider value={{
            videos,
            loading,
            error,
            fetchVideos,
            deleteVideo,
            updateVideo,
            refreshThumbnail,
            searchLocalVideos,
            searchResults,
            localSearchResults,
            isSearchMode,
            searchTerm,
            youtubeLoading,
            handleSearch,
            resetSearch,
            setVideos,
            setIsSearchMode
        }}>
            {children}
        </VideoContext.Provider>
    );
};
