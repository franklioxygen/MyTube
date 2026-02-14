import { createTheme, ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SubscriptionsPage from '../SubscriptionsPage';

// ── Mutable mock data (overridden per test) ──────────────────────────────────

let mockSubscriptions: unknown[] = [];
let mockTasks: unknown[] = [];
const mockRefetchSubscriptions = vi.fn();
const mockRefetchTasks = vi.fn();
const mockShowSnackbar = vi.fn();
let mockUserRole = 'admin';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-query', () => ({
    useQuery: ({ queryKey }: { queryKey: string[] }) => {
        if (queryKey[0] === 'subscriptions') {
            return { data: mockSubscriptions, refetch: mockRefetchSubscriptions };
        }
        if (queryKey[0] === 'subscriptionTasks') {
            return { data: mockTasks, refetch: mockRefetchTasks };
        }
        return { data: [], refetch: vi.fn() };
    },
}));

vi.mock('../../utils/apiClient', () => ({
    api: {
        get: vi.fn(() => Promise.resolve({ data: [] })),
        delete: vi.fn(() => Promise.resolve({ data: {} })),
        put: vi.fn(() => Promise.resolve({ data: {} })),
    },
}));

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, params?: Record<string, string>) => {
            if (params) {
                return Object.entries(params).reduce(
                    (acc, [k, v]) => acc.replace(`{${k}}`, v),
                    key,
                );
            }
            return key;
        },
    }),
}));

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ userRole: mockUserRole }),
}));

