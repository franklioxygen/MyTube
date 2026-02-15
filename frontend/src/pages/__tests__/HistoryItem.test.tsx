import { ThemeProvider, createTheme } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadHistoryItem, HistoryItem } from '../DownloadPage/HistoryItem';

// Mock useLanguage
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

const theme = createTheme({ palette: { mode: 'dark' } });

const defaultProps = {
    onRemove: vi.fn(),
    onRetry: vi.fn(),
    onReDownload: vi.fn(),
    onViewVideo: vi.fn(),
    isDownloadInProgress: vi.fn(() => false),
};

const baseItem: DownloadHistoryItem = {
    id: 'item-1',
    title: 'Test Video',
    sourceUrl: 'https://youtube.com/watch?v=abc123',
    finishedAt: 1700000000000,
    status: 'success',
    videoId: 'vid-1',
};

const renderHistoryItem = (item: Partial<DownloadHistoryItem> = {}, props: Partial<typeof defaultProps> = {}) => {
    return render(
        <ThemeProvider theme={theme}>
            <MemoryRouter>
                <HistoryItem
                    item={{ ...baseItem, ...item }}
                    {...defaultProps}
                    {...props}
                />
            </MemoryRouter>
        </ThemeProvider>
    );
};

describe('HistoryItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // --- Status chip rendering ---
    describe('status chips', () => {
        it('shows success chip for successful downloads', () => {
            renderHistoryItem({ status: 'success' });
            expect(screen.getByText('success')).toBeInTheDocument();
        });

        it('shows failed chip for failed downloads', () => {
            renderHistoryItem({ status: 'failed' });
            expect(screen.getByText('failed')).toBeInTheDocument();
        });

        it('shows skipped chip for skipped downloads', () => {
            renderHistoryItem({ status: 'skipped' });
            expect(screen.getByText('skipped')).toBeInTheDocument();
        });

        it('shows previously deleted chip for deleted downloads', () => {
            renderHistoryItem({ status: 'deleted' });
            expect(screen.getByText('previouslyDeleted')).toBeInTheDocument();
        });
    });

    // --- Title and source URL ---
    describe('title and source URL', () => {
        it('displays video title', () => {
            renderHistoryItem({ title: 'My Test Video' });
            expect(screen.getByText('My Test Video')).toBeInTheDocument();
        });

        it('displays source URL as link', () => {
            renderHistoryItem({ sourceUrl: 'https://youtube.com/watch?v=test' });
            const link = screen.getByText('https://youtube.com/watch?v=test');
            expect(link).toBeInTheDocument();
            expect(link).toHaveAttribute('href', 'https://youtube.com/watch?v=test');
            expect(link).toHaveAttribute('target', '_blank');
        });

        it('does not show source URL when not provided', () => {
            renderHistoryItem({ sourceUrl: undefined });
            expect(screen.queryByRole('link', { name: /http/ })).not.toBeInTheDocument();
        });
    });

    // --- Date display ---
    describe('date display', () => {
        it('shows finishedAt for non-deleted items', () => {
            const date = new Date(1700000000000).toLocaleString();
            renderHistoryItem({ status: 'success', finishedAt: 1700000000000 });
            expect(screen.getByText(date)).toBeInTheDocument();
        });

        it('shows downloadedAt and deletedAt for deleted items', () => {
            const downloadDate = new Date(1699000000000).toLocaleString();
            const deleteDate = new Date(1700000000000).toLocaleString();
            renderHistoryItem({
                status: 'deleted',
                downloadedAt: 1699000000000,
                deletedAt: 1700000000000,
            });
            expect(screen.getByText(new RegExp(downloadDate))).toBeInTheDocument();
            expect(screen.getByText(new RegExp(deleteDate))).toBeInTheDocument();
        });

        it('shows downloadedOn label for deleted items with downloadedAt', () => {
            renderHistoryItem({
                status: 'deleted',
                downloadedAt: 1699000000000,
            });
            expect(screen.getByText(/downloadedOn/)).toBeInTheDocument();
        });

        it('shows deletedOn label for deleted items with deletedAt', () => {
            renderHistoryItem({
                status: 'deleted',
                deletedAt: 1700000000000,
            });
            expect(screen.getByText(/deletedOn/)).toBeInTheDocument();
        });
    });

    // --- Subscription/Task badges ---
    describe('subscription and task badges', () => {
        it('shows subscription badge when subscriptionId is present', () => {
            renderHistoryItem({ subscriptionId: 'sub-1' });
            expect(screen.getByText(/viaSubscription/)).toBeInTheDocument();
        });

        it('shows task badge when taskId is present', () => {
            renderHistoryItem({ taskId: 'task-1' });
            expect(screen.getByText(/viaContinuousDownload/)).toBeInTheDocument();
        });

        it('shows both badges when both are present', () => {
            renderHistoryItem({ subscriptionId: 'sub-1', taskId: 'task-1' });
            expect(screen.getByText(/viaSubscription/)).toBeInTheDocument();
            expect(screen.getByText(/viaContinuousDownload/)).toBeInTheDocument();
        });

        it('does not show badges when neither is present', () => {
            renderHistoryItem({ subscriptionId: undefined, taskId: undefined });
            expect(screen.queryByText(/viaSubscription/)).not.toBeInTheDocument();
            expect(screen.queryByText(/viaContinuousDownload/)).not.toBeInTheDocument();
        });
    });

    // --- Error message ---
    describe('error message', () => {
        it('shows error message when present', () => {
            renderHistoryItem({ status: 'failed', error: 'Download failed: 404' });
            expect(screen.getByText('Download failed: 404')).toBeInTheDocument();
        });

        it('does not show error when not present', () => {
            renderHistoryItem({ status: 'success', error: undefined });
            expect(screen.queryByText(/Download failed/)).not.toBeInTheDocument();
        });
    });

    // --- Action buttons ---
    describe('action buttons', () => {
        it('shows remove button for all items', () => {
            renderHistoryItem();
            expect(screen.getByLabelText('remove')).toBeInTheDocument();
        });

        it('calls onRemove with item id when remove is clicked', () => {
            renderHistoryItem({ id: 'item-42' });
            fireEvent.click(screen.getByLabelText('remove'));
            expect(defaultProps.onRemove).toHaveBeenCalledWith('item-42');
        });

        it('shows retry button for failed items with sourceUrl', () => {
            renderHistoryItem({ status: 'failed', sourceUrl: 'https://example.com' });
            expect(screen.getByText('retry')).toBeInTheDocument();
        });

        it('calls onRetry with sourceUrl when retry is clicked', () => {
            renderHistoryItem({ status: 'failed', sourceUrl: 'https://example.com/video' });
            fireEvent.click(screen.getByText('retry'));
            expect(defaultProps.onRetry).toHaveBeenCalledWith('https://example.com/video');
        });

        it('does not show retry button for non-failed items', () => {
            renderHistoryItem({ status: 'success' });
            expect(screen.queryByText('retry')).not.toBeInTheDocument();
        });

        it('shows view video button for successful items with videoId', () => {
            renderHistoryItem({ status: 'success', videoId: 'vid-1' });
            expect(screen.getByText('viewVideo')).toBeInTheDocument();
        });

        it('calls onViewVideo when view video is clicked (success)', () => {
            renderHistoryItem({ status: 'success', videoId: 'vid-99' });
            fireEvent.click(screen.getByText('viewVideo'));
            expect(defaultProps.onViewVideo).toHaveBeenCalledWith('vid-99');
        });

        it('shows view video button for skipped items with videoId', () => {
            renderHistoryItem({ status: 'skipped', videoId: 'vid-1' });
            expect(screen.getByText('viewVideo')).toBeInTheDocument();
        });

        it('calls onViewVideo when view video is clicked (skipped)', () => {
            renderHistoryItem({ status: 'skipped', videoId: 'vid-50' });
            fireEvent.click(screen.getByText('viewVideo'));
            expect(defaultProps.onViewVideo).toHaveBeenCalledWith('vid-50');
        });

        it('shows download again button for deleted items with sourceUrl', () => {
            renderHistoryItem({ status: 'deleted', sourceUrl: 'https://example.com' });
            expect(screen.getByText('downloadAgain')).toBeInTheDocument();
        });

        it('calls onReDownload when download again is clicked', () => {
            renderHistoryItem({ status: 'deleted', sourceUrl: 'https://example.com/vid' });
            fireEvent.click(screen.getByText('downloadAgain'));
            expect(defaultProps.onReDownload).toHaveBeenCalledWith('https://example.com/vid');
        });

        it('does not show view video for items without videoId', () => {
            renderHistoryItem({ status: 'success', videoId: undefined });
            expect(screen.queryByText('viewVideo')).not.toBeInTheDocument();
        });
    });

    // --- Disabled state ---
    describe('disabled state when download in progress', () => {
        it('disables retry button when download is in progress', () => {
            const isDownloadInProgress = vi.fn(() => true);
            renderHistoryItem(
                { status: 'failed', sourceUrl: 'https://example.com' },
                { isDownloadInProgress }
            );
            expect(screen.getByText('retry').closest('button')).toBeDisabled();
        });

        it('disables download again button when download is in progress', () => {
            const isDownloadInProgress = vi.fn(() => true);
            renderHistoryItem(
                { status: 'deleted', sourceUrl: 'https://example.com' },
                { isDownloadInProgress }
            );
            expect(screen.getByText('downloadAgain').closest('button')).toBeDisabled();
        });

        it('enables retry button when download is not in progress', () => {
            renderHistoryItem({ status: 'failed', sourceUrl: 'https://example.com' });
            expect(screen.getByText('retry').closest('button')).not.toBeDisabled();
        });
    });

    // --- Settings link for deleted videos ---
    describe('settings link for deleted videos', () => {
        it('shows change settings link when status is deleted and dontSkipDeletedVideo is false', () => {
            renderHistoryItem({ status: 'deleted' });
            expect(screen.getByText('changeSettings')).toBeInTheDocument();
        });

        it('hides change settings link when dontSkipDeletedVideo is true', () => {
            render(
                <ThemeProvider theme={theme}>
                    <MemoryRouter>
                        <HistoryItem
                            item={{ ...baseItem, status: 'deleted' }}
                            {...defaultProps}
                            dontSkipDeletedVideo={true}
                        />
                    </MemoryRouter>
                </ThemeProvider>
            );
            expect(screen.queryByText('changeSettings')).not.toBeInTheDocument();
        });

        it('does not show change settings link for non-deleted items', () => {
            renderHistoryItem({ status: 'success' });
            expect(screen.queryByText('changeSettings')).not.toBeInTheDocument();
        });

        it('settings link points to correct URL', () => {
            renderHistoryItem({ status: 'deleted' });
            const link = screen.getByText('changeSettings');
            expect(link.closest('a')).toHaveAttribute('href', '/settings?tab=4#dontSkipDeletedVideo-setting');
        });
    });
});
