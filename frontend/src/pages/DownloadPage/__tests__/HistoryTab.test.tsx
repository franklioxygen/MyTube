import { useMediaQuery, useTheme } from '@mui/material';
import { fireEvent, render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useSettings } from '../../../hooks/useSettings';
import { HistoryTab } from '../HistoryTab';

// Mock dependencies
vi.mock('../../../contexts/LanguageContext');
vi.mock('../../../hooks/useSettings');
vi.mock('@mui/material', async () => {
    const actual = await vi.importActual('@mui/material');
    return {
        ...actual,
        useTheme: vi.fn(),
        useMediaQuery: vi.fn(),
    };
});

const mockHistoryItems = [
    {
        id: '1',
        title: 'Success Item',
        finishedAt: 1678886400000,
        status: 'success' as const,
        sourceUrl: 'http://example.com/1',
    },
    {
        // Saved to the library, but yt-dlp left part of it out.
        id: '1b',
        title: 'Incomplete Save Item',
        finishedAt: 1678886400000,
        status: 'success' as const,
        sourceUrl: 'http://example.com/1b',
        videoId: 'vid-gap',
        // What the backend stores: data, worded here in the viewer's language.
        error: JSON.stringify({
            kind: 'incomplete_download',
            skippedFragments: 1,
            gaps: [{ stream: 'video', atSeconds: 1127.92, gapSeconds: 4.03 }],
        }),
    },
    {
        id: '2',
        title: 'Failed Item',
        finishedAt: 1678886400000,
        status: 'failed' as const,
        sourceUrl: 'http://example.com/2',
        error: 'Error message',
    },
    {
        id: '2b',
        title: 'Partial Item',
        finishedAt: 1678886400000,
        status: 'partial' as const,
        sourceUrl: 'http://example.com/2b',
    },
    {
        id: '3',
        title: 'Skipped Item',
        finishedAt: 1678886400000,
        status: 'skipped' as const,
        sourceUrl: 'http://example.com/3',
        videoId: 'vid-123',
    },
    {
        id: '3b',
        title: 'Pending Retry Item',
        finishedAt: 1678886400000,
        status: 'pending_retry' as const,
        sourceUrl: 'http://example.com/3b',
    },
    {
        id: '4',
        title: 'Deleted Item',
        finishedAt: 1678886400000,
        status: 'deleted' as const,
        sourceUrl: 'http://example.com/4',
    },
];

