import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
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
        savedSettings: {
            maxConcurrentDownloads: 3,
            preferredAudioLanguage: '',
        } as any,
    };

    const renderDownloadSettings = (
        props: Partial<ComponentProps<typeof DownloadSettings>> = {}
    ) => {
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
                mutations: { retry: false },
            },
        });

        return render(
            <QueryClientProvider client={queryClient}>
                <DownloadSettings {...defaultProps} {...props} />
            </QueryClientProvider>
        );
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render slider and cleanup button', () => {
        renderDownloadSettings();

        expect(screen.getByText('maxConcurrent: 3')).toBeInTheDocument();
        expect(screen.getAllByText('cleanupTempFiles')[0]).toBeInTheDocument();
        expect(screen.getByRole('slider')).toHaveValue('3');
    });

    it('should call onCleanup when button clicked', async () => {
        const user = userEvent.setup();
        renderDownloadSettings();

        await user.click(screen.getByRole('button', { name: 'cleanupTempFiles' }));
        expect(mockOnCleanup).toHaveBeenCalled();
    });

    it('should disable cleanup button when active downloads exist', () => {
        renderDownloadSettings({ activeDownloadsCount: 1 });

        expect(screen.getByText('cleanupTempFilesActiveDownloads')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'cleanupTempFiles' })).toBeDisabled();
    });

    it('should change max concurrent downloads via slider', () => {
        renderDownloadSettings();

        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: 5 } });

        expect(mockOnChange).toHaveBeenCalledWith('maxConcurrentDownloads', 5);
    });

    it('should render preferred audio language dropdown and call onChange when selection changes', async () => {
        const user = userEvent.setup();
        renderDownloadSettings();

        const dropdowns = screen.getAllByRole('combobox');
        const dropdown = dropdowns[0];
        expect(dropdown).toBeInTheDocument();

        await user.click(dropdown);
        const option = await screen.findByRole('option', { name: 'preferredAudioLanguage_ja' });
        await user.click(option);

        expect(mockOnChange).toHaveBeenCalledWith('preferredAudioLanguage', 'ja');
    });

    it('should show preferred audio language description', () => {
        renderDownloadSettings();

        expect(screen.getByText('preferredAudioLanguageDescription')).toBeInTheDocument();
    });

    it('should render video codec dropdown and call onChange when selection changes', async () => {
        const user = userEvent.setup();
        renderDownloadSettings();

        const dropdowns = screen.getAllByRole('combobox');
        const codecDropdown = dropdowns[1];
        expect(codecDropdown).toBeInTheDocument();

        await user.click(codecDropdown);
        const option = await screen.findByRole('option', { name: 'defaultVideoCodec_h265' });
        await user.click(option);

        expect(mockOnChange).toHaveBeenCalledWith('defaultVideoCodec', 'h265');
    });

    it('should show video codec description', () => {
        renderDownloadSettings();

        expect(screen.getByText('defaultVideoCodecDescription')).toBeInTheDocument();
    });

    it('should toggle dont skip deleted video setting', async () => {
        const user = userEvent.setup();
        renderDownloadSettings({ settings: { ...defaultProps.settings, dontSkipDeletedVideo: false } });

        await user.click(screen.getByRole('switch', { name: 'dontSkipDeletedVideo' }));

        expect(mockOnChange).toHaveBeenCalledWith('dontSkipDeletedVideo', true);
    });

    it('should disable cleanup button while saving', () => {
        renderDownloadSettings({ isSaving: true });

        expect(screen.getByRole('button', { name: 'cleanupTempFiles' })).toBeDisabled();
    });

    it('should render the default preferred audio language label when empty', () => {
        renderDownloadSettings({ settings: { ...defaultProps.settings, preferredAudioLanguage: '' } });

        expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('preferredAudioLanguageDefault');
    });

    it('should render the translated preferred audio language label for known values', () => {
        renderDownloadSettings({ settings: { ...defaultProps.settings, preferredAudioLanguage: 'ja' } });

        expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('preferredAudioLanguage_ja');
    });

    it('should render the raw preferred audio language value when it is unknown', () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        renderDownloadSettings({ settings: { ...defaultProps.settings, preferredAudioLanguage: 'xx' } });

        expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('xx');
        consoleWarnSpy.mockRestore();
    });

    it('should render the default video codec label when empty', () => {
        renderDownloadSettings({ settings: { ...defaultProps.settings, defaultVideoCodec: '' } });

        expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('defaultVideoCodecDefault');
    });

    it('should render the translated video codec label for known values', () => {
        renderDownloadSettings({ settings: { ...defaultProps.settings, defaultVideoCodec: 'av1' } });

        expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('defaultVideoCodec_av1');
    });

    it('should render the raw video codec value when it is unknown', () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        renderDownloadSettings({ settings: { ...defaultProps.settings, defaultVideoCodec: 'xvid' } });

        expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('xvid');
        consoleWarnSpy.mockRestore();
    });
});