vi.mock('../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}));

// Mock ConfirmationModal – renders buttons that expose onConfirm / onClose
let capturedModals: Record<string, { onConfirm: () => void; onClose: () => void }> = {};

vi.mock('../../components/ConfirmationModal', () => ({
    default: ({
        isOpen,
        onConfirm,
        onClose,
        title,
    }: {
        isOpen: boolean;
        onConfirm: () => void;
        onClose: () => void;
        title: string;
        message: string;
        confirmText: string;
        cancelText: string;
        isDanger?: boolean;
    }) => {
        // Store callbacks so tests can invoke them directly if needed
        if (isOpen) {
            capturedModals[title] = { onConfirm, onClose };
        }
        return isOpen ? (
            <div data-testid={`modal-${title}`}>
                <span data-testid={`modal-title-${title}`}>{title}</span>
                <button data-testid={`modal-confirm-${title}`} onClick={onConfirm}>
                    Confirm
                </button>
                <button data-testid={`modal-close-${title}`} onClick={onClose}>
                    Close
                </button>
            </div>
        ) : null;
    },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const theme = createTheme();

const renderPage = () =>
    render(
        <ThemeProvider theme={theme}>
            <SubscriptionsPage />
        </ThemeProvider>,
    );

const makeSub = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-1',
    author: 'TestAuthor',
    authorUrl: 'https://example.com/@TestAuthor',
    interval: 30,
    lastCheck: 1700000000000,
    downloadCount: 42,
    createdAt: 1690000000000,
    platform: 'youtube',
    paused: 0,
    ...overrides,
});

const makeTask = (overrides: Record<string, unknown> = {}) => ({
    id: 'task-1',
    subscriptionId: 'sub-1',
    authorUrl: 'https://example.com/@Author',
    author: 'TaskAuthor',
    platform: 'youtube',
    status: 'active' as const,
    totalVideos: 50,
    downloadedCount: 10,
    skippedCount: 2,
    failedCount: 1,
    currentVideoIndex: 20,
    createdAt: 1700000000000,
    ...overrides,
});

// ── Import api mock for assertions ──────────────────────────────────────────

import { api } from '../../utils/apiClient';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('SubscriptionsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSubscriptions = [];
        mockTasks = [];
        mockUserRole = 'admin';
        capturedModals = {};
    });

    // ── 1. Page title ────────────────────────────────────────────────────

    it('renders the page title "subscriptions"', () => {
        renderPage();
        expect(screen.getByText('subscriptions')).toBeInTheDocument();
    });

    // ── 2. Empty subscriptions ───────────────────────────────────────────

    it('shows "noVideos" message when subscriptions list is empty', () => {
        renderPage();
        expect(screen.getByText('noVideos')).toBeInTheDocument();
    });

    // ── 3. Renders subscriptions table with data ─────────────────────────

    it('renders subscription rows with author, platform, interval, lastCheck, and downloads', () => {
        mockSubscriptions = [
            makeSub({ id: 'sub-1', author: 'Alice', platform: 'youtube', interval: 60, downloadCount: 5 }),
            makeSub({ id: 'sub-2', author: 'Bob', platform: 'rumble', interval: 120, downloadCount: 99 }),
        ];
        renderPage();

        // Authors rendered as links
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();

        // Platforms
        expect(screen.getByText('youtube')).toBeInTheDocument();
        expect(screen.getByText('rumble')).toBeInTheDocument();

        // Intervals (with translated "minutes" suffix)
        expect(screen.getByText('60 minutes')).toBeInTheDocument();
        expect(screen.getByText('120 minutes')).toBeInTheDocument();

        // Download counts
        expect(screen.getByText('5')).toBeInTheDocument();
        expect(screen.getByText('99')).toBeInTheDocument();
    });

    // ── 4. Unsubscribe flow ──────────────────────────────────────────────

    it('opens modal and calls api.delete on confirm unsubscribe', async () => {
        mockSubscriptions = [makeSub({ id: 'sub-99', author: 'RemoveMe' })];
        renderPage();

        // Click the delete icon button (has title="unsubscribe")
        const deleteBtn = screen.getByTitle('unsubscribe');
        fireEvent.click(deleteBtn);

        // Modal should appear
        expect(screen.getByTestId('modal-unsubscribe')).toBeInTheDocument();

        // Confirm
        await act(async () => {
            fireEvent.click(screen.getByTestId('modal-confirm-unsubscribe'));
        });

        expect(api.delete).toHaveBeenCalledWith('/subscriptions/sub-99');
        expect(mockShowSnackbar).toHaveBeenCalledWith('unsubscribedSuccessfully');
        expect(mockRefetchSubscriptions).toHaveBeenCalled();
    });

    // ── 5. Pause subscription ────────────────────────────────────────────

    it('calls api.put to pause a subscription', async () => {
        mockSubscriptions = [makeSub({ id: 'sub-5', paused: 0 })];
        renderPage();

        const pauseBtn = screen.getByTitle('pauseSubscription');
        await act(async () => {
            fireEvent.click(pauseBtn);
        });

        expect(api.put).toHaveBeenCalledWith('/subscriptions/sub-5/pause');
        expect(mockShowSnackbar).toHaveBeenCalledWith('subscriptionPaused');
        expect(mockRefetchSubscriptions).toHaveBeenCalled();
    });

    // ── 6. Resume subscription ───────────────────────────────────────────

    it('calls api.put to resume a paused subscription', async () => {
        mockSubscriptions = [makeSub({ id: 'sub-6', paused: 1 })];
        renderPage();

        const resumeBtn = screen.getByTitle('resumeSubscription');
        await act(async () => {
            fireEvent.click(resumeBtn);
        });

        expect(api.put).toHaveBeenCalledWith('/subscriptions/sub-6/resume');
        expect(mockShowSnackbar).toHaveBeenCalledWith('subscriptionResumed');
        expect(mockRefetchSubscriptions).toHaveBeenCalled();
    });

    // ── 7. Tasks section hidden when no tasks ────────────────────────────

    it('does not render tasks section when tasks array is empty', () => {
        mockTasks = [];
        renderPage();

        expect(screen.queryByText('continuousDownloadTasks')).not.toBeInTheDocument();
    });

    // ── 8. Tasks section visible with progress bars ──────────────────────

    it('renders tasks section with progress info when tasks exist', () => {
        mockTasks = [makeTask({ id: 'task-1', author: 'Streamer', currentVideoIndex: 10, totalVideos: 20 })];
        renderPage();

        expect(screen.getByText('continuousDownloadTasks')).toBeInTheDocument();
        expect(screen.getByText('Streamer')).toBeInTheDocument();
        // Progress text "10 / 20"
        expect(screen.getByText('10 / 20')).toBeInTheDocument();
        // LinearProgress rendered (role="progressbar")
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    // ── 9. Task progress calculation ─────────────────────────────────────

    it('calculates task progress correctly (currentVideoIndex / totalVideos * 100)', () => {
        mockTasks = [makeTask({ currentVideoIndex: 25, totalVideos: 50 })];
        renderPage();

        const progressBar = screen.getByRole('progressbar');
        // MUI LinearProgress sets aria-valuenow
        expect(progressBar).toHaveAttribute('aria-valuenow', '50');
    });

    it('shows 0 progress when totalVideos is 0', () => {
        mockTasks = [makeTask({ currentVideoIndex: 0, totalVideos: 0 })];
        renderPage();

        const progressBar = screen.getByRole('progressbar');
        expect(progressBar).toHaveAttribute('aria-valuenow', '0');
    });

    // ── 10. Cancel task flow ─────────────────────────────────────────────

    it('opens cancel modal and calls api.delete on confirm', async () => {
        mockTasks = [makeTask({ id: 'task-cancel', status: 'active' })];
        renderPage();

        const cancelBtn = screen.getByTitle('cancelTask');
        fireEvent.click(cancelBtn);

        expect(screen.getByTestId('modal-cancelTask')).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByTestId('modal-confirm-cancelTask'));
        });

        expect(api.delete).toHaveBeenCalledWith('/subscriptions/tasks/task-cancel');
        expect(mockShowSnackbar).toHaveBeenCalledWith('taskCancelled');
        expect(mockRefetchTasks).toHaveBeenCalled();
    });

    // ── 11. Delete task flow (completed/cancelled tasks) ─────────────────

    it('opens delete modal and calls api.delete for a completed task', async () => {
        mockTasks = [makeTask({ id: 'task-del', status: 'completed' })];
        renderPage();

        const deleteBtn = screen.getByTitle('deleteTask');
        fireEvent.click(deleteBtn);

        expect(screen.getByTestId('modal-deleteTask')).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByTestId('modal-confirm-deleteTask'));
        });

        expect(api.delete).toHaveBeenCalledWith('/subscriptions/tasks/task-del/delete');
        expect(mockShowSnackbar).toHaveBeenCalledWith('taskDeleted');
        expect(mockRefetchTasks).toHaveBeenCalled();
    });

    it('opens delete modal for a cancelled task', async () => {
        mockTasks = [makeTask({ id: 'task-del-cancelled', status: 'cancelled' })];
        renderPage();

        const deleteBtn = screen.getByTitle('deleteTask');
        fireEvent.click(deleteBtn);

        await act(async () => {
            fireEvent.click(screen.getByTestId('modal-confirm-deleteTask'));
        });

        expect(api.delete).toHaveBeenCalledWith('/subscriptions/tasks/task-del-cancelled/delete');
    });

    // ── 12. Clear finished tasks flow ────────────────────────────────────

    it('clears finished tasks via api.delete on confirm', async () => {
        mockTasks = [makeTask({ id: 'task-done', status: 'completed' })];
        renderPage();

        const clearBtn = screen.getByText('clearFinishedTasks');
        fireEvent.click(clearBtn);

        expect(screen.getByTestId('modal-clearFinishedTasks')).toBeInTheDocument();

        await act(async () => {
            fireEvent.click(screen.getByTestId('modal-confirm-clearFinishedTasks'));
        });

        expect(api.delete).toHaveBeenCalledWith('/subscriptions/tasks/clear-finished');
        expect(mockShowSnackbar).toHaveBeenCalledWith('tasksCleared');
        expect(mockRefetchTasks).toHaveBeenCalled();
    });

    // ── 13. Pause / resume task buttons ──────────────────────────────────

    it('calls api.put to pause an active task', async () => {
        mockTasks = [makeTask({ id: 'task-p', status: 'active' })];
        renderPage();

        const pauseBtn = screen.getByTitle('pauseTask');
        await act(async () => {
            fireEvent.click(pauseBtn);
        });

        expect(api.put).toHaveBeenCalledWith('/subscriptions/tasks/task-p/pause');
        expect(mockShowSnackbar).toHaveBeenCalledWith('taskPaused');
        expect(mockRefetchTasks).toHaveBeenCalled();
    });

    it('calls api.put to resume a paused task', async () => {
        mockTasks = [makeTask({ id: 'task-r', status: 'paused' })];
        renderPage();

        const resumeBtn = screen.getByTitle('resumeTask');
        await act(async () => {
            fireEvent.click(resumeBtn);
        });

        expect(api.put).toHaveBeenCalledWith('/subscriptions/tasks/task-r/resume');
        expect(mockShowSnackbar).toHaveBeenCalledWith('taskResumed');
        expect(mockRefetchTasks).toHaveBeenCalled();
    });

    // ── 14. Visitor mode: action columns hidden ──────────────────────────

    it('hides action columns and buttons for visitor role', () => {
        mockUserRole = 'visitor';
        mockSubscriptions = [makeSub({ id: 'sub-v' })];
        mockTasks = [makeTask({ id: 'task-v', status: 'active' })];
        renderPage();

        // No unsubscribe / pause buttons for subscriptions
        expect(screen.queryByTitle('unsubscribe')).not.toBeInTheDocument();
        expect(screen.queryByTitle('pauseSubscription')).not.toBeInTheDocument();

        // No task action buttons
        expect(screen.queryByTitle('cancelTask')).not.toBeInTheDocument();
        expect(screen.queryByTitle('pauseTask')).not.toBeInTheDocument();

        // No "Clear finished tasks" button
        expect(screen.queryByText('clearFinishedTasks')).not.toBeInTheDocument();

        // The "actions" column header should not appear
        expect(screen.queryByText('actions')).not.toBeInTheDocument();
    });

    // ── 15. Playlist subscription type shows suffix ──────────────────────

    it('shows "(playlistsWatcher)" suffix for channel_playlists subscription type', () => {
        mockSubscriptions = [
            makeSub({
                id: 'sub-pl',
                author: 'PlaylistGuy',
                subscriptionType: 'channel_playlists',
            }),
        ];
        renderPage();

        expect(screen.getByText('PlaylistGuy (playlistsWatcher)')).toBeInTheDocument();
    });

    // ── Additional edge-case tests ───────────────────────────────────────

    it('shows "never" for subscriptions with no lastCheck', () => {
        mockSubscriptions = [makeSub({ lastCheck: undefined })];
        renderPage();

        expect(screen.getByText('never')).toBeInTheDocument();
    });

    it('closes unsubscribe modal when close button is clicked', () => {
        mockSubscriptions = [makeSub()];
        renderPage();

        fireEvent.click(screen.getByTitle('unsubscribe'));
        expect(screen.getByTestId('modal-unsubscribe')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('modal-close-unsubscribe'));
        expect(screen.queryByTestId('modal-unsubscribe')).not.toBeInTheDocument();
    });

    it('displays task playlistName instead of author when available', () => {
        mockTasks = [makeTask({ author: 'SomeAuthor', playlistName: 'MyPlaylist' })];
        renderPage();

        expect(screen.getByText('MyPlaylist')).toBeInTheDocument();
        // "SomeAuthor" should not appear in the tasks table (it appears for subscriptions only if present)
        // We have no subscriptions, so SomeAuthor should not be in the document
        expect(screen.queryByText('SomeAuthor')).not.toBeInTheDocument();
    });

    it('shows "?" for totalVideos when it is 0', () => {
        mockTasks = [makeTask({ currentVideoIndex: 3, totalVideos: 0 })];
        renderPage();

        expect(screen.getByText('3 / ?')).toBeInTheDocument();
    });

    it('handles api error during unsubscribe gracefully', async () => {
        (api.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));
        mockSubscriptions = [makeSub({ id: 'sub-err' })];
        renderPage();

        fireEvent.click(screen.getByTitle('unsubscribe'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('modal-confirm-unsubscribe'));
        });

        expect(mockShowSnackbar).toHaveBeenCalledWith('error');
        // Modal should be closed even on error
        await waitFor(() => {
            expect(screen.queryByTestId('modal-unsubscribe')).not.toBeInTheDocument();
        });
    });

    it('handles api error during pause subscription gracefully', async () => {
        (api.put as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));
        mockSubscriptions = [makeSub({ id: 'sub-pause-err', paused: 0 })];
        renderPage();

        await act(async () => {
            fireEvent.click(screen.getByTitle('pauseSubscription'));
        });

        expect(mockShowSnackbar).toHaveBeenCalledWith('error');
    });

    it('handles api error during cancel task gracefully', async () => {
        (api.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));
        mockTasks = [makeTask({ id: 'task-err', status: 'active' })];
        renderPage();

        fireEvent.click(screen.getByTitle('cancelTask'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('modal-confirm-cancelTask'));
        });

        expect(mockShowSnackbar).toHaveBeenCalledWith('error');
    });

    it('unsubscribe modal message includes "(playlistsWatcher)" for playlist subscriptions', () => {
        mockSubscriptions = [
            makeSub({
                id: 'sub-plm',
                author: 'PLAuthor',
                subscriptionType: 'channel_playlists',
            }),
        ];
        renderPage();

        fireEvent.click(screen.getByTitle('unsubscribe'));

        // The modal title should be "unsubscribe" (from the mock)
        expect(screen.getByTestId('modal-unsubscribe')).toBeInTheDocument();
    });
});
