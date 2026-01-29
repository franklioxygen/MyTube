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
            preferredAudioLanguage: '',
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

    it('should render preferred audio language dropdown and call onChange when selection changes', async () => {
        const user = userEvent.setup();
        render(<DownloadSettings {...defaultProps} />);

        const dropdown = screen.getByRole('combobox');
        expect(dropdown).toBeInTheDocument();

        await user.click(dropdown);
        const option = await screen.findByRole('option', { name: 'preferredAudioLanguage_ja' });
        await user.click(option);

        expect(mockOnChange).toHaveBeenCalledWith('preferredAudioLanguage', 'ja');
    });

    it('should show preferred audio language description', () => {
        render(<DownloadSettings {...defaultProps} />);

        expect(screen.getByText('preferredAudioLanguageDescription')).toBeInTheDocument();
    });
});
