import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeContextProvider, useThemeContext } from '../ThemeContext';

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};

    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
            store[key] = value.toString();
        },
        removeItem: (key: string) => {
            delete store[key];
        },
        clear: () => {
            store = {};
        }
    };
})();

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock
});

// Mock matchMedia
const mockMatchMedia = vi.fn((query: string) => ({
    matches: query.includes('dark'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
}));

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: mockMatchMedia,
});

describe('ThemeContext', () => {
    beforeEach(() => {
        localStorageMock.clear();
        vi.clearAllMocks();
    });

    afterEach(() => {
        localStorageMock.clear();
    });

    it('should throw error when used outside provider', () => {
        // Suppress console.error for this test
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        expect(() => {
            renderHook(() => useThemeContext());
        }).toThrow('useThemeContext must be used within a ThemeContextProvider');

        consoleSpy.mockRestore();
    });

    it('should initialize with light theme when no saved preference', () => {
        mockMatchMedia.mockReturnValue({
            matches: false,
            media: '(prefers-color-scheme: dark)',
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        } as MediaQueryList);

        const { result } = renderHook(() => useThemeContext(), {
            wrapper: ThemeContextProvider
        });

        expect(result.current.mode).toBe('light');
    });

    it('should initialize with dark theme from system preference', () => {
        mockMatchMedia.mockReturnValue({
            matches: true,
            media: '(prefers-color-scheme: dark)',
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        } as MediaQueryList);

        const { result } = renderHook(() => useThemeContext(), {
            wrapper: ThemeContextProvider
        });

        expect(result.current.mode).toBe('dark');
    });

    it('should initialize with saved theme from localStorage', () => {
        localStorageMock.setItem('themeMode', 'dark');

        const { result } = renderHook(() => useThemeContext(), {
            wrapper: ThemeContextProvider
        });

        expect(result.current.mode).toBe('dark');
    });

    it('should toggle theme from light to dark', () => {
        localStorageMock.setItem('themeMode', 'light');

        const { result } = renderHook(() => useThemeContext(), {
            wrapper: ThemeContextProvider
        });

        expect(result.current.mode).toBe('light');

        act(() => {
            result.current.toggleTheme();
        });

        expect(result.current.mode).toBe('dark');
        expect(localStorageMock.getItem('themeMode')).toBe('dark');
    });

    it('should toggle theme from dark to light', () => {
        localStorageMock.setItem('themeMode', 'dark');

        const { result } = renderHook(() => useThemeContext(), {
            wrapper: ThemeContextProvider
        });

        expect(result.current.mode).toBe('dark');

        act(() => {
            result.current.toggleTheme();
        });

        expect(result.current.mode).toBe('light');
        expect(localStorageMock.getItem('themeMode')).toBe('light');
    });

    it('should save theme to localStorage on change', async () => {
        // Start with light theme
        localStorageMock.setItem('themeMode', 'light');

        const { result } = renderHook(() => useThemeContext(), {
            wrapper: ThemeContextProvider
        });

        // Verify initial state
        expect(result.current.mode).toBe('light');

        await act(async () => {
            result.current.toggleTheme();
        });

        // Verify state changed
        expect(result.current.mode).toBe('dark');

        // Wait for useEffect to save to localStorage
        await waitFor(() => {
            expect(localStorageMock.getItem('themeMode')).toBe('dark');
        }, { timeout: 1000 });
    });
});

