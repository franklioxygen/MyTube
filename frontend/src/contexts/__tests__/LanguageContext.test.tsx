import { act, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../LanguageContext';
// Mock translations with valid keys found in types (inferred from lint)
vi.mock('../utils/translations', () => ({
    translations: {
        en: { retry: 'Retry' },
        es: { retry: 'Reintentar' },
        fr: { retry: 'Réessayer' },
        de: { retry: 'Wiederholen' }
    }
}));

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);



describe('LanguageContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Mock global localStorage
        const storageMock: Record<string, string> = {};
        Object.defineProperty(window, 'localStorage', {
            value: {
                getItem: vi.fn((key) => storageMock[key] || null),
                setItem: vi.fn((key, value) => {
                    storageMock[key] = value.toString();
                }),
                clear: vi.fn(() => {
                    for (const key in storageMock) delete storageMock[key];
                }),
                length: 0,
                key: vi.fn(),
                removeItem: vi.fn((key) => delete storageMock[key]),
            },
            writable: true
        });

        // Default Settings Mock
        mockedAxios.get.mockResolvedValue({ data: { language: 'en' } });
        mockedAxios.post.mockResolvedValue({});

        // Simulate authenticated user
        Object.defineProperty(document, 'cookie', {
            writable: true,
            value: 'mytube_role=admin',
        });
    });

    it('should initialize with default language (en) if nothing stored', async () => {
        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        expect(result.current.language).toBe('en');
    });

    it('should initialize with stored language', async () => {
        localStorage.setItem('mytube_language', 'es');
        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        await waitFor(() => {
            expect(result.current.language).toBe('es');
        });
    });

    it('should fetch language from backend on mount', async () => {
        mockedAxios.get.mockResolvedValueOnce({ data: { language: 'fr' } });

        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        await waitFor(() => {
            expect(result.current.language).toBe('fr');
        });

        expect(mockedAxios.get).toHaveBeenCalledWith(expect.stringContaining('/settings'));
        expect(localStorage.getItem('mytube_language')).toBe('fr');
    });

    it('should update language and sync to backend', async () => {
        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        // Wait for initial fetch to settle to avoid overwrite
        await waitFor(() => {
            expect(result.current.language).toBe('en');
        });

        // Mock getting current settings for the merge update
        mockedAxios.get.mockResolvedValueOnce({ data: { theme: 'dark', language: 'en' } });

        await act(async () => {
            await result.current.setLanguage('de');
        });

        expect(result.current.language).toBe('de');
        expect(localStorage.getItem('mytube_language')).toBe('de');

        expect(mockedAxios.post).toHaveBeenCalledWith(
            expect.stringContaining('/settings'),
            expect.objectContaining({
                language: 'de',
                theme: 'dark'
            })
        );
    });

    it('should translate keys correctly', () => {
        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        expect(result.current.t('retry')).toBe('Retry');
    });

    it('should handle missing keys gracefully', () => {
        const { result } = renderHook(() => useLanguage(), {
            wrapper: LanguageProvider
        });

        // @ts-expect-error - Testing invalid key
        expect(result.current.t('non_existent_key')).toBe('non_existent_key');
    });
});
