import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HookSettings from '../HookSettings';
import { api } from '../../../utils/apiClient';

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, replacements?: Record<string, string | number>) => {
            if (key === 'settingsAuthRequired') {
                return 'Please sign in first.';
            }
            if (key === 'riskCommandDetected') {
                return `Risk command detected: ${replacements?.command}. Upload rejected.`;
            }
            return key;
        },
    }),
}));

vi.mock('../../../utils/apiClient', async () => {
    const actual = await vi.importActual<any>('../../../utils/apiClient');
    return {
        ...actual,
        api: {
            get: vi.fn(),
            post: vi.fn(),
            delete: vi.fn(),
        },
    };
});

vi.mock('../../PasswordModal', () => ({
    default: ({ isOpen, onConfirm, error }: any) => {
        if (!isOpen) return null;
        return (
            <div data-testid="password-modal">
                <button onClick={() => onConfirm('secret')}>Confirm password</button>
                {error ? <div>{error}</div> : null}
            </div>
        );
    },
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

const makeAxiosLikeError = (status: number, data: unknown, message = 'Request failed') =>
    ({
        isAxiosError: true,
        message,
        response: {
            status,
            data,
        },
    } as any);

describe('HookSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(api.get).mockResolvedValue({ data: {} } as any);
    });

    it('surfaces translated backend auth errors when hook upload is denied', async () => {
        const user = userEvent.setup();
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/settings/confirm-admin-password') {
                return Promise.resolve({ data: { success: true } } as any);
            }

            return Promise.reject(
                makeAxiosLikeError(401, {
                    errorKey: 'settingsAuthRequired',
                    error: 'Authentication required. Please log in to access this resource.',
                })
            );
        });

        render(<HookSettings settings={{} as any} onChange={vi.fn()} />);

        await waitFor(() => {
            expect(document.querySelector('input[type="file"]')).not.toBeNull();
        });

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        await user.upload(fileInput, new File(['echo hello'], 'task.sh', { type: 'text/x-shellscript' }));
        await user.click(screen.getByText('Confirm password'));

        expect(await screen.findByText('Please sign in first.')).toBeInTheDocument();
        await waitFor(() => {
            expect(api.post).toHaveBeenCalledWith('/settings/confirm-admin-password', { password: 'secret' });
        });
    });
});
