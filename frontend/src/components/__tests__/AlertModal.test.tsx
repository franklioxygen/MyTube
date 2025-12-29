import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AlertModal from '../AlertModal';

// Mock language context
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key === 'confirm' ? 'OK' : key }),
}));

describe('AlertModal', () => {
    const defaultProps = {
        open: true,
        onClose: vi.fn(),
        title: 'Test Title',
        message: 'Test Message'
    };

    it('should render when open is true', () => {
        render(<AlertModal {...defaultProps} />);
        expect(screen.getByText('Test Title')).toBeInTheDocument();
        expect(screen.getByText('Test Message')).toBeInTheDocument();
        expect(screen.getByText('OK')).toBeInTheDocument();
    });

    it('should not render when open is false', () => {
        render(<AlertModal {...defaultProps} open={false} />);
        expect(screen.queryByText('Test Title')).not.toBeInTheDocument();
    });

    it('should call onClose when confirm button is clicked', async () => {
        render(<AlertModal {...defaultProps} />);
        const user = userEvent.setup();
        await user.click(screen.getByText('OK'));
        expect(defaultProps.onClose).toHaveBeenCalled();
    });
});
