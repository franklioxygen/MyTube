import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UploadModal from '../UploadModal';

// Mock dependencies
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('@tanstack/react-query', () => ({
    useMutation: vi.fn(),
}));

// Mock axios just in case interaction reaches it, though we mock useMutation usually
vi.mock('axios');

import { useMutation } from '@tanstack/react-query';

describe('UploadModal', () => {
    const mockOnClose = vi.fn();
    const mockOnUploadSuccess = vi.fn();
    const mockMutate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // Setup default useMutation mock
        vi.mocked(useMutation).mockReturnValue({
            mutate: mockMutate,
            isPending: false,
            reset: vi.fn(),
        } as any);
    });

    const defaultProps = {
        open: true,
        onClose: mockOnClose,
        onUploadSuccess: mockOnUploadSuccess,
    };

    it('should render correctly when open', () => {
        render(<UploadModal {...defaultProps} />);

        expect(screen.getByText('uploadVideo')).toBeInTheDocument();
        expect(screen.getByText('selectVideoFile')).toBeInTheDocument();
        expect(screen.getByLabelText('title')).toBeInTheDocument();
        expect(screen.getByLabelText('author')).toBeInTheDocument();
        expect(screen.getByText('upload')).toBeInTheDocument();
        expect(screen.getByText('cancel')).toBeInTheDocument();
    });

    it('should not render when closed', () => {
        render(<UploadModal {...defaultProps} open={false} />);

        // Dialog handles open/close, checking for title text usually suffices
        expect(screen.queryByText('uploadVideo')).not.toBeInTheDocument();
    });

    it('should handle file selection and auto-fill title', async () => {
        render(<UploadModal {...defaultProps} />);

        const file = new File(['dummy content'], 'test-video.mp4', { type: 'video/mp4' });

        // Find the hidden input
        // Using container to find input[type="file"] as it is hidden
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;

        // Use fireEvent for hidden input change
        if (input) {
            fireEvent.change(input, { target: { files: [file] } });
        }

        expect(screen.getByText('test-video.mp4')).toBeInTheDocument();
        expect(screen.getByDisplayValue('test-video')).toBeInTheDocument(); // Title auto-filled
    });

    it('should allow updating title and author', async () => {
        const user = userEvent.setup();
        render(<UploadModal {...defaultProps} />);

        const titleInput = screen.getByLabelText('title');
        const authorInput = screen.getByLabelText('author');

        await user.clear(titleInput);
        await user.type(titleInput, 'New Title');
        expect(titleInput).toHaveValue('New Title');

        await user.clear(authorInput);
        await user.type(authorInput, 'New Author');
        expect(authorInput).toHaveValue('New Author');
    });

    it('should validate file selection before upload', async () => {
        render(<UploadModal {...defaultProps} />);

        // Verify upload button is disabled initially (when no file selected)
        const uploadBtn = screen.getByRole('button', { name: /upload/i });
        // Note: material ui button might be disabled using disabled attribute
        expect(uploadBtn).toBeDisabled();

        // Validation effectively handled by disabling the button
    });

    it('should trigger upload on valid submission', async () => {
        const user = userEvent.setup();
        render(<UploadModal {...defaultProps} />);

        const file = new File(['dummy content'], 'video.mp4', { type: 'video/mp4' });
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        if (input) {
            fireEvent.change(input, { target: { files: [file] } });
        }

        // Wait for state update
        await waitFor(() => {
            expect(screen.getByText('video.mp4')).toBeInTheDocument();
        });

        const uploadButton = screen.getByText('upload');
        expect(uploadButton.closest('button')).toBeEnabled();

        await user.click(uploadButton);

        expect(mockMutate).toHaveBeenCalled();
        // Verify FormData was passed
        const formData = mockMutate.mock.calls[0][0];
        expect(formData).toBeInstanceOf(FormData);
        expect(formData.get('title')).toBe('video');
        expect(formData.get('author')).toBe('Admin');
        expect(formData.get('video')).toBe(file);
    });

    it('should show loading state during upload', () => {
        vi.mocked(useMutation).mockReturnValue({
            mutate: mockMutate,
            isPending: true, // mutation in progress
            reset: vi.fn(),
        } as any);

        render(<UploadModal {...defaultProps} />);

        expect(screen.getByText('uploading 0%')).toBeInTheDocument();
        // There might be multiple progress bars (linear and button circular).
        // Check for presence of any progressbar is usually enough or distinct them.
        expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);
        // Inputs should be disabled
        expect(screen.getByLabelText('title')).toBeDisabled();
        expect(screen.getByLabelText('author')).toBeDisabled();
    });

    it('should display error when upload fails', async () => {
        // Define a mock implementation where we simulate onError being called by the useMutation config.
        // However, useMutation hook structure in component is:
        // const uploadMutation = useMutation({ ... onError: (err) => setError(...) })

        // Since we mock useMutation, the component's onError callback passed TO useMutation is what matters.
        // But we are mocking the return value. To test component's reaction to error, 
        // usually we'd need to invoke the options.onError passed to useMutation, 
        // OR simply set a state if the component exposed it, but here it's internal state.

        // Testing internal state set by callback passed to mocked hook is hard without a refined mock.
        // Refined Mock: capture the options passed to useMutation.
        let capturedOptions: any = {};
        vi.mocked(useMutation).mockImplementation((options: any) => {
            capturedOptions = options;
            return {
                mutate: mockMutate,
                isPending: false,
                reset: vi.fn(),
            } as any;
        });

        render(<UploadModal {...defaultProps} />);

        // Simulate upload action (optional, just to set context if needed, but not strictly required for this test)
        // Trigger onError manually
        const error = { response: { data: { error: 'Upload Error Message' } } };

        expect(capturedOptions.onError).toBeDefined();

        await act(async () => {
            capturedOptions.onError(error);
        });

        expect(await screen.findByText('Upload Error Message')).toBeInTheDocument();
    });
});
