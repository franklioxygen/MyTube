import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BilibiliPartsModal from '../BilibiliPartsModal';

// Mock contexts
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, options?: any) => {
            if (options && options.count) {
                return `${key}_${options.count}`;
            }
            return key;
        },
    }),
}));

describe('BilibiliPartsModal', () => {
    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        videosNumber: 10,
        videoTitle: 'Test Video',
        onConfirm: vi.fn(),
        onDownloadCurrent: vi.fn(),
        isLoading: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderModal = (props = {}) => {
        const theme = createTheme();
        return render(
            <ThemeProvider theme={theme}>
                <BilibiliPartsModal {...defaultProps} {...props} />
            </ThemeProvider>
        );
    };

    it('renders playlist specific text when type is playlist', () => {
        renderModal({ type: 'playlist' });

        // Header text: should use 'playlistDetected' key
        expect(screen.getByText('playlistDetected')).toBeInTheDocument();

        // Description text: should use 'playlistHasVideos' key with count
        expect(screen.getByText('playlistHasVideos_10')).toBeInTheDocument();

        // Download all text description: should use 'downloadPlaylistAndCreateCollection' key
        expect(screen.getByText('downloadPlaylistAndCreateCollection')).toBeInTheDocument();

        expect(screen.getByText('allVideosAddedToCollection')).toBeInTheDocument();
    });

    it('renders default text when type is parts', () => {
        renderModal({ type: 'parts' });

        expect(screen.getByText('multiPartVideoDetected')).toBeInTheDocument();
        expect(screen.getByText('videoHasParts_10')).toBeInTheDocument();
        expect(screen.getByText('wouldYouLikeToDownloadAllParts')).toBeInTheDocument();
        expect(screen.getByText('allPartsAddedToCollection')).toBeInTheDocument();
    });

    it('does not show subscribe/history controls for non-subscribable multi-part videos', () => {
        renderModal({ type: 'parts' });
        expect(screen.queryByText('subscribeToPlaylist')).not.toBeInTheDocument();
    });

    it('defaults subscription off and primary action to Download All for playlists', () => {
        renderModal({ type: 'playlist' });
        // Subscription checkbox present but unchecked; primary button is Download All.
        const subscribeLabel = screen.getByText('subscribeToPlaylist');
        expect(subscribeLabel).toBeInTheDocument();
        // downloadAllVideos_{count} is the primary text when subscription is off.
        expect(screen.getByText('downloadAllVideos_10')).toBeInTheDocument();
    });

    it('enabling subscription defaults downloadAll to false and changes primary label to Subscribe', () => {
        renderModal({ type: 'playlist' });
        // Click the "subscribe to this playlist" checkbox by its label.
        fireEvent.click(screen.getByLabelText('subscribeToPlaylist'));

        // Primary button becomes "subscribe".
        expect(screen.getByText('subscribe')).toBeInTheDocument();
        // The "download existing" checkbox is now visible and unchecked.
        expect(screen.getByLabelText('downloadExistingPlaylistVideos')).not.toBeChecked();
    });

    it('sends downloadAll:false by default when confirming a subscribe-only playlist', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        renderModal({ type: 'playlist', onConfirm });
        fireEvent.click(screen.getByLabelText('subscribeToPlaylist')); // enable subscription

        const primaryButton = screen.getByText('subscribe').closest('button')!;
        await fireEvent.click(primaryButton);

        expect(onConfirm).toHaveBeenCalledTimes(1);
        const action = onConfirm.mock.calls[0][0];
        expect(action.subscribe).toEqual(
            expect.objectContaining({ downloadAll: false })
        );
    });

    it('opts into history and returns downloadAll:true with a changed label', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        renderModal({ type: 'playlist', onConfirm });
        fireEvent.click(screen.getByLabelText('subscribeToPlaylist')); // enable subscription
        fireEvent.click(screen.getByLabelText('downloadExistingPlaylistVideos')); // enable history

        // Label becomes downloadAndSubscribe.
        expect(screen.getByText('downloadAndSubscribe')).toBeInTheDocument();
        expect(screen.queryByText('subscribeOnlyNewPlaylistVideosHelp')).not.toBeInTheDocument();
        const primaryButton = screen.getByText('downloadAndSubscribe').closest('button')!;
        await fireEvent.click(primaryButton);

        const action = onConfirm.mock.calls[0][0];
        expect(action.subscribe).toEqual(
            expect.objectContaining({ downloadAll: true })
        );
    });

    it('toggling subscription off resets the history opt-in', () => {
        renderModal({ type: 'playlist' });
        fireEvent.click(screen.getByLabelText('subscribeToPlaylist')); // subscription on
        fireEvent.click(screen.getByLabelText('downloadExistingPlaylistVideos')); // history on
        fireEvent.click(screen.getByLabelText('subscribeToPlaylist')); // subscription off -> history hidden

        expect(screen.queryByText('downloadExistingPlaylistVideos')).not.toBeInTheDocument();
    });

    it('resets subscription and history state when the controlled dialog closes and reopens', async () => {
        const rendered = renderModal({ type: 'playlist' });
        fireEvent.click(screen.getByLabelText('subscribeToPlaylist'));
        fireEvent.click(screen.getByLabelText('downloadExistingPlaylistVideos'));
        expect(screen.getByLabelText('downloadExistingPlaylistVideos')).toBeChecked();

        rendered.rerender(
            <ThemeProvider theme={createTheme()}>
                <BilibiliPartsModal {...defaultProps} type="playlist" isOpen={false} />
            </ThemeProvider>
        );
        rendered.rerender(
            <ThemeProvider theme={createTheme()}>
                <BilibiliPartsModal {...defaultProps} type="playlist" isOpen />
            </ThemeProvider>
        );

        await waitFor(() => {
            expect(screen.getByLabelText('subscribeToPlaylist')).not.toBeChecked();
        });
        expect(screen.queryByText('downloadExistingPlaylistVideos')).not.toBeInTheDocument();
    });

    it('locks every action while the subscription request is pending and keeps state after failure', async () => {
        let rejectConfirm!: (reason?: unknown) => void;
        const onConfirm = vi.fn(() => new Promise<void>((_, reject) => {
            rejectConfirm = reject;
        }));
        renderModal({ type: 'playlist', onConfirm });
        fireEvent.click(screen.getByLabelText('subscribeToPlaylist'));
        fireEvent.click(screen.getByText('subscribe').closest('button')!);

        expect(screen.getByLabelText('subscribeToPlaylist')).toBeDisabled();
        expect(screen.getByLabelText('downloadExistingPlaylistVideos')).toBeDisabled();
        expect(screen.getByLabelText('checkIntervalMinutes')).toBeDisabled();
        expect(screen.getByText('downloadThisVideoOnly').closest('button')).toBeDisabled();

        rejectConfirm(new Error('backend failed'));
        await waitFor(() => {
            expect(screen.getByLabelText('subscribeToPlaylist')).not.toBeDisabled();
        });
        expect(screen.getByText('subscribe')).toBeInTheDocument();
    });
});
