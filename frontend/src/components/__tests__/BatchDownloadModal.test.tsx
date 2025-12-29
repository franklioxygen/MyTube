import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BatchDownloadModal from '../BatchDownloadModal';

// Mock language context
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('BatchDownloadModal', () => {
    const defaultProps = {
        open: true,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
    };

    it('should render when open is true', () => {
        render(<BatchDownloadModal {...defaultProps} />);
        expect(screen.getByText('batchDownload')).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/youtube\.com/)).toBeInTheDocument();
    });

    it('should call onClose when cancel is clicked', async () => {
        const user = userEvent.setup();
        render(<BatchDownloadModal {...defaultProps} />);

        await user.click(screen.getByText('cancel'));
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should split urls and call onConfirm', async () => {
        const user = userEvent.setup();
        render(<BatchDownloadModal {...defaultProps} />);

        const input = screen.getByRole('textbox');
        await user.type(input, 'http://url1.com{enter}https://url2.com');

        await user.click(screen.getByText('addToQueue'));

        expect(defaultProps.onConfirm).toHaveBeenCalledWith([
            'http://url1.com',
            'https://url2.com'
        ]);
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should disable confirm button when input is empty', () => {
        render(<BatchDownloadModal {...defaultProps} />);
        const button = screen.getByText('addToQueue').closest('button');
        expect(button).toBeDisabled();
    });

    it('should enable confirm button when input has text', async () => {
        const user = userEvent.setup();
        render(<BatchDownloadModal {...defaultProps} />);

        const input = screen.getByRole('textbox');
        await user.type(input, 'test');

        const button = screen.getByText('addToQueue').closest('button');
        expect(button).not.toBeDisabled();
    });
});
