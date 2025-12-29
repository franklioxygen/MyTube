import { fireEvent, render, screen } from '@testing-library/react';
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

    it('should call onClose when confirm button is clicked', () => {
        render(<AlertModal {...defaultProps} />);
        fireEvent.click(screen.getByText('OK'));
        expect(defaultProps.onClose).toHaveBeenCalled();
    });
});
