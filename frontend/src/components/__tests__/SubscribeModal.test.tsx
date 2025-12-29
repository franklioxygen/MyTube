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

        // Defaults: 60, false
        await user.click(screen.getByText('subscribe'));
        expect(mockOnConfirm).toHaveBeenCalledWith(60, false);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onConfirm with updated values', async () => {
        const user = userEvent.setup();
        render(<SubscribeModal {...defaultProps} />);

        const intervalInput = screen.getByLabelText('checkIntervalMinutes');
        await user.clear(intervalInput);
        await user.type(intervalInput, '30');
        await user.click(screen.getByLabelText('downloadAllPreviousVideos'));

        await user.click(screen.getByText('subscribe'));
        expect(mockOnConfirm).toHaveBeenCalledWith(30, true);
    });

    it('should call onClose when cancel clicked', async () => {
        const user = userEvent.setup();
        render(<SubscribeModal {...defaultProps} />);

        await user.click(screen.getByText('cancel'));
        expect(mockOnClose).toHaveBeenCalled();
    });
});
