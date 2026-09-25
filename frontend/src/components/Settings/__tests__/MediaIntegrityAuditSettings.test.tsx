import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MediaIntegrityAuditSettings from '../MediaIntegrityAuditSettings';

// t echoes the key, followed by any interpolated values, so assertions can
// check both the wording chosen and the numbers passed to it.
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, replacements?: Record<string, string | number>) =>
            replacements
                ? `${key} ${Object.entries(replacements).map(([name, value]) => `${name}=${value}`).join(' ')}`
                : key,
    }),
}));

const showSnackbarMock = vi.fn();
vi.mock('../../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({ showSnackbar: showSnackbarMock }),
}));

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
vi.mock('../../../utils/apiClient', () => ({
    api: {
        get: (...args: unknown[]) => apiGetMock(...args),
        post: (...args: unknown[]) => apiPostMock(...args),
    },
}));

const buildItem = (overrides: Record<string, unknown> = {}) => ({
    localVideoId: 'video-1',
    title: 'Truncated video',
    sourceUrl: 'https://www.youtube.com/watch?v=abc',
    videoPath: '/videos/truncated.mp4',
    reasons: ['track_disagreement'],
    detail: 'the video track is 10.0s but the audio track is 60.0s, so one of them is truncated',
    recommendedAction: 'redownload',
    ...overrides,
});

const auditResponse = (items: unknown[], summary: Record<string, unknown> = {}) => ({
    data: {
        success: true,
        audit: {
            items,
            summary: { totalVideos: 5, skippedExternal: 2, ...summary },
            humanSummary: 'English prose the UI does not show',
        },
    },
});

const createQueryClient = () =>
    new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

const renderPanel = (queryClient = createQueryClient()) =>
    render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <MediaIntegrityAuditSettings />
            </MemoryRouter>
        </QueryClientProvider>
    );

