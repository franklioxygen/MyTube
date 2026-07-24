import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SubscribeModal from '../SubscribeModal';

// Mock language context
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('SubscribeModal', () => {
    const mockOnClose = vi.fn();
    const mockOnConfirm = vi.fn();
    const defaultProps = {
        open: true,
        onClose: mockOnClose,
        onConfirm: mockOnConfirm,
        url: 'http://test.com',
        authorName: 'Test Author',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render strictly when open', () => {
        render(<SubscribeModal {...defaultProps} />);

        expect(screen.getByText('subscribeToAuthor')).toBeInTheDocument();
        expect(screen.getByLabelText('checkIntervalMinutes')).toHaveValue(60);
        expect(screen.getByLabelText('downloadAllPreviousVideos')).not.toBeChecked();
    });

    it('should handle input changes', async () => {
        const user = userEvent.setup();
        render(<SubscribeModal {...defaultProps} />);

        // Change interval
        const intervalInput = screen.getByLabelText('checkIntervalMinutes');
        await user.clear(intervalInput);
        await user.type(intervalInput, '120');

        // Toggle checkbox
        await user.click(screen.getByLabelText('downloadAllPreviousVideos'));

        expect(screen.getByLabelText('checkIntervalMinutes')).toHaveValue(120);
        expect(screen.getByLabelText('downloadAllPreviousVideos')).toBeChecked();
        // Warning should appear when checkbox is checked
        expect(screen.getByText('downloadAllPreviousWarning')).toBeInTheDocument();
    });

    it('should call onConfirm with values', async () => {
        const user = userEvent.setup();
        render(<SubscribeModal {...defaultProps} />);

        // Defaults: 60, false, false
        await user.click(screen.getByText('subscribe'));
        expect(mockOnConfirm).toHaveBeenCalledWith({ interval: 60, downloadAllPrevious: false, downloadShorts: false, downloadOrder: 'dateDesc', filenameTemplate: null });
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onConfirm with updated values', async () => {
        const user = userEvent.setup();
        render(<SubscribeModal {...defaultProps} />);

        const intervalInput = screen.getByLabelText('checkIntervalMinutes');
        await user.clear(intervalInput);
        await user.type(intervalInput, '30');
        await user.click(screen.getByLabelText('downloadAllPreviousVideos'));
        await user.click(screen.getByLabelText('downloadShorts'));

        await user.click(screen.getByText('subscribe'));
        expect(mockOnConfirm).toHaveBeenCalledWith({ interval: 30, downloadAllPrevious: true, downloadShorts: true, downloadOrder: 'dateDesc', filenameTemplate: null });
    });

    it('should show download order only when download all previous is checked', async () => {
        const user = userEvent.setup();
        render(<SubscribeModal {...defaultProps} />);

        expect(screen.queryByLabelText('downloadOrder')).not.toBeInTheDocument();
        await user.click(screen.getByLabelText('downloadAllPreviousVideos'));
        expect(screen.getByLabelText('downloadOrder')).toBeInTheDocument();
    });

    it('should hide download order when disabled by prop', async () => {
        const user = userEvent.setup();
        render(<SubscribeModal {...defaultProps} enableDownloadOrder={false} />);

        await user.click(screen.getByLabelText('downloadAllPreviousVideos'));
        expect(screen.queryByLabelText('downloadOrder')).not.toBeInTheDocument();
    });

    it('should call onClose when cancel clicked', async () => {
        const user = userEvent.setup();
        render(<SubscribeModal {...defaultProps} />);

        await user.click(screen.getByText('cancel'));
        expect(mockOnClose).toHaveBeenCalled();
    });
    it('should show download shorts option for youtube', () => {
        render(<SubscribeModal {...defaultProps} source="youtube" />);
        expect(screen.getByText('downloadShorts')).toBeInTheDocument();
    });

    it('should hide download shorts option for bilibili', () => {
        render(<SubscribeModal {...defaultProps} source="bilibili" />);
        expect(screen.queryByText('downloadShorts')).not.toBeInTheDocument();
    });

    it('should hide download shorts option and show twitch help for twitch', () => {
        render(<SubscribeModal {...defaultProps} source="twitch" />);
        expect(screen.queryByText('downloadShorts')).not.toBeInTheDocument();
        expect(screen.getByText('twitchSubscriptionDescription')).toBeInTheDocument();
        expect(screen.getByText('twitchSubscriptionVodsOnly')).toBeInTheDocument();
    });

    it('should show download shorts option when source is undefined', () => {
        render(<SubscribeModal {...defaultProps} />);
        expect(screen.getByText('downloadShorts')).toBeInTheDocument();
    });

    it('uses the playlist-specific label and help when provided (design §10.4)', async () => {
        const user = userEvent.setup();
        render(
            <SubscribeModal
                {...defaultProps}
                downloadPreviousLabel="Download existing videos in these playlists"
                downloadPreviousHelp="custom-playlist-help"
            />
        );

        // Author-mode default label is replaced.
        expect(screen.getByText('Download existing videos in these playlists')).toBeInTheDocument();
        expect(screen.queryByText('downloadAllPreviousVideos')).not.toBeInTheDocument();

        // Help text appears only once the checkbox is checked.
        expect(screen.queryByText('custom-playlist-help')).not.toBeInTheDocument();
        await user.click(screen.getByLabelText('Download existing videos in these playlists'));
        expect(screen.getByText('custom-playlist-help')).toBeInTheDocument();
    });
});
