import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Video, VideoSearchResult } from '../types';
import { useStatisticsIngestion } from '../hooks/useStatisticsIngestion';
import { api } from '../utils/apiClient';
import { withCanonicalAuthorAvatars } from '../utils/authorAvatar';
import { hasAxiosStatus } from '../utils/errors';
import { settingsQueryOptions } from '../utils/settingsQueries';
import { useAuth } from './AuthContext';
import { useLanguage } from './LanguageContext';
import { useSnackbar } from './SnackbarContext';
const MAX_SEARCH_RESULTS = 200; // Maximum number of search results to keep in memory

interface VideoContextType {
    videos: Video[];
    loading: boolean;
    error: string | null;
    fetchVideos: () => Promise<void>;
    deleteVideo: (id: string, options?: { showSnackbar?: boolean }) => Promise<{ success: boolean; error?: string }>;
    deleteVideos: (ids: string[]) => Promise<{ success: boolean; error?: string }>;
    updateVideo: (id: string, updates: Partial<Video>) => Promise<{ success: boolean; error?: string }>;
    refreshThumbnail: (id: string) => Promise<{ success: boolean; error?: string }>;
    redownloadThumbnail: (id: string) => Promise<{ success: boolean; error?: string }>;
    uploadThumbnail: (id: string, file: File) => Promise<void>;
    searchLocalVideos: (query: string) => Video[];
    searchResults: VideoSearchResult[];
    localSearchResults: Video[];
    isSearchMode: boolean;
    searchTerm: string;
    incrementView: (id: string) => Promise<{ success: boolean; error?: string }>;
    youtubeLoading: boolean;
    handleSearch: (query: string) => Promise<any>;
    lastSearchEventId: string | null;
    resetSearch: () => void;
    setVideos: React.Dispatch<React.SetStateAction<Video[]>>;
    setIsSearchMode: React.Dispatch<React.SetStateAction<boolean>>;
    availableTags: string[];
    selectedTags: string[];
    handleTagToggle: (tag: string) => void;
    clearSelectedTags: () => void;
    showYoutubeSearch: boolean;
    loadMoreSearchResults: () => Promise<void>;
    loadingMore: boolean;
}

interface VideoTagsContextType {
    availableTags: string[];
    selectedTags: string[];
    handleTagToggle: (tag: string) => void;
    clearSelectedTags: () => void;
}

interface VideoActionsContextType {
    updateVideo: (id: string, updates: Partial<Video>) => Promise<{ success: boolean; error?: string }>;
    incrementView: (id: string) => Promise<{ success: boolean; error?: string }>;
}

