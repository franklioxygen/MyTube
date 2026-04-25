import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useContext, useMemo, useState } from 'react';
import { Video } from '../types';
import { api } from '../utils/apiClient';
import { settingsQueryOptions } from '../utils/settingsQueries';
import { useAuth } from './AuthContext';
import { useLanguage } from './LanguageContext';
import { useSnackbar } from './SnackbarContext';
import { useVideoMutations } from './video/useVideoMutations';
import { useVideoSearch } from './video/useVideoSearch';

interface VideoContextType {
    videos: Video[];
    loading: boolean;
    error: string | null;
    fetchVideos: () => Promise<void>;
    deleteVideo: (id: string, options?: { showSnackbar?: boolean }) => Promise<{ success: boolean; error?: string }>;
    deleteVideos: (ids: string[]) => Promise<{ success: boolean; error?: string }>;
    updateVideo: (id: string, updates: Partial<Video>) => Promise<{ success: boolean; error?: string }>;
    refreshThumbnail: (id: string) => Promise<{ success: boolean; error?: string }>;
    uploadThumbnail: (id: string, file: File) => Promise<void>;
    searchLocalVideos: (query: string) => Video[];
    searchResults: any[];
    localSearchResults: Video[];
    isSearchMode: boolean;
    searchTerm: string;
    incrementView: (id: string) => Promise<{ success: boolean; error?: string }>;
    youtubeLoading: boolean;
    handleSearch: (query: string) => Promise<any>;
    resetSearch: () => void;
    setVideos: React.Dispatch<React.SetStateAction<Video[]>>;
    setIsSearchMode: React.Dispatch<React.SetStateAction<boolean>>;
    availableTags: string[];
    selectedTags: string[];
    handleTagToggle: (tag: string) => void;
    showYoutubeSearch: boolean;
    loadMoreSearchResults: () => Promise<void>;
    loadingMore: boolean;
}

const VideoContext = createContext<VideoContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
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
    const { userRole, isAuthenticated } = useAuth();
    const isVisitor = userRole === 'visitor';

    // Videos Query - Optimized for faster initial load
    const { data: videosRaw = [], isLoading: videosLoading, error: videosError, refetch: refetchVideos } = useQuery({
        queryKey: ['videos'],
        queryFn: async () => {
            try {
                const response = await api.get('/videos');
                return response.data as Video[];
            } catch (err) {
                console.error('Videos fetch failed:', err);
                throw err;
            }
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
        retryDelay: 1000,
        staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
        gcTime: 5 * 60 * 1000, // Garbage collect after 5 minutes (reduced from 30 to save memory)
        // Prioritize initial load for better LCP
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    });

    // Filter invisible videos when in visitor mode
    const videos = useMemo(() => {
        if (isVisitor) {
            return videosRaw.filter(video => (video.visibility ?? 1) === 1);
        }
        return videosRaw;
    }, [videosRaw, isVisitor]);

    // Settings Query (tags and showYoutubeSearch)
    const { data: settingsData } = useQuery({
        ...settingsQueryOptions,
        // Only query when authenticated to avoid 401 errors on login page
        enabled: isAuthenticated,
    });

    const availableTags = settingsData?.tags || [];
    const showYoutubeSearch = settingsData?.showYoutubeSearch ?? true;

    const [selectedTags, setSelectedTags] = useState<string[]>([]);

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

    const {
        deleteVideo,
        deleteVideos,
        refreshThumbnail,
        uploadThumbnail,
        updateVideo,
        incrementView,
    } = useVideoMutations({ queryClient, showSnackbar, t });

    const {
        searchResults,
        localSearchResults,
        isSearchMode,
        searchTerm,
        youtubeLoading,
        loadingMore,
        searchLocalVideos,
        handleSearch,
        resetSearch,
        setIsSearchMode,
        loadMoreSearchResults,
    } = useVideoSearch({ showSnackbar, showYoutubeSearch, t, videos });

    const handleTagToggle = (tag: string) => {
        setSelectedTags(prev =>
            prev.includes(tag)
                ? prev.filter(t => t !== tag)
                : [...prev, tag]
        );
    };

    return (
        <VideoContext.Provider value={{
            videos,
            loading: videosLoading,
            error: videosError ? (videosError as Error).message : null,
            fetchVideos,
            deleteVideo,
            deleteVideos,
            updateVideo,
            refreshThumbnail,
            uploadThumbnail,
            incrementView,
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
            handleTagToggle,
            showYoutubeSearch,
            loadMoreSearchResults,
            loadingMore
        }}>
            {children}
        </VideoContext.Provider>
    );
};
