import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

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
    const [viewMode, setViewMode] = useState<ViewMode>(
        () => initialMode ?? resolveStoredViewMode()
    );

    // React Router reuses the Home instance between `/` and `/favorites`, so
    // the state initializer above does not re-run when the route (and thus
    // `initialMode`) changes. Keep viewMode in sync with the route: adopt an
    // authoritative mode when provided (so the `/favorites` deep link stays
    // correct after Back from `/`), and fall back to the saved/default mode
    // when it is cleared (so leaving `/favorites` via a plain link such as the
    // logo stops rendering FavoritePage at `/`).
    useEffect(() => {
        setViewMode(initialMode ?? resolveStoredViewMode());
    }, [initialMode]);

    const handleViewModeChange = useCallback((mode: ViewMode) => {
        setViewMode(mode);
        localStorage.setItem('homeViewMode', mode);
        setSearchParams((prev: URLSearchParams) => {
            const newParams = new URLSearchParams(prev);
            newParams.set('page', '1');
            return newParams;
        });
    }, [setSearchParams]);

    return {
        viewMode,
        setViewMode,
        handleViewModeChange
    };
};
