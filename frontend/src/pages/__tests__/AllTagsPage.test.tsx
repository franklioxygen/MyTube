import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AllTagsPage from '../AllTagsPage';
import { Video } from '../../types';

const mockHandleTagToggle = vi.fn();
const mockClearSelectedTags = vi.fn();
const mockUseVideoReturn = {
    videos: [
        { id: 'v1', title: 'One', tags: ['Music'] },
        { id: 'v2', title: 'Two', tags: ['Tech'] },
        { id: 'v3', title: 'Three', tags: ['Music', 'Tech'] },
    ] as Video[],
    loading: false,
    error: null as string | null,
    availableTags: ['Music', 'Tech', 'Unused'],
    selectedTags: [] as string[],
    handleTagToggle: mockHandleTagToggle,
    clearSelectedTags: mockClearSelectedTags,
    deleteVideo: vi.fn(),
    deleteVideos: vi.fn(),
};

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, replacements?: Record<string, string | number>) => {
            if (replacements?.count != null) {
                return `${key}:${replacements.count}`;
            }
            return key;
        },
    }),
}));

vi.mock('../../contexts/VideoContext', () => ({
    useVideo: () => mockUseVideoReturn,
}));

vi.mock('../../contexts/CollectionContext', () => ({
    useCollection: () => ({ collections: [] }),
}));

vi.mock('../../hooks/useSettings', () => ({
    useSettings: () => ({
        data: { authorTags: {}, collectionTags: {} },
        isLoading: false,
    }),
}));

vi.mock('../../hooks/useHomeSettings', () => ({
    useHomeSettings: () => ({
        itemsPerPage: 20,
        infiniteScroll: false,
        videoColumns: 4,
        defaultSort: 'dateDesc',
        showTagsOnThumbnail: true,
        settingsLoaded: true,
    }),
}));

vi.mock('../../hooks/useGridLayout', () => ({
    useGridLayout: () => ({ xs: 12, sm: 6, lg: 4, xl: 3 }),
}));

vi.mock('../../hooks/useVideoFiltering', () => ({
    useVideoFiltering: ({ selectedTags, videos }: { selectedTags: string[]; videos: Video[] }) => {
        if (selectedTags.length === 0) return videos;
        return videos.filter((video) =>
            selectedTags.every((tag) => (video.tags ?? []).includes(tag))
        );
    },
}));

vi.mock('../../hooks/useVideoSort', () => ({
    useVideoSort: ({ videos }: { videos: Video[] }) => ({
        sortedVideos: videos,
        sortOption: 'dateDesc',
        sortAnchorEl: null,
        handleSortClick: vi.fn(),
        handleSortClose: vi.fn(),
    }),
}));

vi.mock('../../hooks/useHomePagination', () => ({
    useHomePagination: ({ sortedVideos }: { sortedVideos: Video[] }) => ({
        page: 1,
        totalPages: 1,
        displayedVideos: sortedVideos,
        handlePageChange: vi.fn(),
    }),
}));

vi.mock('../../components/ExpandableTagsStrip', () => ({
    default: ({
        tags,
        onTagToggle,
    }: {
        tags: string[];
        onTagToggle: (tag: string) => void;
    }) => (
        <div data-testid="tags-strip">
            {tags.map((tag) => (
                <button key={tag} type="button" onClick={() => onTagToggle(tag)}>
                    {tag}
                </button>
            ))}
        </div>
    ),
}));

vi.mock('../../components/VideoGrid', () => ({
    VideoGrid: ({ displayedVideos }: { displayedVideos: Video[] }) => (
        <div data-testid="video-grid">
            {displayedVideos.map((v) => (
                <div key={v.id}>{v.title}</div>
            ))}
        </div>
    ),
}));

vi.mock('../../components/SortControl', () => ({
    default: () => <div data-testid="sort-control" />,
}));

describe('AllTagsPage', () => {
    const theme = createTheme();

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseVideoReturn.selectedTags = [];
        mockUseVideoReturn.loading = false;
        mockUseVideoReturn.error = null;
        mockUseVideoReturn.videos = [
            { id: 'v1', title: 'One', tags: ['Music'] },
            { id: 'v2', title: 'Two', tags: ['Tech'] },
            { id: 'v3', title: 'Three', tags: ['Music', 'Tech'] },
        ] as Video[];
        mockUseVideoReturn.availableTags = ['Music', 'Tech', 'Unused'];
    });

    const renderPage = () =>
        render(
            <MemoryRouter>
                <ThemeProvider theme={theme}>
                    <AllTagsPage />
                </ThemeProvider>
            </MemoryRouter>
        );

    it('renders title and most-used ordered tags strip', () => {
        renderPage();
        expect(screen.getByText('allTags')).toBeInTheDocument();
        const strip = screen.getByTestId('tags-strip');
        const buttons = Array.from(strip.querySelectorAll('button')).map((b) => b.textContent);
        // Music (2), Tech (1), Unused (0)
        expect(buttons).toEqual(['Music', 'Tech', 'Unused']);
    });

    it('toggles a tag via the strip', () => {
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: 'Music' }));
        expect(mockHandleTagToggle).toHaveBeenCalledWith('Music');
    });

    it('filters the grid when tags are selected (AND)', () => {
        mockUseVideoReturn.selectedTags = ['Music', 'Tech'];
        renderPage();
        expect(screen.getByText('Three')).toBeInTheDocument();
        expect(screen.queryByText('One')).not.toBeInTheDocument();
        expect(screen.queryByText('Two')).not.toBeInTheDocument();
    });

    it('shows loading spinner while videos load', () => {
        mockUseVideoReturn.loading = true;
        mockUseVideoReturn.videos = [];
        renderPage();
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('shows error alert when video load fails and there are no videos', () => {
        mockUseVideoReturn.error = 'Failed to load videos';
        mockUseVideoReturn.videos = [];
        renderPage();
        expect(screen.getByText('Failed to load videos')).toBeInTheDocument();
        expect(screen.queryByText('noVideosYet')).not.toBeInTheDocument();
    });

    it('shows empty catalog message when no tags exist', () => {
        mockUseVideoReturn.availableTags = [];
        renderPage();
        expect(screen.getByText('noTagsAvailable')).toBeInTheDocument();
    });
});
