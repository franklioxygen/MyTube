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

// Mock apiClient module so fetchWithCsrf is controllable in tests
vi.mock('../../../utils/apiClient', () => ({
    api: {
        delete: vi.fn().mockResolvedValue({ data: { success: true } }),
    },
    apiClient: {
        defaults: { baseURL: '/api' },
    },
    fetchWithCsrf: vi.fn(),
}));

import { fetchWithCsrf } from '../../../utils/apiClient';

const makeSyncResponse = (lines: object[]) => ({
    ok: true,
    body: {
        getReader: () => {
            const chunks = lines.map(
                (l) => ({ done: false as const, value: new TextEncoder().encode(JSON.stringify(l) + '\n') })
            );
            const reads = [...chunks, { done: true as const, value: undefined }];
            let i = 0;
            return { read: vi.fn().mockImplementation(() => Promise.resolve(reads[i++])) };
        },
    },
});

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

        await waitFor(() => {
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
        vi.mocked(fetchWithCsrf).mockResolvedValue(makeSyncResponse([
            { type: 'progress', current: 1, total: 2 },
            { type: 'complete', report: { total: 2, uploaded: 2, failed: 0, errors: [] } },
        ]) as any);

        render(<CloudDriveSettings settings={defaultSettings} onChange={mockOnChange} />);

        await user.click(screen.getByText('sync'));
        expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
        await user.click(screen.getByText('Confirm'));

        await waitFor(() => {
            expect(vi.mocked(fetchWithCsrf)).toHaveBeenCalledWith(
                '/cloud/sync',
                expect.objectContaining({ method: 'POST' })
            );
        });

        await waitFor(() => {
            expect(screen.getByText('syncCompleted')).toBeInTheDocument();
        });
    });

    it('should use fetchWithCsrf (not raw fetch) to protect sync against CSRF', async () => {
        const user = userEvent.setup();
        const rawFetch = vi.fn();
        global.fetch = rawFetch;

        vi.mocked(fetchWithCsrf).mockResolvedValue(makeSyncResponse([
            { type: 'complete', report: { total: 0, uploaded: 0, failed: 0, errors: [] } },
        ]) as any);

        render(<CloudDriveSettings settings={defaultSettings} onChange={mockOnChange} />);
        await user.click(screen.getByText('sync'));
        await user.click(screen.getByText('Confirm'));

        await waitFor(() => {
            expect(vi.mocked(fetchWithCsrf)).toHaveBeenCalledWith(
                '/cloud/sync',
                expect.objectContaining({ method: 'POST' })
            );
        });

        // Raw fetch must not be called directly — CSRF protection would be bypassed
        expect(rawFetch).not.toHaveBeenCalled();
    });
});
