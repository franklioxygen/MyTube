import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
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
    capturedBatchModalPropsRef,
} = vi.hoisted(() => {
    const mockT = vi.fn((key: string) => key);
    const mockShowSnackbar = vi.fn();
    const mockHandleVideoSubmit = vi.fn();
    const mockDownloadContext = {
        activeDownloads: [] as any[],
        queuedDownloads: [] as any[],
        handleVideoSubmit: mockHandleVideoSubmit,
    };
    const mockApi = {
        get: vi.fn().mockResolvedValue({ data: [] }),
        post: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockResolvedValue({ data: {} }),
    };
    const mockMutations: Array<{ mutate: ReturnType<typeof vi.fn>; mutationFn: any }> = [];
    const mockInvalidateQueries = vi.fn();
    const mockCancelQueries = vi.fn();
    const mockSetQueryData = vi.fn();
    const mockGetQueryData = vi.fn();
    const mockHistoryDataRef = { current: [] as any[] };
    const capturedActiveDownloadsPropsRef = { current: {} as any };
    const capturedQueuePropsRef = { current: {} as any };
    const capturedHistoryPropsRef = { current: {} as any };
    const capturedBatchModalPropsRef = { current: {} as any };

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
        capturedBatchModalPropsRef,
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
    useMutation: ({ mutationFn, onSuccess, onError }: any) => {
        const mutate = vi.fn(async (...args: any[]) => {
            try {
                await mutationFn(...args);
                onSuccess?.();
            } catch {
                onError?.();
            }
        });
        const entry = { mutate, mutationFn };
        mockMutations.push(entry);
        return { mutate };
    },
    useQueryClient: () => ({
        invalidateQueries: mockInvalidateQueries,
        cancelQueries: mockCancelQueries,
        setQueryData: mockSetQueryData,
        getQueryData: mockGetQueryData,
    }),
}));

// --- Mock child components ---

vi.mock('../DownloadPage/ActiveDownloadsTab', () => ({
    ActiveDownloadsTab: (props: any) => {
        capturedActiveDownloadsPropsRef.current = props;
        return (
            <div data-testid="ActiveDownloadsTab">
                <button data-testid="cancel-btn" onClick={() => props.onCancel('download-1')}>Cancel</button>
            </div>
        );
    },
}));

vi.mock('../DownloadPage/QueueTab', () => ({
    QueueTab: (props: any) => {
        capturedQueuePropsRef.current = props;
        return (
            <div data-testid="QueueTab">
                <button data-testid="remove-from-queue-btn" onClick={() => props.onRemove('queue-1')}>Remove</button>
                <button data-testid="clear-queue-btn" onClick={() => props.onClear()}>Clear Queue</button>
            </div>
        );
    },
}));

vi.mock('../DownloadPage/HistoryTab', () => ({
    HistoryTab: (props: any) => {
        capturedHistoryPropsRef.current = props;
        return (
            <div data-testid="HistoryTab">
                <button data-testid="remove-from-history-btn" onClick={() => props.onRemove('history-1')}>Remove</button>
                <button data-testid="clear-history-btn" onClick={() => props.onClear()}>Clear History</button>
                <button data-testid="retry-btn" onClick={() => props.onRetry('https://example.com/retry')}>Retry</button>
                <button data-testid="redownload-btn" onClick={() => props.onReDownload('https://example.com/redownload')}>ReDownload</button>
                <button data-testid="view-video-btn" onClick={() => props.onViewVideo('video-123')}>View Video</button>
            </div>
        );
    },
}));

vi.mock('../DownloadPage/CustomTabPanel', () => ({
    CustomTabPanel: ({ children, value, index }: any) => value === index ? <div>{children}</div> : null,
}));

vi.mock('../DownloadPage/HistoryItem', () => ({
    DownloadHistoryItem: {} as any,
}));

vi.mock('../../components/BatchDownloadModal', () => ({
    default: (props: any) => {
        capturedBatchModalPropsRef.current = props;
        return props.open ? (
            <div data-testid="BatchDownloadModal">
                <button data-testid="batch-confirm-btn" onClick={() => props.onConfirm(['https://a.com', 'https://b.com'])}>Confirm Batch</button>
                <button data-testid="batch-close-btn" onClick={() => props.onClose()}>Close Batch</button>
            </div>
        ) : null;
    },
}));

vi.mock('../../components/UploadModal', () => ({
    default: (props: any) => {
        return props.open ? (
            <div data-testid="UploadModal">
                <button data-testid="upload-close-btn" onClick={() => props.onClose()}>Close Upload</button>
            </div>
        ) : null;
    },
}));

// Import the component AFTER all mocks are set up
import DownloadPage from '../DownloadPage';

