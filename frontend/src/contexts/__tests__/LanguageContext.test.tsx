import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../utils/apiClient';
import { loadLocale } from '../../utils/translations';
import { LanguageProvider, useLanguage } from '../LanguageContext';

vi.mock('../../utils/apiClient', () => ({
    api: {
        get: vi.fn(),
        patch: vi.fn(),
    },
}));

vi.mock('../../utils/translations', () => ({
    defaultTranslations: {
        retry: 'Retry',
        helloName: 'Hello {name} {name}',
        error: 'Error',
    },
    loadLocale: vi.fn(async () => ({
        retry: 'Retry',
        helloName: 'Hello {name} {name}',
        error: 'Error',
    })),
}));

const mockedApi = vi.mocked(api, true);
const mockedLoadLocale = vi.mocked(loadLocale);
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
            <LanguageProvider>{children}</LanguageProvider>
        </QueryClientProvider>
    );
};

const setLocalStorageMock = ({
    initial = {},
    throwOnGet = false,
    throwOnSet = false,
}: {
    initial?: Record<string, string>;
    throwOnGet?: boolean;
    throwOnSet?: boolean;
} = {}) => {
    const storageMock: Record<string, string> = { ...initial };
    const localStorageMock = {
        getItem: vi.fn((key: string) => {
            if (throwOnGet) {
                throw new Error('get failed');
            }
            return storageMock[key] ?? null;
        }),
        setItem: vi.fn((key: string, value: string) => {
            if (throwOnSet) {
                throw new Error('set failed');
            }
            storageMock[key] = String(value);
        }),
        clear: vi.fn(() => {
            Object.keys(storageMock).forEach((key) => delete storageMock[key]);
        }),
        removeItem: vi.fn((key: string) => {
            delete storageMock[key];
        }),
        key: vi.fn(),
        length: 0,
    };

    Object.defineProperty(window, 'localStorage', {
        value: localStorageMock,
        writable: true,
        configurable: true,
    });

    return localStorageMock;
};

describe('LanguageContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setLocalStorageMock();

        mockApiGet(async (url: string) => {
            if (url === '/settings/password-enabled') {
                return { data: { loginRequired: true, authenticatedRole: null } };
            }
            return { data: {} };
        });
        mockedApi.patch.mockResolvedValue({ data: { success: true } } as any);
        mockedLoadLocale.mockResolvedValue({
            retry: 'Retry',
            helloName: 'Hello {name} {name}',
            error: 'Error',
        } as any);
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('initializes with default language when nothing is stored', () => {
        const { result } = renderHook(() => useLanguage(), { wrapper: createWrapper() });
        expect(result.current.language).toBe('en');
    });

    it('initializes with stored language', async () => {
        setLocalStorageMock({ initial: { mytube_language: 'es' } });

        const { result } = renderHook(() => useLanguage(), { wrapper: createWrapper() });

        await waitFor(() => expect(result.current.language).toBe('es'));
    });

    it('fetches language from backend when settings can be read', async () => {
        const localStorageMock = setLocalStorageMock();
        mockApiGet(async (url: string) => {
            if (url === '/settings/password-enabled') {
                return { data: { loginRequired: false, authenticatedRole: 'admin' } };
            }
            if (url === '/settings') {
                return { data: { language: 'fr' } };
            }
            return { data: {} };
        });

        const { result } = renderHook(() => useLanguage(), { wrapper: createWrapper() });

        await waitFor(() => expect(result.current.language).toBe('fr'));
        expect(localStorageMock.setItem).toHaveBeenCalledWith('mytube_language', 'fr');
    });

    it('falls back to en when backend returns an invalid language value', async () => {
        const localStorageMock = setLocalStorageMock({ initial: { mytube_language: 'fr' } });
        mockApiGet(async (url: string) => {
            if (url === '/settings/password-enabled') {
                return { data: { loginRequired: false, authenticatedRole: 'admin' } };
            }
            if (url === '/settings') {
                return { data: { language: 'invalid-language' } };
            }
            return { data: {} };
        });

        const { result } = renderHook(() => useLanguage(), { wrapper: createWrapper() });

        await waitFor(() => expect(result.current.language).toBe('en'));
        expect(localStorageMock.setItem).toHaveBeenCalledWith('mytube_language', 'en');
    });

    it('logs when reading localStorage fails', () => {
        setLocalStorageMock({ throwOnGet: true });

        const { result } = renderHook(() => useLanguage(), { wrapper: createWrapper() });

        expect(result.current.language).toBe('en');
        expect(console.error).toHaveBeenCalledWith(
            'Error reading language from localStorage:',
            expect.any(Error)
        );
    });

    it('logs when syncing backend language to localStorage fails', async () => {
        setLocalStorageMock({ throwOnSet: true });
        mockApiGet(async (url: string) => {
            if (url === '/settings/password-enabled') {
                return { data: { loginRequired: false, authenticatedRole: 'admin' } };
            }
            if (url === '/settings') {
                return { data: { language: 'de' } };
            }
            return { data: {} };
        });

        const { result } = renderHook(() => useLanguage(), { wrapper: createWrapper() });

        await waitFor(() => expect(result.current.language).toBe('de'));
        expect(console.error).toHaveBeenCalledWith(
            'Error saving language to localStorage:',
            expect.any(Error)
        );
    });

    it('logs non-auth errors while fetching backend settings', async () => {
        mockedApi.get.mockRejectedValue({ response: { status: 500 } });

        renderHook(() => useLanguage(), { wrapper: createWrapper() });

        await waitFor(() => {
            expect(console.error).toHaveBeenCalledWith(
                'Error fetching settings for language:',
                expect.anything()
            );
        });
    });

    it('updates language and logs localStorage + non-401 patch errors', async () => {
        setLocalStorageMock({ throwOnSet: true });
        mockedApi.patch.mockRejectedValueOnce({ response: { status: 500 } });

        const { result } = renderHook(() => useLanguage(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.setLanguage('de');
        });

        expect(result.current.language).toBe('de');
        expect(console.error).toHaveBeenCalledWith(
            'Error saving language to localStorage:',
            expect.any(Error)
        );
        expect(console.error).toHaveBeenCalledWith(
            'Error saving language setting:',
            expect.anything()
        );
    });

    it('translates placeholders using replaceAll fallback loop', () => {
        const originalDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'replaceAll');
        Object.defineProperty(String.prototype, 'replaceAll', {
            value: undefined,
            configurable: true,
            writable: true,
        });

        try {
            const { result } = renderHook(() => useLanguage(), { wrapper: createWrapper() });
            expect(result.current.t('helloName' as any, { name: 'Alice' })).toBe('Hello Alice Alice');
        } finally {
            if (originalDescriptor) {
                Object.defineProperty(String.prototype, 'replaceAll', originalDescriptor);
            }
        }
    });

    it('throws when useLanguage is called outside provider', () => {
        expect(() => renderHook(() => useLanguage())).toThrow(
            'useLanguage must be used within a LanguageProvider'
        );
    });
});
