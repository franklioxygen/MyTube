import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../apiClient';
import {
    authSettingsQueryOptions,
    fetchAuthSettings,
    fetchReadableSettings
} from '../settingsQueries';

vi.mock('../apiClient', async () => {
    const actual = await vi.importActual<typeof import('../apiClient')>('../apiClient');
    return {
        ...actual,
        api: {
            ...actual.api,
            get: vi.fn(),
        },
    };
});

const mockedApi = vi.mocked(api, true);

describe('settingsQueries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null for unauthenticated auth probe responses but rethrows rate limits', async () => {
        mockedApi.get.mockRejectedValueOnce({ response: { status: 401 } });
        await expect(fetchAuthSettings()).resolves.toBeNull();

        mockedApi.get.mockRejectedValueOnce({ response: { status: 403 } });
        await expect(fetchAuthSettings()).resolves.toBeNull();

        const rateLimitError = { response: { status: 429 } };
        mockedApi.get.mockRejectedValueOnce(rateLimitError);
        await expect(fetchAuthSettings()).rejects.toBe(rateLimitError);
    });

    it('retries auth probe rate limits and uses wait time for retry delay', () => {
        const rateLimitError = {
            isAxiosError: true,
            response: {
                status: 429,
                data: { waitTime: 2500 }
            }
        };

        expect(authSettingsQueryOptions.retry(0, rateLimitError)).toBe(true);
        expect(authSettingsQueryOptions.retry(1, rateLimitError)).toBe(false);
        expect(authSettingsQueryOptions.retryDelay(0, rateLimitError)).toBe(2500);
        expect(authSettingsQueryOptions.retry(0, { response: { status: 401 } })).toBe(false);
    });

    it('forces a fresh settings fetch when requested even with warm cache', async () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                },
            },
        });

        queryClient.setQueryData(['authSettings'], {
            loginRequired: false,
            authenticatedRole: 'admin',
        });
        queryClient.setQueryData(['settings'], {
            language: 'es',
        });

        mockedApi.get.mockImplementation((url: string) => {
            if (url === '/settings') {
                return Promise.resolve({ data: { language: 'fr' } } as any);
            }

            throw new Error(`Unexpected GET ${url}`);
        });

        await expect(fetchReadableSettings(queryClient, { forceRefresh: true })).resolves.toEqual({
            language: 'fr',
        });
        expect(mockedApi.get).toHaveBeenCalledTimes(1);
        expect(mockedApi.get).toHaveBeenCalledWith('/settings');
    });
});
