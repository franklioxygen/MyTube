
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Home from '../Home';

const mockSetSearchParams = vi.fn();
vi.mock('react-router-dom', () => ({
    useSearchParams: () => [new URLSearchParams(), mockSetSearchParams],
}));

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

// Mock useVideo
const mockUseVideoReturn = {
    videos: [],
    loading: false,
    error: null as string | null,
    availableTags: [],
    selectedTags: [] as string[],
    handleTagToggle: vi.fn(),
    deleteVideo: vi.fn(),
    deleteVideos: vi.fn(),
};

vi.mock('../../contexts/VideoContext', () => ({
    useVideo: () => mockUseVideoReturn,
}));

vi.mock('../../contexts/CollectionContext', () => ({
    useCollection: () => ({ collections: [] }),
}));

vi.mock('../../hooks/useViewMode', () => ({
    useViewMode: () => ({ viewMode: 'grid', handleViewModeChange: vi.fn() }),
}));

vi.mock('../../hooks/useHomeSettings', () => ({
    useHomeSettings: () => ({
        isSidebarOpen: true,
        itemsPerPage: 20,
        infiniteScroll: false,
        videoColumns: 4,
        defaultSort: 'date_desc',
        showTagsOnThumbnail: true,
        settingsLoaded: true,
        handleSidebarToggle: vi.fn(),
    }),
}));

vi.mock('../../hooks/useGridLayout', () => ({
    useGridLayout: () => ({}),
}));

vi.mock('../../hooks/useVideoFiltering', () => ({
    useVideoFiltering: () => [],
}));

const mockUseVideoSort = vi.fn((props: any) => ({
    sortedVideos: [],
    sortOption: 'date_desc',
    sortAnchorEl: null,
    handleSortClick: vi.fn(),
    handleSortClose: vi.fn(),
    onSortChange: props.onSortChange, // Ensure onSortChange is passed through
}));

vi.mock('../../hooks/useVideoSort', () => ({
    useVideoSort: (props: any) => mockUseVideoSort(props),
}));

vi.mock('../../hooks/useHomePagination', () => ({
    useHomePagination: () => ({
        page: 1,
        totalPages: 1,
        displayedVideos: [],
        handlePageChange: vi.fn(),
    }),
}));

// Mock child components
vi.mock('../../components/ConfirmationModal', () => ({
    default: ({ isOpen, onConfirm, onClose }: { isOpen: boolean; onConfirm: () => void; onClose: () => void }) => (
        isOpen ? (
            <div>
                <button data-testid="confirm-delete" onClick={onConfirm}>Confirm Delete</button>
                <button data-testid="cancel-delete" onClick={onClose}>Cancel Delete</button>
            </div>
        ) : null
    ),
}));
vi.mock('../../components/HomeHeader', () => ({
    HomeHeader: ({ onDeleteFilteredClick }: { onDeleteFilteredClick: () => void }) => (
        <button data-testid="delete-filtered-btn" onClick={onDeleteFilteredClick}>Delete Filtered</button>
    ),
}));
vi.mock('../../components/HomeSidebar', () => ({
    HomeSidebar: () => <div data-testid="HomeSidebar" />,
}));
vi.mock('../../components/LCPImagePreloader', () => ({
    LCPImagePreloader: () => <div data-testid="LCPImagePreloader" />,
}));
vi.mock('../../components/VideoGrid', () => ({
    VideoGrid: () => <div data-testid="VideoGrid" />,
}));