describe('MediaIntegrityAuditSettings', () => {
    beforeEach(() => {
        apiGetMock.mockReset();
        apiPostMock.mockReset();
        showSnackbarMock.mockReset();
    });

    it('runs the audit only when asked and lists each problem', async () => {
        apiGetMock.mockResolvedValue(
            auditResponse([
                buildItem(),
                buildItem({
                    localVideoId: 'video-2',
                    title: 'Stale duration',
                    detail: 'the stored duration is 50.0s but the file measures 60.0s',
                    recommendedAction: 'refresh_duration',
                }),
            ])
        );
        const user = userEvent.setup();

        renderPanel();
        expect(apiGetMock).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'mediaIntegrityAuditRun' }));

        // External rows are skipped, so they are not counted as checked.
        expect(await screen.findByText('mediaIntegrityAuditSummaryProblems checked=3 count=2')).toBeInTheDocument();
        expect(screen.queryByText('English prose the UI does not show')).not.toBeInTheDocument();
        expect(apiGetMock).toHaveBeenCalledWith('/media-integrity-audit', { timeout: 300000 });

        expect(screen.getByRole('link', { name: 'Truncated video' })).toHaveAttribute('href', '/video/video-1');
        expect(screen.getByRole('link', { name: 'Stale duration' })).toHaveAttribute('href', '/video/video-2');
        expect(screen.getByText(/one of them is truncated/)).toBeInTheDocument();
        expect(screen.getByText('mediaIntegrityAuditActionRedownload')).toBeInTheDocument();
        expect(screen.getByText('mediaIntegrityAuditActionRefreshDuration')).toBeInTheDocument();
        // Only the item that needs a re-download offers one.
        expect(screen.getAllByRole('button', { name: 'downloadAgain' })).toHaveLength(1);
    });

    it('requests the mid-file gap check when opted in', async () => {
        apiGetMock.mockResolvedValue(auditResponse([], { timelineChecked: true, timelineIncomplete: 0 }));
        const user = userEvent.setup();

        renderPanel();
        await user.click(screen.getByRole('checkbox', { name: 'mediaIntegrityAuditCheckTimeline' }));
        await user.click(screen.getByRole('button', { name: 'mediaIntegrityAuditRun' }));

        expect(await screen.findByText('mediaIntegrityAuditSummaryClean checked=3')).toBeInTheDocument();
        expect(apiGetMock).toHaveBeenCalledWith('/media-integrity-audit?timeline=1', { timeout: 300000 });
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
        expect(screen.queryByText('mediaIntegrityAuditTimelineNotChecked')).not.toBeInTheDocument();
        expect(screen.queryByText(/mediaIntegrityAuditTimelineIncomplete/)).not.toBeInTheDocument();
    });

    it('says when the mid-file check did not run, so a clean result is not over-read', async () => {
        // A backend without the mid-file check sends no timeline fields at all.
        apiGetMock.mockResolvedValue(auditResponse([]));
        const user = userEvent.setup();

        renderPanel();
        await user.click(screen.getByRole('button', { name: 'mediaIntegrityAuditRun' }));

        expect(await screen.findByText('mediaIntegrityAuditSummaryClean checked=3')).toBeInTheDocument();
        expect(screen.getByText('mediaIntegrityAuditTimelineNotChecked')).toBeInTheDocument();
    });

    it('warns when the mid-file check could not finish for some files', async () => {
        apiGetMock.mockResolvedValue(auditResponse([], { timelineChecked: true, timelineIncomplete: 2 }));
        const user = userEvent.setup();

        renderPanel();
        await user.click(screen.getByRole('checkbox', { name: 'mediaIntegrityAuditCheckTimeline' }));
        await user.click(screen.getByRole('button', { name: 'mediaIntegrityAuditRun' }));

        expect(await screen.findByText('mediaIntegrityAuditTimelineIncomplete count=2')).toBeInTheDocument();
    });

    it('shows a pending state and locks the options while the audit runs', async () => {
        let resolveAudit: (value: unknown) => void = () => undefined;
        apiGetMock.mockReturnValue(new Promise((resolve) => { resolveAudit = resolve; }));
        const user = userEvent.setup();

        renderPanel();
        await user.click(screen.getByRole('button', { name: 'mediaIntegrityAuditRun' }));

        expect(await screen.findByText('mediaIntegrityAuditRunning')).toBeInTheDocument();
        expect(within(screen.getByRole('alert')).getByRole('progressbar')).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'mediaIntegrityAuditCheckTimeline' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'mediaIntegrityAuditRun' })).toBeDisabled();

        resolveAudit(auditResponse([buildItem()]));

        expect(await screen.findByRole('link', { name: 'Truncated video' })).toBeInTheDocument();
        expect(screen.queryByText('mediaIntegrityAuditRunning')).not.toBeInTheDocument();
    });

    it('re-downloads through the same call the manage page uses', async () => {
        apiGetMock.mockResolvedValue(auditResponse([buildItem()]));
        apiPostMock.mockResolvedValue({ data: { downloadId: 'dl-1' } });
        const user = userEvent.setup();

        renderPanel();
        await user.click(screen.getByRole('button', { name: 'mediaIntegrityAuditRun' }));
        await user.click(await screen.findByRole('button', { name: 'downloadAgain' }));

        await waitFor(() =>
            expect(apiPostMock).toHaveBeenCalledWith('/download', {
                youtubeUrl: 'https://www.youtube.com/watch?v=abc',
                forceDownload: true,
            })
        );
        expect(showSnackbarMock).toHaveBeenCalledWith('videoDownloading');
    });

    it('explains why a missing file without a source URL cannot be re-downloaded', async () => {
        apiGetMock.mockResolvedValue(
            auditResponse([buildItem({ sourceUrl: null, reasons: ['file_missing'] })])
        );
        const user = userEvent.setup();

        renderPanel();
        await user.click(screen.getByRole('button', { name: 'mediaIntegrityAuditRun' }));

        expect(await screen.findByText('noSourceUrlAvailable')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'downloadAgain' })).not.toBeInTheDocument();
    });

    it.each([
        ['the browser timeout', { isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 300000ms exceeded' }],
        ['a proxy 504', { response: { status: 504, data: '<html>504 Gateway Time-out</html>' } }],
    ])('treats %s as a timeout, without retrying', async (_label, rejection) => {
        apiGetMock.mockRejectedValue(rejection);
        const user = userEvent.setup();

        renderPanel();
        await user.click(screen.getByRole('button', { name: 'mediaIntegrityAuditRun' }));

        expect(await screen.findByText('mediaIntegrityAuditTimeout')).toBeInTheDocument();
        expect(apiGetMock).toHaveBeenCalledTimes(1);
        // The retry path stays open.
        expect(screen.getByRole('button', { name: 'mediaIntegrityAuditRun' })).toBeEnabled();
    });

    it('shows the server error for other failures', async () => {
        apiGetMock.mockRejectedValue({ response: { status: 500, data: { error: 'Failed to read videos' } } });
        const user = userEvent.setup();

        renderPanel();
        await user.click(screen.getByRole('button', { name: 'mediaIntegrityAuditRun' }));

        expect(await screen.findByText('Failed to read videos')).toBeInTheDocument();
        expect(screen.queryByText('mediaIntegrityAuditTimeout')).not.toBeInTheDocument();
    });

    it('keeps the result when the section is left and reopened', async () => {
        apiGetMock.mockResolvedValue(auditResponse([buildItem()]));
        const user = userEvent.setup();
        const queryClient = createQueryClient();

        const { unmount } = renderPanel(queryClient);
        await user.click(screen.getByRole('button', { name: 'mediaIntegrityAuditRun' }));
        await screen.findByRole('link', { name: 'Truncated video' });
        unmount();

        renderPanel(queryClient);

        expect(screen.getByRole('link', { name: 'Truncated video' })).toBeInTheDocument();
        expect(apiGetMock).toHaveBeenCalledTimes(1);
    });
});
