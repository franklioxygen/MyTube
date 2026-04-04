import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HookSettings from '../HookSettings';
import { api } from '../../../utils/apiClient';
import { Settings } from '../../../types';

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, replacements?: Record<string, string | number>) => {
            if (key === 'settingsAuthRequired') {
                return 'Please sign in first.';
            }
            if (key === 'riskCommandDetected') {
                return `Risk command detected: ${replacements?.command}. Upload rejected.`;
            }
            if (key === 'tooManyAttempts') {
                return 'Too many attempts.';
            }
            if (key === 'incorrectPassword') {
                return 'incorrectPassword';
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
    default: ({ isOpen, onConfirm, onClose, error, isLoading }: any) => {
        if (!isOpen) return null;
        return (
            <div data-testid="password-modal">
                <button onClick={() => onConfirm('secret')}>Confirm password</button>
                <button onClick={onClose}>Close password</button>
                {isLoading ? <div>Loading</div> : null}
                {error ? <div>{error}</div> : null}
            </div>
        );
    },
}));

vi.mock('../../ConfirmationModal', () => ({
    default: ({ isOpen, onConfirm, onClose, title, message }: any) => {
        if (!isOpen) return null;
        return (
            <div data-testid="confirmation-modal">
                <div>{title}</div>
                <div>{message}</div>
                <button onClick={onConfirm}>Confirm delete</button>
                <button onClick={onClose}>Cancel delete</button>
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

const getFileInput = async (index = 0) => {
    await waitFor(() => {
        expect(document.querySelectorAll('input[type="file"]').length).toBeGreaterThan(index);
    });

    return document.querySelectorAll('input[type="file"]')[index] as HTMLInputElement;
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

const renderComponent = () => render(<HookSettings settings={{} as Settings} onChange={vi.fn()} />);

describe('HookSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(api.get).mockImplementation((url: string) => {
            if (url === '/settings/hooks/status') {
                return Promise.resolve({ data: {} } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
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

        renderComponent();

        const fileInput = await getFileInput();
        await user.upload(fileInput, new File(['echo hello'], 'task.sh', { type: 'text/x-shellscript' }));
        await user.click(screen.getByText('Confirm password'));

        expect(await screen.findByText('Please sign in first.')).toBeInTheDocument();
        await waitFor(() => {
            expect(api.post).toHaveBeenCalledWith('/settings/confirm-admin-password', { password: 'secret' });
        });
    });

    it('renders existing hook state with delete actions and missing hook fallback labels', async () => {
        vi.mocked(api.get).mockResolvedValue({
            data: {
                task_success: true,
                task_cancel: true,
            },
        } as any);

        renderComponent();

        expect(await screen.findAllByText('found')).toHaveLength(2);
        expect(screen.getAllByText('notFound')).toHaveLength(2);
        expect(screen.getAllByText('delete')).toHaveLength(2);
        expect(screen.getAllByText('uploadHook')).toHaveLength(4);
    });

    it('uploads a hook successfully after password confirmation and refetches status', async () => {
        const user = userEvent.setup();
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/settings/confirm-admin-password') {
                return Promise.resolve({ data: { success: true } } as any);
            }
            if (url === '/settings/hooks/task_before_start') {
                return Promise.resolve({ data: { success: true } } as any);
            }
            return Promise.resolve({ data: {} } as any);
        });

        renderComponent();

        const fileInput = await getFileInput();
        await user.upload(fileInput, new File(['echo hello'], 'task.sh', { type: 'text/x-shellscript' }));
        await user.click(screen.getByText('Confirm password'));

        await waitFor(() => {
            expect(api.post).toHaveBeenCalledWith('/settings/confirm-admin-password', { password: 'secret' });
            expect(api.post).toHaveBeenCalledWith(
                '/settings/hooks/task_before_start',
                expect.any(FormData),
                { headers: { 'Content-Type': 'multipart/form-data' } }
            );
        });

        await waitFor(() => {
            expect(api.get).toHaveBeenCalledTimes(2);
        });
        expect(screen.queryByTestId('password-modal')).not.toBeInTheDocument();
    });

    it('shows translated risk-command upload errors from the backend', async () => {
        const user = userEvent.setup();
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/settings/confirm-admin-password') {
                return Promise.resolve({ data: { success: true } } as any);
            }

            return Promise.reject(
                makeAxiosLikeError(400, {
                    error: 'Risk command detected: rm -rf /. Upload rejected.',
                })
            );
        });

        renderComponent();

        const fileInput = await getFileInput();
        await user.upload(fileInput, new File(['echo hello'], 'task.sh', { type: 'text/x-shellscript' }));
        await user.click(screen.getByText('Confirm password'));

        expect(
            await screen.findByText('Risk command detected: rm -rf /. Upload rejected.')
        ).toBeInTheDocument();
    });

    it('rejects unsupported hook file extensions before opening the password modal', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        renderComponent();

        const fileInput = await getFileInput();
        fireEvent.change(fileInput, {
            target: {
                files: [new File(['nope'], 'task.txt', { type: 'text/plain' })],
            },
        });

        expect(alertSpy).toHaveBeenCalledWith('Only .sh files are allowed');
        expect(screen.queryByTestId('password-modal')).not.toBeInTheDocument();
    });

    it('shows a rate-limit password error and clears modal state on close', async () => {
        const user = userEvent.setup();
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/settings/confirm-admin-password') {
                return Promise.reject(
                    makeAxiosLikeError(429, {
                        waitTime: 2500,
                    })
                );
            }
            return Promise.resolve({ data: {} } as any);
        });

        renderComponent();

        const fileInput = await getFileInput();
        await user.upload(fileInput, new File(['echo hello'], 'task.sh', { type: 'text/x-shellscript' }));
        await user.click(screen.getByText('Confirm password'));

        expect(await screen.findByText('Too many attempts. Try again in 3s')).toBeInTheDocument();
        await user.click(screen.getByText('Close password'));

        expect(screen.queryByTestId('password-modal')).not.toBeInTheDocument();
    });

    it('shows the translated incorrect password error', async () => {
        const user = userEvent.setup();
        vi.mocked(api.post).mockImplementation((url: string) => {
            if (url === '/settings/confirm-admin-password') {
                return Promise.reject(
                    makeAxiosLikeError(401, {
                        error: 'Incorrect admin password',
                    })
                );
            }
            return Promise.resolve({ data: {} } as any);
        });

        renderComponent();

        const fileInput = await getFileInput();
        await user.upload(fileInput, new File(['echo hello'], 'task.sh', { type: 'text/x-shellscript' }));
        await user.click(screen.getByText('Confirm password'));

        expect(await screen.findByText('incorrectPassword')).toBeInTheDocument();
    });

    it('deletes an existing hook and refetches hook status on success', async () => {
        const user = userEvent.setup();
        vi.mocked(api.get).mockResolvedValue({
            data: {
                task_success: true,
            },
        } as any);
        vi.mocked(api.delete).mockResolvedValue({ data: { success: true } } as any);

        renderComponent();

        await user.click(await screen.findByText('delete'));
        expect(await screen.findByTestId('confirmation-modal')).toBeInTheDocument();
        await user.click(screen.getByText('Confirm delete'));

        await waitFor(() => {
            expect(api.delete).toHaveBeenCalledWith('/settings/hooks/task_success');
            expect(api.get).toHaveBeenCalledTimes(2);
        });
        expect(screen.queryByTestId('confirmation-modal')).not.toBeInTheDocument();
    });

    it('shows delete errors and allows dismissing the confirmation modal', async () => {
        const user = userEvent.setup();
        vi.mocked(api.get).mockResolvedValue({
            data: {
                task_success: true,
            },
        } as any);
        vi.mocked(api.delete).mockRejectedValue(
            makeAxiosLikeError(500, {
                error: 'delete exploded',
            })
        );

        renderComponent();

        await user.click(await screen.findByText('delete'));
        await user.click(screen.getByText('Confirm delete'));

        expect(await screen.findByText('delete exploded')).toBeInTheDocument();
        await user.click(screen.getByText('Cancel delete'));

        expect(screen.queryByTestId('confirmation-modal')).not.toBeInTheDocument();
    });

    it('ignores empty file selections', async () => {
        renderComponent();

        const fileInput = await getFileInput();
        fireEvent.change(fileInput, { target: { files: [] } });

        expect(screen.queryByTestId('password-modal')).not.toBeInTheDocument();
        expect(api.post).not.toHaveBeenCalled();
    });
});
