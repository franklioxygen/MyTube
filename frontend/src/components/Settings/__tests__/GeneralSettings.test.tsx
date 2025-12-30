import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GeneralSettings from '../GeneralSettings';

// Mock dependencies
vi.mock('axios');
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock('../../PasswordModal', () => ({
    default: ({ isOpen, onConfirm, onClose, error }: any) => isOpen ? (
        <div role="dialog">
            Password Modal
            {error && <div>{error}</div>}
            <button onClick={() => onConfirm('password')}>Confirm</button>
            <button onClick={onClose}>Close</button>
        </div>
    ) : null
}));

const queryClient = new QueryClient({
    defaultOptions: {
        queries: { retry: false }
    }
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('GeneralSettings', () => {
    const defaultProps = {
        language: 'en',
        websiteName: 'MyTube',
        itemsPerPage: 12,
        showYoutubeSearch: true,
        visitorMode: false,
        savedVisitorMode: false,
        infiniteScroll: false,
        videoColumns: 4,
        onChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        queryClient.clear();
    });

    it('should render all settings controls', () => {
        render(<GeneralSettings {...defaultProps} />, { wrapper });

        // Use getAllByText because label and helper text might match
        expect(screen.getAllByText('websiteName')[0]).toBeInTheDocument();
        expect(screen.getByDisplayValue('MyTube')).toBeInTheDocument();
        expect(screen.getByText('infiniteScroll')).toBeInTheDocument();
        expect(screen.getByText('visitorMode')).toBeInTheDocument();
    });

    it('should call onChange when inputs change', () => {
        render(<GeneralSettings {...defaultProps} />, { wrapper });

        const nameInput = screen.getByDisplayValue('MyTube');
        fireEvent.change(nameInput, { target: { value: 'NewName' } });
        expect(defaultProps.onChange).toHaveBeenCalledWith('websiteName', 'NewName');

        const itemsInput = screen.getByDisplayValue('12');
        fireEvent.change(itemsInput, { target: { value: '24' } });
        expect(defaultProps.onChange).toHaveBeenCalledWith('itemsPerPage', 24);
    });

    it('should open password modal when changing visitor mode', () => {
        render(<GeneralSettings {...defaultProps} />, { wrapper });

        const visitorSwitch = screen.getByLabelText('visitorMode');
        fireEvent.click(visitorSwitch);

        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should verify password and update visitor mode on success', async () => {
        (axios.post as any).mockResolvedValueOnce({ data: { success: true } }); // Verify
        (axios.post as any).mockResolvedValueOnce({ data: { success: true } }); // Save setting

        render(<GeneralSettings {...defaultProps} />, { wrapper });

        // Open modal
        fireEvent.click(screen.getByLabelText('visitorMode'));

        // Confirm password
        fireEvent.click(screen.getByText('Confirm'));

        await waitFor(() => {
            expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/verify-password'), { password: 'password' });
            expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/settings'), { visitorMode: true });
            expect(defaultProps.onChange).toHaveBeenCalledWith('visitorMode', true);
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
    });

    it('should show error on password verification failure', async () => {
        const errorResponse = {
            response: {
                status: 401,
                data: {}
            }
        };
        (axios.post as any).mockRejectedValue(errorResponse);

        render(<GeneralSettings {...defaultProps} />, { wrapper });

        fireEvent.click(screen.getByLabelText('visitorMode'));
        fireEvent.click(screen.getByText('Confirm'));

        await waitFor(() => {
            expect(screen.getByText('incorrectPassword')).toBeInTheDocument();
        });
    });
});
