import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ViewMode } from '../hooks/useViewMode';

interface HomeViewModeRequest {
    mode: ViewMode;
    sequence: number;
}

interface HomeViewModeRequestContextValue {
    request: HomeViewModeRequest | null;
    requestHomeViewMode: (mode: ViewMode) => void;
    clearHomeViewModeRequest: (sequence: number) => void;
}

const HomeViewModeRequestContext = createContext<HomeViewModeRequestContextValue | null>(null);

export const HomeViewModeRequestProvider = ({ children }: { children: ReactNode }) => {
    const [request, setRequest] = useState<HomeViewModeRequest | null>(null);

    const requestHomeViewMode = useCallback((mode: ViewMode) => {
        setRequest((current) => ({
            mode,
            sequence: (current?.sequence ?? 0) + 1,
        }));
    }, []);

    const clearHomeViewModeRequest = useCallback((sequence: number) => {
        setRequest((current) => current?.sequence === sequence ? null : current);
    }, []);

    const value = useMemo(
        () => ({ request, requestHomeViewMode, clearHomeViewModeRequest }),
        [clearHomeViewModeRequest, request, requestHomeViewMode]
    );

    return (
        <HomeViewModeRequestContext.Provider value={value}>
            {children}
        </HomeViewModeRequestContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useHomeViewModeRequestOptional = (): HomeViewModeRequestContextValue | null =>
    useContext(HomeViewModeRequestContext);
