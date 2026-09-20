import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Video, VideoSearchResult } from '../types';
import { useStatisticsIngestion } from '../hooks/useStatisticsIngestion';
import { api } from '../utils/apiClient';
import { withCanonicalAuthorAvatars } from '../utils/authorAvatar';
import { hasAxiosStatus, isAbortError } from '../utils/errors';
import { settingsQueryOptions } from '../utils/settingsQueries';
import { normalizeTagKey } from '../utils/tagUtils';
import { useAuth } from './AuthContext';
import { useLanguage } from './LanguageContext';
import { useSnackbar } from './SnackbarContext';
const MAX_SEARCH_RESULTS = 200; // Maximum number of search results to keep in memory

// The external platforms `/search` can be asked for, one section of the search
// page each.
type ExternalSearchSource = 'youtube' | 'bilibili';

/** Identifies which sources a search covered, so a change to them is detectable. */
const sourcesKey = (youtube: boolean, bilibili: boolean) => `${youtube}|${bilibili}`;

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
    bilibiliSearchResults: VideoSearchResult[];
    bilibiliLoading: boolean;
    showBilibiliSearch: boolean;
    loadMoreBilibiliSearchResults: () => Promise<void>;
    loadingMoreBilibili: boolean;
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
    const showBilibiliSearch = settingsData?.showBilibiliSearch ?? false;
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
    const [bilibiliSearchResults, setBilibiliSearchResults] = useState<VideoSearchResult[]>([]);
    const [bilibiliLoading, setBilibiliLoading] = useState<boolean>(false);
    const [loadingMoreBilibili, setLoadingMoreBilibili] = useState<boolean>(false);

    // Reference to the current search request's abort controller
    const searchAbortController = useRef<AbortController | null>(null);
    // Increments for every new search (and reset). Axios cancellation is best
    // effort, so this also prevents a response that ignored cancellation from
    // updating the newer query's state.
    const searchGeneration = useRef(0);
    // Reference to track if load more request is in progress (prevents race conditions)
    const loadMoreInProgress = useRef<boolean>(false);
    const loadMoreBilibiliInProgress = useRef<boolean>(false);
    // Which sources the search currently on screen was run against.
    const searchedSources = useRef<string | null>(null);

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
            // Membership is cascaded away with the video in the database, so a
            // collection cached here would go on listing an id that is gone -
            // and a collection left with nothing would not read as empty.
            queryClient.invalidateQueries({ queryKey: ['collections'] });
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
        searchGeneration.current += 1;
        searchedSources.current = null;
        if (searchAbortController.current) {
            searchAbortController.current.abort();
            searchAbortController.current = null;
        }
        loadMoreInProgress.current = false;
        loadMoreBilibiliInProgress.current = false;
        setIsSearchMode(false);
        setSearchTerm('');
        setSearchResults([]);
        setLocalSearchResults([]);
        setBilibiliSearchResults([]);
        setYoutubeLoading(false);
        setBilibiliLoading(false);
        setLoadingMore(false);
        setLoadingMoreBilibili(false);
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
            const generation = searchGeneration.current + 1;
            searchGeneration.current = generation;
            // Reset load-more state for the new query. Any older request is
            // ignored by its generation check before it can update state.
            loadMoreInProgress.current = false;
            loadMoreBilibiliInProgress.current = false;
            setLoadingMore(false);
            setLoadingMoreBilibili(false);

            setIsSearchMode(true);
            setSearchTerm(query);
            // Each source publishes its cards as soon as it answers, but the
            // search_submitted event is not recorded until both have. Holding
            // the previous query's id through that window would attribute a
            // download of an already-visible card to the wrong search, so it is
            // dropped here and only replaced once this search is recorded.
            setLastSearchEventId(null);

            const localResults = searchLocalVideos(query);
            setLocalSearchResults(localResults);

            // Which sources to search is a saved setting, and on a cold load of
            // /search?q=... the query has not resolved yet - the fallbacks above
            // are what an unresolved settings query reads as. Searching on those
            // would render an enabled Bilibili section that never fetched, and
            // SearchPage cannot recover it: by the time the setting arrives the
            // term already matches, so it does not search again.
            let searchYoutube = showYoutubeSearch;
            let searchBilibili = showBilibiliSearch;
            if (!settingsData && isAuthenticated) {
                try {
                    const resolvedSettings = await queryClient.ensureQueryData(settingsQueryOptions);
                    searchYoutube = resolvedSettings?.showYoutubeSearch ?? true;
                    searchBilibili = resolvedSettings?.showBilibiliSearch ?? false;
                } catch (settingsErr: unknown) {
                    // Settings are unreadable; the fallbacks stand rather than
                    // failing a search the user can otherwise be served.
                    if (!isAbortError(settingsErr)) {
                        console.error('Could not resolve search sources from settings:', settingsErr);
                    }
                }
            }

            // Resolving the settings is an await, so a reset or a newer query
            // can land while it is pending. Without this the superseded call
            // would carry on into searchExternalSource, which blanks the newer
            // search's results and raises its loading flag before its own
            // generation check - and then skips lowering it again, leaving the
            // section spinning over nothing.
            if (signal.aborted || searchGeneration.current !== generation) {
                return { success: false, error: t('searchCancelled') };
            }
            searchedSources.current = sourcesKey(searchYoutube, searchBilibili);

            // Each external source is fetched the same way; only the endpoint's
            // `source` and the state it fills differ.
            const searchExternalSource = async (
                source: ExternalSearchSource,
                enabled: boolean,
                setResults: React.Dispatch<React.SetStateAction<VideoSearchResult[]>>,
                setLoading: React.Dispatch<React.SetStateAction<boolean>>
            ): Promise<VideoSearchResult[]> => {
                if (!enabled) {
                    // Clear any existing results when the source is disabled
                    setResults([]);
                    setLoading(false);
                    return [];
                }

                // A failed request must not leave this source showing cards
                // belonging to the preceding query.
                setResults([]);
                setLoading(true);
                try {
                    const response = await api.get('/search', {
                        params: { query, source },
                        signal: signal
                    });

                    if (signal.aborted || searchGeneration.current !== generation) {
                        return [];
                    }
                    // Limit search results to prevent memory issues
                    const results: VideoSearchResult[] = response.data.results || [];
                    setResults(results.slice(0, MAX_SEARCH_RESULTS));
                    return results;
                } catch (externalErr: unknown) {
                    if (!isAbortError(externalErr)) {
                        console.error(`Error searching ${source}:`, externalErr);
                    }
                    return [];
                } finally {
                    if (!signal.aborted && searchGeneration.current === generation) {
                        setLoading(false);
                    }
                }
            };

            // Run both sources concurrently so enabling Bilibili does not make a
            // search wait for YouTube to answer first.
            const [youtubeResults, bilibiliResults] = await Promise.all([
                searchExternalSource('youtube', searchYoutube, setSearchResults, setYoutubeLoading),
                searchExternalSource('bilibili', searchBilibili, setBilibiliSearchResults, setBilibiliLoading),
            ]);
            if (searchGeneration.current !== generation) {
                return { success: false, error: t('searchCancelled') };
            }
            const externalResultCount = youtubeResults.length + bilibiliResults.length;

            if (statisticsIngestion.enabled) {
                const queryPayload: Record<string, unknown> = {
                    queryLength: query.length,
                    localResultCount: localResults.length,
                    externalResultCount,
                    externalSearchEnabled: searchYoutube || searchBilibili,
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
            if (!isAbortError(err)) {
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
    }, [resetSearch, showYoutubeSearch, showBilibiliSearch, settingsData, isAuthenticated, queryClient,
        searchLocalVideos, statisticsIngestion, captureSearchText, t]);

    // The next page for one external source. Both sections page identically, so
    // the source, its in-flight guard and its result state are the only inputs.
    const loadMoreExternalResults = useCallback(async (
        source: ExternalSearchSource,
        enabled: boolean,
        inProgressRef: React.RefObject<boolean>,
        currentCount: number,
        isLoadingMore: boolean,
        setResults: React.Dispatch<React.SetStateAction<VideoSearchResult[]>>,
        setIsLoadingMore: React.Dispatch<React.SetStateAction<boolean>>
    ): Promise<void> => {
        // Use ref check first to prevent race conditions (immediate, synchronous check)
        if (!searchTerm || inProgressRef.current || isLoadingMore || !enabled) return;

        // Don't load more if we've reached the maximum
        if (currentCount >= MAX_SEARCH_RESULTS) {
            return;
        }

        const generation = searchGeneration.current;
        const query = searchTerm;
        try {
            // Set both state and ref to prevent concurrent requests
            inProgressRef.current = true;
            setIsLoadingMore(true);

            const limit = 8;
            const offset = currentCount + 1;

            const response = await api.get('/search', {
                params: {
                    query,
                    source,
                    limit,
                    offset
                }
            });

            // A "more" response may arrive after the user has searched for a
            // different term. It belongs to the previous result set, not this
            // one, so never merge it into the new query.
            if (searchGeneration.current !== generation) {
                return;
            }

            if (response.data.results && response.data.results.length > 0) {
                setResults(prev => {
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
            if (searchGeneration.current === generation) {
                console.error(`Error loading more ${source} results:`, error);
                showSnackbar(t('failedToSearch'));
            }
        } finally {
            if (searchGeneration.current === generation) {
                inProgressRef.current = false;
                setIsLoadingMore(false);
            }
        }
    }, [searchTerm, showSnackbar, t]);

    const loadMoreSearchResults = useCallback(async (): Promise<void> => {
        await loadMoreExternalResults(
            'youtube', showYoutubeSearch, loadMoreInProgress, searchResults.length,
            loadingMore, setSearchResults, setLoadingMore,
        );
    }, [loadMoreExternalResults, showYoutubeSearch, searchResults.length, loadingMore]);

    const loadMoreBilibiliSearchResults = useCallback(async (): Promise<void> => {
        await loadMoreExternalResults(
            'bilibili', showBilibiliSearch, loadMoreBilibiliInProgress, bilibiliSearchResults.length,
            loadingMoreBilibili, setBilibiliSearchResults, setLoadingMoreBilibili,
        );
    }, [loadMoreExternalResults, showBilibiliSearch, bilibiliSearchResults.length, loadingMoreBilibili]);

    // Which sources are enabled is an input to the search, not a filter over an
    // existing result set, so a search already on screen has to be re-run when
    // it changes. Turning Bilibili on in Settings and returning to the same
    // /search?q=... would otherwise show an empty section reading "no results":
    // this provider outlives the route change, so SearchPage sees a term that
    // already matches and does not search again. Compared against the sources
    // the displayed search actually used rather than against the previous
    // render's flags, so settings arriving after a cold-load search - which
    // resolved them itself - does not trigger a redundant second search.
    useEffect(() => {
        if (!searchTerm || !searchedSources.current) {
            return;
        }
        if (searchedSources.current !== sourcesKey(showYoutubeSearch, showBilibiliSearch)) {
            void handleSearch(searchTerm);
        }
    }, [showYoutubeSearch, showBilibiliSearch, searchTerm, handleSearch]);

    const handleTagToggle = useCallback((tag: string) => {
        setSelectedTags((prev) => {
            const key = normalizeTagKey(tag);
            const alreadySelected = prev.some((t) => normalizeTagKey(t) === key);
            if (alreadySelected) {
                return prev.filter((t) => normalizeTagKey(t) !== key);
            }
            return [...prev, tag];
        });
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
                const isAutoDeleteLockUpdate = Object.prototype.hasOwnProperty.call(
                    updates,
                    'autoDeleteLocked'
                );
                showSnackbar(
                    isAutoDeleteLockUpdate
                        ? updates.autoDeleteLocked === 1
                            ? t('videoLocked')
                            : t('videoUnlocked')
                        : t('videoUpdated')
                );
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
        bilibiliSearchResults,
        bilibiliLoading,
        showBilibiliSearch,
        loadMoreBilibiliSearchResults,
        loadingMoreBilibili,
    }), [
        videos, videosLoading, videosError, fetchVideos, deleteVideo, deleteVideos,
        updateVideo, refreshThumbnail, redownloadThumbnail, uploadThumbnail,
        incrementView, searchLocalVideos, searchResults, localSearchResults,
        isSearchMode, searchTerm, youtubeLoading, handleSearch, lastSearchEventId,
        resetSearch, setVideos, availableTags, selectedTags, handleTagToggle,
        clearSelectedTags, showYoutubeSearch, loadMoreSearchResults, loadingMore,
        bilibiliSearchResults, bilibiliLoading, showBilibiliSearch,
        loadMoreBilibiliSearchResults, loadingMoreBilibili,
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
