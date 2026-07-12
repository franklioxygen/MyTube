import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmationModal from '../ConfirmationModal';

describe('ConfirmationModal', () => {
    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
        title: 'Confirm Action',
        message: 'Are you sure?',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders with title and message when open', () => {
        render(<ConfirmationModal {...defaultProps} />);

        expect(screen.getByText('Confirm Action')).toBeInTheDocument();
        expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
        render(<ConfirmationModal {...defaultProps} isOpen={false} />);

        expect(screen.queryByText('Confirm Action')).not.toBeInTheDocument();
    });

    it('calls onConfirm and onClose when confirm button is clicked', async () => {
        render(<ConfirmationModal {...defaultProps} />);

        const user = userEvent.setup();
        await user.click(screen.getByText('Confirm')); // Default text

        expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
        // Ensure onClose is called after onConfirm
        expect(defaultProps.onConfirm.mock.invocationCallOrder[0]).toBeLessThan(
            defaultProps.onClose.mock.invocationCallOrder[0]
        );
    });

    it('calls onClose when cancel button is clicked', async () => {
        render(<ConfirmationModal {...defaultProps} />);

        const user = userEvent.setup();
        await user.click(screen.getByText('Cancel')); // Default text

        expect(defaultProps.onClose).toHaveBeenCalled();
        expect(defaultProps.onConfirm).not.toHaveBeenCalled();
    });

    it('renders custom button text', () => {
        render(
            <ConfirmationModal
                {...defaultProps}
                confirmText="Yes, do it"
                cancelText="No, wait"
            />
        );

        expect(screen.getByText('Yes, do it')).toBeInTheDocument();
        expect(screen.getByText('No, wait')).toBeInTheDocument();
    });

    it('shows loading state and disables cancel while async confirm is pending', async () => {
        let resolveConfirm!: () => void;
        const onConfirm = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveConfirm = resolve;
                })
        );
        const onClose = vi.fn();

        render(<ConfirmationModal {...defaultProps} onConfirm={onConfirm} onClose={onClose} />);

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();

        await act(async () => {
            resolveConfirm();
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps the modal open when async confirm rejects', async () => {
        const onConfirm = vi.fn(() => Promise.reject(new Error('failed')));
        const onClose = vi.fn();

        render(<ConfirmationModal {...defaultProps} onConfirm={onConfirm} onClose={onClose} />);

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Confirm' }));

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    });
});
