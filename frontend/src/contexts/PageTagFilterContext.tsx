import React, { createContext, useContext, useMemo, useState } from 'react';

export interface PageTagFilterValue {
    availableTags: string[];
    selectedTags: string[];
    onTagToggle: (tag: string) => void;
    /** Optional version bump so context consumers re-render when selection changes */
    _version?: number;
}

interface PageTagFilterContextType {
    pageTagFilter: PageTagFilterValue | null;
    setPageTagFilter: (value: PageTagFilterValue | null) => void;
}

const PageTagFilterContext = createContext<PageTagFilterContextType | null>(null);

export const PageTagFilterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [pageTagFilter, setPageTagFilter] = useState<PageTagFilterValue | null>(null);
    const value = useMemo(
        () => ({ pageTagFilter, setPageTagFilter }),
        [pageTagFilter]
    );
    return (
        <PageTagFilterContext.Provider value={value}>
            {children}
        </PageTagFilterContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export function usePageTagFilter(): PageTagFilterContextType {
    const ctx = useContext(PageTagFilterContext);
    if (!ctx) {
        throw new Error('usePageTagFilter must be used within PageTagFilterProvider');
    }
    return ctx;
}

/**
 * Optional hook for components that may be outside the provider (e.g. Header in tests).
 * Returns context value or null. Use for reading page tag filter when provider may be absent.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePageTagFilterOptional(): PageTagFilterContextType | null {
    return useContext(PageTagFilterContext);
}
