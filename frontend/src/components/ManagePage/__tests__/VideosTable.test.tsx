import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { AxiosHeaders } from 'axios';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Video } from '../../../types';
import VideosTable from '../VideosTable';
import { api } from '../../../utils/apiClient';

let mockUserRole = 'admin';
let mockCollections = [
    { id: 'collection-1', name: 'Collection 1', videos: [] },
    { id: 'collection-2', name: 'Collection 2', videos: [] },
];
let mockActiveDownloads: Array<{ sourceUrl: string }> = [];
let mockQueuedDownloads: Array<{ sourceUrl: string }> = [];
const mockAvailableTags = ['Music', 'Tutorial'];

const mockDeleteVideo = vi.fn();
const mockAddToCollection = vi.fn();
const mockCreateCollection = vi.fn();
const mockFetchCollections = vi.fn();
const mockShowSnackbar = vi.fn();
const mockInvalidateQueries = vi.fn();

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../contexts/AuthContext', () => ({
    useAuth: () => ({ userRole: mockUserRole }),
}));

vi.mock('../../../contexts/VideoContext', () => ({
    useVideo: () => ({
        deleteVideo: mockDeleteVideo,
        availableTags: mockAvailableTags,
    }),
}));

vi.mock('../../../contexts/CollectionContext', () => ({
    useCollection: () => ({
        collections: mockCollections,
        addToCollection: mockAddToCollection,
        createCollection: mockCreateCollection,
        fetchCollections: mockFetchCollections,
    }),
}));

vi.mock('../../../contexts/DownloadContext', () => ({
    useDownload: () => ({
        activeDownloads: mockActiveDownloads,
        queuedDownloads: mockQueuedDownloads,
    }),
}));

vi.mock('../../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({
        showSnackbar: mockShowSnackbar,
    }),
}));

vi.mock('@tanstack/react-query', async () => {
    const actual = await vi.importActual('@tanstack/react-query');
    return {
        ...actual,
        useQueryClient: vi.fn(),
    };
});

