import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SearchResults from '../SearchResults';

// Mock useLanguage
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

// Mock useVideo with mutable defaults
const mockUseVideoReturn = {
    searchResults: [] as any[],
    localSearchResults: [] as any[],
    searchTerm: '',
    loading: false,
    youtubeLoading: false,
    deleteVideo: vi.fn(),
    resetSearch: vi.fn(),
    setIsSearchMode: vi.fn(),
    showYoutubeSearch: true,
    loadMoreSearchResults: vi.fn(),
    loadingMore: false,
};

vi.mock('../../contexts/VideoContext', () => ({
    useVideo: () => mockUseVideoReturn,
}));

// Mock useCollection
vi.mock('../../contexts/CollectionContext', () => ({
    useCollection: () => ({ collections: [{ id: 'c1', name: 'Favorites' }] }),
}));

// Mock useDownload
const mockHandleVideoSubmit = vi.fn().mockResolvedValue(undefined);
vi.mock('../../contexts/DownloadContext', () => ({
    useDownload: () => ({ handleVideoSubmit: mockHandleVideoSubmit }),
}));

// Mock VideoCard as a simple stub
vi.mock('../../components/VideoCard', () => ({
    default: ({ video }: { video: any }) => (
        <div data-testid={`video-card-${video.id}`}>{video.title}</div>
    ),
}));

