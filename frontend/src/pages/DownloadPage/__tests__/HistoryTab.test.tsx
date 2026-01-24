import { useMediaQuery, useTheme } from '@mui/material';
import { fireEvent, render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
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
        id: '2',
        title: 'Failed Item',
        finishedAt: 1678886400000,
        status: 'failed' as const,
        sourceUrl: 'http://example.com/2',
        error: 'Error message',
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
        id: '4',
        title: 'Deleted Item',
        finishedAt: 1678886400000,
        status: 'deleted' as const,
        sourceUrl: 'http://example.com/4',
    },
];

describe('HistoryTab Filter', () => {
    const mockOnRemove = vi.fn();
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
        expect(screen.getByText('Skipped Item')).toBeInTheDocument();
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