vi.mock('../../../utils/apiClient', () => ({
    ensureCsrfToken: vi.fn().mockResolvedValue(undefined),
    api: {
        post: vi.fn(),
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('../../../hooks/useCloudStorageUrl', () => ({
    useCloudStorageUrl: (path: string | null | undefined) => (path ? 'mock-cloud-url' : undefined),
}));

vi.mock('../../CollectionModal', () => ({
    default: ({
        open,
        collections,
        onClose,
        onAddToCollection,
        onCreateCollection,
    }: {
        open: boolean;
        collections?: Array<{ id: string; name: string }>;
        onClose: () => void;
        onAddToCollection?: (collectionId: string) => Promise<void>;
        onCreateCollection?: (name: string) => Promise<void>;
    }) =>
        open ? (
            <div data-testid="collection-modal">
                <span data-testid="collection-modal-count">{collections?.length ?? 0}</span>
                <button onClick={() => onAddToCollection?.('collection-1')}>mock-add-existing</button>
                <button onClick={() => onCreateCollection?.('Created Collection')}>mock-create-collection</button>
                <button onClick={onClose}>mock-close-collection</button>
            </div>
        ) : null,
}));

vi.mock('../../UploadThumbnailModal', () => ({
    default: ({
        open,
        onClose,
        onUpload,
    }: {
        open: boolean;
        onClose: () => void;
        onUpload: (file: File) => Promise<void>;
    }) =>
        open ? (
            <div data-testid="upload-thumbnail-modal">
                <button onClick={() => onUpload(new File(['thumb'], 'thumb.png', { type: 'image/png' }))}>
                    trigger-upload-thumbnail
                </button>
                <button onClick={onClose}>close-upload-thumbnail</button>
            </div>
        ) : null,
}));

describe('VideosTable', () => {
    const mockVideos = [
        {
            id: '1',
            title: 'Video 1',
            author: 'Author 1',
            fileSize: '1024',
            duration: 60,
            addedAt: '2023-01-01',
            sourceUrl: 'https://youtube.com/watch?v=test1',
            thumbnailPath: '/images/thumb-1.jpg',
            thumbnailUrl: '/images/thumb-1.jpg?t=123',
        },
        {
            id: '2',
            title: 'Video 2',
            author: 'Author 2',
            fileSize: '2048',
            duration: 120,
            addedAt: '2023-01-02',
            sourceUrl: 'https://youtube.com/watch?v=test2',
            thumbnailPath: '/images/thumb-2.jpg',
        },
    ] as unknown as Video[];

    const defaultProps = {
        displayedVideos: mockVideos,
        totalVideosCount: 2,
        totalSize: 3072,
        searchTerm: '',
        onSearchChange: vi.fn(),
        orderBy: 'title' as const,
        order: 'asc' as const,
        onSort: vi.fn(),
        page: 1,
        totalPages: 1,
        onPageChange: vi.fn(),
        onDeleteClick: vi.fn(),
        deletingId: null,
        onRefreshThumbnail: vi.fn(),
        onRedownloadThumbnail: vi.fn(),
        onUploadThumbnail: vi.fn().mockResolvedValue(undefined),
        refreshingId: null,
        redownloadingThumbnailIds: {},
        thumbnailCacheBustById: {},
        onRefreshFileSizes: vi.fn(),
        isRefreshingFileSizes: false,
        onUpdateVideo: vi.fn().mockResolvedValue(undefined),
    };

    const renderTable = (props = {}) => {
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
            },
        });

        return render(
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <VideosTable {...defaultProps} {...props} />
                </BrowserRouter>
            </QueryClientProvider>
        );
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockUserRole = 'admin';
        mockCollections = [
            { id: 'collection-1', name: 'Collection 1', videos: [] },
            { id: 'collection-2', name: 'Collection 2', videos: [] },
        ];
        mockActiveDownloads = [];
        mockQueuedDownloads = [];
        mockDeleteVideo.mockResolvedValue(undefined);
        mockAddToCollection.mockResolvedValue(undefined);
        mockCreateCollection.mockResolvedValue({ id: 'created-collection' });
        mockFetchCollections.mockResolvedValue(undefined);
        mockShowSnackbar.mockReset();
        mockInvalidateQueries.mockReset();
        vi.mocked(useQueryClient).mockReturnValue({
            invalidateQueries: mockInvalidateQueries,
            cancelQueries: vi.fn().mockResolvedValue(undefined),
        } as any);
        vi.mocked(api.post).mockReset();
        vi.mocked(api.post).mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() }, data: { success: true, data: {
            requestedCount: 2, changedVideoIds: ['1', '2'], unchangedVideoIds: [],
        } } });
    });

    it('renders video rows and thumbnail sources', () => {
        renderTable();

        expect(screen.getByText('Video 1')).toBeInTheDocument();
        expect(screen.getByText('Author 1')).toBeInTheDocument();
        expect(screen.getByAltText('Video 1')).toHaveAttribute('src', '/images-small/thumb-1.jpg?t=123');
    });

    it('appends a cache-bust token to the rendered thumbnail src when provided', () => {
        renderTable({ thumbnailCacheBustById: { '1': 456 } });

        expect(screen.getByAltText('Video 1')).toHaveAttribute('src', '/images-small/thumb-1.jpg?t=123&cb=456');
    });

    it('calls onSearchChange and onSort from the header controls', () => {
        renderTable();

        fireEvent.change(screen.getByPlaceholderText('searchVideos'), { target: { value: 'cats' } });
        fireEvent.click(screen.getByText('title'));

        expect(defaultProps.onSearchChange).toHaveBeenCalledWith('cats');
        expect(defaultProps.onSort).toHaveBeenCalledWith('title');
    });

    it('renders an empty-state alert when there are no videos', () => {
        renderTable({ displayedVideos: [], totalVideosCount: 0, totalSize: 0 });

        expect(screen.getByText('noVideosFoundMatching')).toBeInTheDocument();
    });

    it('hides admin-only controls for visitor users', () => {
        mockUserRole = 'visitor';

        renderTable();

        expect(screen.queryByLabelText('select all videos')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Refresh all file sizes')).not.toBeInTheDocument();
        expect(screen.queryAllByRole('button', { name: 'Re-download Video' })).toHaveLength(0);
    });

    it('shows a spinner for the refresh file sizes action while refreshing', () => {
        renderTable({ isRefreshingFileSizes: true });

        expect(screen.getByLabelText('Refresh all file sizes')).toBeDisabled();
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('hides redownload buttons for videos already downloading', () => {
        mockActiveDownloads = [{ sourceUrl: 'https://youtube.com/watch?v=test1' }];

        renderTable();

        expect(screen.getAllByRole('button', { name: 'Re-download Video' })).toHaveLength(1);
    });

    it('selects all videos and deletes them through the bulk delete modal', async () => {
        const user = userEvent.setup();
        renderTable();

        await user.click(screen.getByLabelText('select all videos'));

        expect(screen.getByText('bulkSelectedCount')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'delete' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'delete' }));

        await waitFor(() => {
            expect(mockDeleteVideo).toHaveBeenCalledWith('1');
            expect(mockDeleteVideo).toHaveBeenCalledWith('2');
        });
    });

    it('provides the existing tag catalog and saves a suggested tag in one request', async () => {
        const user = userEvent.setup();
        renderTable();
        await user.click(screen.getByLabelText('select video Video 1'));
        await user.click(screen.getByRole('button', { name: 'addTags' }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('combobox'));
        expect(await screen.findByRole('option', { name: 'Tutorial' })).toBeInTheDocument();
        await user.click(screen.getByRole('option', { name: 'Music' }));
        expect(api.post).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole('button', { name: 'addTags' }));
        await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/videos/batch/tags', {
            videoIds: ['1'], tags: ['Music'],
        }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('adds selected videos in one request to an existing collection', async () => {
        const user = userEvent.setup();
        renderTable();
        await user.click(screen.getByLabelText('select video Video 1'));
        await user.click(screen.getByRole('button', { name: 'bulkAddToCollection' }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('combobox'));
        await user.click(await screen.findByRole('option', { name: 'Collection 1' }));
        await user.click(within(dialog).getByRole('button', { name: 'bulkAddToCollection' }));
        await waitFor(() => expect(api.post).toHaveBeenCalledWith('/collections/batch-add', {
            videoIds: ['1'], collectionId: 'collection-1',
        }));
        expect(mockAddToCollection).not.toHaveBeenCalled();
    });

    it('creates a new collection and adds all selected videos in one request', async () => {
        const user = userEvent.setup();
        renderTable();
        await user.click(screen.getByLabelText('select all videos'));
        await user.click(screen.getByRole('button', { name: 'bulkAddToCollection' }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('radio', { name: 'bulkNewCollection' }));
        await user.type(within(dialog).getByRole('textbox', { name: 'bulkNewCollection' }), 'Created Collection');
        await user.click(within(dialog).getByRole('button', { name: 'bulkAddToCollection' }));
        await waitFor(() => expect(api.post).toHaveBeenCalledWith('/collections/batch-add', {
            videoIds: ['1', '2'], newCollection: { name: 'Created Collection', id: expect.any(String) },
        }));
        expect(mockCreateCollection).not.toHaveBeenCalled();
    });

    it('opens the upload thumbnail modal and forwards uploads to the selected video', async () => {
        const user = userEvent.setup();
        renderTable();

        const firstRow = screen.getAllByRole('row')[1];
        await user.click(within(firstRow).getByRole('button', { name: 'Upload Thumbnail' }));
        await user.click(screen.getByRole('button', { name: 'trigger-upload-thumbnail' }));

        await waitFor(() => {
            expect(defaultProps.onUploadThumbnail).toHaveBeenCalledWith(
                '1',
                expect.objectContaining({ name: 'thumb.png' })
            );
        });
    });

    it('supports inline title editing with Enter and Escape', async () => {
        const user = userEvent.setup();
        renderTable();

        const firstRow = screen.getAllByRole('row')[1];
        await user.click(within(firstRow).getByRole('button', { name: 'Edit' }));

        const input = screen.getByDisplayValue('Video 1');
        await user.clear(input);
        await user.type(input, 'Renamed Video');
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => {
            expect(defaultProps.onUpdateVideo).toHaveBeenCalledWith('1', { title: 'Renamed Video' });
        });

        const secondRow = screen.getAllByRole('row')[2];
        await user.click(within(secondRow).getByRole('button', { name: 'Edit' }));
        const secondInput = screen.getByDisplayValue('Video 2');
        fireEvent.keyDown(secondInput, { key: 'Escape' });

        await waitFor(() => {
            expect(screen.queryByDisplayValue('Video 2')).not.toBeInTheDocument();
        });
    });

    it('triggers row-level thumbnail refresh, thumbnail re-download, delete, and video re-download actions', async () => {
        const user = userEvent.setup();
        vi.mocked(api.post).mockResolvedValueOnce({ data: { downloadId: 'download-1' } } as any);

        renderTable();

        const firstRow = screen.getAllByRole('row')[1];

        await user.click(within(firstRow).getByRole('button', { name: 'Refresh Thumbnail' }));
        await user.click(within(firstRow).getByRole('button', { name: 'Re-download Thumbnail' }));
        await user.click(within(firstRow).getByRole('button', { name: 'Delete Video' }));
        await user.click(within(firstRow).getByRole('button', { name: 'Re-download Video' }));

        expect(defaultProps.onRefreshThumbnail).toHaveBeenCalledWith('1');
        expect(defaultProps.onRedownloadThumbnail).toHaveBeenCalledWith('1');
        expect(defaultProps.onDeleteClick).toHaveBeenCalledWith('1');
        await waitFor(() => {
            expect(api.post).toHaveBeenCalledWith('/download', {
                youtubeUrl: 'https://youtube.com/watch?v=test1',
                forceDownload: true,
            });
            expect(mockShowSnackbar).toHaveBeenCalledWith('videoDownloading');
            expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['downloadStatus'] });
        });
    }, 15000);
});
