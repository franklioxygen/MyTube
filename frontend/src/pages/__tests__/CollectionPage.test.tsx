import { createTheme, ThemeProvider } from '@mui/material/styles';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CollectionPage from '../CollectionPage';

// --- Mocks ---

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
    useParams: () => ({ id: 'col-1' }),
    useNavigate: () => mockNavigate,
}));

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

const mockShowSnackbar = vi.fn();
vi.mock('../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}));

const mockDeleteCollection = vi.fn();
const mockCollectionContext = {
    collections: [] as any[],
    deleteCollection: mockDeleteCollection,
};
vi.mock('../../contexts/CollectionContext', () => ({
    useCollection: () => mockCollectionContext,
}));

const mockDeleteVideo = vi.fn();
const mockUpdateVideo = vi.fn();
const mockVideoContext = {
    videos: [] as any[],
    deleteVideo: mockDeleteVideo,
    availableTags: ['tag1', 'tag2', 'tag3'],
    updateVideo: mockUpdateVideo,
};
vi.mock('../../contexts/VideoContext', () => ({
    useVideo: () => mockVideoContext,
}));

const mockSetPageTagFilter = vi.fn();
vi.mock('../../contexts/PageTagFilterContext', () => ({
    usePageTagFilter: () => ({ setPageTagFilter: mockSetPageTagFilter }),
}));

vi.mock('../../hooks/useSettings', () => ({
    useSettings: () => ({
        data: { showTagsOnThumbnail: true },
        isLoading: false,
        error: null,
    }),
}));

const mockUseVideoSort = vi.fn((props: any) => ({
    sortedVideos: props.videos,
    sortOption: 'dateDesc',
    sortAnchorEl: null,
    handleSortClick: vi.fn(),
    handleSortClose: vi.fn(),
}));
vi.mock('../../hooks/useVideoSort', () => ({
    useVideoSort: (props: any) => mockUseVideoSort(props),
}));

// --- Mock child components ---

vi.mock('../../components/TagsSidebar', () => ({
    TagsSidebar: ({ isSidebarOpen }: { isSidebarOpen: boolean }) => (
        <div data-testid="TagsSidebar" data-open={isSidebarOpen} />
    ),
}));

vi.mock('../../components/SortControl', () => ({
    default: ({ sortOption }: { sortOption: string }) => (
        <div data-testid="SortControl" data-sort={sortOption} />
    ),
}));

vi.mock('../../components/VideoCard', () => ({
    default: ({ video }: { video: any }) => (
        <div data-testid={`VideoCard-${video.id}`}>{video.title}</div>
    ),
}));

// Track props passed to DeleteCollectionModal for assertions
let capturedDeleteModalProps: any = {};
vi.mock('../../components/DeleteCollectionModal', () => ({
    default: (props: any) => {
        capturedDeleteModalProps = props;
        return props.isOpen ? (
            <div data-testid="DeleteCollectionModal">
                <span data-testid="modal-collection-name">{props.collectionName}</span>
                <span data-testid="modal-video-count">{props.videoCount}</span>
                <button data-testid="delete-collection-only" onClick={props.onDeleteCollectionOnly}>
                    Delete Collection Only
                </button>
                <button data-testid="delete-collection-and-videos" onClick={props.onDeleteCollectionAndVideos}>
                    Delete Collection and Videos
                </button>
                <button data-testid="close-delete-modal" onClick={props.onClose}>
                    Close
                </button>
            </div>
        ) : null;
    },
}));

vi.mock('../../components/TagsModal', () => ({
    default: ({
        open,
        onClose,
        onSave,
    }: {
        open: boolean;
        onClose: () => void;
        onSave: (tags: string[]) => void;
    }) =>
        open ? (
            <div data-testid="TagsModal">
                <button data-testid="close-tags-modal" onClick={onClose}>
                    Close Tags
                </button>
                <button data-testid="save-tags" onClick={() => onSave(['newTag'])}>
                    Save Tags
                </button>
            </div>
        ) : null,
}));

// --- Test data ---

const mockCollections = [
    { id: 'col-1', name: 'Test Collection', videos: ['v1', 'v2'], createdAt: '2024-01-01' },
];

const mockVideos = [
    { id: 'v1', title: 'Video 1', tags: ['tag1'], author: 'Author' },
    { id: 'v2', title: 'Video 2', tags: ['tag2'], author: 'Author' },
];

// --- Helpers ---

const theme = createTheme();

const renderCollectionPage = () => {
    return render(
        <ThemeProvider theme={theme}>
            <CollectionPage />
        </ThemeProvider>
    );
};

// --- Tests ---

describe('CollectionPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedDeleteModalProps = {};

        // Reset context data to defaults
        mockCollectionContext.collections = [...mockCollections];
        mockCollectionContext.deleteCollection = mockDeleteCollection;
        mockVideoContext.videos = [...mockVideos];
        mockVideoContext.deleteVideo = mockDeleteVideo;
        mockVideoContext.availableTags = ['tag1', 'tag2', 'tag3'];
        mockVideoContext.updateVideo = mockUpdateVideo;

        mockDeleteCollection.mockResolvedValue({ success: true });
        mockUseVideoSort.mockImplementation((props: any) => ({
            sortedVideos: props.videos,
            sortOption: 'dateDesc',
            sortAnchorEl: null,
            handleSortClick: vi.fn(),
            handleSortClose: vi.fn(),
        }));
    });

    afterEach(() => {
        cleanup();
    });

    // 1. Collection not found
    it('shows collectionNotFound alert when collection does not exist', () => {
        mockCollectionContext.collections = [];
        renderCollectionPage();

        expect(screen.getByText('collectionNotFound')).toBeInTheDocument();
    });

    // 2. Renders collection name and video count
    it('renders collection name and video count', () => {
        renderCollectionPage();

        expect(screen.getByText('Test Collection')).toBeInTheDocument();
        expect(screen.getByText('2 videos')).toBeInTheDocument();
    });

    // 3. Empty collection
    it('shows noVideosInCollection alert when collection has no videos', () => {
        mockCollectionContext.collections = [
            { id: 'col-1', name: 'Empty Collection', videos: [], createdAt: '2024-01-01' },
        ];
        renderCollectionPage();

        expect(screen.getByText('noVideosInCollection')).toBeInTheDocument();
    });

    // 4. Renders VideoCard for each video in collection
    it('renders a VideoCard for each video in the collection', () => {
        renderCollectionPage();

        expect(screen.getByTestId('VideoCard-v1')).toBeInTheDocument();
        expect(screen.getByTestId('VideoCard-v2')).toBeInTheDocument();
        expect(screen.getByText('Video 1')).toBeInTheDocument();
        expect(screen.getByText('Video 2')).toBeInTheDocument();
    });

    // 5. Tag sidebar toggle button
    it('renders the sidebar toggle button with sidebar initially closed', () => {
        renderCollectionPage();

        expect(screen.getByTestId('TagsSidebar')).toBeInTheDocument();
        expect(screen.getByTestId('TagsSidebar').getAttribute('data-open')).toBe('false');
    });

    // 6. Delete collection modal is not visible initially
    it('does not render delete modal when closed', () => {
        renderCollectionPage();

        expect(screen.queryByTestId('DeleteCollectionModal')).not.toBeInTheDocument();
    });

    // 7. Delete collection only - calls deleteCollection(id, false) and navigates home
    it('calls deleteCollection(id, false) and navigates to / when delete collection only handler is invoked', async () => {
        renderCollectionPage();

        // The modal is rendered but hidden (isOpen=false). We can invoke the captured callback
        // directly since the component wires it as a prop to DeleteCollectionModal.
        expect(capturedDeleteModalProps.onDeleteCollectionOnly).toBeDefined();

        await capturedDeleteModalProps.onDeleteCollectionOnly();

        expect(mockDeleteCollection).toHaveBeenCalledWith('col-1', false);
        expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    // 8. Delete collection and videos - calls deleteCollection(id, true) and navigates home
    it('calls deleteCollection(id, true) and navigates to / when delete collection and videos handler is invoked', async () => {
        renderCollectionPage();

        expect(capturedDeleteModalProps.onDeleteCollectionAndVideos).toBeDefined();

        await capturedDeleteModalProps.onDeleteCollectionAndVideos();

        expect(mockDeleteCollection).toHaveBeenCalledWith('col-1', true);
        expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    // Delete handlers do not navigate when deleteCollection returns failure
    it('does not navigate when deleteCollection returns failure', async () => {
        mockDeleteCollection.mockResolvedValue({ success: false });
        renderCollectionPage();

        await capturedDeleteModalProps.onDeleteCollectionOnly();

        expect(mockDeleteCollection).toHaveBeenCalledWith('col-1', false);
        expect(mockNavigate).not.toHaveBeenCalled();
    });

    // DeleteCollectionModal receives correct collection name and video count
    it('passes correct collectionName and videoCount to DeleteCollectionModal', () => {
        renderCollectionPage();

        expect(capturedDeleteModalProps.collectionName).toBe('Test Collection');
        expect(capturedDeleteModalProps.videoCount).toBe(2);
    });

    // Close handler for delete modal
    it('wires onClose handler to DeleteCollectionModal', () => {
        renderCollectionPage();

        expect(capturedDeleteModalProps.onClose).toBeDefined();
        expect(typeof capturedDeleteModalProps.onClose).toBe('function');
    });

    // 9. Tags modal opens/closes
    it('opens tags modal when tag icon button is clicked', () => {
        renderCollectionPage();

        expect(screen.queryByTestId('TagsModal')).not.toBeInTheDocument();

        const addTagsButton = screen.getByLabelText('add tags to collection');
        fireEvent.click(addTagsButton);

        expect(screen.getByTestId('TagsModal')).toBeInTheDocument();
    });

    it('closes tags modal when close button is clicked', () => {
        renderCollectionPage();

        // Open modal
        fireEvent.click(screen.getByLabelText('add tags to collection'));
        expect(screen.getByTestId('TagsModal')).toBeInTheDocument();

        // Close modal
        fireEvent.click(screen.getByTestId('close-tags-modal'));
        expect(screen.queryByTestId('TagsModal')).not.toBeInTheDocument();
    });

    // 10. Video count label with tag filtering
    it('shows total video count when no tags are selected', () => {
        renderCollectionPage();

        expect(screen.getByText('2 videos')).toBeInTheDocument();
    });

    it('shows "0 videos" for empty collection', () => {
        mockCollectionContext.collections = [
            { id: 'col-1', name: 'Empty', videos: [], createdAt: '2024-01-01' },
        ];
        renderCollectionPage();

        expect(screen.getByText('0 videos')).toBeInTheDocument();
    });

    // 11. Sort control renders when videos exist
    it('renders SortControl when collection has videos', () => {
        renderCollectionPage();

        expect(screen.getByTestId('SortControl')).toBeInTheDocument();
    });

    it('does not render SortControl when collection has no videos', () => {
        mockCollectionContext.collections = [
            { id: 'col-1', name: 'Empty', videos: [], createdAt: '2024-01-01' },
        ];
        renderCollectionPage();

        expect(screen.queryByTestId('SortControl')).not.toBeInTheDocument();
    });

    // 12. Pagination renders when > 12 videos
    it('renders Pagination when there are more than 12 videos', () => {
        const videoIds = Array.from({ length: 13 }, (_, i) => `v${i + 1}`);
        const manyVideos = videoIds.map(id => ({
            id,
            title: `Video ${id}`,
            tags: ['tag1'],
            author: 'Author',
        }));

        mockCollectionContext.collections = [
            { id: 'col-1', name: 'Big Collection', videos: videoIds, createdAt: '2024-01-01' },
        ];
        mockVideoContext.videos = manyVideos;

        renderCollectionPage();

        expect(screen.getByRole('navigation')).toBeInTheDocument();
    });

    it('does not render Pagination when there are 12 or fewer videos', () => {
        renderCollectionPage();

        expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });

    // Edge case: collection references videos not present in video context
    it('shows noVideosInCollection when collection references nonexistent videos', () => {
        mockCollectionContext.collections = [
            { id: 'col-1', name: 'Missing Videos', videos: ['missing1', 'missing2'], createdAt: '2024-01-01' },
        ];
        renderCollectionPage();

        expect(screen.queryByTestId(/^VideoCard-/)).not.toBeInTheDocument();
        expect(screen.getByText('noVideosInCollection')).toBeInTheDocument();
    });

    // Only videos belonging to collection are shown
    it('only renders videos that belong to the collection', () => {
        mockVideoContext.videos = [
            { id: 'v1', title: 'Video 1', tags: ['tag1'], author: 'Author' },
            { id: 'v2', title: 'Video 2', tags: ['tag2'], author: 'Author' },
            { id: 'v3', title: 'Video 3', tags: ['tag3'], author: 'Author' },
        ];
        renderCollectionPage();

        expect(screen.getByTestId('VideoCard-v1')).toBeInTheDocument();
        expect(screen.getByTestId('VideoCard-v2')).toBeInTheDocument();
        expect(screen.queryByTestId('VideoCard-v3')).not.toBeInTheDocument();
    });

    // setPageTagFilter is called on mount
    it('calls setPageTagFilter on mount with a non-null filter', () => {
        renderCollectionPage();

        expect(mockSetPageTagFilter).toHaveBeenCalled();
        const firstCallArg = mockSetPageTagFilter.mock.calls[0][0];
        expect(firstCallArg).not.toBeNull();
    });

    // setPageTagFilter cleanup sets null on unmount
    it('calls setPageTagFilter with null on unmount', () => {
        const { unmount } = renderCollectionPage();

        mockSetPageTagFilter.mockClear();
        unmount();

        expect(mockSetPageTagFilter).toHaveBeenCalledWith(null);
    });

    // Tags modal save triggers updateVideo for each video
    it('calls updateVideo for collection videos when tags are saved', async () => {
        mockUpdateVideo.mockResolvedValue(undefined);
        renderCollectionPage();

        // Open tags modal
        fireEvent.click(screen.getByLabelText('add tags to collection'));

        // Save tags (mock passes ['newTag'] to onSave)
        fireEvent.click(screen.getByTestId('save-tags'));

        await waitFor(() => {
            expect(mockUpdateVideo).toHaveBeenCalled();
        });
    });

    // Tags modal save shows snackbar on success
    it('shows success snackbar after saving tags', async () => {
        mockUpdateVideo.mockResolvedValue(undefined);
        renderCollectionPage();

        fireEvent.click(screen.getByLabelText('add tags to collection'));
        fireEvent.click(screen.getByTestId('save-tags'));

        await waitFor(() => {
            expect(mockShowSnackbar).toHaveBeenCalledWith('videoUpdated');
        });
    });

    // useVideoSort is called with collection videos
    it('passes collection videos to useVideoSort', () => {
        renderCollectionPage();

        expect(mockUseVideoSort).toHaveBeenCalled();
        const callArgs = mockUseVideoSort.mock.calls[0][0];
        expect(callArgs.videos).toHaveLength(2);
        expect(callArgs.defaultSort).toBe('dateDesc');
    });
});