describe('Home Page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset mocks to default
        mockUseVideoReturn.loading = false;
        mockUseVideoReturn.error = null;
        mockUseVideoReturn.videos = [];
        mockUseVideoReturn.selectedTags = [];

        // Reset specific mocks if needed
        mockUseVideoSort.mockClear();
        // Since we defined mockUseVideoSort with a specific implementation that returns an object, 
        // mockClear clears the call history but keeps the implementation.
        mockSetSearchParams.mockClear();
    });

    const renderHome = () => {
        const theme = createTheme();
        return render(
            <ThemeProvider theme={theme}>
                <Home />
            </ThemeProvider>
        );
    };

    it('renders loading spinner when loading and no videos', () => {
        mockUseVideoReturn.loading = true;
        renderHome();
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('renders error message when error and no videos', () => {
        mockUseVideoReturn.error = 'Test Error';
        renderHome();
        expect(screen.getByText('Test Error')).toBeInTheDocument();
    });

    it('renders no videos message when not loading, no error, and no videos', () => {
        renderHome();
        expect(screen.getByText('noVideosYet')).toBeInTheDocument();
    });

    it('renders main content when videos exist', () => {
        // We need to trick the component to think videos exist
        // The component checks `videoArray.length > 0` directly from useVideo
        // AND also uses other hooks.
        // We mocked useVideoFiltering and useVideoSort and useHomePagination
        // to return empty arrays, but the conditional rendering for 'noVideosYet'
        // depends on `videoArray` from useVideo only.

        mockUseVideoReturn.videos = [{ id: '1' }] as any;

        renderHome();

        expect(screen.getByTestId('delete-filtered-btn')).toBeInTheDocument(); // HomeHeader
        expect(screen.getByTestId('HomeSidebar')).toBeInTheDocument();
        expect(screen.getByTestId('VideoGrid')).toBeInTheDocument();
    });

    it('handles delete filtered videos flow', async () => {
        const mockVideos = [
            { id: '1', tags: ['tag1'] },
            { id: '2', tags: ['tag2'] },
            { id: '3', tags: ['tag1', 'tag2'] }
        ];
        mockUseVideoReturn.videos = mockVideos as any;
        mockUseVideoReturn.selectedTags = ['tag1'];

        // Mock useVideoFiltering to return something so logical flow holds (though Home logic uses videoArray filter implicitly for count)
        // Actually Home uses videoArray.filter internally for the delete logic, independent of useVideoFiltering hook result which is for display.

        renderHome();

        // Open modal
        const deleteBtn = screen.getByTestId('delete-filtered-btn');
        fireEvent.click(deleteBtn);

        // Confirm delete
        const confirmBtn = screen.getByTestId('confirm-delete');
        fireEvent.click(confirmBtn);

        // Expect deleteVideos to be called with IDs of videos having 'tag1'
        // Vid 1 has tag1. Vid 2 has tag2. Vid 3 has tag1, tag2.
        // So Vid 1 and Vid 3 should be deleted.
        expect(mockUseVideoReturn.deleteVideos).toHaveBeenCalledWith(['1', '3']);
    });

    it('closes the delete filtered videos modal', () => {
        const mockVideos = [{ id: '1', tags: ['tag1'] }];
        mockUseVideoReturn.videos = mockVideos as any;
        mockUseVideoReturn.selectedTags = ['tag1'];

        renderHome();

        // Open modal
        fireEvent.click(screen.getByTestId('delete-filtered-btn'));
        expect(screen.getByTestId('cancel-delete')).toBeInTheDocument();

        // Close modal
        fireEvent.click(screen.getByTestId('cancel-delete'));
        expect(screen.queryByTestId('cancel-delete')).not.toBeInTheDocument();
    });

    it('updates search params when sort changes', () => {
        mockUseVideoReturn.videos = [{ id: '1' }] as any;
        renderHome();

        // Capture the onSortChange callback passed to useVideoSort
        const { onSortChange } = mockUseVideoSort.mock.calls[0][0];

        // Trigger it
        onSortChange();

        // Check if setSearchParams was called
        expect(mockSetSearchParams).toHaveBeenCalled();

        // Execute the callback passed to setSearchParams to cover inner lines
        // The argument passed to setSearchParams is a function: (prev) => newParams
        const callback = mockSetSearchParams.mock.calls[0][0];
        const prevParams = new URLSearchParams('page=5');
        const newParams = callback(prevParams);

        expect(newParams.get('page')).toBe('1');
    });
});
