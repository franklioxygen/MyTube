import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsMutations } from '../useSettingsMutations';
import type { Settings } from '../../types';
import { api } from '../../utils/apiClient';

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => {
            const translations: Record<string, string> = {
                settingsSaved: 'settingsSaved',
                settingsFailed: 'settingsFailed',
                error: 'error',
                success: 'success',
                migrationReport: 'migrationReport',
                migrationWarnings: 'migrationWarnings',
                itemsMigrated: 'itemsMigrated',
                fileNotFound: 'fileNotFound',
                migrationErrors: 'migrationErrors',
                noDataFilesFound: 'noDataFilesFound',
                migrationResults: 'migrationResults',
                migrationNoData: 'migrationNoData',
                migrationFailed: 'migrationFailed',
                cleanupTempFilesSuccess: 'Deleted {count} temp files',
                cleanupTempFilesActiveDownloads: 'cleanupTempFilesActiveDownloads',
                cleanupTempFilesFailed: 'cleanupTempFilesFailed',
                legacyDataDeleted: 'legacyDataDeleted',
                databaseExportFailed: 'databaseExportFailed',
                databaseExportedSuccess: 'databaseExportedSuccess',
                databaseImportedSuccess: 'databaseImportedSuccess',
                databaseImportFailed: 'databaseImportFailed',
                databaseMergedSuccess: 'databaseMergedSuccess',
                databaseMergeFailed: 'databaseMergeFailed',
                backupDatabasesCleanedUp: 'backupDatabasesCleanedUp',
                backupDatabasesCleanupFailed: 'backupDatabasesCleanupFailed',
                restoreFromLastBackupSuccess: 'restoreFromLastBackupSuccess',
                restoreFromLastBackupFailed: 'restoreFromLastBackupFailed',
                legacyDataDeleteFailed: 'legacyDataDeleteFailed',
                formatFilenamesSuccess: 'Processed {processed}, renamed {renamed}, errors {errors}',
                formatFilenamesDetails: 'formatFilenamesDetails',
                formatFilenamesMore: 'And {count} more',
                formatFilenamesError: 'formatFilenamesError: {error}',
                tagRenamedSuccess: 'tagRenamedSuccess',
                tagRenameFailed: 'tagRenameFailed',
                settingsVisitorAccessRestricted: 'Localized visitor restriction',
                settingsAuthRequired: 'Please sign in first.',
            };
            return translations[key] || key;
        },
    }),
}));

vi.mock('../../utils/formatUtils', async () => {
    const actual = await vi.importActual<any>('../../utils/formatUtils');
    return {
        ...actual,
        generateTimestamp: vi.fn(() => '2026-04-04_10-00-00'),
    };
});

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

const baseSettings: Settings = {
    loginEnabled: true,
    defaultAutoPlay: false,
    defaultAutoLoop: false,
    maxConcurrentDownloads: 2,
    language: 'en',
    tags: ['tag-a'],
    cloudDriveEnabled: false,
    openListApiUrl: '',
    openListToken: '',
    cloudDrivePath: '',
    hooks: {
        task_success: 'echo ok',
    },
    authorTags: {
        author1: ['tag-a'],
    },
    collectionTags: {
        favorites: ['tag-b'],
    },
};

