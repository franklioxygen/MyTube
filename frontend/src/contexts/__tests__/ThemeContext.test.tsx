import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../utils/apiClient';
import { ThemeContextProvider, useThemeContext } from '../ThemeContext';

vi.mock('../../utils/apiClient', () => ({
    api: {
        get: vi.fn(),
        patch: vi.fn(),
    },
}));

const mockedApi = vi.mocked(api, true);
const mockApiGet = (implementation: (url: string) => Promise<{ data: unknown }>) => {
    mockedApi.get.mockImplementation(implementation as any);
};

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <ThemeContextProvider>{children}</ThemeContextProvider>
        </QueryClientProvider>
    );
};

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
const createMediaQueryList = (matches: boolean, media = '(prefers-color-scheme: dark)'): MediaQueryList => ({
    matches,
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
} as MediaQueryList);

const mockMatchMedia = vi.fn<(query: string) => MediaQueryList>((query: string) =>
    createMediaQueryList(query.includes('dark'), query)
);

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: mockMatchMedia,
});

describe('ThemeContext', () => {
    beforeEach(() => {
        localStorageMock.clear();
        vi.clearAllMocks();
        document.documentElement.style.colorScheme = '';
        delete document.documentElement.dataset.theme;
        mockApiGet(async (url: string) => {
            if (url === '/settings/password-enabled') {
                return { data: { loginRequired: true, authenticatedRole: null } };
            }
            return { data: {} };
        });
        mockedApi.patch.mockResolvedValue({ data: { success: true } } as any);
    });

    afterEach(() => {
        localStorageMock.clear();
        document.documentElement.style.colorScheme = '';
        delete document.documentElement.dataset.theme;
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
        mockMatchMedia.mockReturnValue(createMediaQueryList(false));

        const { result } = renderHook(() => useThemeContext(), {
            wrapper: createWrapper()
        });

        expect(result.current.mode).toBe('light');
        expect(document.documentElement.style.colorScheme).toBe('light');
        expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('should initialize with dark theme from system preference', () => {
        mockMatchMedia.mockReturnValue(createMediaQueryList(true));

        const { result } = renderHook(() => useThemeContext(), {
            wrapper: createWrapper()
        });

        expect(result.current.mode).toBe('dark');
        expect(document.documentElement.style.colorScheme).toBe('dark');
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('should initialize with saved theme from localStorage', () => {
        localStorageMock.setItem('themeMode', 'dark');

        const { result } = renderHook(() => useThemeContext(), {
            wrapper: createWrapper()
        });

        expect(result.current.mode).toBe('dark');
        expect(document.documentElement.style.colorScheme).toBe('dark');
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('falls back to system when backend returns an invalid theme value', async () => {
        mockMatchMedia.mockReturnValue(createMediaQueryList(false));
        localStorageMock.setItem('themeMode', 'dark');
        mockApiGet(async (url: string) => {
            if (url === '/settings/password-enabled') {
                return { data: { loginRequired: false, authenticatedRole: 'admin' } };
            }
            if (url === '/settings') {
                return { data: { theme: 'invalid-theme' } };
            }
            return { data: {} };
        });

        const { result } = renderHook(() => useThemeContext(), {
            wrapper: createWrapper()
        });

        await waitFor(() => expect(result.current.preference).toBe('system'));
        expect(localStorageMock.getItem('themeMode')).toBe('system');
    });

    it('should toggle theme from light to dark', () => {
        localStorageMock.setItem('themeMode', 'light');

        const { result } = renderHook(() => useThemeContext(), {
            wrapper: createWrapper()
        });

        expect(result.current.mode).toBe('light');

        act(() => {
            result.current.toggleTheme();
        });

        expect(result.current.mode).toBe('dark');
        expect(localStorageMock.getItem('themeMode')).toBe('dark');
        expect(document.documentElement.style.colorScheme).toBe('dark');
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('should toggle theme from dark to light', () => {
        localStorageMock.setItem('themeMode', 'dark');

        const { result } = renderHook(() => useThemeContext(), {
            wrapper: createWrapper()
        });

        expect(result.current.mode).toBe('dark');

        act(() => {
            result.current.toggleTheme();
        });

        expect(result.current.mode).toBe('light');
        expect(localStorageMock.getItem('themeMode')).toBe('light');
        expect(document.documentElement.style.colorScheme).toBe('light');
        expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('should save theme to localStorage on change', async () => {
        // Start with light theme
        localStorageMock.setItem('themeMode', 'light');

        const { result } = renderHook(() => useThemeContext(), {
            wrapper: createWrapper()
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
