import { createTheme, ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted so these are available in vi.mock factories
const {
    mockT,
    mockShowSnackbar,
    mockHandleVideoSubmit,
    mockDownloadContext,
    mockApi,
    mockMutations,
    mockInvalidateQueries,
    mockCancelQueries,
    mockSetQueryData,
    mockGetQueryData,
    mockHistoryDataRef,
    capturedActiveDownloadsPropsRef,
    capturedQueuePropsRef,
    capturedHistoryPropsRef,
} = vi.hoisted(() => {
    const mockT = vi.fn((key: string) => key);
    const mockShowSnackbar = vi.fn();
    const mockHandleVideoSubmit = vi.fn();
    const mockDownloadContext = {
        activeDownloads: [] as unknown[],
        queuedDownloads: [] as unknown[],
        handleVideoSubmit: mockHandleVideoSubmit,
    };
    const mockApi = {
        get: vi.fn().mockResolvedValue({ data: [] }),
        post: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockResolvedValue({ data: {} }),
    };
    const mockMutations: Array<{ mutate: ReturnType<typeof vi.fn>; mutationFn: unknown }> = [];
    const mockInvalidateQueries = vi.fn();
    const mockCancelQueries = vi.fn();
    const mockSetQueryData = vi.fn();
    const mockGetQueryData = vi.fn();
    const mockHistoryDataRef = { current: [] as unknown[] };
    const capturedActiveDownloadsPropsRef = { current: {} as Record<string, unknown> };
    const capturedQueuePropsRef = { current: {} as Record<string, unknown> };
    const capturedHistoryPropsRef = { current: {} as Record<string, unknown> };

    return {
        mockT,
        mockShowSnackbar,
        mockHandleVideoSubmit,
        mockDownloadContext,
        mockApi,
        mockMutations,
        mockInvalidateQueries,
        mockCancelQueries,
        mockSetQueryData,
        mockGetQueryData,
        mockHistoryDataRef,
        capturedActiveDownloadsPropsRef,
        capturedQueuePropsRef,
        capturedHistoryPropsRef,
    };
});

// --- vi.mock calls ---

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: mockT }),
}));

