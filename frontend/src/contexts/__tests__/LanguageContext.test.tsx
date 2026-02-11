import { act, renderHook, waitFor } from '@testing-library/react';
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

        mockedApi.get.mockImplementation((url: string) => {
            if (url === '/settings/password-enabled') {
                return Promise.resolve({ data: { loginRequired: true, authenticatedRole: null } });
            }
            return Promise.resolve({ data: {} });
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
        const { result } = renderHook(() => useLanguage(), { wrapper: LanguageProvider });
        expect(result.current.language).toBe('en');
    });

    it('initializes with stored language', async () => {
        setLocalStorageMock({ initial: { mytube_language: 'es' } });

        const { result } = renderHook(() => useLanguage(), { wrapper: LanguageProvider });

        await waitFor(() => expect(result.current.language).toBe('es'));
    });

    it('fetches language from backend when settings can be read', async () => {
        const localStorageMock = setLocalStorageMock();
        mockedApi.get.mockImplementation((url: string) => {
            if (url === '/settings/password-enabled') {
                return Promise.resolve({ data: { loginRequired: false, authenticatedRole: 'admin' } });
            }
            if (url === '/settings') {
                return Promise.resolve({ data: { language: 'fr' } });
            }
            return Promise.resolve({ data: {} });
        });

        const { result } = renderHook(() => useLanguage(), { wrapper: LanguageProvider });

        await waitFor(() => expect(result.current.language).toBe('fr'));
        expect(localStorageMock.setItem).toHaveBeenCalledWith('mytube_language', 'fr');
    });

    it('logs when reading localStorage fails', () => {
        setLocalStorageMock({ throwOnGet: true });

        const { result } = renderHook(() => useLanguage(), { wrapper: LanguageProvider });

        expect(result.current.language).toBe('en');
        expect(console.error).toHaveBeenCalledWith(
            'Error reading language from localStorage:',
            expect.any(Error)
        );
    });

    it('logs when syncing backend language to localStorage fails', async () => {
        setLocalStorageMock({ throwOnSet: true });
        mockedApi.get.mockImplementation((url: string) => {
            if (url === '/settings/password-enabled') {
                return Promise.resolve({ data: { loginRequired: false, authenticatedRole: 'admin' } });
            }
            if (url === '/settings') {
                return Promise.resolve({ data: { language: 'de' } });
            }
            return Promise.resolve({ data: {} });
        });

        const { result } = renderHook(() => useLanguage(), { wrapper: LanguageProvider });

        await waitFor(() => expect(result.current.language).toBe('de'));
        expect(console.error).toHaveBeenCalledWith(
            'Error saving language to localStorage:',
            expect.any(Error)
        );
    });

    it('logs non-auth errors while fetching backend settings', async () => {
        mockedApi.get.mockRejectedValueOnce({ response: { status: 500 } });

        renderHook(() => useLanguage(), { wrapper: LanguageProvider });

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

        const { result } = renderHook(() => useLanguage(), { wrapper: LanguageProvider });

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
            const { result } = renderHook(() => useLanguage(), { wrapper: LanguageProvider });
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
