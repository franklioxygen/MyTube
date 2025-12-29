import { useMutation, useQuery } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CookieSettings from '../CookieSettings';

// Mock contexts and hooks
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('@tanstack/react-query', () => ({
    useQuery: vi.fn(),
    useMutation: vi.fn(),
}));

// Mock ConfirmationModal
vi.mock('../../ConfirmationModal', () => ({
    default: ({ isOpen, onConfirm, onClose }: any) => {
        if (!isOpen) return null;
        return (
            <div data-testid="confirmation-modal">
                <button onClick={onConfirm}>Confirm</button>
                <button onClick={onClose}>Cancel</button>
            </div>
        );
    },
}));

// Mock axios
vi.mock('axios');

describe('CookieSettings', () => {
    const mockOnSuccess = vi.fn();
    const mockOnError = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // Default useQuery mock
        (useQuery as any).mockReturnValue({
            data: { exists: false },
            refetch: vi.fn(),
            isLoading: false,
        });
        // Default useMutation mock
        (useMutation as any).mockReturnValue({
            mutate: vi.fn(),
            isPending: false,
        });
    });

    it('should render upload button and not found status initially', () => {
        render(<CookieSettings onSuccess={mockOnSuccess} onError={mockOnError} />);

        expect(screen.getByText('uploadCookies')).toBeInTheDocument();
        expect(screen.getByText('cookiesNotFound')).toBeInTheDocument();
    });

    it('should render delete button and found status when cookies exist', () => {
        (useQuery as any).mockReturnValue({
            data: { exists: true },
            refetch: vi.fn(),
            isLoading: false,
        });

        render(<CookieSettings onSuccess={mockOnSuccess} onError={mockOnError} />);

        expect(screen.getByText('deleteCookies')).toBeInTheDocument();
        expect(screen.getByText('cookiesFound')).toBeInTheDocument();
    });

    it('should handle file upload', async () => {
        const user = userEvent.setup();
        const refetchMock = vi.fn();
        (useQuery as any).mockReturnValue({
            data: { exists: false },
            refetch: refetchMock,
            isLoading: false,
        });
        (axios.post as any).mockResolvedValue({ data: {} });

        render(<CookieSettings onSuccess={mockOnSuccess} onError={mockOnError} />);

        const file = new File(['cookie data'], 'cookies.txt', { type: 'text/plain' });
        // Use hidden input to upload
        // Finding the input is tricky as it's hidden. 
        // We can look for the button component="label" which wraps the input.
        // Or directly select by implicit accessibility if possible, but input type=file is hidden.
        // testing-library userEvent.upload can attach to input or label.

        // Use container query to find input
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        if (fileInput) {
            await user.upload(fileInput, file);
        }

        expect(axios.post).toHaveBeenCalledWith(
            expect.stringContaining('/settings/upload-cookies'),
            expect.any(FormData),
            expect.any(Object)
        );

        await waitFor(() => {
            expect(mockOnSuccess).toHaveBeenCalledWith('cookiesUploadedSuccess');
            expect(refetchMock).toHaveBeenCalled();
        });
    });

    it('should reject non-txt files', async () => {
        const { container } = render(<CookieSettings onSuccess={mockOnSuccess} onError={mockOnError} />);

        const file = new File(['data'], 'test.png', { type: 'image/png' });
        const fileInput = container.querySelector('input[type="file"]');

        if (fileInput) {
            fireEvent.change(fileInput, { target: { files: [file] } });
        }

        expect(mockOnError).toHaveBeenCalledWith('onlyTxtFilesAllowed');
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('should handle delete cookies', async () => {
        const user = userEvent.setup();
        const mutateMock = vi.fn();
        (useQuery as any).mockReturnValue({
            data: { exists: true },
            refetch: vi.fn(),
            isLoading: false,
        });
        (useMutation as any).mockReturnValue({
            mutate: mutateMock,
            isPending: false,
        });

        render(<CookieSettings onSuccess={mockOnSuccess} onError={mockOnError} />);

        // Click delete button
        await user.click(screen.getByText('deleteCookies'));

        // Confirm modal
        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
        await user.click(screen.getByText('Confirm'));

        expect(mutateMock).toHaveBeenCalled();
    });
});
