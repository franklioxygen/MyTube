import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../LanguageContext';

// Mock axios
const mockedAxios = vi.hoisted(() => ({
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({}),
    create: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ data: {} }),
        post: vi.fn().mockResolvedValue({}),
    })),
}));

vi.mock('axios', () => ({
    default: mockedAxios,
}));

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

// Mock environment variable - the actual code uses import.meta.env.VITE_API_URL
// We need to check what URL is actually being used, or make the test more flexible

describe('LanguageContext', () => {
    beforeEach(() => {
        localStorageMock.clear();
        // Default mock for axios.get to prevent crashes in useEffect
        mockedAxios.get.mockResolvedValue({ data: {} });
    });

    afterEach(() => {
        localStorageMock.clear();
    });

    it('should throw error when used outside provider', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        expect(() => {
            renderHook(() => useLanguage());
        }).toThrow('useLanguage must be used within a LanguageProvider');

        consoleSpy.mockRestore();
    });

    it('should initialize with language from localStorage', () => {
        localStorageMock.setItem('mytube_language', 'zh');

        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        expect(result.current.language).toBe('zh');
    });

    it('should default to English when no language in localStorage', () => {
        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        expect(result.current.language).toBe('en');
    });

    it('should fetch language from backend on mount', async () => {
        mockedAxios.get.mockResolvedValueOnce({
            data: { language: 'es' }
        });

        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        await waitFor(() => {
            expect(mockedAxios.get).toHaveBeenCalledWith('http://localhost:5551/api/settings');
        });

        await waitFor(() => {
            expect(result.current.language).toBe('es');
        });
    });

    it('should update language and save to localStorage', async () => {
        mockedAxios.get.mockResolvedValue({
            data: { language: 'en' }
        });
        mockedAxios.post.mockResolvedValue({});

        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        await waitFor(() => {
            expect(result.current.language).toBe('en');
        });

        await act(async () => {
            await result.current.setLanguage('fr');
        });

        expect(result.current.language).toBe('fr');
        expect(localStorageMock.getItem('mytube_language')).toBe('fr');
    });

    it('should save language to backend', async () => {
        mockedAxios.get.mockResolvedValue({
            data: { language: 'en', otherSetting: 'value' }
        });
        mockedAxios.post.mockResolvedValue({});

        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        await waitFor(() => {
            expect(result.current.language).toBe('en');
        });

        await act(async () => {
            await result.current.setLanguage('de');
        });

        await waitFor(() => {
            expect(mockedAxios.post).toHaveBeenCalledWith(
                'http://localhost:5551/api/settings',
                expect.objectContaining({
                    language: 'de',
                    otherSetting: 'value'
                })
            );
        });
    });

    it('should translate keys correctly', () => {
        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        // Use a valid translation key
        const translation = result.current.t('myTube');
        expect(typeof translation).toBe('string');
        expect(translation).toBe('MyTube'); // English default
    });

    it('should replace placeholders in translations', () => {
        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        // Test placeholder replacement with a key that might have placeholders
        // If the key doesn't exist, it returns the key itself
        const translation = result.current.t('myTube', { count: 5 });
        expect(typeof translation).toBe('string');
    });

    it('should handle backend fetch failure gracefully', async () => {
        mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

        localStorageMock.setItem('mytube_language', 'ja');

        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        // Should still use localStorage value
        await waitFor(() => {
            expect(result.current.language).toBe('ja');
        });
    });

    it('should handle backend save failure gracefully', async () => {
        mockedAxios.get.mockResolvedValue({
            data: { language: 'en' }
        });
        mockedAxios.post.mockRejectedValueOnce(new Error('Save failed'));

        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        await waitFor(() => {
            expect(result.current.language).toBe('en');
        });

        // Should still update local state even if backend save fails
        await act(async () => {
            await result.current.setLanguage('pt');
        });

        expect(result.current.language).toBe('pt');
        expect(localStorageMock.getItem('mytube_language')).toBe('pt');
    });
});