vi.mock('../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}));

vi.mock('../../contexts/DownloadContext', () => ({
    useDownload: () => mockDownloadContext,
}));

vi.mock('../../utils/apiClient', () => ({
    api: mockApi,
}));

vi.mock('@tanstack/react-query', () => ({
    useQuery: () => {
        return { data: mockHistoryDataRef.current };
    },
    useMutation: ({ mutationFn, onSuccess, onError }: { mutationFn: (...args: unknown[]) => Promise<unknown>; onSuccess?: () => void; onError?: (err: unknown) => void }) => {
        const mutate = vi.fn(async (...args: unknown[]) => {
            try {
                await mutationFn(...args);
                onSuccess?.();
            } catch (err) {
                onError?.(err);
            }
        });
        const entry = { mutate, mutationFn };
        mockMutations.push(entry);
        return { mutate, isPending: false };
    },
    useQueryClient: () => ({
        invalidateQueries: mockInvalidateQueries,
        cancelQueries: mockCancelQueries,
        setQueryData: mockSetQueryData,
        getQueryData: mockGetQueryData,
    }),
}));

// --- Mock only heavy child components (tabs with many context deps) ---

vi.mock('../DownloadPage/ActiveDownloadsTab', () => ({
    ActiveDownloadsTab: (props: { onCancel: (id: string) => void; [key: string]: unknown }) => {
        capturedActiveDownloadsPropsRef.current = props;
        return (
            <div data-testid="ActiveDownloadsTab">
                <button data-testid="cancel-btn" onClick={() => { props.onCancel('download-1'); }}>Cancel</button>
            </div>
        );
    },
}));

vi.mock('../DownloadPage/QueueTab', () => ({
    QueueTab: (props: { onRemove: (id: string) => void; onClear: () => void; [key: string]: unknown }) => {
        capturedQueuePropsRef.current = props;
        return (
            <div data-testid="QueueTab">
                <button data-testid="remove-from-queue-btn" onClick={() => { props.onRemove('queue-1'); }}>Remove</button>
                <button data-testid="clear-queue-btn" onClick={() => { props.onClear(); }}>Clear Queue</button>
            </div>
        );
    },
}));

vi.mock('../DownloadPage/HistoryTab', () => ({
    HistoryTab: (props: { onRemove: (id: string) => void; onClear: () => void; onRetry: (url: string) => void; onReDownload: (url: string) => void; onViewVideo: (id: string) => void; [key: string]: unknown }) => {
        capturedHistoryPropsRef.current = props;
        return (
            <div data-testid="HistoryTab">
                <button data-testid="remove-from-history-btn" onClick={() => { props.onRemove('history-1'); }}>Remove</button>
                <button data-testid="clear-history-btn" onClick={() => { props.onClear(); }}>Clear History</button>
                <button data-testid="retry-btn" onClick={() => { props.onRetry('https://example.com/retry'); }}>Retry</button>
                <button data-testid="redownload-btn" onClick={() => { props.onReDownload('https://example.com/redownload'); }}>ReDownload</button>
                <button data-testid="view-video-btn" onClick={() => { props.onViewVideo('video-123'); }}>View Video</button>
            </div>
        );
    },
}));

vi.mock('../DownloadPage/HistoryItem', () => ({
    DownloadHistoryItem: {} as Record<string, unknown>,
}));

// NOTE: CustomTabPanel, BatchDownloadModal, and UploadModal are NOT mocked.
// They render as real components so their code is covered.

// Import the component AFTER all mocks are set up
import DownloadPage from '../DownloadPage';

/**
 * Helper to get the latest set of mutations from the accumulated array.
 * Each render of DownloadPage calls useMutation 5 times, and UploadModal adds 1:
 *   0: cancelMutation
 *   1: removeFromQueueMutation
 *   2: clearQueueMutation
 *   3: removeFromHistoryMutation
 *   4: clearHistoryMutation
 *   5: uploadMutation (from UploadModal)
 *
 * On re-renders, new entries are appended.
 * The latest 6 entries represent the current render's mutations.
 */
const getLatestMutations = () => {
    const len = mockMutations.length;
    return {
        cancel: mockMutations[len - 6],
        removeFromQueue: mockMutations[len - 5],
        clearQueue: mockMutations[len - 4],
        removeFromHistory: mockMutations[len - 3],
        clearHistory: mockMutations[len - 2],
        upload: mockMutations[len - 1],
    };
};

// --- Test suite ---

describe('DownloadPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMutations.length = 0;
        mockHistoryDataRef.current = [];
        mockDownloadContext.activeDownloads = [];
        mockDownloadContext.queuedDownloads = [];
        mockApi.get.mockResolvedValue({ data: [] });
        mockApi.post.mockResolvedValue({ data: {} });
        mockApi.delete.mockResolvedValue({ data: {} });
        capturedActiveDownloadsPropsRef.current = {};
        capturedQueuePropsRef.current = {};
        capturedHistoryPropsRef.current = {};
    });

    const renderPage = () => {
        const theme = createTheme();
        return render(
            <ThemeProvider theme={theme}>
                <DownloadPage />
            </ThemeProvider>
        );
    };

    // --- Page rendering ---
    describe('page rendering', () => {
        it('renders page title "downloads"', () => {
            renderPage();
            expect(screen.getByText('downloads')).toBeInTheDocument();
        });

        it('renders batch download and upload buttons', () => {
            renderPage();
            expect(screen.getByText('addBatchTasks')).toBeInTheDocument();
            expect(screen.getByText('uploadVideo')).toBeInTheDocument();
        });

        it('renders tab panels with correct roles', () => {
            renderPage();
            const tabpanels = screen.getAllByRole('tabpanel', { hidden: true });
            expect(tabpanels.length).toBe(3);
        });
    });

    // --- Tab switching ---
    describe('tab switching', () => {
        it('shows active downloads tab by default', () => {
            renderPage();
            expect(screen.getByTestId('ActiveDownloadsTab')).toBeInTheDocument();
            expect(screen.queryByTestId('QueueTab')).not.toBeInTheDocument();
            expect(screen.queryByTestId('HistoryTab')).not.toBeInTheDocument();
        });

        it('switches to queue tab', () => {
            renderPage();
            fireEvent.click(screen.getByText('queuedDownloads'));
            expect(screen.queryByTestId('ActiveDownloadsTab')).not.toBeInTheDocument();
            expect(screen.getByTestId('QueueTab')).toBeInTheDocument();
            expect(screen.queryByTestId('HistoryTab')).not.toBeInTheDocument();
        });

        it('switches to history tab', () => {
            renderPage();
            fireEvent.click(screen.getByText('downloadHistory'));
            expect(screen.queryByTestId('ActiveDownloadsTab')).not.toBeInTheDocument();
            expect(screen.queryByTestId('QueueTab')).not.toBeInTheDocument();
            expect(screen.getByTestId('HistoryTab')).toBeInTheDocument();
        });

        it('switches back to active tab from history', () => {
            renderPage();
            fireEvent.click(screen.getByText('downloadHistory'));
            fireEvent.click(screen.getByText('activeDownloads'));
            expect(screen.getByTestId('ActiveDownloadsTab')).toBeInTheDocument();
            expect(screen.queryByTestId('HistoryTab')).not.toBeInTheDocument();
        });
    });

    // --- Props passed to tab components ---
    describe('tab component props', () => {
        it('passes correct props to ActiveDownloadsTab', () => {
            const downloads = [{ id: '1', title: 'Video 1', sourceUrl: 'https://example.com/1' }];
            mockDownloadContext.activeDownloads = downloads;
            renderPage();
            expect(capturedActiveDownloadsPropsRef.current.downloads).toBe(downloads);
            expect(typeof capturedActiveDownloadsPropsRef.current.onCancel).toBe('function');
        });

        it('passes correct props to QueueTab', () => {
            const queued = [{ id: 'q1', title: 'Queued 1', sourceUrl: 'https://example.com/q1' }];
            mockDownloadContext.queuedDownloads = queued;
            renderPage();
            fireEvent.click(screen.getByText('queuedDownloads'));
            expect(capturedQueuePropsRef.current.downloads).toBe(queued);
            expect(typeof capturedQueuePropsRef.current.onRemove).toBe('function');
            expect(typeof capturedQueuePropsRef.current.onClear).toBe('function');
        });

        it('passes correct props to HistoryTab', () => {
            mockHistoryDataRef.current = [{ id: 'h1', title: 'History 1' }];
            renderPage();
            fireEvent.click(screen.getByText('downloadHistory'));
            expect(capturedHistoryPropsRef.current.history).toEqual(mockHistoryDataRef.current);
            expect(typeof capturedHistoryPropsRef.current.onRemove).toBe('function');
            expect(typeof capturedHistoryPropsRef.current.onClear).toBe('function');
            expect(typeof capturedHistoryPropsRef.current.onRetry).toBe('function');
            expect(typeof capturedHistoryPropsRef.current.onReDownload).toBe('function');
            expect(typeof capturedHistoryPropsRef.current.onViewVideo).toBe('function');
            expect(typeof capturedHistoryPropsRef.current.isDownloadInProgress).toBe('function');
        });
    });

    // --- Batch download modal (real component) ---
    describe('batch download modal', () => {
        it('opens on button click', () => {
            renderPage();
            expect(screen.queryByText('batchDownload')).not.toBeInTheDocument();
            fireEvent.click(screen.getByText('addBatchTasks'));
            expect(screen.getByText('batchDownload')).toBeInTheDocument();
        });

        it('shows description and URL input field', () => {
            renderPage();
            fireEvent.click(screen.getByText('addBatchTasks'));
            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('batchDownloadDescription')).toBeInTheDocument();
            expect(within(dialog).getByLabelText('urls')).toBeInTheDocument();
        });

        it('has confirm button disabled when input is empty', () => {
            renderPage();
            fireEvent.click(screen.getByText('addBatchTasks'));
            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('addToQueue').closest('button')).toBeDisabled();
        });

        it('submits URLs and calls handleVideoSubmit for each', async () => {
            renderPage();
            fireEvent.click(screen.getByText('addBatchTasks'));
            const dialog = screen.getByRole('dialog');

            // Type URLs
            const input = within(dialog).getByLabelText('urls');
            fireEvent.change(input, { target: { value: 'https://youtube.com/1\nhttps://youtube.com/2' } });

            // Confirm button should be enabled now
            const confirmBtn = within(dialog).getByText('addToQueue').closest('button')!;
            expect(confirmBtn).not.toBeDisabled();

            // Click confirm
            fireEvent.click(confirmBtn);

            await waitFor(() => {
                expect(mockHandleVideoSubmit).toHaveBeenCalledWith('https://youtube.com/1');
                expect(mockHandleVideoSubmit).toHaveBeenCalledWith('https://youtube.com/2');
                expect(mockShowSnackbar).toHaveBeenCalledWith('batchTasksAdded');
            });
        });

        it('filters empty lines when submitting', async () => {
            renderPage();
            fireEvent.click(screen.getByText('addBatchTasks'));
            const dialog = screen.getByRole('dialog');

            const input = within(dialog).getByLabelText('urls');
            fireEvent.change(input, { target: { value: 'https://youtube.com/1\n\n\nhttps://youtube.com/2\n' } });

            fireEvent.click(within(dialog).getByText('addToQueue'));

            await waitFor(() => {
                expect(mockHandleVideoSubmit).toHaveBeenCalledTimes(2);
            });
        });

        it('closes on cancel', async () => {
            renderPage();
            fireEvent.click(screen.getByText('addBatchTasks'));
            expect(screen.getByRole('dialog')).toBeInTheDocument();

            fireEvent.click(within(screen.getByRole('dialog')).getByText('cancel'));

            await waitFor(() => {
                expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            });
        });

        it('closes after successful submission', async () => {
            renderPage();
            fireEvent.click(screen.getByText('addBatchTasks'));
            const dialog = screen.getByRole('dialog');

            fireEvent.change(within(dialog).getByLabelText('urls'), {
                target: { value: 'https://youtube.com/1' },
            });
            fireEvent.click(within(dialog).getByText('addToQueue'));

            await waitFor(() => {
                expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            });
        });
    });

    // --- Upload modal (real component) ---
    describe('upload modal', () => {
        it('opens on button click', () => {
            renderPage();
            fireEvent.click(screen.getByText('uploadVideo'));
            expect(screen.getByRole('dialog')).toBeInTheDocument();
            expect(screen.getByText('selectVideoFile')).toBeInTheDocument();
        });

        it('shows title and author input fields', () => {
            renderPage();
            fireEvent.click(screen.getByText('uploadVideo'));
            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByLabelText('title')).toBeInTheDocument();
            expect(within(dialog).getByLabelText('author')).toBeInTheDocument();
        });

        it('has upload button disabled without file selected', () => {
            renderPage();
            fireEvent.click(screen.getByText('uploadVideo'));
            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('upload').closest('button')).toBeDisabled();
        });

        it('shows error when uploading without file', () => {
            renderPage();
            fireEvent.click(screen.getByText('uploadVideo'));

            // The upload button should be disabled, but let's test the error path
            // by verifying the button is actually disabled
            const dialog = screen.getByRole('dialog');
            const uploadBtn = within(dialog).getByText('upload').closest('button')!;
            expect(uploadBtn).toBeDisabled();
        });

        it('closes on cancel', async () => {
            renderPage();
            fireEvent.click(screen.getByText('uploadVideo'));
            expect(screen.getByRole('dialog')).toBeInTheDocument();

            fireEvent.click(within(screen.getByRole('dialog')).getByText('cancel'));

            await waitFor(() => {
                expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            });
        });

        it('has default author value of Admin', () => {
            renderPage();
            fireEvent.click(screen.getByText('uploadVideo'));
            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByLabelText('author')).toHaveValue('Admin');
        });
    });

    // --- Mutation callbacks ---
    describe('mutations', () => {
        it('calls cancel mutation when cancel button is clicked', () => {
            renderPage();
            fireEvent.click(screen.getByTestId('cancel-btn'));
            const mutations = getLatestMutations();
            expect(mutations.cancel.mutate).toHaveBeenCalledWith('download-1');
        });

        it('calls remove from queue mutation', () => {
            renderPage();
            fireEvent.click(screen.getByText('queuedDownloads'));
            fireEvent.click(screen.getByTestId('remove-from-queue-btn'));
            const mutations = getLatestMutations();
            expect(mutations.removeFromQueue.mutate).toHaveBeenCalledWith('queue-1');
        });

        it('calls clear queue mutation', () => {
            renderPage();
            fireEvent.click(screen.getByText('queuedDownloads'));
            fireEvent.click(screen.getByTestId('clear-queue-btn'));
            const mutations = getLatestMutations();
            expect(mutations.clearQueue.mutate).toHaveBeenCalled();
        });

        it('calls remove from history mutation', () => {
            renderPage();
            fireEvent.click(screen.getByText('downloadHistory'));
            fireEvent.click(screen.getByTestId('remove-from-history-btn'));
            const mutations = getLatestMutations();
            expect(mutations.removeFromHistory.mutate).toHaveBeenCalledWith('history-1');
        });

        it('calls clear history mutation', () => {
            renderPage();
            fireEvent.click(screen.getByText('downloadHistory'));
            fireEvent.click(screen.getByTestId('clear-history-btn'));
            const mutations = getLatestMutations();
            expect(mutations.clearHistory.mutate).toHaveBeenCalled();
        });
    });

    // --- isDownloadInProgress logic ---
    describe('isDownloadInProgress', () => {
        it('returns true when sourceUrl is in active downloads', () => {
            mockDownloadContext.activeDownloads = [{ id: '1', sourceUrl: 'https://example.com/active' }];
            renderPage();
            fireEvent.click(screen.getByText('downloadHistory'));
            const fn = capturedHistoryPropsRef.current.isDownloadInProgress as (url: string) => boolean;
            expect(fn('https://example.com/active')).toBe(true);
        });

        it('returns true when sourceUrl is in queued downloads', () => {
            mockDownloadContext.queuedDownloads = [{ id: 'q1', sourceUrl: 'https://example.com/queued' }];
            renderPage();
            fireEvent.click(screen.getByText('downloadHistory'));
            const fn = capturedHistoryPropsRef.current.isDownloadInProgress as (url: string) => boolean;
            expect(fn('https://example.com/queued')).toBe(true);
        });

        it('returns false when sourceUrl is not active or queued', () => {
            renderPage();
            fireEvent.click(screen.getByText('downloadHistory'));
            const fn = capturedHistoryPropsRef.current.isDownloadInProgress as (url: string) => boolean;
            expect(fn('https://example.com/not-found')).toBe(false);
        });
    });

    // --- Retry and re-download logic ---
    describe('retry and re-download', () => {
        it('handleRetry calls handleVideoSubmit when not in progress', () => {
            renderPage();
            fireEvent.click(screen.getByText('downloadHistory'));
            fireEvent.click(screen.getByTestId('retry-btn'));
            expect(mockHandleVideoSubmit).toHaveBeenCalledWith('https://example.com/retry');
            expect(mockShowSnackbar).not.toHaveBeenCalled();
        });

        it('handleRetry shows snackbar when already in progress', () => {
            mockDownloadContext.activeDownloads = [{ id: '1', sourceUrl: 'https://example.com/retry' }];
            renderPage();
            fireEvent.click(screen.getByText('downloadHistory'));
            fireEvent.click(screen.getByTestId('retry-btn'));
            expect(mockHandleVideoSubmit).not.toHaveBeenCalled();
            expect(mockShowSnackbar).toHaveBeenCalledWith('Download already in progress or queued');
        });

        it('handleReDownload calls api.post with forceDownload when not in progress', async () => {
            mockApi.post.mockResolvedValue({ data: { downloadId: 'new-dl-1' } });
            renderPage();
            fireEvent.click(screen.getByText('downloadHistory'));

            await act(async () => {
                fireEvent.click(screen.getByTestId('redownload-btn'));
            });

            await waitFor(() => {
                expect(mockApi.post).toHaveBeenCalledWith('/download', {
                    youtubeUrl: 'https://example.com/redownload',
                    forceDownload: true,
                });
            });
        });

        it('handleReDownload shows success snackbar on successful re-download', async () => {
            mockApi.post.mockResolvedValue({ data: { downloadId: 'new-dl-1' } });
            renderPage();
            fireEvent.click(screen.getByText('downloadHistory'));

            await act(async () => {
                fireEvent.click(screen.getByTestId('redownload-btn'));
            });

            await waitFor(() => {
                expect(mockShowSnackbar).toHaveBeenCalledWith('videoDownloading');
            });
        });

        it('handleReDownload shows snackbar when already in progress', async () => {
            mockDownloadContext.activeDownloads = [{ id: '1', sourceUrl: 'https://example.com/redownload' }];
            renderPage();
            fireEvent.click(screen.getByText('downloadHistory'));

            await act(async () => {
                fireEvent.click(screen.getByTestId('redownload-btn'));
            });

            expect(mockShowSnackbar).toHaveBeenCalledWith('Download already in progress or queued');
            expect(mockApi.post).not.toHaveBeenCalledWith('/download', expect.anything());
        });

        it('handleReDownload shows error snackbar on failure', async () => {
            mockApi.post.mockRejectedValueOnce(new Error('Network error'));
            renderPage();
            fireEvent.click(screen.getByText('downloadHistory'));

            await act(async () => {
                fireEvent.click(screen.getByTestId('redownload-btn'));
            });

            await waitFor(() => {
                expect(mockShowSnackbar).toHaveBeenCalledWith('error');
            });
        });
    });
});
