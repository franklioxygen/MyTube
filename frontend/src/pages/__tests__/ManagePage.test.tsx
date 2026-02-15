import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManagePage from '../ManagePage';
import type { CapturedVideosTableProps, ConfirmationModalProps, DeleteCollectionModalProps, CollectionsTableProps } from './managePageTestTypes';

// --- Module-level mock data (modifiable per test) ---

let mockVideos: unknown[] = [];
let mockCollections: unknown[] = [];
let mockUserRole = 'admin';

const mockDeleteVideo = vi.fn();
const mockRefreshThumbnail = vi.fn();
const mockUpdateVideo = vi.fn();
const mockFetchVideos = vi.fn();
const mockDeleteCollection = vi.fn();
const mockUpdateCollection = vi.fn();
const mockShowSnackbar = vi.fn();
const mockMutate = vi.fn(), mockRefreshFileSizesMutate = vi.fn();

// --- Mocks ---

vi.mock('react-router-dom', () => ({
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    useNavigate: () => vi.fn(),
}));

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ userRole: mockUserRole }),
}));

vi.mock('../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}));

vi.mock('../../contexts/VideoContext', () => ({
    useVideo: () => ({
        videos: mockVideos,
        deleteVideo: mockDeleteVideo,
        refreshThumbnail: mockRefreshThumbnail,
        updateVideo: mockUpdateVideo,
        fetchVideos: mockFetchVideos,
    }),
}));

vi.mock('../../contexts/CollectionContext', () => ({
    useCollection: () => ({
        collections: mockCollections,
        deleteCollection: mockDeleteCollection,
        updateCollection: mockUpdateCollection,
    }),
}));

// Track useMutation calls per render cycle using a counter that resets
let mutationCallIndex = 0;
vi.mock('@tanstack/react-query', () => ({
    useMutation: () => {
        const index = mutationCallIndex++;
        if (index % 2 === 0) {
            // First call in each render = scanMutation
            return {
                mutate: mockMutate,
                isPending: false,
            };
        } else {
            // Second call in each render = refreshFileSizesMutation
            return {
                mutate: mockRefreshFileSizesMutate,
                isPending: false,
            };
        }
    },
}));

vi.mock('../../utils/apiClient', () => ({
    api: {
        post: vi.fn(),
    },
}));

vi.mock('../../utils/formatUtils', () => ({
    formatSize: (bytes: number) => `${bytes} bytes`,
}));

// --- Mock child components ---

vi.mock('../../components/ConfirmationModal', () => ({
    default: (props: ConfirmationModalProps) =>
        props.isOpen ? (
            <div data-testid="confirmation-modal">
                <span data-testid="modal-title">{props.title}</span>
                <span data-testid="modal-message">{props.message}</span>
                <button data-testid="modal-confirm" onClick={props.onConfirm}>
                    {props.confirmText}
                </button>
                <button data-testid="modal-cancel" onClick={props.onClose}>
                    {props.cancelText}
                </button>
            </div>
        ) : null,
}));

vi.mock('../../components/DeleteCollectionModal', () => ({
    default: (props: DeleteCollectionModalProps) =>
        props.isOpen ? (
            <div data-testid="delete-collection-modal">
                <span data-testid="delete-collection-name">{props.collectionName}</span>
                <span data-testid="delete-collection-video-count">{props.videoCount}</span>
                <button data-testid="delete-collection-only" onClick={props.onDeleteCollectionOnly}>
                    Delete Collection Only
                </button>
                <button data-testid="delete-collection-and-videos" onClick={props.onDeleteCollectionAndVideos}>
                    Delete Collection and Videos
                </button>
                <button data-testid="delete-collection-close" onClick={props.onClose}>
                    Close
                </button>
            </div>
        ) : null,
}));

let capturedVideosTableProps: CapturedVideosTableProps | null = null;

vi.mock('../../components/ManagePage/CollectionsTable', () => ({
    default: (props: CollectionsTableProps) => (
        <div data-testid="collections-table">
            <span data-testid="collections-count">{props.totalCollectionsCount}</span>
            <span data-testid="collections-page">{props.page}</span>
            <button
                data-testid="collections-delete-btn"
                onClick={() => props.onDelete?.({ id: 'col-1', name: 'Test Collection', videos: ['vid-1', 'vid-2'], createdAt: '2024-01-01' })}
            >
                Delete Collection
            </button>
            <button
                data-testid="collections-page-change-btn"
                onClick={() => props.onPageChange?.({}, 2)}
            >
                Next Page
            </button>
            <button
                data-testid="collections-sort-btn"
                onClick={() => props.onSort?.('name')}
            >
                Sort
            </button>
        </div>
    ),
}));

vi.mock('../../components/ManagePage/VideosTable', () => ({
    default: (props: CapturedVideosTableProps) => {
        capturedVideosTableProps = props;
        return (
            <div data-testid="videos-table">
                <span data-testid="videos-count">{props.totalVideosCount}</span>
                <span data-testid="videos-search-term">{props.searchTerm}</span>
                <span data-testid="videos-page">{props.page}</span>
                <input
                    data-testid="videos-search-input"
                    value={props.searchTerm}
                    onChange={(e) => props.onSearchChange?.(e.target.value)}
                />
                <button
                    data-testid="videos-delete-btn"
                    onClick={() => props.onDeleteClick?.('vid-1')}
                >
                    Delete Video
                </button>
                <button
                    data-testid="videos-refresh-thumbnail-btn"
                    onClick={() => props.onRefreshThumbnail?.('vid-1')}
                >
                    Refresh Thumbnail
                </button>
                <button
                    data-testid="videos-refresh-file-sizes-btn"
                    onClick={() => props.onRefreshFileSizes?.()}
                >
                    Refresh File Sizes
                </button>
                <button
                    data-testid="videos-page-change-btn"
                    onClick={() => props.onPageChange?.({}, 2)}
                >
                    Next Page
                </button>
                <button
                    data-testid="videos-sort-btn"
                    onClick={() => props.onSort?.('title')}
                >
                    Sort
                </button>
            </div>
        );
    },
}));

// --- Test suite ---

describe('ManagePage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mutationCallIndex = 0;
        capturedVideosTableProps = null;

        mockUserRole = 'admin';
        mockVideos = [
            {
                id: 'vid-1',
                title: 'Test Video 1',
                author: 'Author A',
                date: '2024-01-01',
                source: 'youtube' as const,
                sourceUrl: 'https://youtube.com/1',
                addedAt: '2024-01-01T00:00:00Z',
                fileSize: '1000',
            },
            {
                id: 'vid-2',
                title: 'Test Video 2',
                author: 'Author B',
                date: '2024-01-02',
                source: 'local' as const,
                sourceUrl: '',
                addedAt: '2024-01-02T00:00:00Z',
                fileSize: '2000',
            },
        ];
        mockCollections = [
            {
                id: 'col-1',
                name: 'Collection One',
                videos: ['vid-1'],
                createdAt: '2024-01-01T00:00:00Z',
            },
            {
                id: 'col-2',
                name: 'Collection Two',
                videos: ['vid-1', 'vid-2'],
                createdAt: '2024-02-01T00:00:00Z',
            },
        ];

        mockDeleteVideo.mockResolvedValue(undefined);
        mockDeleteCollection.mockResolvedValue(undefined);
        mockUpdateCollection.mockResolvedValue({ success: true });
        mockFetchVideos.mockResolvedValue(undefined);
    });

    const renderManagePage = () => {
        const theme = createTheme();
        return render(
            <ThemeProvider theme={theme}>
                <ManagePage />
            </ThemeProvider>
        );
    };

    // ---- Test 1: Page title ----
    it('renders the page title "manageContent"', () => {
        renderManagePage();
        expect(screen.getByText('manageContent')).toBeInTheDocument();
    });

    // ---- Test 2: Scan files button for admin ----
    it('shows scan files button for admin users', () => {
        renderManagePage();
        expect(screen.getByText('scanFiles')).toBeInTheDocument();
    });

    // ---- Test 3: Hides scan files button for visitor ----
    it('hides scan files button for visitor users', () => {
        mockUserRole = 'visitor';
        renderManagePage();
        expect(screen.queryByText('scanFiles')).not.toBeInTheDocument();
    });

    // ---- Test 4: Tab switching ----
    it('switches between collections and videos tabs', () => {
        renderManagePage();

        // Collections tab is active by default (tab index 0)
        expect(screen.getByTestId('collections-table')).toBeInTheDocument();
        expect(screen.queryByTestId('videos-table')).not.toBeInTheDocument();

        // Click the videos tab
        const videosTab = screen.getByRole('tab', { name: /videos/i });
        fireEvent.click(videosTab);

        expect(screen.queryByTestId('collections-table')).not.toBeInTheDocument();
        expect(screen.getByTestId('videos-table')).toBeInTheDocument();

        // Switch back to collections tab
        const collectionsTab = screen.getByRole('tab', { name: /collections/i });
        fireEvent.click(collectionsTab);

        expect(screen.getByTestId('collections-table')).toBeInTheDocument();
        expect(screen.queryByTestId('videos-table')).not.toBeInTheDocument();
    });

    // ---- Test 5: Collections tab renders CollectionsTable ----
    it('renders CollectionsTable on the collections tab', () => {
        renderManagePage();
        expect(screen.getByTestId('collections-table')).toBeInTheDocument();
        expect(screen.getByTestId('collections-count')).toHaveTextContent('2');
    });

    // ---- Test 6: Videos tab renders VideosTable ----
    it('renders VideosTable on the videos tab', () => {
        renderManagePage();

        const videosTab = screen.getByRole('tab', { name: /videos/i });
        fireEvent.click(videosTab);

        expect(screen.getByTestId('videos-table')).toBeInTheDocument();
        expect(screen.getByTestId('videos-count')).toHaveTextContent('2');
    });

    // ---- Test 7: Delete video flow ----
    it('opens confirmation modal when deleting a video and calls deleteVideo on confirm', async () => {
        renderManagePage();

        // Switch to videos tab
        const videosTab = screen.getByRole('tab', { name: /videos/i });
        fireEvent.click(videosTab);

        // No confirmation modal initially
        expect(screen.queryByTestId('confirmation-modal')).not.toBeInTheDocument();

        // Click delete on a video
        fireEvent.click(screen.getByTestId('videos-delete-btn'));

        // Confirmation modal should appear
        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
        expect(screen.getByTestId('modal-title')).toHaveTextContent('deleteVideo');
        expect(screen.getByTestId('modal-message')).toHaveTextContent('confirmDelete');

        // Confirm the deletion
        fireEvent.click(screen.getByTestId('modal-confirm'));

        await waitFor(() => {
            expect(mockDeleteVideo).toHaveBeenCalledWith('vid-1');
        });
    });

    it('closes the video delete modal when cancel is clicked', () => {
        renderManagePage();

        const videosTab = screen.getByRole('tab', { name: /videos/i });
        fireEvent.click(videosTab);

        fireEvent.click(screen.getByTestId('videos-delete-btn'));
        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('modal-cancel'));
        expect(screen.queryByTestId('confirmation-modal')).not.toBeInTheDocument();
    });

    // ---- Test 8: Delete collection flow ----
    it('opens DeleteCollectionModal when deleting a collection', () => {
        renderManagePage();

        expect(screen.queryByTestId('delete-collection-modal')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('collections-delete-btn'));

        expect(screen.getByTestId('delete-collection-modal')).toBeInTheDocument();
        expect(screen.getByTestId('delete-collection-name')).toHaveTextContent('Test Collection');
        expect(screen.getByTestId('delete-collection-video-count')).toHaveTextContent('2');
    });

    it('calls deleteCollection with deleteVideos=false when "delete collection only" is clicked', async () => {
        renderManagePage();

        fireEvent.click(screen.getByTestId('collections-delete-btn'));
        fireEvent.click(screen.getByTestId('delete-collection-only'));

        await waitFor(() => {
            expect(mockDeleteCollection).toHaveBeenCalledWith('col-1', false);
        });
    });

    it('calls deleteCollection with deleteVideos=true when "delete collection and videos" is clicked', async () => {
        renderManagePage();

        fireEvent.click(screen.getByTestId('collections-delete-btn'));
        fireEvent.click(screen.getByTestId('delete-collection-and-videos'));

        await waitFor(() => {
            expect(mockDeleteCollection).toHaveBeenCalledWith('col-1', true);
        });
    });

    // ---- Test 9: Scan files confirmation modal flow ----
    it('opens scan files confirmation modal and triggers scan on confirm', () => {
        renderManagePage();

        // Click scan files button
        fireEvent.click(screen.getByText('scanFiles'));

        // The scan confirmation modal should appear (it is the second ConfirmationModal)
        // We need to find the one with the scan-related title
        const modals = screen.getAllByTestId('confirmation-modal');
        expect(modals.length).toBeGreaterThanOrEqual(1);

        // Confirm the scan
        const confirmButtons = screen.getAllByTestId('modal-confirm');
        // The scan modal is the last one rendered
        fireEvent.click(confirmButtons[confirmButtons.length - 1]);

        expect(mockMutate).toHaveBeenCalled();
    });

    it('closes scan files confirmation modal on cancel', () => {
        renderManagePage();

        fireEvent.click(screen.getByText('scanFiles'));

        // Modal should be visible
        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();

        // Cancel
        fireEvent.click(screen.getByTestId('modal-cancel'));

        // Modal should be closed
        expect(screen.queryByTestId('confirmation-modal')).not.toBeInTheDocument();
    });

    // ---- Test 10: Search term filtering ----
    it('passes searchTerm to VideosTable and filters videos', () => {
        mockVideos = [
            {
                id: 'vid-1',
                title: 'Alpha Video',
                author: 'Author A',
                date: '2024-01-01',
                source: 'youtube' as const,
                sourceUrl: '',
                addedAt: '2024-01-01T00:00:00Z',
                fileSize: '1000',
            },
            {
                id: 'vid-2',
                title: 'Beta Video',
                author: 'Author B',
                date: '2024-01-02',
                source: 'local' as const,
                sourceUrl: '',
                addedAt: '2024-01-02T00:00:00Z',
                fileSize: '2000',
            },
            {
                id: 'vid-3',
                title: 'Gamma Video',
                author: 'Alpha Author',
                date: '2024-01-03',
                source: 'local' as const,
                sourceUrl: '',
                addedAt: '2024-01-03T00:00:00Z',
                fileSize: '3000',
            },
        ];

        renderManagePage();

        // Switch to videos tab
        const videosTab = screen.getByRole('tab', { name: /videos/i });
        fireEvent.click(videosTab);

        // Initially all 3 videos
        expect(screen.getByTestId('videos-count')).toHaveTextContent('3');

        // Type a search term via the mock input
        fireEvent.change(screen.getByTestId('videos-search-input'), {
            target: { value: 'Alpha' },
        });

        // After search, the filtered count should be 2 (vid-1 title "Alpha Video" + vid-3 author "Alpha Author")
        expect(screen.getByTestId('videos-count')).toHaveTextContent('2');
        expect(screen.getByTestId('videos-search-term')).toHaveTextContent('Alpha');
    });

    // ---- Test 11: Pagination state management ----
    it('manages collection pagination state', () => {
        renderManagePage();

        // Default page is 1
        expect(screen.getByTestId('collections-page')).toHaveTextContent('1');

        // Click next page
        fireEvent.click(screen.getByTestId('collections-page-change-btn'));

        expect(screen.getByTestId('collections-page')).toHaveTextContent('2');
    });

    it('manages video pagination state', () => {
        renderManagePage();

        // Switch to videos tab
        const videosTab = screen.getByRole('tab', { name: /videos/i });
        fireEvent.click(videosTab);

        // Default page is 1
        expect(screen.getByTestId('videos-page')).toHaveTextContent('1');

        // Click next page
        fireEvent.click(screen.getByTestId('videos-page-change-btn'));

        expect(screen.getByTestId('videos-page')).toHaveTextContent('2');
    });

    // ---- Additional edge cases ----

    it('renders tab labels with correct counts', () => {
        renderManagePage();

        expect(screen.getByRole('tab', { name: /collections \(2\)/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /videos \(2\)/i })).toBeInTheDocument();
    });

    it('handles refreshThumbnail through VideosTable', async () => {
        renderManagePage();

        const videosTab = screen.getByRole('tab', { name: /videos/i });
        fireEvent.click(videosTab);

        fireEvent.click(screen.getByTestId('videos-refresh-thumbnail-btn'));

        await waitFor(() => {
            expect(mockRefreshThumbnail).toHaveBeenCalledWith('vid-1');
        });
    });

    it('triggers refreshFileSizes mutation through VideosTable', () => {
        renderManagePage();

        const videosTab = screen.getByRole('tab', { name: /videos/i });
        fireEvent.click(videosTab);

        fireEvent.click(screen.getByTestId('videos-refresh-file-sizes-btn'));

        expect(mockRefreshFileSizesMutate).toHaveBeenCalled();
    });

    it('renders with empty videos and collections', () => {
        mockVideos = [];
        mockCollections = [];

        renderManagePage();

        expect(screen.getByText('manageContent')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /collections \(0\)/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /videos \(0\)/i })).toBeInTheDocument();
    });

    it('passes totalSize to VideosTable as sum of filtered video file sizes', () => {
        renderManagePage();

        const videosTab = screen.getByRole('tab', { name: /videos/i });
        fireEvent.click(videosTab);

        // vid-1: 1000 + vid-2: 2000 = 3000
        expect(capturedVideosTableProps!.totalSize).toBe(3000);
    });

    it('passes onUpdateVideo to VideosTable', () => {
        renderManagePage();

        const videosTab = screen.getByRole('tab', { name: /videos/i });
        fireEvent.click(videosTab);

        expect(capturedVideosTableProps!.onUpdateVideo).toBe(mockUpdateVideo);
    });
});
