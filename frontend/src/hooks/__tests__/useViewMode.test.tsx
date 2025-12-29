import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewMode } from '../useViewMode';

// Mock react-router-dom
const mockSetSearchParams = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock('react-router-dom', () => ({
    useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}));

describe('useViewMode', () => {
    const localStorageMock = (() => {
        let store: Record<string, string> = {};
        return {
            getItem: (key: string) => store[key] || null,
            setItem: (key: string, value: string) => {
                store[key] = value.toString();
            },
            clear: () => {
                store = {};
            },
            removeItem: (key: string) => {
                delete store[key];
            },
        };
    })();

    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(window, 'localStorage', {
            value: localStorageMock,
        });
        localStorageMock.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return default view mode "all-videos" if no local storage', () => {
        const { result } = renderHook(() => useViewMode());
        expect(result.current.viewMode).toBe('all-videos');
    });

    it('should initialize with value from local storage', () => {
        localStorageMock.setItem('homeViewMode', 'collections');
        const { result } = renderHook(() => useViewMode());
        expect(result.current.viewMode).toBe('collections');
    });

    it('should update view mode and local storage when handleViewModeChange is called', () => {
        const { result } = renderHook(() => useViewMode());

        act(() => {
            result.current.handleViewModeChange('history');
        });

        expect(result.current.viewMode).toBe('history');
        expect(localStorageMock.getItem('homeViewMode')).toBe('history');
    });

    it('should reset page param when view mode changes', () => {
        const { result } = renderHook(() => useViewMode());

        act(() => {
            result.current.handleViewModeChange('collections');
        });

        expect(mockSetSearchParams).toHaveBeenCalled();
        // Check if the callback passed to setSearchParams sets the page to 1
        const callback = mockSetSearchParams.mock.calls[0][0];
        const params = new URLSearchParams();
        params.set('page', '5'); // Simulation of existing params
        const newParams = callback(params);
        expect(newParams.get('page')).toBe('1');
    });
});
