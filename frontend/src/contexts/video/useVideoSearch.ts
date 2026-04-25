import { useEffect, useRef, useState } from 'react';
import { Video } from '../../types';
import { api } from '../../utils/apiClient';
import type { TranslateFn } from '../../utils/translateOrFallback';

const MAX_SEARCH_RESULTS = 200; // Maximum number of search results to keep in memory

interface UseVideoSearchArgs {
    showSnackbar: (message: string) => void;
    showYoutubeSearch: boolean;
    t: TranslateFn;
    videos: Video[];
}

const isAbortLikeError = (error: unknown): boolean => {
    const name = (error as { name?: unknown }).name;
    return name === 'CanceledError' || name === 'AbortError';
};

export const useVideoSearch = ({
    showSnackbar,
    showYoutubeSearch,
    t,
    videos,
}: UseVideoSearchArgs) => {
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [localSearchResults, setLocalSearchResults] = useState<Video[]>([]);
    const [isSearchMode, setIsSearchMode] = useState<boolean>(false);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [youtubeLoading, setYoutubeLoading] = useState<boolean>(false);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);
    const searchAbortController = useRef<AbortController | null>(null);
    const loadMoreInProgress = useRef<boolean>(false);

    const searchLocalVideos = (query: string) => {
        if (!query || !videos.length) return [];

        const terms = query.toLowerCase().trim().split(/\s+/).filter(term => term.length > 0);
        if (terms.length === 0) return videos;

        return videos.filter(video => {
            const searchableText = [
                video.title,
                video.author,
                video.description || '',
                ...(video.tags || [])
            ].join(' ').toLowerCase();

            return terms.every(term => searchableText.includes(term));
        });
    };

    const resetSearch = () => {
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
    };

    const searchYoutube = async (
        query: string,
        signal: AbortSignal
    ): Promise<void> => {
        if (!showYoutubeSearch) {
            setSearchResults([]);
            setYoutubeLoading(false);
            return;
        }

        setYoutubeLoading(true);
        try {
            const response = await api.get('/search', {
                params: { query },
                signal,
            });

            if (!signal.aborted) {
                const results = response.data.results || [];
                setSearchResults(results.slice(0, MAX_SEARCH_RESULTS));
            }
        } catch (youtubeErr: unknown) {
            if (!isAbortLikeError(youtubeErr)) {
                console.error('Error searching YouTube:', youtubeErr);
            }
        } finally {
            if (!signal.aborted) {
                setYoutubeLoading(false);
            }
        }
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
            loadMoreInProgress.current = false;

            setIsSearchMode(true);
            setSearchTerm(query);

            const localResults = searchLocalVideos(query);
            setLocalSearchResults(localResults);
            await searchYoutube(query, signal);

            return { success: true };
        } catch (err: unknown) {
            if (isAbortLikeError(err)) {
                return { success: false, error: t('searchCancelled') };
            }

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
    };

    const loadMoreSearchResults = async (): Promise<void> => {
        if (!searchTerm || loadMoreInProgress.current || loadingMore || !showYoutubeSearch) return;

        if (searchResults.length >= MAX_SEARCH_RESULTS) {
            return;
        }

        try {
            loadMoreInProgress.current = true;
            setLoadingMore(true);

            const response = await api.get('/search', {
                params: {
                    query: searchTerm,
                    limit: 8,
                    offset: searchResults.length + 1,
                },
            });

            if (response.data.results && response.data.results.length > 0) {
                setSearchResults(prev => {
                    const existingIds = new Set(prev.map(result => result.id));
                    const newResults = response.data.results.filter((result: any) => !existingIds.has(result.id));
                    return [...prev, ...newResults].slice(0, MAX_SEARCH_RESULTS);
                });
            }
        } catch (error) {
            console.error('Error loading more results:', error);
            showSnackbar(t('failedToSearch'));
        } finally {
            loadMoreInProgress.current = false;
            setLoadingMore(false);
        }
    };

    useEffect(() => {
        return () => {
            if (searchAbortController.current) {
                searchAbortController.current.abort();
                searchAbortController.current = null;
            }
        };
    }, []);

    return {
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
    };
};
