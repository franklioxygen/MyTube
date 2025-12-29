import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from '../../../types';
import CloudDriveSettings from '../CloudDriveSettings';

// Mock language context
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

// Mock ConfirmationModal
vi.mock('../../ConfirmationModal', () => ({
    default: ({ isOpen, onConfirm, onClose, title, message }: any) => {
        if (!isOpen) return null;
        return (
            <div data-testid="confirmation-modal">
                <h2>{title}</h2>
                <p>{message}</p>
                <button onClick={onConfirm}>Confirm</button>
                <button onClick={onClose}>Cancel</button>
            </div>
        );
    },
}));

// Mock axios
vi.mock('axios');

describe('CloudDriveSettings', () => {
    const defaultSettings: Settings = {
        cloudDriveEnabled: true,
        openListApiUrl: 'http://localhost/api/fs/put',
        openListToken: 'test-token',
        openListPublicUrl: 'http://localhost',
        cloudDrivePath: '/uploads',
        cloudDriveScanPaths: '/scan',
    } as Settings;

    const mockOnChange = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render all fields when enabled', () => {
        render(<CloudDriveSettings settings={defaultSettings} onChange={mockOnChange} />);

        expect(screen.getByLabelText(/enableAutoSave/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/apiUrl/i)).toHaveValue('http://localhost/api/fs/put');
        expect(screen.getByLabelText(/token/i)).toHaveValue('test-token');
        expect(screen.getByLabelText(/publicUrl/i)).toHaveValue('http://localhost');
        expect(screen.getByLabelText(/uploadPath/i)).toHaveValue('/uploads');
        expect(screen.getByLabelText(/scanPaths/i)).toHaveValue('/scan');
    });

    it('should hide fields when disabled', () => {
        render(<CloudDriveSettings settings={{ ...defaultSettings, cloudDriveEnabled: false }} onChange={mockOnChange} />);

        expect(screen.getByLabelText(/enableAutoSave/i)).toBeInTheDocument();
        expect(screen.queryByLabelText(/apiUrl/i)).not.toBeInTheDocument();
    });

    it('should validate API URL format', async () => {
        render(<CloudDriveSettings settings={{ ...defaultSettings, openListApiUrl: 'invalid-url' }} onChange={mockOnChange} />);

        // This relies on the component rendering the error message based on the invalid prop passed
        // The component validates props immediately on render
        // Check for error helper text if rendered locally
        // Looking at the code: const apiUrlError = ...
        // So we might need to find the error message.
        // Actually, MUI helperText usually renders.
        // The validation logic is inside the component render body.

        await waitFor(() => {
            // We can check if invalid-url causes "Invalid URL format" or similar if the component shows it.
            // The mock t returns key.
            // We can assume validateApiUrl returns 'URL must start with http:// or https://' or 'URL should end with /api/fs/put'
            // 'invalid-url' fails 'http' check.
            expect(screen.getByLabelText(/apiUrl/i)).toBeInvalid();
        });
    });

    it('should call onChange when fields are updated', async () => {
        render(<CloudDriveSettings settings={defaultSettings} onChange={mockOnChange} />);

        const urlInput = screen.getByLabelText(/apiUrl/i);
        fireEvent.change(urlInput, { target: { value: 'http://new-url' } });

        expect(mockOnChange).toHaveBeenCalledWith('openListApiUrl', 'http://new-url');
    });

    it('should handle test connection success', async () => {
        const user = userEvent.setup();
        (axios.request as any).mockResolvedValue({ status: 200 });

        render(<CloudDriveSettings settings={defaultSettings} onChange={mockOnChange} />);

        const testBtn = screen.getByText('testConnection');
        await user.click(testBtn);

        expect(axios.request).toHaveBeenCalled();
        expect(await screen.findByText('connectionTestSuccess')).toBeInTheDocument();
    });

    it('should handle test connection failure', async () => {
        const user = userEvent.setup();
        (axios.request as any).mockRejectedValue(new Error('Network Error'));

        render(<CloudDriveSettings settings={defaultSettings} onChange={mockOnChange} />);

        const testBtn = screen.getByText('testConnection');
        await user.click(testBtn);

        expect(await screen.findByText(/connectionTestFailed/)).toBeInTheDocument();
    });

    it('should handle sync flow', async () => {
        const user = userEvent.setup();
        // Mock global fetch for sync
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: {
                getReader: () => ({
                    read: vi.fn()
                        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(JSON.stringify({ type: 'progress', current: 1, total: 2 }) + '\n') })
                        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(JSON.stringify({ type: 'complete', report: { total: 2, uploaded: 2, failed: 0, errors: [] } }) + '\n') })
                        .mockResolvedValueOnce({ done: true })
                })
            }
        } as any);

        render(<CloudDriveSettings settings={defaultSettings} onChange={mockOnChange} />);

        // Click Sync button to open modal
        await user.click(screen.getByText('sync'));

        // Confirm in modal
        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
        await user.click(screen.getByText('Confirm'));

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/cloud/sync'), expect.any(Object));
        });
    });
});
