import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startRegistration } from '@simplewebauthn/browser';
import SecuritySettings from '../SecuritySettings';
import { api } from '../../../utils/apiClient';

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../utils/apiClient', () => ({
    api: {
        get: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('@simplewebauthn/browser', () => ({
    startRegistration: vi.fn(),
}));

const createTestQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

const render = (ui: React.ReactElement) => {
    const queryClient = createTestQueryClient();
    return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

let mockPasskeysExist = false;
let mockWriteText = vi.fn();

describe('SecuritySettings', () => {
    const mockOnChange = vi.fn();
    const defaultSettings: any = {
        loginEnabled: false,
        password: '',
        passwordLoginAllowed: true,
        apiKeyEnabled: false,
        apiKey: '',
        isPasswordSet: false,
        visitorUserEnabled: true,
        visitorPassword: '',
        isVisitorPasswordSet: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockPasskeysExist = false;
        vi.mocked(api.get).mockResolvedValue({ data: { exists: mockPasskeysExist } } as any);
        vi.mocked(api.post).mockReset();
        vi.mocked(api.delete).mockReset();
        vi.mocked(startRegistration).mockReset();

        Object.defineProperty(window, 'isSecureContext', {
            configurable: true,
            value: true,
        });
        Object.defineProperty(window, 'PublicKeyCredential', {
            configurable: true,
            value: class PublicKeyCredentialMock {},
        });
        Object.defineProperty(navigator, 'credentials', {
            configurable: true,
            value: { create: vi.fn() },
        });
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: mockWriteText,
            },
        });
        mockWriteText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: mockWriteText,
            },
        });
    });

    it('renders login controls', () => {
        render(<SecuritySettings settings={defaultSettings} onChange={mockOnChange} />);

        expect(screen.getByRole('switch', { name: 'enableLogin' })).toBeInTheDocument();
    });

    it('shows password and visitor password fields when login is enabled', () => {
        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, isPasswordSet: true, isVisitorPasswordSet: true }}
                onChange={mockOnChange}
            />
        );

        expect(screen.getByLabelText('password')).toBeInTheDocument();
        expect(screen.getByText('passwordHelper')).toBeInTheDocument();
        expect(screen.getByLabelText('visitorPassword')).toBeInTheDocument();
        expect(screen.getByText('visitorPasswordSetHelper')).toBeInTheDocument();
    });

    it('hides visitor password field when visitor user is disabled', () => {
        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, visitorUserEnabled: false }}
                onChange={mockOnChange}
            />
        );

        expect(screen.queryByLabelText('visitorPassword')).not.toBeInTheDocument();
    });

    it('auto-enables password login when no passkeys exist', async () => {
        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, passwordLoginAllowed: false }}
                onChange={mockOnChange}
            />
        );

        await waitFor(() => {
            expect(mockOnChange).toHaveBeenCalledWith('passwordLoginAllowed', true);
        });
    });

    it('enables the allow password login switch once passkeys exist', async () => {
        mockPasskeysExist = true;
        vi.mocked(api.get).mockResolvedValue({ data: { exists: true } } as any);

        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, passwordLoginAllowed: true }}
                onChange={mockOnChange}
            />
        );

        await waitFor(() => {
            expect(screen.getByRole('switch', { name: 'allowPasswordLogin' })).toBeEnabled();
            expect(screen.getByRole('button', { name: 'removePasskeys' })).toBeEnabled();
        });
    });

    it('handles login, password, and visitor switches', async () => {
        const user = userEvent.setup();
        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, visitorUserEnabled: true }}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByRole('switch', { name: 'enableLogin' }));
        await user.click(screen.getByRole('switch', { name: 'enableVisitorUser' }));
        await user.type(screen.getByLabelText('password'), 'secret');
        await user.type(screen.getByLabelText('visitorPassword'), 'guest');

        expect(mockOnChange).toHaveBeenCalledWith('loginEnabled', false);
        expect(mockOnChange).toHaveBeenCalledWith('visitorUserEnabled', false);
        expect(mockOnChange).toHaveBeenCalledWith('password', 's');
        expect(mockOnChange).toHaveBeenCalledWith('visitorPassword', 'g');
    });

    it('generates an api key when enabling api key auth without an existing key', async () => {
        const user = userEvent.setup();
        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, apiKeyEnabled: false, apiKey: '' }}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByRole('switch', { name: 'enableApiKeyAuth' }));

        expect(mockOnChange).toHaveBeenCalledWith('apiKeyEnabled', true);
        expect(mockOnChange).toHaveBeenCalledWith('apiKey', expect.stringMatching(/^[a-f0-9]{64}$/));
    });

    it('does not regenerate the api key when enabling auth with an existing key', async () => {
        const user = userEvent.setup();
        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, apiKeyEnabled: false, apiKey: 'existing-key' }}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByRole('switch', { name: 'enableApiKeyAuth' }));

        expect(mockOnChange).toHaveBeenCalledWith('apiKeyEnabled', true);
        expect(mockOnChange).not.toHaveBeenCalledWith('apiKey', expect.anything());
    });

    it('refreshes the api key after confirmation', async () => {
        const user = userEvent.setup();
        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, apiKeyEnabled: true, apiKey: 'abc123' }}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByRole('button', { name: 'refreshApiKey' }));
        await user.click(screen.getByRole('button', { name: 'confirm' }));

        expect(mockOnChange).toHaveBeenCalledWith('apiKey', expect.stringMatching(/^[a-f0-9]{64}$/));
    });

    it('copies the api key to the clipboard and shows a success alert', async () => {
        const user = userEvent.setup();
        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, apiKeyEnabled: true, apiKey: 'abc123' }}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByRole('button', { name: 'copyApiKey' }));

        expect(await screen.findByText('apiKeyCopied')).toBeInTheDocument();
    });

    it('shows an error alert when copying the api key fails', async () => {
        const user = userEvent.setup();
        const copyError = new Error('copy failed');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockWriteText = vi.fn().mockRejectedValue(copyError);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: mockWriteText,
            },
        });

        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, apiKeyEnabled: true, apiKey: 'abc123' }}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByRole('button', { name: 'copyApiKey' }));

        expect(await screen.findByText('apiKeyCopyFailed')).toBeInTheDocument();
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error copying API key:', copyError);
        consoleErrorSpy.mockRestore();
    });

    it('shows an unsupported alert when WebAuthn is unavailable', async () => {
        const user = userEvent.setup();
        Object.defineProperty(window, 'PublicKeyCredential', {
            configurable: true,
            value: undefined,
        });
        Object.defineProperty(navigator, 'credentials', {
            configurable: true,
            value: {},
        });

        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true }}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByRole('button', { name: 'createPasskey' }));

        expect(await screen.findByText('passkeyWebAuthnNotSupported')).toBeInTheDocument();
    });

    it('creates a passkey successfully and refetches passkeys', async () => {
        const user = userEvent.setup();
        vi.mocked(api.post)
            .mockResolvedValueOnce({ data: { options: { rp: { name: 'MyTube' } }, challenge: 'challenge-1' } } as any)
            .mockResolvedValueOnce({ data: { success: true } } as any);
        vi.mocked(startRegistration).mockResolvedValue({ id: 'cred-1' } as any);

        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, passwordLoginAllowed: true }}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByRole('button', { name: 'createPasskey' }));

        await waitFor(() => {
            expect(api.post).toHaveBeenNthCalledWith(1, '/settings/passkeys/register', {
                userName: 'MyTube User',
            });
            expect(startRegistration).toHaveBeenCalledWith({
                optionsJSON: { rp: { name: 'MyTube' } },
            });
            expect(api.post).toHaveBeenNthCalledWith(2, '/settings/passkeys/register/verify', {
                body: { id: 'cred-1' },
                challenge: 'challenge-1',
            });
            expect(api.get).toHaveBeenCalledTimes(2);
        });

        expect(await screen.findByText('passkeyCreated')).toBeInTheDocument();
    });

    it('translates WebAuthn permission errors when creating a passkey fails', async () => {
        const user = userEvent.setup();
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(api.post).mockResolvedValueOnce({
            data: { options: { rp: { name: 'MyTube' } }, challenge: 'challenge-1' },
        } as any);
        vi.mocked(startRegistration).mockRejectedValue(new Error('Not allowed by user'));

        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, passwordLoginAllowed: true }}
                onChange={mockOnChange}
            />
        );

        await user.click(screen.getByRole('button', { name: 'createPasskey' }));

        expect(await screen.findByText('passkeyErrorPermissionDenied')).toBeInTheDocument();
        expect(consoleErrorSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });

    it('removes passkeys after confirmation and shows a success alert', async () => {
        const user = userEvent.setup();
        mockPasskeysExist = true;
        vi.mocked(api.get).mockResolvedValue({ data: { exists: true } } as any);
        vi.mocked(api.delete).mockResolvedValue({} as any);

        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, passwordLoginAllowed: true }}
                onChange={mockOnChange}
            />
        );

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'removePasskeys' })).toBeEnabled();
        });

        await user.click(screen.getByRole('button', { name: 'removePasskeys' }));
        await user.click(screen.getByRole('button', { name: 'remove' }));

        await waitFor(() => {
            expect(api.delete).toHaveBeenCalledWith('/settings/passkeys');
            expect(api.get).toHaveBeenCalledTimes(2);
        });

        expect(await screen.findByText('passkeysRemoved')).toBeInTheDocument();
    });

    it('shows an error alert when removing passkeys fails', async () => {
        const user = userEvent.setup();
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockPasskeysExist = true;
        vi.mocked(api.get).mockResolvedValue({ data: { exists: true } } as any);
        vi.mocked(api.delete).mockRejectedValue(new Error('delete failed'));

        render(
            <SecuritySettings
                settings={{ ...defaultSettings, loginEnabled: true, passwordLoginAllowed: true }}
                onChange={mockOnChange}
            />
        );

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'removePasskeys' })).toBeEnabled();
        });

        await user.click(screen.getByRole('button', { name: 'removePasskeys' }));
        await user.click(screen.getByRole('button', { name: 'remove' }));

        expect(await screen.findByText('passkeysRemoveFailed')).toBeInTheDocument();
        expect(consoleErrorSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });
});