const makeSettings = (overrides: Partial<Settings> = {}): Settings => ({
    ...baseSettings,
    ...overrides,
    tags: overrides.tags ?? baseSettings.tags,
    hooks: overrides.hooks ?? baseSettings.hooks,
    authorTags: overrides.authorTags ?? baseSettings.authorTags,
    collectionTags: overrides.collectionTags ?? baseSettings.collectionTags,
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

const createWrapper = (queryClient: QueryClient) =>
    ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

const renderSettingsHook = (options?: {
    queryClient?: QueryClient;
    setMessage?: ReturnType<typeof vi.fn>;
    setInfoModal?: ReturnType<typeof vi.fn>;
}) => {
    const queryClient = options?.queryClient ?? createTestQueryClient();
    const setMessage = options?.setMessage ?? vi.fn();
    const setInfoModal = options?.setInfoModal ?? vi.fn();
    const wrapper = createWrapper(queryClient);

    const hook = renderHook(
        () => useSettingsMutations({ setMessage, setInfoModal }),
        { wrapper }
    );

    return {
        ...hook,
        queryClient,
        setMessage,
        setInfoModal,
    };
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

const getLastInfoModal = (setInfoModal: ReturnType<typeof vi.fn>) =>
    setInfoModal.mock.calls.at(-1)?.[0];

const getLastMessage = (setMessage: ReturnType<typeof vi.fn>) =>
    setMessage.mock.calls.at(-1)?.[0];

const countApiGetCalls = (url: string) =>
    vi.mocked(api.get).mock.calls.filter(([calledUrl]) => calledUrl === url).length;

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

    it('skips unchanged settings payloads and ignores derived or blank credential fields', async () => {
        const currentSettings = makeSettings({
            tags: ['tag-a', 'tag-b'],
            hooks: { task_success: 'echo ok' },
            authorTags: { author1: ['tag-a'] },
            collectionTags: { favorites: ['tag-b'] },
            isPasswordSet: true,
            isVisitorPasswordSet: true,
            deploymentSecurity: {
                adminTrustLevel: 'container',
                adminTrustedWithContainer: true,
                adminTrustedWithHost: false,
                source: 'env',
            },
        });
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(['settings'], currentSettings);

        const { result, setMessage } = renderSettingsHook({ queryClient });
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const nextSettings = {
            ...makeSettings({
                tags: ['tag-a', 'tag-b'],
                hooks: { task_success: 'echo ok' },
                authorTags: { author1: ['tag-a'] },
                collectionTags: { favorites: ['tag-b'] },
            }),
            password: '',
            visitorPassword: '',
            isPasswordSet: false,
            isVisitorPasswordSet: false,
            deploymentSecurity: {
                adminTrustLevel: 'host',
                adminTrustedWithContainer: false,
                adminTrustedWithHost: true,
                source: 'env',
            },
            authenticatedRole: 'admin',
        } as Settings & { authenticatedRole: string };

        let mutationResult: unknown;
        await act(async () => {
            mutationResult = await result.current.saveMutation.mutateAsync(nextSettings);
        });

        expect(mutationResult).toEqual({
            skipped: true,
            patchPayload: {},
        });
        expect(api.patch).not.toHaveBeenCalled();
        expect(api.get).not.toHaveBeenCalledWith('/settings');
        expect(invalidateSpy).not.toHaveBeenCalled();
        expect(queryClient.getQueryData(['settings'])).toEqual(currentSettings);
        expect(getLastMessage(setMessage)).toEqual({
            text: 'settingsSaved',
            type: 'success',
        });
    });

    it('fetches current settings when cache is empty, patches only changed fields, and invalidates dependent queries', async () => {
        const currentSettings = makeSettings({
            language: 'en',
            tags: ['tag-a'],
            hooks: { task_success: 'echo ok' },
            authorTags: { author1: ['tag-a'] },
        });
        vi.mocked(api.get).mockImplementation((url: string) => {
            if (url === '/settings/last-backup-info') {
                return Promise.resolve({ data: { exists: false } } as any);
            }
            if (url === '/settings') {
                return Promise.resolve({ data: currentSettings } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });

        const queryClient = createTestQueryClient();
        const { result, setMessage } = renderSettingsHook({ queryClient });
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        await act(async () => {
            await result.current.saveMutation.mutateAsync(
                makeSettings({
                    language: 'fr',
                    tags: ['tag-a', 'tag-b'],
                    hooks: { task_success: 'echo ok' },
                    authorTags: { author1: ['tag-a'] },
                })
            );
        });

        expect(api.get).toHaveBeenCalledWith('/settings');
        expect(api.patch).toHaveBeenCalledWith('/settings', {
            language: 'fr',
            tags: ['tag-a', 'tag-b'],
        });
        expect(queryClient.getQueryData<Settings>(['settings'])).toMatchObject({
            language: 'fr',
            tags: ['tag-a', 'tag-b'],
        });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['settings'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['videos'] });
        expect(getLastMessage(setMessage)).toEqual({
            text: 'settingsSaved',
            type: 'success',
        });
    });

    it('reports the shared fallback message when save rejects with a non-API error shape', async () => {
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(['settings'], makeSettings());
        vi.mocked(api.patch).mockRejectedValue({});

        const { result, setMessage } = renderSettingsHook({ queryClient });

        act(() => {
            result.current.saveMutation.mutate(makeSettings({ language: 'ja' }));
        });

        await waitFor(() => {
            expect(getLastMessage(setMessage)).toEqual({
                text: 'An unknown error occurred',
                type: 'error',
            });
        });
    });

    it('builds a migration report with warnings, found files, missing files, and errors', async () => {
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/settings/migrate') {
                return Promise.resolve({
                    data: {
                        results: {
                            warnings: ['warn 1'],
                            videos: { found: true, count: 2 },
                            collections: { found: false, path: '/collections.json' },
                            downloads: { found: true, count: 1 },
                            errors: ['bad row'],
                        },
                    },
                } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });

        const { result, setInfoModal } = renderSettingsHook();

        await act(async () => {
            await result.current.migrateMutation.mutateAsync();
        });

        const modal = getLastInfoModal(setInfoModal);
        expect(modal).toMatchObject({
            isOpen: true,
            title: 'migrationResults',
            type: 'success',
        });
        expect(modal.message).toContain('migrationReport');
        expect(modal.message).toContain('⚠️ migrationWarnings');
        expect(modal.message).toContain('✅ videos: 2 itemsMigrated');
        expect(modal.message).toContain('❌ collections: fileNotFound /collections.json');
        expect(modal.message).toContain('✅ downloads: 1 itemsMigrated');
        expect(modal.message).toContain('⛔ migrationErrors');
    });

    it('shows a warning modal when migration finds no importable data', async () => {
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/settings/migrate') {
                return Promise.resolve({
                    data: {
                        results: {
                            videos: { found: false, path: '/videos.json' },
                        },
                    },
                } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });

        const { result, setInfoModal } = renderSettingsHook();

        await act(async () => {
            await result.current.migrateMutation.mutateAsync();
        });

        const modal = getLastInfoModal(setInfoModal);
        expect(modal).toMatchObject({
            isOpen: true,
            title: 'migrationNoData',
            type: 'warning',
        });
        expect(modal.message).toContain('fileNotFound /videos.json');
        expect(modal.message).toContain('noDataFilesFound');
    });

    it('reports cleanup warnings when temp file deletion completes with per-file errors', async () => {
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/cleanup-temp-files') {
                return Promise.resolve({
                    data: {
                        deletedCount: 3,
                        errors: ['temp.lock'],
                    },
                } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });

        const { result, setInfoModal } = renderSettingsHook();

        await act(async () => {
            await result.current.cleanupMutation.mutateAsync();
        });

        expect(getLastInfoModal(setInfoModal)).toEqual({
            isOpen: true,
            title: 'success',
            message: 'Deleted 3 temp files\n\nErrors:\ntemp.lock',
            type: 'warning',
        });
    });

    it('surfaces the dedicated cleanup message when downloads are still active', async () => {
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/cleanup-temp-files') {
                return Promise.reject(
                    makeAxiosLikeError(409, {
                        error: 'Cannot clean up while downloads are active',
                    })
                );
            }
            return Promise.resolve({ data: {} } as any);
        });

        const { result, setInfoModal } = renderSettingsHook();

        act(() => {
            result.current.cleanupMutation.mutate();
        });

        await waitFor(() => {
            expect(getLastInfoModal(setInfoModal)).toEqual({
                isOpen: true,
                title: 'error',
                message: 'cleanupTempFilesActiveDownloads',
                type: 'error',
            });
        });
    });

    it('lists deleted and failed legacy files after a successful cleanup', async () => {
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/settings/delete-legacy') {
                return Promise.resolve({
                    data: {
                        results: {
                            deleted: ['videos.json'],
                            failed: ['settings.json'],
                        },
                    },
                } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });

        const { result, setInfoModal } = renderSettingsHook();

        await act(async () => {
            await result.current.deleteLegacyMutation.mutateAsync();
        });

        expect(getLastInfoModal(setInfoModal)).toEqual({
            isOpen: true,
            title: 'success',
            message: 'legacyDataDeleted\n\nDeleted: videos.json\nFailed: settings.json',
            type: 'success',
        });
    });

    it('truncates long filename-formatting detail lists and marks warnings when errors are present', async () => {
        const details = Array.from({ length: 12 }, (_, index) => `detail ${index + 1}`);
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/settings/format-filenames') {
                return Promise.resolve({
                    data: {
                        results: {
                            processed: 12,
                            renamed: 10,
                            errors: 2,
                            details,
                        },
                    },
                } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });

        const { result, setInfoModal } = renderSettingsHook();

        await act(async () => {
            await result.current.formatFilenamesMutation.mutateAsync();
        });

        const modal = getLastInfoModal(setInfoModal);
        expect(modal).toMatchObject({
            isOpen: true,
            title: 'success',
            type: 'warning',
        });
        expect(modal.message).toContain('Processed 12, renamed 10, errors 2');
        expect(modal.message).toContain('formatFilenamesDetails');
        expect(modal.message).toContain('detail 1');
        expect(modal.message).toContain('detail 10');
        expect(modal.message).not.toContain('detail 11');
        expect(modal.message).toContain('And 2 more');
    });

    it('downloads exported database backups with a timestamped filename', async () => {
        vi.mocked(api.get).mockImplementation((url: string, config?: any) => {
            if (url === '/settings/last-backup-info') {
                return Promise.resolve({ data: { exists: false } } as any);
            }
            if (url === '/settings/export-database' && config?.responseType === 'blob') {
                return Promise.resolve({ data: new Uint8Array([1, 2, 3]) } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });

        Object.defineProperty(window.URL, 'createObjectURL', {
            writable: true,
            value: vi.fn(() => 'blob:mock-export'),
        });
        Object.defineProperty(window.URL, 'revokeObjectURL', {
            writable: true,
            value: vi.fn(),
        });

        const appendSpy = vi.spyOn(document.body, 'appendChild');
        const clickSpy = vi
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => {});

        const { result, setMessage } = renderSettingsHook();

        await act(async () => {
            await result.current.exportDatabaseMutation.mutateAsync();
        });

        expect(window.URL.createObjectURL).toHaveBeenCalled();
        expect(clickSpy).toHaveBeenCalled();
        expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-export');

        const appendedAnchor = appendSpy.mock.calls.at(-1)?.[0] as HTMLAnchorElement;
        expect(appendedAnchor).toBeInstanceOf(HTMLAnchorElement);
        expect(appendedAnchor.getAttribute('download')).toBe(
            'mytube-backup-2026-04-04_10-00-00.db'
        );
        expect(getLastMessage(setMessage)).toEqual({
            text: 'databaseExportedSuccess',
            type: 'success',
        });
    });

    it('uploads database imports as multipart form data and reports success', async () => {
        const file = new File(['db'], 'backup.db', {
            type: 'application/octet-stream',
        });

        vi.mocked(api.post).mockImplementation((url: string, data?: any, config?: any) => {
            if (url === '/settings/import-database') {
                expect(data).toBeInstanceOf(FormData);
                expect(data.get('file')).toBe(file);
                expect(config).toMatchObject({
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
                return Promise.resolve({ data: { imported: true } } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });

        const { result, setInfoModal } = renderSettingsHook();

        await act(async () => {
            await result.current.importDatabaseMutation.mutateAsync(file);
        });

        expect(getLastInfoModal(setInfoModal)).toEqual({
            isOpen: true,
            title: 'success',
            message: 'databaseImportedSuccess',
            type: 'success',
        });
    });

    it('returns merge preview summaries from the preview endpoint', async () => {
        const file = new File(['db'], 'preview.db', {
            type: 'application/octet-stream',
        });
        const summary = {
            videos: { merged: 1, skipped: 0 },
            collections: { merged: 2, skipped: 1 },
            collectionLinks: { merged: 3, skipped: 0 },
            subscriptions: { merged: 0, skipped: 4 },
            downloadHistory: { merged: 5, skipped: 0 },
            videoDownloads: { merged: 6, skipped: 1 },
            tags: { merged: 7, skipped: 2 },
        };

        vi.mocked(api.post).mockImplementation((url: string, data?: any, config?: any) => {
            if (url === '/settings/merge-database-preview') {
                expect(data).toBeInstanceOf(FormData);
                expect(data.get('file')).toBe(file);
                expect(config).toMatchObject({
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
                return Promise.resolve({ data: { summary } } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });

        const { result } = renderSettingsHook();

        let previewResult: unknown;
        await act(async () => {
            previewResult = await result.current.previewMergeDatabaseMutation.mutateAsync(file);
        });

        expect(previewResult).toEqual(summary);
    });

    it('invalidates database queries and refetches backup info after a successful merge', async () => {
        const file = new File(['db'], 'merge.db', {
            type: 'application/octet-stream',
        });
        vi.mocked(api.post).mockImplementation((url: string, data?: any, config?: any) => {
            if (url === '/settings/merge-database') {
                expect(data).toBeInstanceOf(FormData);
                expect(data.get('file')).toBe(file);
                expect(config).toMatchObject({
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
                return Promise.resolve({ data: { merged: true } } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });

        const queryClient = createTestQueryClient();
        const { result, setInfoModal } = renderSettingsHook({ queryClient });
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        await waitFor(() => {
            expect(countApiGetCalls('/settings/last-backup-info')).toBeGreaterThan(0);
        });
        const lastBackupCallsBefore = countApiGetCalls('/settings/last-backup-info');

        await act(async () => {
            await result.current.mergeDatabaseMutation.mutateAsync(file);
        });

        await waitFor(() => {
            expect(countApiGetCalls('/settings/last-backup-info')).toBeGreaterThan(
                lastBackupCallsBefore
            );
        });

        expect(getLastInfoModal(setInfoModal)).toEqual({
            isOpen: true,
            title: 'success',
            message: 'databaseMergedSuccess',
            type: 'success',
        });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['settings'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['videos'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['collections'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['subscriptions'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['subscriptionTasks'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['downloadHistory'] });
    });

    it('uses the default cleanup-backup success message when the API does not provide one', async () => {
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/settings/cleanup-backup-databases') {
                return Promise.resolve({ data: {} } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });

        const { result, setMessage } = renderSettingsHook();

        await act(async () => {
            await result.current.cleanupBackupDatabasesMutation.mutateAsync();
        });

        expect(getLastMessage(setMessage)).toEqual({
            text: 'backupDatabasesCleanedUp',
            type: 'success',
        });
    });

    it('refetches backup info after restoring from the latest backup', async () => {
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/settings/restore-from-last-backup') {
                return Promise.resolve({ data: { restored: true } } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });

        const { result, setInfoModal } = renderSettingsHook();

        await waitFor(() => {
            expect(countApiGetCalls('/settings/last-backup-info')).toBeGreaterThan(0);
        });
        const lastBackupCallsBefore = countApiGetCalls('/settings/last-backup-info');

        await act(async () => {
            await result.current.restoreFromLastBackupMutation.mutateAsync();
        });

        await waitFor(() => {
            expect(countApiGetCalls('/settings/last-backup-info')).toBeGreaterThan(
                lastBackupCallsBefore
            );
        });

        expect(getLastInfoModal(setInfoModal)).toEqual({
            isOpen: true,
            title: 'success',
            message: 'restoreFromLastBackupSuccess',
            type: 'success',
        });
    });

    it('renames tags successfully and invalidates settings and video queries', async () => {
        vi.mocked(api.post).mockImplementation((url: string, data?: any) => {
            if (url === '/settings/tags/rename') {
                expect(data).toEqual({ oldTag: 'old', newTag: 'new' });
                return Promise.resolve({ data: {} } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });

        const queryClient = createTestQueryClient();
        const { result, setMessage } = renderSettingsHook({ queryClient });
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        await act(async () => {
            await result.current.renameTagMutation.mutateAsync({
                oldTag: 'old',
                newTag: 'new',
            });
        });

        expect(getLastMessage(setMessage)).toEqual({
            text: 'tagRenamedSuccess',
            type: 'success',
        });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['settings'] });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['videos'] });
    });

    it('reports the shared fallback message when rename errors do not contain a usable API message', async () => {
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/settings/tags/rename') {
                return Promise.reject({});
            }
            return Promise.resolve({ data: {} } as any);
        });

        const { result, setMessage } = renderSettingsHook();

        act(() => {
            result.current.renameTagMutation.mutate({
                oldTag: 'old',
                newTag: 'new',
            });
        });

        await waitFor(() => {
            expect(getLastMessage(setMessage)).toEqual({
                text: 'An unknown error occurred',
                type: 'error',
            });
        });
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
            { wrapper: createWrapper(createTestQueryClient()) }
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
            { wrapper: createWrapper(createTestQueryClient()) }
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
            { wrapper: createWrapper(createTestQueryClient()) }
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
