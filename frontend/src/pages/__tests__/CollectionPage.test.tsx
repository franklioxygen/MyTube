import { createTheme, ThemeProvider } from '@mui/material/styles';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    collections: [] as unknown[],
    deleteCollection: mockDeleteCollection,
};
vi.mock('../../contexts/CollectionContext', () => ({
    useCollection: () => mockCollectionContext,
}));

const mockDeleteVideo = vi.fn();
const mockUpdateVideo = vi.fn();
const mockVideoContext = {
    videos: [] as unknown[],
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

const mockSaveMutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock('../../hooks/useSettingsMutations', () => ({
    useSettingsMutations: () => ({
        saveMutation: { mutateAsync: mockSaveMutateAsync },
    }),
}));

const mockUseVideoSort = vi.fn((props: Record<string, unknown>) => ({
    sortedVideos: props.videos,
    sortOption: 'dateDesc',
    sortAnchorEl: null,
    handleSortClick: vi.fn(),
    handleSortClose: vi.fn(),
}));
vi.mock('../../hooks/useVideoSort', () => ({
    useVideoSort: (props: Record<string, unknown>) => mockUseVideoSort(props),
}));

// --- Mock only heavy child components ---
// NOTE: SortControl and TagsModal are NOT mocked - they render as real components.

vi.mock('../../components/TagsSidebar', () => ({
    TagsSidebar: ({ isSidebarOpen }: { isSidebarOpen: boolean }) => (
        <div data-testid="TagsSidebar" data-open={isSidebarOpen} />
    ),
}));

vi.mock('../../components/VideoCard', () => ({
    default: ({ video }: { video: { id: string; title: string; [key: string]: unknown } }) => (
        <div data-testid={`VideoCard-${video.id}`}>{video.title}</div>
    ),
}));

// Keep DeleteCollectionModal mock since showDeleteModal is never set to true in CollectionPage
// (no UI trigger), so we use prop capture to test handler logic
let capturedDeleteModalProps: { onDeleteCollectionOnly?: () => Promise<void>; onDeleteCollectionAndVideos?: () => Promise<void>; [key: string]: unknown } = {};
vi.mock('../../components/DeleteCollectionModal', () => ({
    default: (props: { isOpen: boolean; collectionName: string; videoCount: number; onDeleteCollectionOnly: () => Promise<void>; onDeleteCollectionAndVideos: () => Promise<void>; onClose: () => void }) => {
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
        mockUpdateVideo.mockResolvedValue(undefined);
        mockSaveMutateAsync.mockResolvedValue(undefined);
        mockUseVideoSort.mockImplementation((props: Record<string, unknown>) => ({
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

    // --- Collection rendering ---
    describe('collection rendering', () => {
        it('shows collectionNotFound alert when collection does not exist', () => {
            mockCollectionContext.collections = [];
            renderCollectionPage();
            expect(screen.getByText('collectionNotFound')).toBeInTheDocument();
        });

        it('renders collection name and video count', () => {
            renderCollectionPage();
            expect(screen.getByText('Test Collection')).toBeInTheDocument();
            expect(screen.getByText('2 videos')).toBeInTheDocument();
        });

        it('shows noVideosInCollection alert when collection has no videos', () => {
            mockCollectionContext.collections = [
                { id: 'col-1', name: 'Empty Collection', videos: [], createdAt: '2024-01-01' },
            ];
            renderCollectionPage();
            expect(screen.getByText('noVideosInCollection')).toBeInTheDocument();
        });

        it('shows "0 videos" for empty collection', () => {
            mockCollectionContext.collections = [
                { id: 'col-1', name: 'Empty', videos: [], createdAt: '2024-01-01' },
            ];
            renderCollectionPage();
            expect(screen.getByText('0 videos')).toBeInTheDocument();
        });

        it('shows noVideosInCollection when collection references nonexistent videos', () => {
            mockCollectionContext.collections = [
                { id: 'col-1', name: 'Missing Videos', videos: ['missing1', 'missing2'], createdAt: '2024-01-01' },
            ];
            renderCollectionPage();
            expect(screen.queryByTestId(/^VideoCard-/)).not.toBeInTheDocument();
            expect(screen.getByText('noVideosInCollection')).toBeInTheDocument();
        });
    });

    // --- Video cards ---
    describe('video cards', () => {
        it('renders a VideoCard for each video in the collection', () => {
            renderCollectionPage();
            expect(screen.getByTestId('VideoCard-v1')).toBeInTheDocument();
            expect(screen.getByTestId('VideoCard-v2')).toBeInTheDocument();
            expect(screen.getByText('Video 1')).toBeInTheDocument();
            expect(screen.getByText('Video 2')).toBeInTheDocument();
        });

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
    });

    // --- Sort control (real component) ---
    describe('sort control', () => {
        it('renders sort button when collection has videos', () => {
            renderCollectionPage();
            expect(screen.getByText('sort')).toBeInTheDocument();
        });

        it('does not render sort button when collection has no videos', () => {
            mockCollectionContext.collections = [
                { id: 'col-1', name: 'Empty', videos: [], createdAt: '2024-01-01' },
            ];
            renderCollectionPage();
            expect(screen.queryByText('sort')).not.toBeInTheDocument();
        });

        it('passes collection videos to useVideoSort', () => {
            renderCollectionPage();
            expect(mockUseVideoSort).toHaveBeenCalled();
            const callArgs = mockUseVideoSort.mock.calls[0][0];
            expect(callArgs.videos).toHaveLength(2);
            expect(callArgs.defaultSort).toBe('dateDesc');
        });
    });

    // --- Tags sidebar ---
    describe('tags sidebar', () => {
        it('renders the sidebar toggle button with sidebar initially closed', () => {
            renderCollectionPage();
            expect(screen.getByTestId('TagsSidebar')).toBeInTheDocument();
            expect(screen.getByTestId('TagsSidebar').getAttribute('data-open')).toBe('false');
        });
    });

    // --- Tags modal (real component) ---
    describe('tags modal', () => {
        it('opens tags modal when tag icon button is clicked', () => {
            renderCollectionPage();
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

            fireEvent.click(screen.getByLabelText('add tags to collection'));

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('selectTags')).toBeInTheDocument();
        });

        it('shows available tag chips in the modal', () => {
            renderCollectionPage();
            fireEvent.click(screen.getByLabelText('add tags to collection'));

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('tag1')).toBeInTheDocument();
            expect(within(dialog).getByText('tag2')).toBeInTheDocument();
            expect(within(dialog).getByText('tag3')).toBeInTheDocument();
        });

        it('closes tags modal on cancel', async () => {
            renderCollectionPage();
            fireEvent.click(screen.getByLabelText('add tags to collection'));
            expect(screen.getByRole('dialog')).toBeInTheDocument();

            fireEvent.click(within(screen.getByRole('dialog')).getByText('cancel'));

            await waitFor(() => {
                expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            });
        });

        it('calls updateVideo for collection videos when tags are saved', async () => {
            renderCollectionPage();
            fireEvent.click(screen.getByLabelText('add tags to collection'));

            const dialog = screen.getByRole('dialog');

            // Select tag1 (click the chip)
            fireEvent.click(within(dialog).getByText('tag1'));

            // Click save
            fireEvent.click(within(dialog).getByText('save'));

            await waitFor(() => {
                // tag1 is added to v2 (v1 already has tag1)
                expect(mockUpdateVideo).toHaveBeenCalled();
            });
        });

        it('shows success snackbar after saving tags', async () => {
            renderCollectionPage();
            fireEvent.click(screen.getByLabelText('add tags to collection'));

            const dialog = screen.getByRole('dialog');
            fireEvent.click(within(dialog).getByText('tag1'));
            fireEvent.click(within(dialog).getByText('save'));

            await waitFor(() => {
                expect(mockShowSnackbar).toHaveBeenCalledWith('videoUpdated');
            });
        });

        it('allows adding a new custom tag', async () => {
            renderCollectionPage();
            fireEvent.click(screen.getByLabelText('add tags to collection'));

            const dialog = screen.getByRole('dialog');
            const input = within(dialog).getByLabelText('newTag');
            fireEvent.change(input, { target: { value: 'customTag' } });
            fireEvent.click(within(dialog).getByText('add'));

            // customTag should now appear as a chip in the modal
            expect(within(dialog).getByText('customTag')).toBeInTheDocument();
        });
    });

    // --- Delete collection flow (via captured props) ---
    describe('delete collection flow', () => {
        it('does not render delete modal when closed', () => {
            renderCollectionPage();
            expect(screen.queryByTestId('DeleteCollectionModal')).not.toBeInTheDocument();
        });

        it('calls deleteCollection(id, false) and navigates to / when delete collection only handler is invoked', async () => {
            renderCollectionPage();
            expect(capturedDeleteModalProps.onDeleteCollectionOnly).toBeDefined();
            await capturedDeleteModalProps.onDeleteCollectionOnly!();
            expect(mockDeleteCollection).toHaveBeenCalledWith('col-1', false);
            expect(mockNavigate).toHaveBeenCalledWith('/');
        });

        it('calls deleteCollection(id, true) and navigates to / when delete collection and videos handler is invoked', async () => {
            renderCollectionPage();
            expect(capturedDeleteModalProps.onDeleteCollectionAndVideos).toBeDefined();
            await capturedDeleteModalProps.onDeleteCollectionAndVideos!();
            expect(mockDeleteCollection).toHaveBeenCalledWith('col-1', true);
            expect(mockNavigate).toHaveBeenCalledWith('/');
        });

        it('does not navigate when deleteCollection returns failure', async () => {
            mockDeleteCollection.mockResolvedValue({ success: false });
            renderCollectionPage();
            await capturedDeleteModalProps.onDeleteCollectionOnly!();
            expect(mockDeleteCollection).toHaveBeenCalledWith('col-1', false);
            expect(mockNavigate).not.toHaveBeenCalled();
        });

        it('passes correct collectionName and videoCount to DeleteCollectionModal', () => {
            renderCollectionPage();
            expect(capturedDeleteModalProps.collectionName).toBe('Test Collection');
            expect(capturedDeleteModalProps.videoCount).toBe(2);
        });
    });

    // --- Pagination ---
    describe('pagination', () => {
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
    });

    // --- Page tag filter ---
    describe('page tag filter', () => {
        it('calls setPageTagFilter on mount with a non-null filter', () => {
            renderCollectionPage();
            expect(mockSetPageTagFilter).toHaveBeenCalled();
            const firstCallArg = mockSetPageTagFilter.mock.calls[0][0];
            expect(firstCallArg).not.toBeNull();
        });

        it('calls setPageTagFilter with null on unmount', () => {
            const { unmount } = renderCollectionPage();
            mockSetPageTagFilter.mockClear();
            unmount();
            expect(mockSetPageTagFilter).toHaveBeenCalledWith(null);
        });
    });
});