describe('HistoryTab Filter', () => {
    const mockOnRemove = vi.fn();
    const mockOnCancelRetry = vi.fn();
    const mockOnClear = vi.fn();
    const mockOnRetry = vi.fn();
    const mockOnReDownload = vi.fn();
    const mockOnViewVideo = vi.fn();
    const mockIsDownloadInProgress = vi.fn();

    beforeEach(() => {
        (useLanguage as Mock).mockReturnValue({ t: (key: string) => key });
        (useSettings as Mock).mockReturnValue({ data: {} });
        (useTheme as Mock).mockReturnValue({ breakpoints: { down: vi.fn() } });
        (useMediaQuery as Mock).mockReturnValue(false);
    });

    const renderComponent = () => {
        return render(
            <BrowserRouter>
                <HistoryTab
                    history={mockHistoryItems}
                    onRemove={mockOnRemove}
                    onCancelRetry={mockOnCancelRetry}
                    onClear={mockOnClear}
                    onRetry={mockOnRetry}
                    onReDownload={mockOnReDownload}
                    onViewVideo={mockOnViewVideo}
                    isDownloadInProgress={mockIsDownloadInProgress}
                />
            </BrowserRouter>
        );
    };

    it('shows all items by default', () => {
        renderComponent();
        expect(screen.getByText('Success Item')).toBeInTheDocument();
        expect(screen.getByText('Failed Item')).toBeInTheDocument();
        expect(screen.getByText('Partial Item')).toBeInTheDocument();
        expect(screen.getByText('Skipped Item')).toBeInTheDocument();
        expect(screen.getByText('Pending Retry Item')).toBeInTheDocument();
        expect(screen.getByText('Deleted Item')).toBeInTheDocument();
    });

    it('filters success items', () => {
        renderComponent();

        const filterSelect = screen.getByRole('combobox');
        fireEvent.mouseDown(filterSelect);

        // Use getAllByText and pick the last one (usually the menu item) or scope it
        const options = screen.getAllByText('success');
        fireEvent.click(options[options.length - 1]);

        expect(screen.getByText('Success Item')).toBeInTheDocument();
        expect(screen.queryByText('Incomplete Save Item')).not.toBeInTheDocument();
        expect(screen.queryByText('Failed Item')).not.toBeInTheDocument();
        expect(screen.queryByText('Skipped Item')).not.toBeInTheDocument();
        expect(screen.queryByText('Deleted Item')).not.toBeInTheDocument();
    });

    it('filters failed items', () => {
        renderComponent();

        const filterSelect = screen.getByRole('combobox');
        fireEvent.mouseDown(filterSelect);

        const options = screen.getAllByText('failed');
        fireEvent.click(options[options.length - 1]);

        expect(screen.queryByText('Success Item')).not.toBeInTheDocument();
        expect(screen.getByText('Failed Item')).toBeInTheDocument();
        expect(screen.queryByText('Partial Item')).not.toBeInTheDocument();
        expect(screen.queryByText('Skipped Item')).not.toBeInTheDocument();
        expect(screen.queryByText('Deleted Item')).not.toBeInTheDocument();
    });

    it('filters partial items', () => {
        renderComponent();

        const filterSelect = screen.getByRole('combobox');
        fireEvent.mouseDown(filterSelect);

        const options = screen.getAllByText('partialDownload');
        fireEvent.click(options[options.length - 1]);

        expect(screen.queryByText('Success Item')).not.toBeInTheDocument();
        expect(screen.queryByText('Failed Item')).not.toBeInTheDocument();
        expect(screen.getByText('Partial Item')).toBeInTheDocument();
        expect(screen.getByText('Incomplete Save Item')).toBeInTheDocument();
        expect(screen.queryByText('Skipped Item')).not.toBeInTheDocument();
        expect(screen.queryByText('Deleted Item')).not.toBeInTheDocument();
    });

    it('filters skipped items', () => {
        renderComponent();

        const filterSelect = screen.getByRole('combobox');
        fireEvent.mouseDown(filterSelect);

        const options = screen.getAllByText('skipped');
        fireEvent.click(options[options.length - 1]);

        expect(screen.queryByText('Success Item')).not.toBeInTheDocument();
        expect(screen.queryByText('Failed Item')).not.toBeInTheDocument();
        expect(screen.getByText('Skipped Item')).toBeInTheDocument();
        expect(screen.queryByText('Deleted Item')).not.toBeInTheDocument();
    });

    it('filters pending retry items', () => {
        renderComponent();

        const filterSelect = screen.getByRole('combobox');
        fireEvent.mouseDown(filterSelect);

        const options = screen.getAllByText('pendingRetry');
        fireEvent.click(options[options.length - 1]);

        expect(screen.queryByText('Success Item')).not.toBeInTheDocument();
        expect(screen.queryByText('Failed Item')).not.toBeInTheDocument();
        expect(screen.queryByText('Partial Item')).not.toBeInTheDocument();
        expect(screen.queryByText('Skipped Item')).not.toBeInTheDocument();
        expect(screen.getByText('Pending Retry Item')).toBeInTheDocument();
        expect(screen.queryByText('Deleted Item')).not.toBeInTheDocument();
    });

    it('filters deleted items', () => {
        renderComponent();

        const filterSelect = screen.getByRole('combobox');
        fireEvent.mouseDown(filterSelect);

        const options = screen.getAllByText('previouslyDeleted');
        fireEvent.click(options[options.length - 1]);

        expect(screen.queryByText('Success Item')).not.toBeInTheDocument();
        expect(screen.queryByText('Failed Item')).not.toBeInTheDocument();
        expect(screen.queryByText('Skipped Item')).not.toBeInTheDocument();
        expect(screen.getByText('Deleted Item')).toBeInTheDocument();
    });

    it('shows no history message when filter matches nothing', () => {
        render(
            <BrowserRouter>
                <HistoryTab
                    history={[mockHistoryItems[0]]} // Only success
                    onRemove={mockOnRemove}
                    onCancelRetry={mockOnCancelRetry}
                    onClear={mockOnClear}
                    onRetry={mockOnRetry}
                    onReDownload={mockOnReDownload}
                    onViewVideo={mockOnViewVideo}
                    isDownloadInProgress={mockIsDownloadInProgress}
                />
            </BrowserRouter>
        );

        const filterSelect = screen.getByRole('combobox');
        fireEvent.mouseDown(filterSelect);

        const option = screen.getByText('failed');
        fireEvent.click(option);

        expect(screen.getByText('noDownloadHistory')).toBeInTheDocument();
    });
});

