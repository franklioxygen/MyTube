import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TmdbApiKeySettings from '../TmdbApiKeySettings';

// Mock language context: t echoes the key. createTranslateOrFallback then
// returns the *fallback* when the key matches, so assertions check fallbacks.
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

// Mock the TMDB test API
const apiPostMock = vi.fn();
vi.mock('../../../utils/apiClient', () => ({
    api: { post: (...args: unknown[]) => apiPostMock(...args) },
}));

describe('TmdbApiKeySettings', () => {
    const onChange = vi.fn();

    it('renders the password field and disabled test button', () => {
        render(<TmdbApiKeySettings tmdbApiKey="" onChange={onChange} />);

        expect(screen.getByText('tmdbApiKey')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Enter your TMDB API key')).toBeInTheDocument();
        // Test button is disabled when there is no key
        expect(screen.getByRole('button', { name: /Test Credential/ })).toBeDisabled();
    });

    it('propagates field changes through onChange', async () => {
        const user = userEvent.setup();
        render(<TmdbApiKeySettings tmdbApiKey="" onChange={onChange} />);

        await user.type(screen.getByPlaceholderText('Enter your TMDB API key'), 'x');

        expect(onChange).toHaveBeenCalledWith('tmdbApiKey', expect.stringContaining('x'));
    });

    it('shows a success message when the TMDB test resolves', async () => {
        apiPostMock.mockResolvedValueOnce({ data: { messageKey: 'tmdbCredentialValid', message: 'ok' } });
        const user = userEvent.setup();
        render(<TmdbApiKeySettings tmdbApiKey="real-key" onChange={onChange} />);

        await user.click(screen.getByRole('button', { name: /Test Credential/ }));

        await waitFor(() => {
            expect(screen.getByText('TMDB credential is valid.')).toBeInTheDocument();
        });
        expect(apiPostMock).toHaveBeenCalledWith('/settings/tmdb/test', { tmdbApiKey: 'real-key' });
    });

    it('shows an error message when the TMDB test rejects', async () => {
        apiPostMock.mockRejectedValueOnce({
            response: { data: { errorKey: 'tmdbCredentialInvalid' } },
        });
        const user = userEvent.setup();
        render(<TmdbApiKeySettings tmdbApiKey="bad-key" onChange={onChange} />);

        await user.click(screen.getByRole('button', { name: /Test Credential/ }));

        await waitFor(() => {
            expect(screen.getByText(/TMDB credential is invalid/)).toBeInTheDocument();
        });
    });
});
