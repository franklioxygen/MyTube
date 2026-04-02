import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManagePage from '../ManagePage';
import type { CapturedVideosTableProps, CollectionsTableProps } from './managePageTestTypes';

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
const mockApiPost = vi.fn();
const mockMutate = vi.fn(), mockRefreshFileSizesMutate = vi.fn();
let scanMutationCallbacks: { onSuccess?: (data: any) => unknown; onError?: (error: any) => unknown } = {};
let refreshFileSizesMutationCallbacks: { onSuccess?: (data: any) => unknown; onError?: (error: any) => unknown } = {};
let scanMutationFn: (() => Promise<any>) | undefined;
let scanMutationPending = false;
let refreshFileSizesMutationPending = false;

// --- Mocks ---

vi.mock('react-router-dom', () => ({
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    useNavigate: () => vi.fn(),
}));

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) =>
            ({
                scanFilesSuccess: 'scanFilesSuccess {count}',
                scanFilesDeleted: 'scanFilesDeleted {count}',
                refreshFileSizesSuccess: 'refreshFileSizesSuccess {count}',
                refreshFileSizesFailed: 'refreshFileSizesFailed {count}',
                refreshFileSizesSkipped: 'refreshFileSizesSkipped {count}',
                refreshFileSizesError: 'refreshFileSizesError {error}',
            }[key] ?? key),
    }),
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
    useMutation: ({ mutationFn, onSuccess, onError }: { mutationFn?: () => Promise<any>; onSuccess?: (data: any) => unknown; onError?: (error: any) => unknown }) => {
        const index = mutationCallIndex++;
        if (index % 2 === 0) {
            // First call in each render = scanMutation
            scanMutationCallbacks = { onSuccess, onError };
            scanMutationFn = mutationFn;
            return {
                mutate: mockMutate,
                isPending: scanMutationPending,
            };
        } else {
            // Second call in each render = refreshFileSizesMutation
            refreshFileSizesMutationCallbacks = { onSuccess, onError };
            return {
                mutate: mockRefreshFileSizesMutate,
                isPending: refreshFileSizesMutationPending,
            };
        }
    },
}));

vi.mock('../../utils/apiClient', () => ({
    api: {
        post: (...args: any[]) => mockApiPost(...args),
    },
}));

vi.mock('../../utils/formatUtils', () => ({
    formatSize: (bytes: number) => `${bytes} bytes`,
}));

// --- Mock only heavy child components (tables with many context deps) ---
// NOTE: ConfirmationModal and DeleteCollectionModal are NOT mocked.
// They render as real components so their code is covered.

let capturedVideosTableProps: CapturedVideosTableProps | null = null;
let capturedCollectionsTableProps: CollectionsTableProps | null = null;

vi.mock('../../components/ManagePage/CollectionsTable', () => ({
    default: (props: CollectionsTableProps) => {
        capturedCollectionsTableProps = props;
        return (
            <div data-testid="collections-table">
                <span data-testid="collections-count">{props.totalCollectionsCount}</span>
                <span data-testid="collections-page">{props.page}</span>
                <span data-testid="collections-first-name">{props.displayedCollections[0]?.name ?? 'none'}</span>
                <span data-testid="collections-first-size">
                    {props.displayedCollections[0] ? props.getCollectionSize(props.displayedCollections[0].videos) : 'none'}
                </span>
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
                    data-testid="collections-sort-name-btn"
                    onClick={() => props.onSort?.('name')}
                >
                    Sort Name
                </button>
                <button
                    data-testid="collections-sort-size-btn"
                    onClick={() => props.onSort?.('size')}
                >
                    Sort Size
                </button>
                <button
                    data-testid="collections-sort-video-count-btn"
                    onClick={() => props.onSort?.('videoCount')}
                >
                    Sort Video Count
                </button>
            </div>
        );
    },
}));

