import { fireEvent, render, screen } from '@testing-library/react';
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

        expect(screen.getByText('customize')).toBeInTheDocument();
        // Textarea should be hidden initially
        expect(screen.queryByPlaceholderText(/yt-dlp Configuration/)).not.toBeInTheDocument();
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
        // The expanded panel holds more than one textbox - the proxy bypass
        // host list sits above the config - so this must name the one it means.
        expect(screen.getByPlaceholderText(/yt-dlp Configuration File/)).toBeVisible();
        expect(screen.getByPlaceholderText(/yt-dlp Configuration File/)).toHaveValue(defaultConfig);
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

        const textarea = screen.getByPlaceholderText(/yt-dlp Configuration File/);
        await user.clear(textarea);
        await user.type(textarea, 'New Config');

        expect(mockOnChange).toHaveBeenCalledWith('New Config');
    });

    it('should report proxy bypass host edits', async () => {
        const user = userEvent.setup();
        const mockOnBypassChange = vi.fn();
        render(
            <YtDlpSettings
                config={defaultConfig}
                proxyBypassHosts=""
                onChange={mockOnChange}
                onProxyBypassHostsChange={mockOnBypassChange}
            />
        );

        await user.click(screen.getByText('customize'));
        // The field is controlled by the prop, which a test render never feeds
        // back, so a keystroke-by-keystroke type() would report single letters.
        fireEvent.change(screen.getByPlaceholderText('surrit.com, example.com'), {
            target: { value: 'surrit.com' },
        });

        expect(mockOnBypassChange).toHaveBeenCalledWith('surrit.com');
        // The host list must not be mistaken for an edit to the config itself.
        expect(mockOnChange).not.toHaveBeenCalled();
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
