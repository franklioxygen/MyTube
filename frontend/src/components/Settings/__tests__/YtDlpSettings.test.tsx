import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import YtDlpSettings from '../YtDlpSettings';

// Mock language context
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('YtDlpSettings', () => {
    const mockOnChange = vi.fn();
    const mockOnProxyChange = vi.fn();
    const defaultConfig = '# Default Config';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render initial state', () => {
        render(
            <YtDlpSettings
                config={defaultConfig}
                proxyOnlyYoutube={false}
                onChange={mockOnChange}
                onProxyOnlyYoutubeChange={mockOnProxyChange}
            />
        );

        expect(screen.getByText('ytDlpConfiguration')).toBeInTheDocument();
        expect(screen.getByText('customize')).toBeInTheDocument();
        // Textarea should be hidden initially
        expect(screen.queryByPlaceholderText(/yt-dlp Configuration/)).not.toBeVisible();
    });

    it('should expand configuration on customize click', async () => {
        const user = userEvent.setup();
        render(
            <YtDlpSettings
                config={defaultConfig}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByText('customize'));

        expect(screen.getByText('hide')).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toBeVisible();
        expect(screen.getByRole('textbox')).toHaveValue(defaultConfig);
    });

    it('should handle config changes', async () => {
        const user = userEvent.setup();
        render(
            <YtDlpSettings
                config={defaultConfig}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByText('customize'));

        const textarea = screen.getByRole('textbox');
        await user.clear(textarea);
        await user.type(textarea, 'New Config');

        expect(mockOnChange).toHaveBeenCalledWith('New Config');
    });

    it('should reset config', async () => {
        const user = userEvent.setup();
        render(
            <YtDlpSettings
                config="Custom Config"
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByText('customize'));
        await user.click(screen.getByText('reset'));

        expect(mockOnChange).toHaveBeenCalledWith(expect.stringContaining('# yt-dlp Configuration File'));
    });

    it('should toggle proxy only youtube', async () => {
        const user = userEvent.setup();
        render(
            <YtDlpSettings
                config={defaultConfig}
                proxyOnlyYoutube={false}
                onChange={mockOnChange}
                onProxyOnlyYoutubeChange={mockOnProxyChange}
            />
        );

        await user.click(screen.getByText('customize'));
        await user.click(screen.getByLabelText('proxyOnlyApplyToYoutube'));

        expect(mockOnProxyChange).toHaveBeenCalledWith(true);
    });
});
