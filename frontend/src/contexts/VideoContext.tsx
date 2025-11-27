import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
    availableTags: string[];
    selectedTags: string[];
    handleTagToggle: (tag: string) => void;
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
    const queryClient = useQueryClient();

    // Videos Query
    const { data: videos = [], isLoading: videosLoading, error: videosError, refetch: refetchVideos } = useQuery({
        queryKey: ['videos'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/videos`);
            return response.data as Video[];
        },
    });

    // Tags Query
    const { data: availableTags = [] } = useQuery({
        queryKey: ['tags'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings`);
            return response.data.tags || [];
        },
    });

    const [selectedTags, setSelectedTags] = useState<string[]>([]);

    // Search state
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [localSearchResults, setLocalSearchResults] = useState<Video[]>([]);
    const [isSearchMode, setIsSearchMode] = useState<boolean>(false);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [youtubeLoading, setYoutubeLoading] = useState<boolean>(false);

    // Reference to the current search request's abort controller
    const searchAbortController = useRef<AbortController | null>(null);

    // Wrapper for refetch to match interface
    const fetchVideos = async () => {
        await refetchVideos();
    };

    // Emulate setVideos for compatibility
    const setVideos: React.Dispatch<React.SetStateAction<Video[]>> = (updater) => {
        queryClient.setQueryData(['videos'], (oldVideos: Video[] | undefined) => {
            const currentVideos = oldVideos || [];
            if (typeof updater === 'function') {
                return updater(currentVideos);
            }
            return updater;
        });
    };

    const deleteVideoMutation = useMutation({
        mutationFn: async (id: string) => {
            await axios.delete(`${API_URL}/videos/${id}`);
            return id;
        },
        onSuccess: (id) => {
            queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                old ? old.filter(video => video.id !== id) : []
            );
            showSnackbar(t('videoRemovedSuccessfully'));
        },
        onError: (error) => {
            console.error('Error deleting video:', error);
        }
    });

    const deleteVideo = async (id: string) => {
        try {
            await deleteVideoMutation.mutateAsync(id);
            return { success: true };
        } catch (error) {
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
        }
    };

    const handleTagToggle = (tag: string) => {
        setSelectedTags(prev =>
            prev.includes(tag)
                ? prev.filter(t => t !== tag)
                : [...prev, tag]
        );
    };

    // Cleanup search on unmount
    useEffect(() => {
        return () => {
            if (searchAbortController.current) {
                searchAbortController.current.abort();
                searchAbortController.current = null;
            }
        };
    }, []);

    const refreshThumbnailMutation = useMutation({
        mutationFn: async (id: string) => {
            const response = await axios.post(`${API_URL}/videos/${id}/refresh-thumbnail`);
            return { id, data: response.data };
        },
        onSuccess: ({ id, data }) => {
            if (data.success) {
                queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                    old ? old.map(video =>
                        video.id === id
                            ? { ...video, thumbnailUrl: data.thumbnailUrl, thumbnailPath: data.thumbnailUrl }
                            : video
                    ) : []
                );
                showSnackbar(t('thumbnailRefreshed'));
            }
        },
        onError: (error) => {
            console.error('Error refreshing thumbnail:', error);
        }
    });

    const refreshThumbnail = async (id: string) => {
        try {
            const result = await refreshThumbnailMutation.mutateAsync(id);
            if (result.data.success) {
                return { success: true };
            }
            return { success: false, error: t('thumbnailRefreshFailed') };
        } catch (error) {
            return { success: false, error: t('thumbnailRefreshFailed') };
        }
    };

    const updateVideoMutation = useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: Partial<Video> }) => {
            const response = await axios.put(`${API_URL}/videos/${id}`, updates);
            return { id, updates, data: response.data };
        },
        onSuccess: ({ id, updates, data }) => {
            if (data.success) {
                queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                    old ? old.map(video =>
                        video.id === id ? { ...video, ...updates } : video
                    ) : []
                );
                showSnackbar(t('videoUpdated'));
            }
        },
        onError: (error) => {
            console.error('Error updating video:', error);
        }
    });

    const updateVideo = async (id: string, updates: Partial<Video>) => {
        try {
            const result = await updateVideoMutation.mutateAsync({ id, updates });
            if (result.data.success) {
                return { success: true };
            }
            return { success: false, error: t('videoUpdateFailed') };
        } catch (error) {
            return { success: false, error: t('videoUpdateFailed') };
        }
    };

    return (
        <VideoContext.Provider value={{
            videos,
            loading: videosLoading,
            error: videosError ? (videosError as Error).message : null,
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
            setIsSearchMode,
            availableTags,
            selectedTags,
            handleTagToggle
        }}>
            {children}
        </VideoContext.Provider>
    );
};
