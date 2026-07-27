import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';

export type ViewMode = 'favorite' | 'collections' | 'all-videos' | 'history';

interface UseViewModeReturn {
    viewMode: ViewMode;
    setViewMode: (mode: ViewMode) => void;
    handleViewModeChange: (mode: ViewMode) => void;
}

const isViewMode = (value: unknown): value is ViewMode =>
    value === 'favorite' ||
    value === 'collections' ||
    value === 'all-videos' ||
    value === 'history';

// The mode Home should show when the route provides no authoritative one
// (i.e. on `/`): the last-selected saved mode, otherwise the default.
const resolveStoredViewMode = (): ViewMode => {
    const saved = localStorage.getItem('homeViewMode');
    return isViewMode(saved) ? saved : 'all-videos';
};

export const useViewMode = (initialMode?: ViewMode): UseViewModeReturn => {
    const [_searchParams, setSearchParams] = useSearchParams();
    const [storedViewMode, setStoredViewMode] = useState<ViewMode>(resolveStoredViewMode);
    const viewMode = initialMode ?? storedViewMode;

    const handleViewModeChange = useCallback((mode: ViewMode) => {
        setStoredViewMode(mode);
        localStorage.setItem('homeViewMode', mode);
        setSearchParams((prev: URLSearchParams) => {
            const newParams = new URLSearchParams(prev);
            newParams.set('page', '1');
            return newParams;
        });
    }, [setSearchParams]);

    return {
        viewMode,
        setViewMode: setStoredViewMode,
        handleViewModeChange
    };
};
