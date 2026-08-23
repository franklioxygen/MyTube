import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import YtDlpVersionSettings from '../YtDlpVersionSettings';

// t echoes the key, with {placeholders} substituted, so assertions can match
// on the key plus the interpolated value.
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, replacements?: Record<string, string | number>) => {
            if (!replacements) return key;
            return Object.entries(replacements).reduce(
                (text, [name, value]) => text.replace(`{${name}}`, String(value)),
                key
            );
        },
    }),
}));

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
vi.mock('../../../utils/apiClient', () => ({
    api: {
        get: (...args: unknown[]) => apiGetMock(...args),
        post: (...args: unknown[]) => apiPostMock(...args),
    },
}));

const buildStatus = (overrides: Record<string, unknown> = {}) => ({
    version: '2026.08.19',
    path: '/usr/local/bin/yt-dlp',
    available: true,
    isStale: false,
    staleAfterDays: 90,
    latestVersion: '2026.8.19',
    updateAvailable: false,
    updateSupported: true,
    customPathConfigured: false,
    ...overrides,
});

// Real QueryClient with retries off so failures surface on the first attempt.
const renderPanel = (props: { canUpdate?: boolean } = {}) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <YtDlpVersionSettings {...props} />
        </QueryClientProvider>
    );
};

describe('YtDlpVersionSettings', () => {
    beforeEach(() => {
        apiGetMock.mockReset();
        apiPostMock.mockReset();
    });

    it('shows the installed version and an up-to-date chip', async () => {
        apiGetMock.mockResolvedValue({ data: { data: buildStatus() } });

        renderPanel();

        expect(await screen.findByText('2026.08.19')).toBeInTheDocument();
        expect(screen.getByText('ytDlpUpToDate')).toBeInTheDocument();
        expect(apiGetMock).toHaveBeenCalledWith('/settings/ytdlp/version');
    });

    it('flags an available update with the latest version', async () => {
        apiGetMock.mockResolvedValue({
            data: {
                data: buildStatus({
                    version: '2026.06.09',
                    latestVersion: '2026.8.19',
                    updateAvailable: true,
                }),
            },
        });

        renderPanel();

        expect(
            await screen.findByText('ytDlpUpdateAvailable')
        ).toBeInTheDocument();
    });

    it('reports the new version after a successful update', async () => {
        apiGetMock.mockResolvedValue({
            data: { data: buildStatus({ version: '2026.06.09', updateAvailable: true }) },
        });
        apiPostMock.mockResolvedValue({
            data: {
                data: {
                    previousVersion: '2026.06.09',
                    changed: true,
                    status: buildStatus(),
                },
            },
        });
        const user = userEvent.setup();

        renderPanel();
        await screen.findByText('2026.06.09');
        await user.click(screen.getByRole('button', { name: /ytDlpUpdate$/ }));

        await waitFor(() => {
            expect(screen.getByText('ytDlpUpdateSuccess')).toBeInTheDocument();
        });
        expect(apiPostMock).toHaveBeenCalledWith(
            '/settings/ytdlp/update',
            {},
            expect.objectContaining({ timeout: expect.any(Number) })
        );
    });

    it('surfaces the backend error when the update fails', async () => {
        apiGetMock.mockResolvedValue({ data: { data: buildStatus() } });
        apiPostMock.mockRejectedValue({
            response: { data: { error: 'pip is unavailable' } },
        });
        const user = userEvent.setup();

        renderPanel();
        await screen.findByText('2026.08.19');
        await user.click(screen.getByRole('button', { name: /ytDlpUpdate$/ }));

        expect(await screen.findByText('pip is unavailable')).toBeInTheDocument();
    });

    it('disables updating and explains why when YT_DLP_PATH pins a binary', async () => {
        apiGetMock.mockResolvedValue({
            data: {
                data: buildStatus({ updateSupported: false, customPathConfigured: true }),
            },
        });

        renderPanel();

        expect(
            await screen.findByText('ytDlpUpdateCustomPathNotice')
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /ytDlpUpdate$/ })).toBeDisabled();
    });

    it('explains that application trust mode blocks the update', async () => {
        apiGetMock.mockResolvedValue({ data: { data: buildStatus() } });

        renderPanel({ canUpdate: false });

        expect(
            await screen.findByText('ytDlpUpdatePolicyNotice')
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /ytDlpUpdate$/ })).toBeDisabled();
    });

    it('shows an error when the version probe request fails', async () => {
        apiGetMock.mockRejectedValue(new Error('network down'));

        renderPanel();

        expect(
            await screen.findByText('ytDlpVersionCheckFailed')
        ).toBeInTheDocument();
    });
});