// Mock formatDuration
vi.mock('../../utils/formatUtils', () => ({
    formatDuration: (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
}));

describe('SearchResults Page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset to defaults
        mockUseVideoReturn.searchResults = [];
        mockUseVideoReturn.localSearchResults = [];
        mockUseVideoReturn.searchTerm = '';
        mockUseVideoReturn.loading = false;
        mockUseVideoReturn.youtubeLoading = false;
        mockUseVideoReturn.showYoutubeSearch = true;
        mockUseVideoReturn.loadingMore = false;
    });

    const renderSearchResults = () => {
        const theme = createTheme();
        return render(
            <ThemeProvider theme={theme}>
                <SearchResults />
            </ThemeProvider>
        );
    };

    // --- 1. Returns null when searchTerm is empty ---
    it('returns null when searchTerm is empty', () => {
        mockUseVideoReturn.searchTerm = '';
        const { container } = renderSearchResults();
        expect(container.innerHTML).toBe('');
    });

    // --- 2. Returns null when searchTerm is whitespace only ---
    it('returns null when searchTerm is whitespace only', () => {
        mockUseVideoReturn.searchTerm = '   ';
        const { container } = renderSearchResults();
        expect(container.innerHTML).toBe('');
    });

    // --- 3. Shows loading spinner when loading=true ---
    it('shows loading spinner when loading is true', () => {
        mockUseVideoReturn.searchTerm = 'test query';
        mockUseVideoReturn.loading = true;
        renderSearchResults();

        expect(screen.getByRole('progressbar')).toBeInTheDocument();
        expect(screen.getByText('Searching for "test query"...')).toBeInTheDocument();
    });

    // --- 4. Shows "no results" alert when no local and no YouTube results ---
    it('shows no results alert when there are no local and no YouTube results', () => {
        mockUseVideoReturn.searchTerm = 'nonexistent';
        mockUseVideoReturn.searchResults = [];
        mockUseVideoReturn.localSearchResults = [];
        mockUseVideoReturn.youtubeLoading = false;
        renderSearchResults();

        expect(screen.getByText('Search Results for "nonexistent"')).toBeInTheDocument();
        expect(screen.getByText('No results found. Try a different search term.')).toBeInTheDocument();
    });

    // --- 5. Shows "From Your Library" section with local results ---
    it('shows "From Your Library" section with local results', () => {
        mockUseVideoReturn.searchTerm = 'my video';
        mockUseVideoReturn.localSearchResults = [
            { id: 'local1', title: 'Local Video 1' },
            { id: 'local2', title: 'Local Video 2' },
        ];
        renderSearchResults();

        expect(screen.getByText('From Your Library')).toBeInTheDocument();
        expect(screen.getByTestId('video-card-local1')).toBeInTheDocument();
        expect(screen.getByTestId('video-card-local2')).toBeInTheDocument();
    });

    // --- 6. Shows "No matching videos in your library" when no local results but has YouTube results ---
    it('shows "No matching videos in your library" when no local results but has YouTube results', () => {
        mockUseVideoReturn.searchTerm = 'youtube only';
        mockUseVideoReturn.localSearchResults = [];
        mockUseVideoReturn.searchResults = [
            { id: 'yt1', title: 'YT Video', author: 'Author', sourceUrl: 'https://youtube.com/watch?v=abc', source: 'youtube' },
        ];
        renderSearchResults();

        expect(screen.getByText('No matching videos in your library.')).toBeInTheDocument();
    });

    // --- 7. Shows "From YouTube" section with YouTube results ---
    it('shows "From YouTube" section with YouTube results', () => {
        mockUseVideoReturn.searchTerm = 'music';
        mockUseVideoReturn.searchResults = [
            { id: 'yt1', title: 'YT Song', author: 'Artist', sourceUrl: 'https://youtube.com/watch?v=123', source: 'youtube', thumbnailUrl: 'https://img.com/thumb.jpg' },
        ];
        renderSearchResults();

        expect(screen.getByText('From YouTube')).toBeInTheDocument();
        expect(screen.getByText('YT Song')).toBeInTheDocument();
        expect(screen.getByText('Artist')).toBeInTheDocument();
    });

    // --- 8. Shows YouTube loading spinner when youtubeLoading=true ---
    it('shows YouTube loading spinner when youtubeLoading is true', () => {
        mockUseVideoReturn.searchTerm = 'loading test';
        mockUseVideoReturn.youtubeLoading = true;
        // Need at least local results or youtubeLoading to avoid noResults path
        // noResults = !hasLocalResults && !hasYouTubeResults && (!showYoutubeSearch || !youtubeLoading)
        // With youtubeLoading=true and showYoutubeSearch=true, noResults = false
        renderSearchResults();

        expect(screen.getByText('Loading YouTube results...')).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    // --- 9. Download button click calls handleVideoSubmit with sourceUrl ---
    it('calls handleVideoSubmit with sourceUrl when download button is clicked', async () => {
        mockUseVideoReturn.searchTerm = 'download test';
        mockUseVideoReturn.searchResults = [
            { id: 'yt1', title: 'Download Me', author: 'Author', sourceUrl: 'https://youtube.com/watch?v=xyz', source: 'youtube' },
        ];
        renderSearchResults();

        const downloadBtn = screen.getByRole('button', { name: /download/i });
        fireEvent.click(downloadBtn);

        await waitFor(() => {
            expect(mockHandleVideoSubmit).toHaveBeenCalledWith('https://youtube.com/watch?v=xyz');
        });
        expect(mockUseVideoReturn.setIsSearchMode).toHaveBeenCalledWith(false);
    });

    // --- 10. Download button disabled while downloading (downloadingId matches) ---
    it('disables download button while downloading', async () => {
        mockUseVideoReturn.searchTerm = 'disable test';
        // Make handleVideoSubmit hang so downloadingId stays set
        mockHandleVideoSubmit.mockImplementation(() => new Promise(() => {}));
        mockUseVideoReturn.searchResults = [
            { id: 'yt1', title: 'Video', author: 'Author', sourceUrl: 'https://youtube.com/watch?v=1', source: 'youtube' },
        ];
        renderSearchResults();

        const downloadBtn = screen.getByRole('button', { name: /download/i });
        expect(downloadBtn).not.toBeDisabled();

        fireEvent.click(downloadBtn);

        await waitFor(() => {
            expect(downloadBtn).toBeDisabled();
        });
    });

    // --- 11. Load more button calls loadMoreSearchResults ---
    it('calls loadMoreSearchResults when load more button is clicked', () => {
        mockUseVideoReturn.searchTerm = 'load more';
        mockUseVideoReturn.searchResults = [
            { id: 'yt1', title: 'Video', author: 'Author', sourceUrl: 'https://youtube.com/watch?v=1', source: 'youtube' },
        ];
        renderSearchResults();

        const loadMoreBtn = screen.getByRole('button', { name: 'more' });
        fireEvent.click(loadMoreBtn);

        expect(mockUseVideoReturn.loadMoreSearchResults).toHaveBeenCalled();
    });

    // --- 12. Load more button shows loading state when loadingMore=true ---
    it('shows loading state on load more button when loadingMore is true', () => {
        mockUseVideoReturn.searchTerm = 'load more loading';
        mockUseVideoReturn.loadingMore = true;
        mockUseVideoReturn.searchResults = [
            { id: 'yt1', title: 'Video', author: 'Author', sourceUrl: 'https://youtube.com/watch?v=1', source: 'youtube' },
        ];
        renderSearchResults();

        const loadMoreBtn = screen.getByRole('button', { name: /loading/i });
        expect(loadMoreBtn).toBeDisabled();
    });

    // --- 13. formatViewCount ---
    describe('formatViewCount display', () => {
        const makeYtResult = (id: string, viewCount?: number) => ({
            id,
            title: `Video ${id}`,
            author: 'Author',
            sourceUrl: `https://youtube.com/watch?v=${id}`,
            source: 'youtube',
            viewCount,
        });

        it('shows "0" for undefined view count', () => {
            mockUseVideoReturn.searchTerm = 'views';
            mockUseVideoReturn.searchResults = [makeYtResult('v1', undefined)];
            renderSearchResults();

            // viewCount is undefined so formatViewCount returns '0', but
            // the component only renders the view count block when result.viewCount is truthy.
            // So "0 views" should NOT appear.
            expect(screen.queryByText('0 views')).not.toBeInTheDocument();
        });

        it('shows raw number for count less than 1000', () => {
            mockUseVideoReturn.searchTerm = 'views';
            mockUseVideoReturn.searchResults = [makeYtResult('v1', 500)];
            renderSearchResults();

            expect(screen.getByText('500 views')).toBeInTheDocument();
        });

        it('shows K format for count between 1000 and 999999', () => {
            mockUseVideoReturn.searchTerm = 'views';
            mockUseVideoReturn.searchResults = [makeYtResult('v1', 15000)];
            renderSearchResults();

            expect(screen.getByText('15.0K views')).toBeInTheDocument();
        });

        it('shows M format for count >= 1000000', () => {
            mockUseVideoReturn.searchTerm = 'views';
            mockUseVideoReturn.searchResults = [makeYtResult('v1', 2500000)];
            renderSearchResults();

            expect(screen.getByText('2.5M views')).toBeInTheDocument();
        });
    });

    // --- 14. Video card shows duration chip when duration exists ---
    it('shows duration chip when YouTube result has duration', () => {
        mockUseVideoReturn.searchTerm = 'duration';
        mockUseVideoReturn.searchResults = [
            { id: 'yt1', title: 'Video', author: 'Author', sourceUrl: 'https://youtube.com/watch?v=1', source: 'youtube', duration: 125 },
        ];
        renderSearchResults();

        // formatDuration mock: 125 => "2:05"
        expect(screen.getByText('2:05')).toBeInTheDocument();
    });

    it('does not show duration chip when YouTube result has no duration', () => {
        mockUseVideoReturn.searchTerm = 'no duration';
        mockUseVideoReturn.searchResults = [
            { id: 'yt1', title: 'Video', author: 'Author', sourceUrl: 'https://youtube.com/watch?v=1', source: 'youtube' },
        ];
        renderSearchResults();

        // No duration chip should be present
        // formatDuration would produce "0:00" but chip is conditionally rendered
        expect(screen.queryByText('0:00')).not.toBeInTheDocument();
    });

    // --- 15. YouTube results show source icon (YouTube vs bilibili) ---
    it('shows YouTube icon for youtube source', () => {
        mockUseVideoReturn.searchTerm = 'source';
        mockUseVideoReturn.searchResults = [
            { id: 'yt1', title: 'YT Video', author: 'Author', sourceUrl: 'https://youtube.com/watch?v=1', source: 'youtube' },
        ];
        renderSearchResults();

        // YouTube icon is rendered via MUI's YouTube component with a testid set by MUI
        expect(screen.getByTestId('YouTubeIcon')).toBeInTheDocument();
    });

    it('shows OndemandVideo icon for bilibili source', () => {
        mockUseVideoReturn.searchTerm = 'source';
        mockUseVideoReturn.searchResults = [
            { id: 'bb1', title: 'Bilibili Video', author: 'Author', sourceUrl: 'https://bilibili.com/video/BV123', source: 'bilibili' },
        ];
        renderSearchResults();

        expect(screen.getByTestId('OndemandVideoIcon')).toBeInTheDocument();
    });

    // --- 16. Resets search when searchTerm becomes empty ---
    it('calls resetSearch when searchTerm is empty', () => {
        mockUseVideoReturn.searchTerm = '';
        renderSearchResults();

        expect(mockUseVideoReturn.resetSearch).toHaveBeenCalled();
    });

    it('calls resetSearch when searchTerm is whitespace', () => {
        mockUseVideoReturn.searchTerm = '   ';
        renderSearchResults();

        expect(mockUseVideoReturn.resetSearch).toHaveBeenCalled();
    });

    it('does not call resetSearch when searchTerm has value', () => {
        mockUseVideoReturn.searchTerm = 'valid search';
        renderSearchResults();

        expect(mockUseVideoReturn.resetSearch).not.toHaveBeenCalled();
    });

    // --- Additional edge cases ---
    it('does not show YouTube section when showYoutubeSearch is false', () => {
        mockUseVideoReturn.searchTerm = 'no youtube';
        mockUseVideoReturn.showYoutubeSearch = false;
        mockUseVideoReturn.localSearchResults = [
            { id: 'local1', title: 'Local Only' },
        ];
        renderSearchResults();

        expect(screen.queryByText('From YouTube')).not.toBeInTheDocument();
    });

    it('shows "No YouTube results found" when YouTube has no results but is not loading', () => {
        mockUseVideoReturn.searchTerm = 'empty youtube';
        mockUseVideoReturn.localSearchResults = [
            { id: 'local1', title: 'Local Video' },
        ];
        mockUseVideoReturn.searchResults = [];
        mockUseVideoReturn.youtubeLoading = false;
        renderSearchResults();

        expect(screen.getByText('No YouTube results found.')).toBeInTheDocument();
    });

    it('sets downloadingId to null on download error', async () => {
        mockUseVideoReturn.searchTerm = 'error test';
        mockHandleVideoSubmit.mockRejectedValueOnce(new Error('Download failed'));
        mockUseVideoReturn.searchResults = [
            { id: 'yt1', title: 'Error Video', author: 'Author', sourceUrl: 'https://youtube.com/watch?v=err', source: 'youtube' },
            { id: 'yt2', title: 'Other Video', author: 'Author', sourceUrl: 'https://youtube.com/watch?v=ok', source: 'youtube' },
        ];
        renderSearchResults();

        const downloadBtns = screen.getAllByRole('button', { name: /download/i });
        fireEvent.click(downloadBtns[0]);

        // After error, the button should become enabled again
        await waitFor(() => {
            expect(downloadBtns[0]).not.toBeDisabled();
        });
    });
});
