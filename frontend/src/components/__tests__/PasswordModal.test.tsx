import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PasswordModal from '../PasswordModal';

// Mock language context
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('PasswordModal', () => {
    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
    };

    it('should render when open', () => {
        render(<PasswordModal {...defaultProps} />);
        expect(screen.getByText('enterPassword')).toBeInTheDocument();
        expect(screen.getByLabelText('password')).toBeInTheDocument();
    });

    it('should call onClose when cancel is clicked', async () => {
        const user = userEvent.setup();
        render(<PasswordModal {...defaultProps} />);
        await user.click(screen.getByText('cancel'));
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should call onConfirm with password when submitted', async () => {
        const user = userEvent.setup();
        render(<PasswordModal {...defaultProps} />);

        const input = screen.getByLabelText('password');
        await user.type(input, 'secret');

        await user.click(screen.getByText('confirm'));
        expect(defaultProps.onConfirm).toHaveBeenCalledWith('secret');
    });

    it('should show error message when error prop is provided', () => {
        render(<PasswordModal {...defaultProps} error="Wrong password" />);
        expect(screen.getByText('Wrong password')).toBeInTheDocument();
    });

    it('should disable inputs and show loading when isLoading is true', () => {
        render(<PasswordModal {...defaultProps} isLoading={true} />);
        expect(screen.getByLabelText('password')).toBeDisabled();
        expect(screen.getByText('verifying')).toBeInTheDocument();
    });

    it('should toggle password visibility', async () => {
        const user = userEvent.setup();
        render(<PasswordModal {...defaultProps} />);

        const input = screen.getByLabelText('password');
        expect(input).toHaveAttribute('type', 'password');

        // Find visibility toggle button
        const toggleBtn = screen.getByLabelText('togglePasswordVisibility');
        await user.click(toggleBtn);

        expect(input).toHaveAttribute('type', 'text');

        await user.click(toggleBtn);
        expect(input).toHaveAttribute('type', 'password');
    });
});
