import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export type ViewMode = 'favorite' | 'collections' | 'all-videos' | 'history';

interface UseViewModeReturn {
    viewMode: ViewMode;
    setViewMode: (mode: ViewMode) => void;
    handleViewModeChange: (mode: ViewMode) => void;
}

export const useViewMode = (initialMode?: ViewMode): UseViewModeReturn => {
    const [_searchParams, setSearchParams] = useSearchParams();
    const [viewMode, setViewMode] = useState<ViewMode>(() => {
        if (initialMode) {
            return initialMode;
        }
        const saved = localStorage.getItem('homeViewMode');
        if (
            saved === 'favorite' ||
            saved === 'collections' ||
            saved === 'all-videos' ||
            saved === 'history'
        ) {
            return saved;
        }
        return 'all-videos';
    });

    const handleViewModeChange = (mode: ViewMode) => {
        setViewMode(mode);
        localStorage.setItem('homeViewMode', mode);
        setSearchParams((prev: URLSearchParams) => {
            const newParams = new URLSearchParams(prev);
            newParams.set('page', '1');
            return newParams;
        });
    };

    return {
        viewMode,
        setViewMode,
        handleViewModeChange
    };
};
