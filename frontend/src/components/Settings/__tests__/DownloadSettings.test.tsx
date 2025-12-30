import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DownloadSettings from '../DownloadSettings';

// Mock language context
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('DownloadSettings', () => {
    const mockOnChange = vi.fn();
    const mockOnCleanup = vi.fn();

    const defaultProps = {
        settings: {
            maxConcurrentDownloads: 3,
        } as any,
        onChange: mockOnChange,
        activeDownloadsCount: 0,
        onCleanup: mockOnCleanup,
        isSaving: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render slider and cleanup button', () => {
        render(<DownloadSettings {...defaultProps} />);

        expect(screen.getByText('maxConcurrent: 3')).toBeInTheDocument();
        expect(screen.getAllByText('cleanupTempFiles')[0]).toBeInTheDocument();
        expect(screen.getByRole('slider')).toHaveValue('3');
    });

    it('should call onCleanup when button clicked', async () => {
        const user = userEvent.setup();
        render(<DownloadSettings {...defaultProps} />);

        await user.click(screen.getByRole('button', { name: 'cleanupTempFiles' }));
        expect(mockOnCleanup).toHaveBeenCalled();
    });

    it('should disable cleanup button when active downloads exist', () => {
        render(<DownloadSettings {...defaultProps} activeDownloadsCount={1} />);

        expect(screen.getByText('cleanupTempFilesActiveDownloads')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'cleanupTempFiles' })).toBeDisabled();
    });

    it('should change max concurrent downloads via slider', () => {
        render(<DownloadSettings {...defaultProps} />);

        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: 5 } });

        expect(mockOnChange).toHaveBeenCalledWith('maxConcurrentDownloads', 5);
    });
});
