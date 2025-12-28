import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Video } from '../types';

interface UseHomePaginationProps {
    sortedVideos: Video[];
    itemsPerPage: number;
    infiniteScroll: boolean;
    selectedTags: string[];
}

interface UseHomePaginationReturn {
    page: number;
    totalPages: number;
    displayedVideos: Video[];
    handlePageChange: (event: React.ChangeEvent<unknown>, value: number) => void;
}

export const useHomePagination = ({
    sortedVideos,
    itemsPerPage,
    infiniteScroll,
    selectedTags
}: UseHomePaginationProps): UseHomePaginationReturn => {
    const [searchParams, setSearchParams] = useSearchParams();
    const page = parseInt(searchParams.get('page') || '1', 10);

    // Reset page when switching tags (paginated mode only)
    const prevTagsRef = useRef(selectedTags);
    useEffect(() => {
        if (prevTagsRef.current !== selectedTags) {
            prevTagsRef.current = selectedTags;
            setSearchParams((prev: URLSearchParams) => {
                const newParams = new URLSearchParams(prev);
                newParams.set('page', '1');
                return newParams;
            });
        }
    }, [selectedTags, setSearchParams]);

    // Pagination logic
    const totalPages = Math.ceil(sortedVideos.length / itemsPerPage);

    // Get displayed videos based on mode (Only used for PAGINATION)
    const displayedVideos = useMemo(() => {
        if (infiniteScroll) {
            // When infinite scroll is on, we ignore this slice and pass strict 'sortedVideos' to Virtuoso
            // but we might want to return sortedVideos directly here if used elsewhere
            return sortedVideos;
        } else {
            // For pagination, return current page
            return sortedVideos.slice(
                (page - 1) * itemsPerPage,
                page * itemsPerPage
            );
        }
    }, [infiniteScroll, sortedVideos, page, itemsPerPage]);

    const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
        setSearchParams((prev: URLSearchParams) => {
            const newParams = new URLSearchParams(prev);
            newParams.set('page', value.toString());
            return newParams;
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Keyboard navigation for pagination (only when infinite scroll is disabled)
    useEffect(() => {
        if (infiniteScroll) {
            return; // Disable keyboard navigation when infinite scroll is enabled
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            // Don't handle keyboard navigation if user is typing in an input field
            const target = event.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }

            // Only handle if there are multiple pages
            if (totalPages <= 1) {
                return;
            }

            if (event.key === 'ArrowLeft' && page > 1) {
                event.preventDefault();
                setSearchParams((prev: URLSearchParams) => {
                    const newParams = new URLSearchParams(prev);
                    newParams.set('page', (page - 1).toString());
                    return newParams;
                });
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (event.key === 'ArrowRight' && page < totalPages) {
                event.preventDefault();
                setSearchParams((prev: URLSearchParams) => {
                    const newParams = new URLSearchParams(prev);
                    newParams.set('page', (page + 1).toString());
                    return newParams;
                });
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [page, totalPages, setSearchParams, infiniteScroll]);

    return {
        page,
        totalPages,
        displayedVideos,
        handlePageChange
    };
};
