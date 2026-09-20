import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExternalSearchSection from '../ExternalSearchSection';
import { VideoSearchResult } from '../../types';

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

const theme = createTheme();

const bilibiliResult: VideoSearchResult = {
    id: 'BV1',
    title: 'A Bilibili video',
    author: 'Some UP',
    thumbnailUrl: 'https://i2.hdslb.com/cover.jpg',
    duration: 754,
    viewCount: 4321,
    sourceUrl: 'https://www.bilibili.com/video/BV1',
    source: 'bilibili',
};

const renderSection = (overrides: Partial<React.ComponentProps<typeof ExternalSearchSection>> = {}) => {
    const props: React.ComponentProps<typeof ExternalSearchSection> = {
        source: 'bilibili',
        heading: 'fromBilibili',
        loadingLabel: 'loadingBilibiliResults',
        emptyLabel: 'noBilibiliResults',
        results: [bilibiliResult],
        loading: false,
        loadingMore: false,
        onLoadMore: vi.fn(),
        onDownload: vi.fn(),
        downloadingIds: new Set<string>(),
        ...overrides,
    };

    render(
        <ThemeProvider theme={theme}>
            <ExternalSearchSection {...props} />
        </ThemeProvider>
    );

    return props;
};

describe('ExternalSearchSection', () => {
    it('renders the heading and a card per result', () => {
        renderSection();

        expect(screen.getByText('fromBilibili')).toBeInTheDocument();
        expect(screen.getByText('A Bilibili video')).toBeInTheDocument();
        expect(screen.getByText('Some UP')).toBeInTheDocument();
        // 754 seconds, formatted by the shared duration helper.
        expect(screen.getByText('12:34')).toBeInTheDocument();
        expect(screen.getByText('4.3K views')).toBeInTheDocument();
    });

    it('shows the loading label instead of results while loading', () => {
        renderSection({ loading: true });

        expect(screen.getByText('loadingBilibiliResults')).toBeInTheDocument();
        expect(screen.queryByText('A Bilibili video')).not.toBeInTheDocument();
    });

    it('shows the empty label when the source returned nothing', () => {
        renderSection({ results: [] });

        expect(screen.getByText('noBilibiliResults')).toBeInTheDocument();
        expect(screen.queryByText('more')).not.toBeInTheDocument();
    });

    it('hands the whole result back on download so the caller keeps its source URL', () => {
        const props = renderSection();

        fireEvent.click(screen.getByRole('button', { name: /download/i }));

        expect(props.onDownload).toHaveBeenCalledWith(bilibiliResult);
    });

    it('blocks a second click on a result whose download is still in flight', () => {
        const props = renderSection({ downloadingIds: new Set(['BV1']) });

        const button = screen.getByRole('button', { name: /download/i });
        expect(button).toBeDisabled();

        fireEvent.click(button);
        expect(props.onDownload).not.toHaveBeenCalled();
    });

    it('leaves another result downloadable while one is in flight', () => {
        const other: VideoSearchResult = { ...bilibiliResult, id: 'BV2', title: 'Another video' };
        const props = renderSection({
            results: [bilibiliResult, other],
            downloadingIds: new Set(['BV1']),
        });

        // Queueing a second download is legitimate, so only the busy card locks.
        const buttons = screen.getAllByRole('button', { name: /download/i });
        expect(buttons[0]).toBeDisabled();
        expect(buttons[1]).toBeEnabled();

        fireEvent.click(buttons[1]);
        expect(props.onDownload).toHaveBeenCalledWith(other);
    });

    it('loads the next page on demand', () => {
        const props = renderSection();

        fireEvent.click(screen.getByRole('button', { name: /more/i }));

        expect(props.onLoadMore).toHaveBeenCalled();
    });
});
