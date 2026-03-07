import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import YtDlpSettings from '../YtDlpSettings';

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('YtDlpSettings', () => {
    const mockOnChange = vi.fn();
    const mockOnProxyChange = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render collapsed state by default', () => {
        render(
            <YtDlpSettings
                config={{}}
                proxyOnlyYoutube={false}
                onChange={mockOnChange}
                onProxyOnlyYoutubeChange={mockOnProxyChange}
            />
        );

        expect(screen.getByText('customize')).toBeInTheDocument();
        expect(screen.queryByLabelText('maxResolution')).not.toBeInTheDocument();
    });

    it('should expand and show structured fields', async () => {
        const user = userEvent.setup();
        render(
            <YtDlpSettings
                config={{ maxResolution: 1080, proxy: 'http://127.0.0.1:7890' }}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByText('customize'));

        expect(screen.getByText('hide')).toBeInTheDocument();
        expect(screen.getByLabelText('maxResolution')).toBeInTheDocument();
        expect(screen.getByLabelText('proxy')).toHaveValue('http://127.0.0.1:7890');
    });

    it('should handle structured config changes', async () => {
        const user = userEvent.setup();
        render(
            <YtDlpSettings
                config={{}}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByText('customize'));
        await user.click(screen.getByLabelText('maxResolution'));
        await user.click(screen.getByRole('option', { name: '1080p' }));

        expect(mockOnChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ maxResolution: 1080 })
        );
    });

    it('should reset structured config', async () => {
        const user = userEvent.setup();
        render(
            <YtDlpSettings
                config={{ maxResolution: 2160, retries: 5 }}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByText('customize'));
        await user.click(screen.getByText('reset'));

        expect(mockOnChange).toHaveBeenCalledWith({});
    });

    it('should toggle proxy only youtube', async () => {
        const user = userEvent.setup();
        render(
            <YtDlpSettings
                config={{}}
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
