import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsMutations } from '../useSettingsMutations';
import { api } from '../../utils/apiClient';

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => {
            const translations: Record<string, string> = {
                error: 'error',
                databaseExportFailed: 'databaseExportFailed',
                restoreFromLastBackupFailed: 'restoreFromLastBackupFailed',
                legacyDataDeleteFailed: 'legacyDataDeleteFailed',
                settingsVisitorAccessRestricted: 'Localized visitor restriction',
                settingsAuthRequired: 'Please sign in first.',
            };
            return translations[key] || key;
        },
    }),
}));

vi.mock('../../utils/apiClient', async () => {
    const actual = await vi.importActual<any>('../../utils/apiClient');
    return {
        ...actual,
        api: {
            get: vi.fn(),
            post: vi.fn(),
            patch: vi.fn(),
            delete: vi.fn(),
        },
    };
});

const createTestQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
            mutations: {
                retry: false,
            },
        },
    });

const createWrapper = () => {
    const queryClient = createTestQueryClient();
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
};

const makeAxiosLikeError = (status: number, data: unknown, message = 'Request failed') =>
    ({
        isAxiosError: true,
        message,
        response: {
            status,
            data,
        },
    } as any);

describe('useSettingsMutations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(api.get).mockImplementation((url: string) => {
            if (url === '/settings/last-backup-info') {
                return Promise.resolve({ data: { exists: false } } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });
        vi.mocked(api.post).mockResolvedValue({ data: {} } as any);
        vi.mocked(api.patch).mockResolvedValue({ data: {} } as any);
    });

    it('shows translated blob-backed export errors', async () => {
        vi.mocked(api.get).mockImplementation((url: string, config?: any) => {
            if (url === '/settings/last-backup-info') {
                return Promise.resolve({ data: { exists: false } } as any);
            }
            if (url === '/settings/export-database' && config?.responseType === 'blob') {
                return Promise.reject(
                    makeAxiosLikeError(
                        403,
                        {
                            constructor: { name: 'Blob' },
                            text: async () =>
                                JSON.stringify({
                                    errorKey: 'settingsVisitorAccessRestricted',
                                    error: 'Visitor role: Access to this resource is restricted.',
                                }),
                        }
                    )
                );
            }
            return Promise.resolve({ data: {} } as any);
        });

        const setMessage = vi.fn();
        const setInfoModal = vi.fn();
        const { result } = renderHook(
            () => useSettingsMutations({ setMessage, setInfoModal }),
            { wrapper: createWrapper() }
        );

        act(() => {
            result.current.exportDatabaseMutation.mutate();
        });

        await waitFor(() => {
            expect(setMessage).toHaveBeenCalledWith({
                text: 'databaseExportFailed: Localized visitor restriction',
                type: 'error',
            });
        });
    });

    it('shows translated restore errors in the info modal', async () => {
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/settings/restore-from-last-backup') {
                return Promise.reject(
                    makeAxiosLikeError(401, {
                        errorKey: 'settingsAuthRequired',
                        error: 'Authentication required. Please log in to access this resource.',
                    })
                );
            }
            return Promise.resolve({ data: {} } as any);
        });

        const setMessage = vi.fn();
        const setInfoModal = vi.fn();
        const { result } = renderHook(
            () => useSettingsMutations({ setMessage, setInfoModal }),
            { wrapper: createWrapper() }
        );

        act(() => {
            result.current.restoreFromLastBackupMutation.mutate();
        });

        await waitFor(() => {
            expect(setInfoModal).toHaveBeenCalledWith({
                isOpen: true,
                title: 'error',
                message: 'restoreFromLastBackupFailed: Please sign in first.',
                type: 'error',
            });
        });
    });

    it('uses the translated legacy delete failure label', async () => {
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/settings/delete-legacy') {
                return Promise.reject(
                    makeAxiosLikeError(500, {
                        details: 'disk failure',
                    })
                );
            }
            return Promise.resolve({ data: {} } as any);
        });

        const setMessage = vi.fn();
        const setInfoModal = vi.fn();
        const { result } = renderHook(
            () => useSettingsMutations({ setMessage, setInfoModal }),
            { wrapper: createWrapper() }
        );

        act(() => {
            result.current.deleteLegacyMutation.mutate();
        });

        await waitFor(() => {
            expect(setInfoModal).toHaveBeenCalledWith({
                isOpen: true,
                title: 'error',
                message: 'legacyDataDeleteFailed: disk failure',
                type: 'error',
            });
        });
    });
});
