import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export type ViewMode = 'collections' | 'all-videos' | 'history';

interface UseViewModeReturn {
    viewMode: ViewMode;
    setViewMode: (mode: ViewMode) => void;
    handleViewModeChange: (mode: ViewMode) => void;
}

export const useViewMode = (): UseViewModeReturn => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [viewMode, setViewMode] = useState<ViewMode>(() => {
        const saved = localStorage.getItem('homeViewMode');
        return (saved as ViewMode) || 'all-videos';
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