const VideoContext = createContext<VideoContextType | undefined>(undefined);
const VideoTagsContext = createContext<VideoTagsContextType | undefined>(undefined);
const VideoActionsContext = createContext<VideoActionsContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useVideo = () => {
    const context = useContext(VideoContext);
    if (!context) {
        throw new Error('useVideo must be used within a VideoProvider');
    }
    return context;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useVideoTags = () => {
    const context = useContext(VideoTagsContext);
    if (!context) {
        throw new Error('useVideoTags must be used within a VideoProvider');
    }
    return context;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useVideoActions = () => {
    const context = useContext(VideoActionsContext);
    if (!context) {
        throw new Error('useVideoActions must be used within a VideoProvider');
    }
    return context;
};

// Stable fallback so the provider-value useMemo deps don't see a fresh array
// identity on every render while the settings query is unresolved.
const EMPTY_TAGS: string[] = [];

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
        retry: (failureCount, error: unknown) => {
            // Don't retry on 401 errors (unauthorized) - user is not authenticated
            if (hasAxiosStatus(error, 401)) {
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
        const normalizedVideos = withCanonicalAuthorAvatars(videosRaw);
        if (isVisitor) {
            return normalizedVideos.filter(video => (video.visibility ?? 1) === 1);
        }
        return normalizedVideos;
    }, [videosRaw, isVisitor]);

    // Settings Query (tags and showYoutubeSearch)
    const { data: settingsData } = useQuery({
        ...settingsQueryOptions,
        // Only query when authenticated to avoid 401 errors on login page
        enabled: isAuthenticated,
    });

    const availableTags = settingsData?.tags ?? EMPTY_TAGS;
    const showYoutubeSearch = settingsData?.showYoutubeSearch ?? true;
    const captureSearchText = settingsData?.statisticsCaptureSearchText === true;

    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [lastSearchEventId, setLastSearchEventId] = useState<string | null>(null);
    const statisticsIngestion = useStatisticsIngestion();

    // Search state
    const [searchResults, setSearchResults] = useState<VideoSearchResult[]>([]);
    const [localSearchResults, setLocalSearchResults] = useState<Video[]>([]);
    const [isSearchMode, setIsSearchMode] = useState<boolean>(false);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [youtubeLoading, setYoutubeLoading] = useState<boolean>(false);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);

    // Reference to the current search request's abort controller
    const searchAbortController = useRef<AbortController | null>(null);
    // Reference to track if load more request is in progress (prevents race conditions)
    const loadMoreInProgress = useRef<boolean>(false);

    // Wrapper for refetch to match interface
    const fetchVideos = useCallback(async () => {
        await refetchVideos();
    }, [refetchVideos]);

    // Emulate setVideos for compatibility
    const setVideos: React.Dispatch<React.SetStateAction<Video[]>> = useCallback((updater) => {
        queryClient.setQueryData(['videos'], (oldVideos: Video[] | undefined) => {
            const currentVideos = oldVideos || [];
            if (typeof updater === 'function') {
                return updater(currentVideos);
            }
            return updater;
        });
    }, [queryClient]);

    const deleteVideoMutation = useMutation({
        mutationFn: async ({ id }: { id: string; options?: { showSnackbar?: boolean } }) => {
            await api.delete(`/videos/${id}`);
            return id;
        },
        onSuccess: (id, variables) => {
            queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                old ? old.filter(video => video.id !== id) : []
            );
            // Deleting a video changes visibility-aware favorite counts/covers
            // (e.g. removing an author's last video, or a favorited collection's
            // cover), so refresh favorites to avoid stale cards that link to now
            // empty author/collection pages.
            queryClient.invalidateQueries({ queryKey: ['favorite-authors'] });
            queryClient.invalidateQueries({ queryKey: ['favorite-collections'] });
            if (variables.options?.showSnackbar !== false) {
                showSnackbar(t('videoRemovedSuccessfully'));
            }
        },
        onError: (error) => {
            console.error('Error deleting video:', error);
        }
    });

    const deleteVideo = useCallback(async (id: string, options?: { showSnackbar?: boolean }) => {
        try {
            await deleteVideoMutation.mutateAsync({ id, options });
            return { success: true };
        } catch {
            return { success: false, error: t('failedToDeleteVideo') };
        }
    }, [deleteVideoMutation, t]);

    const deleteVideos = useCallback(async (ids: string[]) => {
        try {
            // Delete in small bounded-concurrency batches: much faster than fully
            // sequential for large selections, but capped so we never fire one
            // request per video at once and flood the server.
            const DELETE_CONCURRENCY = 5;
            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < ids.length; i += DELETE_CONCURRENCY) {
                const chunk = ids.slice(i, i + DELETE_CONCURRENCY);
                const outcomes = await Promise.all(
                    chunk.map(async (id) => {
                        try {
                            await deleteVideoMutation.mutateAsync({ id, options: { showSnackbar: false } });
                            return true;
                        } catch (error) {
                            console.error(`Failed to delete video ${id}:`, error);
                            return false;
                        }
                    })
                );
                for (const ok of outcomes) {
                    if (ok) successCount++;
                    else failCount++;
                }
            }

            if (failCount === 0) {
                showSnackbar(t('deleteFilteredVideosSuccess', { count: successCount }));
                return { success: true };
            } else {
                showSnackbar(`${t('deleteFilteredVideosSuccess', { count: successCount })} (${failCount} failed)`);
                return { success: failCount === 0 }; // Consider partial success as success? strict: fail if any fail
            }
        } catch {
            return { success: false, error: t('failedToDeleteVideo') };
        }
    }, [deleteVideoMutation, showSnackbar, t]);

    const searchLocalVideos = useCallback((query: string) => {
        if (!query || !videos.length) return [];

        // Normalize query: lowercase, trim, split by whitespace
        const terms = query.toLowerCase().trim().split(/\s+/).filter(t => t.length > 0);

        if (terms.length === 0) return videos;

        return videos.filter(video => {
            // Prepare searchable text. The list payload intentionally omits
            // description (heavy column, only the player loads it), so local
            // search matches title/author/tags.
            const searchableText = [
                video.title,
                video.author,
                ...(video.tags || [])
            ].join(' ').toLowerCase();

            // Check if ALL terms are present (AND logic)
            return terms.every(term => searchableText.includes(term));
        });
    }, [videos]);

    const resetSearch = useCallback(() => {
        if (searchAbortController.current) {
            searchAbortController.current.abort();
            searchAbortController.current = null;
        }
        loadMoreInProgress.current = false;
        setIsSearchMode(false);
        setSearchTerm('');
        setSearchResults([]);
        setLocalSearchResults([]);
        setYoutubeLoading(false);
        setLoadingMore(false);
        setLastSearchEventId(null);
    }, []);

    const handleSearch = useCallback(async (query: string): Promise<any> => {
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
            loadMoreInProgress.current = false; // Reset load more state for new search

            setIsSearchMode(true);
            setSearchTerm(query);

            const localResults = searchLocalVideos(query);
            setLocalSearchResults(localResults);

            let externalResults: VideoSearchResult[] = [];
            // Only search YouTube if showYoutubeSearch is enabled
            if (showYoutubeSearch) {
                setYoutubeLoading(true);

                try {
                    const response = await api.get('/search', {
                        params: { query },
                        signal: signal
                    });

                    if (!signal.aborted) {
                        // Limit search results to prevent memory issues
                        const results = response.data.results || [];
                        externalResults = results;
                        setSearchResults(results.slice(0, MAX_SEARCH_RESULTS));
                    }
                } catch (youtubeErr: unknown) {
                    const errorName = youtubeErr && typeof youtubeErr === 'object' && 'name' in youtubeErr
                        ? String((youtubeErr as { name: unknown }).name)
                        : '';
                    if (errorName !== 'CanceledError' && errorName !== 'AbortError') {
                        console.error('Error searching YouTube:', youtubeErr);
                    }
                } finally {
                    if (!signal.aborted) {
                        setYoutubeLoading(false);
                    }
                }
            } else {
                // Clear any existing YouTube results when disabled
                setSearchResults([]);
                setYoutubeLoading(false);
            }

            if (statisticsIngestion.enabled) {
                const queryPayload: Record<string, unknown> = {
                    queryLength: query.length,
                    localResultCount: localResults.length,
                    externalResultCount: externalResults.length,
                    externalSearchEnabled: showYoutubeSearch,
                };
                if (captureSearchText) {
                    queryPayload.queryText = query;
                }
                const submittedId = statisticsIngestion.recordEvent({
                    eventType: 'search_submitted',
                    surface: 'web',
                    payload: queryPayload,
                });
                setLastSearchEventId(submittedId);
            } else {
                setLastSearchEventId(null);
            }

            return { success: true };
        } catch (err: unknown) {
            const errorName = err && typeof err === 'object' && 'name' in err
                ? String((err as { name: unknown }).name)
                : '';
            if (errorName !== 'CanceledError' && errorName !== 'AbortError') {
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
    }, [resetSearch, showYoutubeSearch, searchLocalVideos, statisticsIngestion, captureSearchText, t]);

    const loadMoreSearchResults = useCallback(async (): Promise<void> => {
        // Use ref check first to prevent race conditions (immediate, synchronous check)
        if (!searchTerm || loadMoreInProgress.current || loadingMore || !showYoutubeSearch) return;

        // Don't load more if we've reached the maximum
        if (searchResults.length >= MAX_SEARCH_RESULTS) {
            return;
        }

        try {
            // Set both state and ref to prevent concurrent requests
            loadMoreInProgress.current = true;
            setLoadingMore(true);

            const currentCount = searchResults.length;
            const limit = 8;
            const offset = currentCount + 1;

            const response = await api.get('/search', {
                params: {
                    query: searchTerm,
                    limit,
                    offset
                }
            });

            if (response.data.results && response.data.results.length > 0) {
                setSearchResults(prev => {
                    // Create a Set of existing IDs for fast lookup
                    const existingIds = new Set(prev.map(result => result.id));
                    // Filter out duplicates by ID
                    const newResults = response.data.results.filter((result: VideoSearchResult) => !existingIds.has(result.id));
                    // Only append new, non-duplicate results, up to MAX_SEARCH_RESULTS
                    const combined = [...prev, ...newResults];
                    return combined.slice(0, MAX_SEARCH_RESULTS);
                });
            }
        } catch (error) {
            console.error('Error loading more results:', error);
            showSnackbar(t('failedToSearch'));
        } finally {
            loadMoreInProgress.current = false;
            setLoadingMore(false);
        }
    }, [searchTerm, loadingMore, showYoutubeSearch, searchResults.length, showSnackbar, t]);

    const handleTagToggle = useCallback((tag: string) => {
        setSelectedTags(prev =>
            prev.includes(tag)
                ? prev.filter(t => t !== tag)
                : [...prev, tag]
        );
    }, []);

    const clearSelectedTags = useCallback(() => {
        setSelectedTags([]);
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

    const refreshThumbnailMutation = useMutation({
        mutationFn: async (id: string) => {
            const response = await api.post(`/videos/${id}/refresh-thumbnail`);
            return { id, data: response.data };
        },
        onSuccess: ({ id, data }) => {
            if (data.success) {
                queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                    old ? old.map(video => {
                        if (video.id !== id) return video;
                        const thumbnailUrl = data.thumbnailUrl;
                        const thumbnailPath = typeof thumbnailUrl === 'string'
                            ? thumbnailUrl.split('?')[0]
                            : thumbnailUrl;
                        return { ...video, thumbnailUrl, thumbnailPath };
                    }) : []
                );
                showSnackbar(t('thumbnailRefreshed'));
            }
        },
        onError: (error) => {
            console.error('Error refreshing thumbnail:', error);
        }
    });

    const refreshThumbnail = useCallback(async (id: string) => {
        try {
            const result = await refreshThumbnailMutation.mutateAsync(id);
            if (result.data.success) {
                return { success: true };
            }
            return { success: false, error: t('thumbnailRefreshFailed') };
        } catch {
            return { success: false, error: t('thumbnailRefreshFailed') };
        }
    }, [refreshThumbnailMutation, t]);

    const redownloadThumbnailMutation = useMutation({
        mutationFn: async (id: string) => {
            const response = await api.post(`/videos/${id}/redownload-thumbnail`);
            return { id, data: response.data };
        },
        onSuccess: ({ id, data }) => {
            if (data.success) {
                queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                    old ? old.map(video => {
                        if (video.id !== id) return video;
                        const thumbnailUrl = data.thumbnailUrl;
                        const thumbnailPath = typeof thumbnailUrl === 'string'
                            ? thumbnailUrl.split('?')[0]
                            : thumbnailUrl;
                        return { ...video, thumbnailUrl, thumbnailPath };
                    }) : []
                );
                showSnackbar(t('thumbnailRefreshed'));
            }
        },
        onError: (error) => {
            console.error('Error re-downloading thumbnail:', error);
        }
    });

    const redownloadThumbnail = useCallback(async (id: string) => {
        try {
            const result = await redownloadThumbnailMutation.mutateAsync(id);
            if (result.data.success) {
                return { success: true };
            }
            return { success: false, error: t('thumbnailRefreshFailed') };
        } catch {
            return { success: false, error: t('thumbnailRefreshFailed') };
        }
    }, [redownloadThumbnailMutation, t]);

    const uploadThumbnailMutation = useMutation({
        mutationFn: async ({ id, file }: { id: string; file: File }) => {
            const formData = new FormData();
            formData.append('thumbnail', file);
            const response = await api.post(`/videos/${id}/upload-thumbnail`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            return { id, data: response.data };
        },
        onSuccess: ({ id, data }) => {
            if (data.success) {
                queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                    old ? old.map(video => {
                        if (video.id !== id) return video;
                        const thumbnailUrl = data.thumbnailUrl;
                        const thumbnailPath = typeof thumbnailUrl === 'string'
                            ? thumbnailUrl.split('?')[0]
                            : thumbnailUrl;
                        return { ...video, thumbnailUrl, thumbnailPath };
                    }) : []
                );
                showSnackbar(t('thumbnailUploaded') || 'Thumbnail uploaded');
            }
        },
        onError: (error: unknown) => {
            console.error('Error uploading thumbnail:', error);
        }
    });

    const uploadThumbnail = useCallback(async (id: string, file: File): Promise<void> => {
        await uploadThumbnailMutation.mutateAsync({ id, file });
    }, [uploadThumbnailMutation]);

    const updateVideoMutation = useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: Partial<Video> }) => {
            const response = await api.put(`/videos/${id}`, updates);
            return { id, updates, data: response.data };
        },
        onSuccess: ({ id, updates, data }) => {
            if (data.success) {
                // Update the videos list query
                queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                    old ? old.map(video =>
                        video.id === id ? { ...video, ...updates } : video
                    ) : []
                );
                // Also update the individual video query if it exists
                queryClient.setQueryData(['video', id], (old: Video | undefined) =>
                    old ? { ...old, ...updates } : old
                );
                showSnackbar(t('videoUpdated'));
            }
        },
        onError: (error) => {
            console.error('Error updating video:', error);
        }
    });

    const updateVideo = useCallback(async (id: string, updates: Partial<Video>) => {
        try {
            const result = await updateVideoMutation.mutateAsync({ id, updates });
            if (result.data.success) {
                return { success: true };
            }
            return { success: false, error: t('videoUpdateFailed') };
        } catch {
            return { success: false, error: t('videoUpdateFailed') };
        }
    }, [updateVideoMutation, t]);

    const incrementView = useCallback(async (id: string) => {
        try {
            const res = await api.post(`/videos/${id}/view`);
            if (res.data.success) {
                const lastPlayedAt = Date.now();
                queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                    old ? old.map(video =>
                        video.id === id
                            ? { ...video, viewCount: res.data.viewCount, lastPlayedAt }
                            : video
                    ) : []
                );
                // Also update individual video query if it exists
                queryClient.setQueryData(['video', id], (old: Video | undefined) =>
                    old ? { ...old, viewCount: res.data.viewCount, lastPlayedAt } : old
                );
                return { success: true };
            }
            return { success: false, error: 'Failed to increment view' };
        } catch (error) {
            console.error('Error incrementing view count:', error);
            return { success: false, error: 'Failed to increment view' };
        }
    }, [queryClient]);

    const value = useMemo<VideoContextType>(() => ({
        videos,
        loading: videosLoading,
        error: videosError ? (videosError as Error).message : null,
        fetchVideos,
        deleteVideo,
        deleteVideos,
        updateVideo,
        refreshThumbnail,
        redownloadThumbnail,
        uploadThumbnail,
        incrementView,
        searchLocalVideos,
        searchResults,
        localSearchResults,
        isSearchMode,
        searchTerm,
        youtubeLoading,
        handleSearch,
        lastSearchEventId,
        resetSearch,
        setVideos,
        setIsSearchMode,
        availableTags,
        selectedTags,
        handleTagToggle,
        clearSelectedTags,
        showYoutubeSearch,
        loadMoreSearchResults,
        loadingMore,
    }), [
        videos, videosLoading, videosError, fetchVideos, deleteVideo, deleteVideos,
        updateVideo, refreshThumbnail, redownloadThumbnail, uploadThumbnail,
        incrementView, searchLocalVideos, searchResults, localSearchResults,
        isSearchMode, searchTerm, youtubeLoading, handleSearch, lastSearchEventId,
        resetSearch, setVideos, availableTags, selectedTags, handleTagToggle,
        clearSelectedTags, showYoutubeSearch, loadMoreSearchResults, loadingMore,
    ]);

    const tagsValue = useMemo<VideoTagsContextType>(() => ({
        availableTags,
        selectedTags,
        handleTagToggle,
        clearSelectedTags,
    }), [availableTags, selectedTags, handleTagToggle, clearSelectedTags]);

    const actionsValue = useMemo<VideoActionsContextType>(() => ({
        updateVideo,
        incrementView,
    }), [updateVideo, incrementView]);

    return (
        <VideoContext.Provider value={value}>
            <VideoActionsContext.Provider value={actionsValue}>
                <VideoTagsContext.Provider value={tagsValue}>
                    {children}
                </VideoTagsContext.Provider>
            </VideoActionsContext.Provider>
        </VideoContext.Provider>
    );
};
