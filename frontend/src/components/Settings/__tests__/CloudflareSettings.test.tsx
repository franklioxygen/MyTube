import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { useCloudflareStatus } from '../../../hooks/useCloudflareStatus';
import CloudflareSettings from '../CloudflareSettings';

// Mock contexts and hooks
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../contexts/SnackbarContext', () => ({
    useSnackbar: vi.fn(),
}));

vi.mock('../../../hooks/useCloudflareStatus', () => ({
    useCloudflareStatus: vi.fn(),
}));

describe('CloudflareSettings', () => {
    const mockOnChange = vi.fn();
    const mockShowSnackbar = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        (useSnackbar as any).mockReturnValue({ showSnackbar: mockShowSnackbar });
        // Default mock for hook
        (useCloudflareStatus as any).mockReturnValue({
            data: { isRunning: false },
            isLoading: false
        });
    });

    it('should render switch and fields', () => {
        render(<CloudflareSettings enabled={true} token="test-token" onChange={mockOnChange} />);

        expect(screen.getByLabelText(/enableCloudflaredTunnel/i)).toBeChecked();
        expect(screen.getByLabelText(/cloudflaredToken/i)).toHaveValue('test-token');
    });

    it('should update enable state on switch toggle', async () => {
        const user = userEvent.setup();
        render(<CloudflareSettings enabled={false} token="" onChange={mockOnChange} />);

        const switchControl = screen.getByRole('switch', { name: /enableCloudflaredTunnel/i });
        await user.click(switchControl);

        expect(mockOnChange).toHaveBeenCalledWith('cloudflaredTunnelEnabled', true);
    });

    it('should update token on change', async () => {
        const user = userEvent.setup();
        render(<CloudflareSettings enabled={true} token="" onChange={mockOnChange} />);

        const tokenInput = screen.getByLabelText(/cloudflaredToken/i);
        await user.type(tokenInput, 'new-token');

        expect(mockOnChange).toHaveBeenCalledWith('cloudflaredToken', 'n');
    });

    it('should display running status', () => {
        (useCloudflareStatus as any).mockReturnValue({
            data: { isRunning: true, publicUrl: 'https://test.trycloudflare.com', tunnelId: '123' },
            isLoading: false
        });

        render(<CloudflareSettings enabled={true} token="test-token" onChange={mockOnChange} />);

        expect(screen.getByText('running')).toBeInTheDocument();
        expect(screen.getByText('https://test.trycloudflare.com')).toBeInTheDocument();
        expect(screen.getByText('123')).toBeInTheDocument();
    });

    it('should handle copy to clipboard', async () => {
        const user = userEvent.setup();

        // Mock navigator.clipboard
        const originalClipboard = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
            configurable: true,
        });

        (useCloudflareStatus as any).mockReturnValue({
            data: { isRunning: true, publicUrl: 'https://test.trycloudflare.com' },
            isLoading: false
        });

        render(<CloudflareSettings enabled={true} token="test-token" onChange={mockOnChange} />);

        const urlElement = screen.getByText('https://test.trycloudflare.com');
        await user.click(urlElement);

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://test.trycloudflare.com');

        // Cleanup
        if (originalClipboard) {
            Object.defineProperty(navigator, 'clipboard', { value: originalClipboard });
        }
    });
});
