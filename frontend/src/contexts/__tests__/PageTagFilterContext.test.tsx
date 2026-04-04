import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import {
    PageTagFilterProvider,
    usePageTagFilter,
    usePageTagFilterOptional,
    type PageTagFilterValue,
} from '../PageTagFilterContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <PageTagFilterProvider>{children}</PageTagFilterProvider>
);

describe('PageTagFilterContext', () => {
    it('throws when usePageTagFilter is used outside the provider', () => {
        expect(() => renderHook(() => usePageTagFilter())).toThrow(
            'usePageTagFilter must be used within PageTagFilterProvider'
        );
    });

    it('returns null from the optional hook outside the provider', () => {
        const { result } = renderHook(() => usePageTagFilterOptional());

        expect(result.current).toBeNull();
    });

    it('stores and clears the page tag filter state inside the provider', () => {
        const filterValue: PageTagFilterValue = {
            availableTags: ['music', 'news'],
            selectedTags: ['music'],
            onTagToggle: () => {},
            _version: 1,
        };

        const { result } = renderHook(
            () => ({
                required: usePageTagFilter(),
                optional: usePageTagFilterOptional(),
            }),
            { wrapper }
        );

        expect(result.current.required.pageTagFilter).toBeNull();
        expect(result.current.optional?.pageTagFilter).toBeNull();

        act(() => {
            result.current.required.setPageTagFilter(filterValue);
        });

        expect(result.current.required.pageTagFilter).toBe(filterValue);
        expect(result.current.optional?.pageTagFilter).toBe(filterValue);

        act(() => {
            result.current.required.setPageTagFilter(null);
        });

        expect(result.current.required.pageTagFilter).toBeNull();
        expect(result.current.optional?.pageTagFilter).toBeNull();
    });
});