/**
 * Helper to get the latest set of 5 mutations from the accumulated array.
 * Each render of DownloadPage calls useMutation 5 times in order:
 *   0: cancelMutation
 *   1: removeFromQueueMutation
 *   2: clearQueueMutation
 *   3: removeFromHistoryMutation
 *   4: clearHistoryMutation
 *
 * On re-renders (e.g. tab switching), new entries are appended.
 * The latest 5 entries represent the current render's mutations.
 */
const getLatestMutations = () => {
    const len = mockMutations.length;
    return {
        cancel: mockMutations[len - 5],
        removeFromQueue: mockMutations[len - 4],
        clearQueue: mockMutations[len - 3],
        removeFromHistory: mockMutations[len - 2],
        clearHistory: mockMutations[len - 1],
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
        capturedBatchModalPropsRef.current = {};
    });

    const renderPage = () => {
        const theme = createTheme();
        return render(
            <ThemeProvider theme={theme}>
                <DownloadPage />
            </ThemeProvider>
        );
    };

    // 1. Renders page title
    it('renders page title "downloads"', () => {
        renderPage();
        expect(screen.getByText('downloads')).toBeInTheDocument();
    });

    // 2. Renders batch download and upload buttons
    it('renders batch download and upload buttons', () => {
        renderPage();
        expect(screen.getByText('addBatchTasks')).toBeInTheDocument();
        expect(screen.getByText('uploadVideo')).toBeInTheDocument();
    });

    // 3. Tab switching between active, queue, history
    it('switches tabs between active, queue, and history', () => {
        renderPage();

        // Initially on Active Downloads tab (index 0)
        expect(screen.getByTestId('ActiveDownloadsTab')).toBeInTheDocument();
        expect(screen.queryByTestId('QueueTab')).not.toBeInTheDocument();
        expect(screen.queryByTestId('HistoryTab')).not.toBeInTheDocument();

        // Switch to Queue tab
        fireEvent.click(screen.getByText('queuedDownloads'));
        expect(screen.queryByTestId('ActiveDownloadsTab')).not.toBeInTheDocument();
        expect(screen.getByTestId('QueueTab')).toBeInTheDocument();
        expect(screen.queryByTestId('HistoryTab')).not.toBeInTheDocument();

        // Switch to History tab
        fireEvent.click(screen.getByText('downloadHistory'));
        expect(screen.queryByTestId('ActiveDownloadsTab')).not.toBeInTheDocument();
        expect(screen.queryByTestId('QueueTab')).not.toBeInTheDocument();
        expect(screen.getByTestId('HistoryTab')).toBeInTheDocument();
    });

    // 4. ActiveDownloadsTab receives correct downloads and onCancel
    it('passes correct props to ActiveDownloadsTab', () => {
        const downloads = [{ id: '1', title: 'Video 1', sourceUrl: 'https://example.com/1' }];
        mockDownloadContext.activeDownloads = downloads;
        renderPage();
        expect(capturedActiveDownloadsPropsRef.current.downloads).toBe(downloads);
        expect(typeof capturedActiveDownloadsPropsRef.current.onCancel).toBe('function');
    });

    // 5. QueueTab receives correct downloads, onRemove, onClear
    it('passes correct props to QueueTab', () => {
        const queued = [{ id: 'q1', title: 'Queued 1', sourceUrl: 'https://example.com/q1' }];
        mockDownloadContext.queuedDownloads = queued;
        renderPage();

        // Switch to Queue tab
        fireEvent.click(screen.getByText('queuedDownloads'));
        expect(capturedQueuePropsRef.current.downloads).toBe(queued);
        expect(typeof capturedQueuePropsRef.current.onRemove).toBe('function');
        expect(typeof capturedQueuePropsRef.current.onClear).toBe('function');
    });

    // 6. HistoryTab receives correct history data and callbacks
    it('passes correct props to HistoryTab', () => {
        mockHistoryDataRef.current = [{ id: 'h1', title: 'History 1', sourceUrl: 'https://example.com/h1' }];
        renderPage();

        // Switch to History tab
        fireEvent.click(screen.getByText('downloadHistory'));
        expect(capturedHistoryPropsRef.current.history).toEqual(mockHistoryDataRef.current);
        expect(typeof capturedHistoryPropsRef.current.onRemove).toBe('function');
        expect(typeof capturedHistoryPropsRef.current.onClear).toBe('function');
        expect(typeof capturedHistoryPropsRef.current.onRetry).toBe('function');
        expect(typeof capturedHistoryPropsRef.current.onReDownload).toBe('function');
        expect(typeof capturedHistoryPropsRef.current.onViewVideo).toBe('function');
        expect(typeof capturedHistoryPropsRef.current.isDownloadInProgress).toBe('function');
    });

    // 7. Batch download modal opens on button click
    it('opens batch download modal on button click', () => {
        renderPage();
        expect(screen.queryByTestId('BatchDownloadModal')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('addBatchTasks'));
        expect(screen.getByTestId('BatchDownloadModal')).toBeInTheDocument();
    });

    // 8. Upload modal opens on button click
    it('opens upload modal on button click', () => {
        renderPage();
        expect(screen.queryByTestId('UploadModal')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('uploadVideo'));
        expect(screen.getByTestId('UploadModal')).toBeInTheDocument();
    });

    // 9. Cancel download calls cancelMutation.mutate
    it('calls cancel mutation when cancel button is clicked', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('cancel-btn'));
        const mutations = getLatestMutations();
        expect(mutations.cancel.mutate).toHaveBeenCalledWith('download-1');
    });

    // 10. Remove from queue calls mutation
    it('calls remove from queue mutation when remove button is clicked', () => {
        renderPage();

        // Switch to Queue tab
        fireEvent.click(screen.getByText('queuedDownloads'));
        fireEvent.click(screen.getByTestId('remove-from-queue-btn'));

        const mutations = getLatestMutations();
        expect(mutations.removeFromQueue.mutate).toHaveBeenCalledWith('queue-1');
    });

    // 11. Clear queue calls mutation
    it('calls clear queue mutation when clear button is clicked', () => {
        renderPage();

        // Switch to Queue tab
        fireEvent.click(screen.getByText('queuedDownloads'));
        fireEvent.click(screen.getByTestId('clear-queue-btn'));

        const mutations = getLatestMutations();
        expect(mutations.clearQueue.mutate).toHaveBeenCalled();
    });

    // 12. Remove from history calls mutation
    it('calls remove from history mutation when remove button is clicked', () => {
        renderPage();

        // Switch to History tab
        fireEvent.click(screen.getByText('downloadHistory'));
        fireEvent.click(screen.getByTestId('remove-from-history-btn'));

        const mutations = getLatestMutations();
        expect(mutations.removeFromHistory.mutate).toHaveBeenCalledWith('history-1');
    });

    // 13. Clear history calls mutation
    it('calls clear history mutation when clear button is clicked', () => {
        renderPage();

        // Switch to History tab
        fireEvent.click(screen.getByText('downloadHistory'));
        fireEvent.click(screen.getByTestId('clear-history-btn'));

        const mutations = getLatestMutations();
        expect(mutations.clearHistory.mutate).toHaveBeenCalled();
    });

    // 14. isDownloadInProgress returns true if sourceUrl in active downloads
    it('isDownloadInProgress returns true when sourceUrl is in active downloads', () => {
        mockDownloadContext.activeDownloads = [
            { id: '1', sourceUrl: 'https://example.com/active' },
        ];
        renderPage();

        // Switch to History tab to access isDownloadInProgress
        fireEvent.click(screen.getByText('downloadHistory'));
        expect(capturedHistoryPropsRef.current.isDownloadInProgress('https://example.com/active')).toBe(true);
    });

    // 15. isDownloadInProgress returns true if sourceUrl in queued downloads
    it('isDownloadInProgress returns true when sourceUrl is in queued downloads', () => {
        mockDownloadContext.queuedDownloads = [
            { id: 'q1', sourceUrl: 'https://example.com/queued' },
        ];
        renderPage();

        // Switch to History tab to access isDownloadInProgress
        fireEvent.click(screen.getByText('downloadHistory'));
        expect(capturedHistoryPropsRef.current.isDownloadInProgress('https://example.com/queued')).toBe(true);
    });

    // Also verify it returns false when not in progress
    it('isDownloadInProgress returns false when sourceUrl is not active or queued', () => {
        mockDownloadContext.activeDownloads = [];
        mockDownloadContext.queuedDownloads = [];
        renderPage();

        fireEvent.click(screen.getByText('downloadHistory'));
        expect(capturedHistoryPropsRef.current.isDownloadInProgress('https://example.com/not-found')).toBe(false);
    });

    // 16. handleRetry calls handleVideoSubmit when not in progress
    it('handleRetry calls handleVideoSubmit when download is not in progress', () => {
        mockDownloadContext.activeDownloads = [];
        mockDownloadContext.queuedDownloads = [];
        renderPage();

        // Switch to History tab
        fireEvent.click(screen.getByText('downloadHistory'));
        fireEvent.click(screen.getByTestId('retry-btn'));

        expect(mockHandleVideoSubmit).toHaveBeenCalledWith('https://example.com/retry');
        expect(mockShowSnackbar).not.toHaveBeenCalled();
    });

    // 17. handleRetry shows snackbar when already in progress
    it('handleRetry shows snackbar when download is already in progress', () => {
        mockDownloadContext.activeDownloads = [
            { id: '1', sourceUrl: 'https://example.com/retry' },
        ];
        renderPage();

        // Switch to History tab
        fireEvent.click(screen.getByText('downloadHistory'));
        fireEvent.click(screen.getByTestId('retry-btn'));

        expect(mockHandleVideoSubmit).not.toHaveBeenCalled();
        expect(mockShowSnackbar).toHaveBeenCalledWith('Download already in progress or queued');
    });
});