describe('HistoryTab incomplete save', () => {
    const onReDownload = vi.fn();
    const onRetry = vi.fn();
    const onViewVideo = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // Show the interpolated values so the test can see what reaches t().
        (useLanguage as Mock).mockReturnValue({
            language: 'en',
            t: (key: string, params?: Record<string, string | number>) =>
                params ? `${key} ${JSON.stringify(params)}` : key,
        });
        (useSettings as Mock).mockReturnValue({ data: {} });
        (useTheme as Mock).mockReturnValue({ breakpoints: { down: vi.fn() } });
        (useMediaQuery as Mock).mockReturnValue(false);
    });

    const renderIncompleteSave = () => render(
        <BrowserRouter>
            <HistoryTab
                history={[mockHistoryItems[1]]}
                onRemove={vi.fn()}
                onCancelRetry={vi.fn()}
                onClear={vi.fn()}
                onRetry={onRetry}
                onReDownload={onReDownload}
                onViewVideo={onViewVideo}
                isDownloadInProgress={() => false}
            />
        </BrowserRouter>
    );

    it('is shown as incomplete, with what is missing, in the viewer\'s language', () => {
        renderIncompleteSave();

        expect(screen.getByText('partialDownload')).toBeInTheDocument();
        expect(screen.queryByText('success')).not.toBeInTheDocument();
        expect(screen.getByText(
            'incompleteDownloadVideoGap {"seconds":"4.0","positions":"18:47"}',
        )).toBeInTheDocument();
        expect(screen.getByText('incompleteDownloadFragments {"count":1}')).toBeInTheDocument();
        // The stored JSON itself is never shown.
        expect(screen.queryByText(/incomplete_download/)).not.toBeInTheDocument();
    });

    it('does not show the stored note as raw JSON after deletion', () => {
        render(
            <BrowserRouter>
                <HistoryTab
                    history={[{ ...mockHistoryItems[1], status: 'deleted' }]}
                    onRemove={vi.fn()}
                    onCancelRetry={vi.fn()}
                    onClear={vi.fn()}
                    onRetry={onRetry}
                    onReDownload={onReDownload}
                    onViewVideo={onViewVideo}
                    isDownloadInProgress={() => false}
                />
            </BrowserRouter>,
        );

        expect(screen.getByText('previouslyDeleted')).toBeInTheDocument();
        expect(screen.queryByText(/incomplete_download/)).not.toBeInTheDocument();
        expect(screen.queryByText('partialDownload')).not.toBeInTheDocument();
    });

    it('formats seconds for the viewer\'s locale', () => {
        (useLanguage as Mock).mockReturnValue({
            language: 'de',
            t: (key: string, params?: Record<string, string | number>) =>
                params ? `${key} ${JSON.stringify(params)}` : key,
        });
        renderIncompleteSave();

        expect(screen.getByText(/"seconds":"4,0"/)).toBeInTheDocument();
    });

    it('can still be watched', () => {
        renderIncompleteSave();

        fireEvent.click(screen.getByText('viewVideo'));

        expect(onViewVideo).toHaveBeenCalledWith('vid-gap');
    });

    it('offers a re-download that replaces the copy, not a retry that would be skipped', () => {
        // A plain retry resubmits the URL, which is skipped because the video
        // already exists; only a forced re-download replaces it.
        renderIncompleteSave();

        expect(screen.queryByText('retry')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('downloadAgain'));

        expect(onReDownload).toHaveBeenCalledWith('http://example.com/1b');
        expect(onRetry).not.toHaveBeenCalled();
    });
});