vi.mock('../../components/ManagePage/VideosTable', () => ({
    default: (props: CapturedVideosTableProps) => {
        capturedVideosTableProps = props;
        return (
            <div data-testid="videos-table">
                <span data-testid="videos-count">{props.totalVideosCount}</span>
                <span data-testid="videos-search-term">{props.searchTerm}</span>
                <span data-testid="videos-page">{props.page}</span>
                <span data-testid="videos-first-title">{props.displayedVideos[0]?.title ?? 'none'}</span>
                <span data-testid="videos-order">{props.order}</span>
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
                <button
                    data-testid="videos-sort-file-size-btn"
                    onClick={() => props.onSort?.('fileSize')}
                >
                    Sort File Size
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
        capturedCollectionsTableProps = null;
        scanMutationCallbacks = {};
        refreshFileSizesMutationCallbacks = {};
        scanMutationFn = undefined;
        scanMutationPending = false;
        refreshFileSizesMutationPending = false;
        window.scrollTo = vi.fn();

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

    // --- Page rendering ---
    describe('page rendering', () => {
        it('renders the page title "manageContent"', () => {
            renderManagePage();
            expect(screen.getByText('manageContent')).toBeInTheDocument();
        });

        it('shows scan files button for admin users', () => {
            renderManagePage();
            expect(screen.getByText('scanFiles')).toBeInTheDocument();
        });

        it('hides scan files button for visitor users', () => {
            mockUserRole = 'visitor';
            renderManagePage();
            expect(screen.queryByText('scanFiles')).not.toBeInTheDocument();
        });

        it('renders tab labels with correct counts', () => {
            renderManagePage();
            expect(screen.getByRole('tab', { name: /collections \(2\)/i })).toBeInTheDocument();
            expect(screen.getByRole('tab', { name: /videos \(2\)/i })).toBeInTheDocument();
        });

        it('renders with empty videos and collections', () => {
            mockVideos = [];
            mockCollections = [];
            renderManagePage();
            expect(screen.getByText('manageContent')).toBeInTheDocument();
            expect(screen.getByRole('tab', { name: /collections \(0\)/i })).toBeInTheDocument();
            expect(screen.getByRole('tab', { name: /videos \(0\)/i })).toBeInTheDocument();
        });
    });

    // --- Tab switching ---
    describe('tab switching', () => {
        it('shows collections tab by default', () => {
            renderManagePage();
            expect(screen.getByTestId('collections-table')).toBeInTheDocument();
            expect(screen.queryByTestId('videos-table')).not.toBeInTheDocument();
        });

        it('switches to videos tab', () => {
            renderManagePage();
            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));
            expect(screen.queryByTestId('collections-table')).not.toBeInTheDocument();
            expect(screen.getByTestId('videos-table')).toBeInTheDocument();
        });

        it('switches back to collections tab', () => {
            renderManagePage();
            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));
            fireEvent.click(screen.getByRole('tab', { name: /collections/i }));
            expect(screen.getByTestId('collections-table')).toBeInTheDocument();
            expect(screen.queryByTestId('videos-table')).not.toBeInTheDocument();
        });
    });

    // --- Table props ---
    describe('table props', () => {
        it('renders CollectionsTable with correct count', () => {
            renderManagePage();
            expect(screen.getByTestId('collections-count')).toHaveTextContent('2');
        });

        it('renders VideosTable with correct count', () => {
            renderManagePage();
            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));
            expect(screen.getByTestId('videos-count')).toHaveTextContent('2');
        });

        it('passes totalSize to VideosTable as sum of filtered video file sizes', () => {
            renderManagePage();
            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));
            // vid-1: 1000 + vid-2: 2000 = 3000
            expect(capturedVideosTableProps!.totalSize).toBe(3000);
        });

        it('passes onUpdateVideo to VideosTable', () => {
            renderManagePage();
            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));
            expect(capturedVideosTableProps!.onUpdateVideo).toBe(mockUpdateVideo);
        });
    });

    // --- Delete video flow (real ConfirmationModal) ---
    describe('delete video flow', () => {
        it('opens real confirmation modal when deleting a video', () => {
            renderManagePage();
            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));

            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

            fireEvent.click(screen.getByTestId('videos-delete-btn'));

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('deleteVideo')).toBeInTheDocument();
            expect(within(dialog).getByText('confirmDelete')).toBeInTheDocument();
        });

        it('calls deleteVideo on confirm', async () => {
            renderManagePage();
            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));
            fireEvent.click(screen.getByTestId('videos-delete-btn'));

            const dialog = screen.getByRole('dialog');
            fireEvent.click(within(dialog).getByText('delete'));

            await waitFor(() => {
                expect(mockDeleteVideo).toHaveBeenCalledWith('vid-1');
            });
        });

        it('closes modal on cancel', async () => {
            renderManagePage();
            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));
            fireEvent.click(screen.getByTestId('videos-delete-btn'));

            const dialog = screen.getByRole('dialog');
            fireEvent.click(within(dialog).getByText('cancel'));

            await waitFor(() => {
                expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            });
        });

        it('closes modal on close icon button', async () => {
            renderManagePage();
            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));
            fireEvent.click(screen.getByTestId('videos-delete-btn'));

            const dialog = screen.getByRole('dialog');
            fireEvent.click(within(dialog).getByLabelText('close'));

            await waitFor(() => {
                expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            });
        });
    });

    // --- Delete collection flow (real DeleteCollectionModal) ---
    describe('delete collection flow', () => {
        it('opens real DeleteCollectionModal when deleting a collection', () => {
            renderManagePage();
            fireEvent.click(screen.getByTestId('collections-delete-btn'));

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('deleteCollectionTitle')).toBeInTheDocument();
            expect(within(dialog).getByText(/Test Collection/)).toBeInTheDocument();
        });

        it('shows video count in delete collection modal', () => {
            renderManagePage();
            fireEvent.click(screen.getByTestId('collections-delete-btn'));

            const dialog = screen.getByRole('dialog');
            // The mock passes videos: ['vid-1', 'vid-2'] = videoCount 2
            expect(within(dialog).getByText('2')).toBeInTheDocument();
        });

        it('calls deleteCollection with deleteVideos=false on "delete collection only"', async () => {
            renderManagePage();
            fireEvent.click(screen.getByTestId('collections-delete-btn'));

            const dialog = screen.getByRole('dialog');
            fireEvent.click(within(dialog).getByText('deleteCollectionOnly'));

            await waitFor(() => {
                expect(mockDeleteCollection).toHaveBeenCalledWith('col-1', false);
            });
        });

        it('calls deleteCollection with deleteVideos=true on "delete collection and videos"', async () => {
            renderManagePage();
            fireEvent.click(screen.getByTestId('collections-delete-btn'));

            const dialog = screen.getByRole('dialog');
            fireEvent.click(within(dialog).getByText('deleteCollectionAndVideos'));

            await waitFor(() => {
                expect(mockDeleteCollection).toHaveBeenCalledWith('col-1', true);
            });
        });

        it('closes modal on cancel', async () => {
            renderManagePage();
            fireEvent.click(screen.getByTestId('collections-delete-btn'));

            const dialog = screen.getByRole('dialog');
            fireEvent.click(within(dialog).getByText('cancel'));

            await waitFor(() => {
                expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            });
        });
    });

    // --- Scan files flow (real ConfirmationModal) ---
    describe('scan files flow', () => {
        it('opens scan confirmation modal on button click', () => {
            renderManagePage();
            fireEvent.click(screen.getByText('scanFiles'));

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('scanFilesConfirmMessage')).toBeInTheDocument();
        });

        it('triggers scan mutation on confirm', () => {
            renderManagePage();
            fireEvent.click(screen.getByText('scanFiles'));

            const dialog = screen.getByRole('dialog');
            fireEvent.click(within(dialog).getByText('continue'));

            expect(mockMutate).toHaveBeenCalled();
        });

        it('calls scan endpoint without a client-side timeout', async () => {
            mockApiPost.mockResolvedValueOnce({ data: { addedCount: 0, deletedCount: 0 } });

            renderManagePage();

            await scanMutationFn?.();

            expect(mockApiPost).toHaveBeenCalledWith('/scan-files', undefined, { timeout: 0 });
        });

        it('closes scan modal on cancel', async () => {
            renderManagePage();
            fireEvent.click(screen.getByText('scanFiles'));

            const dialog = screen.getByRole('dialog');
            fireEvent.click(within(dialog).getByText('cancel'));

            await waitFor(() => {
                expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            });
        });
    });

    // --- Search filtering ---
    describe('search filtering', () => {
        it('filters videos by search term', () => {
            mockVideos = [
                { id: 'vid-1', title: 'Alpha Video', author: 'Author A', date: '2024-01-01', source: 'youtube' as const, sourceUrl: '', addedAt: '2024-01-01T00:00:00Z', fileSize: '1000' },
                { id: 'vid-2', title: 'Beta Video', author: 'Author B', date: '2024-01-02', source: 'local' as const, sourceUrl: '', addedAt: '2024-01-02T00:00:00Z', fileSize: '2000' },
                { id: 'vid-3', title: 'Gamma Video', author: 'Alpha Author', date: '2024-01-03', source: 'local' as const, sourceUrl: '', addedAt: '2024-01-03T00:00:00Z', fileSize: '3000' },
            ];

            renderManagePage();
            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));

            expect(screen.getByTestId('videos-count')).toHaveTextContent('3');

            fireEvent.change(screen.getByTestId('videos-search-input'), { target: { value: 'Alpha' } });

            expect(screen.getByTestId('videos-count')).toHaveTextContent('2');
            expect(screen.getByTestId('videos-search-term')).toHaveTextContent('Alpha');
        });
    });

    // --- Pagination ---
    describe('pagination', () => {
        it('manages collection pagination state', () => {
            renderManagePage();
            expect(screen.getByTestId('collections-page')).toHaveTextContent('1');
            fireEvent.click(screen.getByTestId('collections-page-change-btn'));
            expect(screen.getByTestId('collections-page')).toHaveTextContent('2');
        });

        it('manages video pagination state', () => {
            renderManagePage();
            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));
            expect(screen.getByTestId('videos-page')).toHaveTextContent('1');
            fireEvent.click(screen.getByTestId('videos-page-change-btn'));
            expect(screen.getByTestId('videos-page')).toHaveTextContent('2');
            expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
        });
    });

    describe('sorting and derived data', () => {
        it('sorts collections by name, size, and video count while calculating sizes safely', () => {
            mockVideos = [
                { id: 'vid-1', title: 'Video 1', author: 'Author A', addedAt: '2024-01-01T00:00:00Z', fileSize: '400' },
                { id: 'vid-2', title: 'Video 2', author: 'Author B', addedAt: '2024-01-02T00:00:00Z', fileSize: 'not-a-number' },
                { id: 'vid-3', title: 'Video 3', author: 'Author C', addedAt: '2024-01-03T00:00:00Z', fileSize: '800' },
            ];
            mockCollections = [
                { id: 'col-1', name: 'Zoo', videos: ['vid-1'], createdAt: '2024-01-01T00:00:00Z' },
                { id: 'col-2', name: 'Alpha', videos: ['vid-1', 'vid-3'], createdAt: '2024-02-01T00:00:00Z' },
                { id: 'col-3', name: 'Beta', videos: [], createdAt: '2024-03-01T00:00:00Z' },
            ];

            renderManagePage();

            expect(screen.getByTestId('collections-first-name')).toHaveTextContent('Beta');
            expect(screen.getByTestId('collections-first-size')).toHaveTextContent('0 bytes');

            fireEvent.click(screen.getByTestId('collections-sort-name-btn'));
            expect(screen.getByTestId('collections-first-name')).toHaveTextContent('Alpha');

            fireEvent.click(screen.getByTestId('collections-sort-name-btn'));
            expect(screen.getByTestId('collections-first-name')).toHaveTextContent('Zoo');

            fireEvent.click(screen.getByTestId('collections-sort-size-btn'));
            fireEvent.click(screen.getByTestId('collections-sort-size-btn'));
            expect(screen.getByTestId('collections-first-name')).toHaveTextContent('Alpha');

            fireEvent.click(screen.getByTestId('collections-sort-video-count-btn'));
            fireEvent.click(screen.getByTestId('collections-sort-video-count-btn'));
            expect(screen.getByTestId('collections-first-name')).toHaveTextContent('Alpha');
        });

        it('sorts videos by title and file size while ignoring invalid file sizes in totals', () => {
            mockVideos = [
                { id: 'vid-1', title: 'Beta Video', author: 'Author A', addedAt: '2024-01-01T00:00:00Z', fileSize: 'not-a-number' },
                { id: 'vid-2', title: 'Alpha Video', author: 'Author B', addedAt: '2024-01-03T00:00:00Z', fileSize: '500' },
                { id: 'vid-3', title: 'Gamma Video', author: 'Author C', addedAt: '2024-01-02T00:00:00Z', fileSize: '200' },
            ];

            renderManagePage();
            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));

            expect(screen.getByTestId('videos-first-title')).toHaveTextContent('Alpha Video');
            expect(capturedVideosTableProps!.totalSize).toBe(700);

            fireEvent.click(screen.getByTestId('videos-sort-btn'));
            expect(screen.getByTestId('videos-first-title')).toHaveTextContent('Alpha Video');
            expect(screen.getByTestId('videos-order')).toHaveTextContent('asc');

            fireEvent.click(screen.getByTestId('videos-sort-btn'));
            expect(screen.getByTestId('videos-first-title')).toHaveTextContent('Gamma Video');
            expect(screen.getByTestId('videos-order')).toHaveTextContent('desc');

            fireEvent.click(screen.getByTestId('videos-sort-file-size-btn'));
            expect(screen.getByTestId('videos-first-title')).toHaveTextContent('Beta Video');

            fireEvent.click(screen.getByTestId('videos-sort-file-size-btn'));
            expect(screen.getByTestId('videos-first-title')).toHaveTextContent('Beta Video');
        });
    });

    // --- Other interactions ---
    describe('other interactions', () => {
        it('handles refreshThumbnail through VideosTable', async () => {
            renderManagePage();
            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));
            fireEvent.click(screen.getByTestId('videos-refresh-thumbnail-btn'));
            await waitFor(() => {
                expect(mockRefreshThumbnail).toHaveBeenCalledWith('vid-1');
            });
        });

        it('triggers refreshFileSizes mutation through VideosTable', () => {
            renderManagePage();
            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));
            fireEvent.click(screen.getByTestId('videos-refresh-file-sizes-btn'));
            expect(mockRefreshFileSizesMutate).toHaveBeenCalled();
        });

        it('renders pending scan and refresh-file-size states', () => {
            scanMutationPending = true;
            refreshFileSizesMutationPending = true;

            renderManagePage();

            expect(screen.getByText('scanning')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('tab', { name: /videos/i }));
            expect(capturedVideosTableProps!.isRefreshingFileSizes).toBe(true);
        });

        it('shows snackbar messages for scan mutation success and error callbacks', () => {
            renderManagePage();

            scanMutationCallbacks.onSuccess?.({ addedCount: 2, deletedCount: 1 });
            expect(mockShowSnackbar).toHaveBeenCalledWith('scanFilesSuccess 2scanFilesDeleted 1');

            scanMutationCallbacks.onError?.({ response: { data: { details: 'scan exploded' } } });
            expect(mockShowSnackbar).toHaveBeenLastCalledWith('scanFilesFailed: scan exploded');
        });

        it('shows snackbar messages for refresh-file-size success, skipped, failed, and error callbacks', async () => {
            renderManagePage();

            await refreshFileSizesMutationCallbacks.onSuccess?.({ updatedCount: 4, failedCount: 1, skippedCount: 0 });
            expect(mockFetchVideos).toHaveBeenCalled();
            expect(mockShowSnackbar).toHaveBeenLastCalledWith('refreshFileSizesSuccess 4refreshFileSizesFailed 1');

            await refreshFileSizesMutationCallbacks.onSuccess?.({ updatedCount: 2, failedCount: 0, skippedCount: 3 });
            expect(mockShowSnackbar).toHaveBeenLastCalledWith('refreshFileSizesSuccess 2refreshFileSizesSkipped 3');

            refreshFileSizesMutationCallbacks.onError?.({ message: 'refresh exploded' });
            expect(mockShowSnackbar).toHaveBeenLastCalledWith('refreshFileSizesError refresh exploded');
        });

        it('throws when collection updates return an unsuccessful result', async () => {
            mockUpdateCollection.mockResolvedValueOnce({ success: false, error: 'update failed' });

            renderManagePage();

            await expect(capturedCollectionsTableProps!.onUpdate('col-1', 'Broken Name')).rejects.toThrow('update failed');
        });
    });
});
