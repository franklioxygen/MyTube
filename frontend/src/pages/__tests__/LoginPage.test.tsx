import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ensureCsrfToken } from '../../utils/apiClient';
import { getWebAuthnErrorTranslationKey } from '../../utils/translations';
import LoginPage from '../LoginPage';

// --- Mocks ---

// Mock logo SVG import
vi.mock('../../assets/logo.svg', () => ({ default: 'logo.svg' }));

// Mock theme - must return a real MUI theme for ThemeProvider/CssBaseline
vi.mock('../../theme', async () => {
    const { createTheme } = await import('@mui/material/styles');
    return {
        default: () => createTheme({ palette: { mode: 'dark' } }),
    };
});

// Mock api client
vi.mock('../../utils/apiClient', () => ({
    api: {
        get: vi.fn(),
        post: vi.fn(),
    },
    ensureCsrfToken: vi.fn(() => Promise.resolve()),
    getErrorMessage: vi.fn((error: any) =>
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        'An unknown error occurred'
    ),
    getWaitTime: vi.fn((error: any) => error?.response?.data?.waitTime || 0),
    isRateLimitError: vi.fn((error: any) => error?.response?.status === 429),
    isAuthError: vi.fn((error: any) => error?.response?.status === 401),
}));

// Mock translations util
vi.mock('../../utils/translations', () => ({
    getWebAuthnErrorTranslationKey: vi.fn(() => null),
}));

// Mock @simplewebauthn/browser
vi.mock('@simplewebauthn/browser', () => ({
    startAuthentication: vi.fn(),
}));

// Mock useAuth
const mockLogin = vi.fn();
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        login: mockLogin,
    }),
}));

// Mock useLanguage
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => {
            // Return template with placeholder so .replace('{time}', ...) works
            if (key === 'waitTimeMessage') return 'waitTimeMessage {time}';
            return key;
        },
        setLanguage: vi.fn(),
    }),
}));

// --- Controllable useQuery / useMutation mocks ---

// Default query results keyed by queryKey[0]
let queryResults: Record<string, Record<string, unknown>> = {};

// Store mutation callbacks so tests can invoke onSuccess/onError
let mutationCallbacks: Record<string, { onSuccess?: (...args: unknown[]) => void; onError?: (...args: unknown[]) => void }> = {};
let mutationFns: Record<string, (...args: any[]) => Promise<any>> = {};

// Store mutation mocks so tests can invoke onSuccess/onError and check mutate calls
let mutationMocks: Record<string, Record<string, unknown>> = {};

// Helper to get or create a mutation mock for a given key.
// Returns the same mock on subsequent calls with the same key (across re-renders).
const getOrCreateMutationMock = (key: string, callbacks: { onSuccess?: (...args: unknown[]) => void; onError?: (...args: unknown[]) => void }) => {
    if (!mutationMocks[key]) {
        mutationCallbacks[key] = callbacks;
        mutationMocks[key] = {
            mutate: vi.fn(),
            mutateAsync: vi.fn(),
            isPending: false,
            isError: false,
            reset: vi.fn(),
        };
    }
    return mutationMocks[key];
};

// Track mutation call order so we can assign keys
let mutationCallIndex = 0;
const mutationKeyOrder = [
    'adminLogin',      // 1st useMutation call in component
    'visitorLogin',    // 2nd
    'passkeyLogin',    // 3rd
];

vi.mock('@tanstack/react-query', () => ({
    useQuery: vi.fn(({ queryKey }: { queryKey: string[] }) => {
        const key = queryKey[0];
        return queryResults[key] || {
            data: undefined,
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
        };
    }),
    useMutation: vi.fn(({ mutationFn, onSuccess, onError }: { mutationFn?: (...args: any[]) => Promise<any>; onSuccess?: (...args: unknown[]) => void; onError?: (...args: unknown[]) => void }) => {
        const key = mutationKeyOrder[mutationCallIndex % mutationKeyOrder.length];
        mutationCallIndex++;
        if (mutationFn) {
            mutationFns[key] = mutationFn;
        }
        return getOrCreateMutationMock(key, { onSuccess, onError });
    }),
    useQueryClient: vi.fn(() => ({
        invalidateQueries: vi.fn(),
    })),
}));

// --- Helpers ---

/** Set default query results that produce the "normal login form" state */
const setNormalState = (overrides: Record<string, unknown> = {}) => {
    queryResults = {
        healthCheck: {
            data: {
                loginRequired: true,
                passwordEnabled: true,
                passwordLoginAllowed: true,
                visitorUserEnabled: false,
                isVisitorPasswordSet: false,
                websiteName: 'MyTube',
                ...overrides,
            },
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
        },
        'passkeys-exists': {
            data: overrides.passkeysExist !== undefined
                ? { exists: overrides.passkeysExist }
                : { exists: false },
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
        },
    };
};

/** Set query results that produce the "checking connection" (loading) state */
const setLoadingState = () => {
    queryResults = {
        healthCheck: {
            data: undefined,
            isLoading: true,
            isError: false,
            refetch: vi.fn(),
        },
    };
};

/** Set query results that produce the "connection error" state */
const setErrorState = () => {
    const refetchFn = vi.fn();
    queryResults = {
        healthCheck: {
            data: undefined,
            isLoading: false,
            isError: true,
            refetch: refetchFn,
        },
    };
    return { refetchFn };
};

const triggerAdminRateLimit = (waitTime: number) => {
    act(() => {
        mutationCallbacks['adminLogin']?.onError?.({
            response: {
                status: 429,
                data: { waitTime },
            },
        });
    });
};

// --- Tests ---

describe('LoginPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mutationCallIndex = 0;
        mutationMocks = {};
        mutationCallbacks = {};
        mutationFns = {};
        queryResults = {};
    });

    // 1. Connection checking state
    describe('connection checking state', () => {
        it('shows CircularProgress and "checkingConnection" text', () => {
            setLoadingState();
            render(<LoginPage />);

            expect(screen.getByRole('progressbar')).toBeInTheDocument();
            expect(screen.getByText('checkingConnection')).toBeInTheDocument();
        });
    });

    // 2. Connection error state
    describe('connection error state', () => {
        it('shows error avatar, connectionError text, and retry button', () => {
            const { refetchFn } = setErrorState();
            render(<LoginPage />);

            expect(screen.getByText('connectionError')).toBeInTheDocument();
            expect(screen.getByText('backendConnectionFailed')).toBeInTheDocument();

            const retryButton = screen.getByText('retry');
            expect(retryButton).toBeInTheDocument();

            fireEvent.click(retryButton);
            expect(refetchFn).toHaveBeenCalled();
        });
    });

    // 3. Normal login form
    describe('normal login form', () => {
        it('shows sign in title, password field, and sign in button', () => {
            setNormalState();
            const { container } = render(<LoginPage />);

            // Both the h1 and submit button say "signIn"
            const signInElements = screen.getAllByText('signIn');
            expect(signInElements.length).toBe(2);
            // Password input by id
            const passwordInput = container.querySelector('#password');
            expect(passwordInput).toBeInTheDocument();
            // Submit button
            const submitButton = screen.getByRole('button', { name: 'signIn' });
            expect(submitButton).toBeInTheDocument();
        });
    });

    // 4. Password visibility toggle
    describe('password visibility toggle', () => {
        it('clicking eye icon toggles password field type', () => {
            setNormalState();
            const { container } = render(<LoginPage />);

            const passwordInput = container.querySelector('#password') as HTMLInputElement;
            expect(passwordInput).toHaveAttribute('type', 'password');

            const toggleButton = screen.getByLabelText('togglePasswordVisibility');
            fireEvent.click(toggleButton);
            expect(passwordInput).toHaveAttribute('type', 'text');

            fireEvent.click(toggleButton);
            expect(passwordInput).toHaveAttribute('type', 'password');
        });
    });

    // 5. Admin form submission
    describe('admin form submission', () => {
        it('calls adminLoginMutation.mutate with password', () => {
            setNormalState();
            const { container } = render(<LoginPage />);

            const passwordInput = container.querySelector('#password') as HTMLInputElement;
            fireEvent.change(passwordInput, { target: { value: 'mySecret' } });

            // Click the submit button to trigger form submission
            const submitButton = screen.getByRole('button', { name: 'signIn' });
            fireEvent.click(submitButton);

            expect(mutationMocks['adminLogin'].mutate).toHaveBeenCalledWith('mySecret');
        });

        it('refreshes CSRF before posting the admin password', async () => {
            setNormalState();
            vi.mocked(api.post).mockResolvedValue({ data: { success: true, role: 'admin' } } as any);
            render(<LoginPage />);

            const result = await mutationFns['adminLogin']('mySecret');

            expect(ensureCsrfToken).toHaveBeenCalledWith({ refresh: true });
            expect(api.post).toHaveBeenCalledWith('/settings/verify-admin-password', { password: 'mySecret' });
            expect(result).toEqual({ success: true, role: 'admin' });
        });

        it('does not submit when waitTime > 0', () => {
            setNormalState();
            const { container } = render(<LoginPage />);
            triggerAdminRateLimit(5000);

            const passwordInput = container.querySelector('#password') as HTMLInputElement;
            fireEvent.change(passwordInput, { target: { value: 'mySecret' } });

            const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
            fireEvent.click(submitButton);

            expect(mutationMocks['adminLogin'].mutate).not.toHaveBeenCalled();
        });
    });

    // 6. Visitor tab rendering
    describe('visitor tab rendering', () => {
        it('shows tabs when showVisitorTab is true', () => {
            setNormalState({
                visitorUserEnabled: true,
                isVisitorPasswordSet: true,
            });
            render(<LoginPage />);

            expect(screen.getByRole('tablist')).toBeInTheDocument();
            expect(screen.getByText('admin')).toBeInTheDocument();
            expect(screen.getByText('visitorUser')).toBeInTheDocument();
        });
    });

    // 7. Visitor tab hidden
    describe('visitor tab hidden', () => {
        it('does not show tabs when showVisitorTab is false', () => {
            setNormalState({
                visitorUserEnabled: false,
                isVisitorPasswordSet: false,
            });
            render(<LoginPage />);

            expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
        });
    });

    // 8. Visitor form submission
    describe('visitor form submission', () => {
        it('calls visitorLoginMutation.mutate when visitor form is submitted', () => {
            setNormalState({
                visitorUserEnabled: true,
                isVisitorPasswordSet: true,
            });
            const { container } = render(<LoginPage />);

            // Switch to visitor tab
            const visitorTab = screen.getByText('visitorUser');
            fireEvent.click(visitorTab);

            const visitorPasswordInput = container.querySelector('#visitorPassword') as HTMLInputElement;
            fireEvent.change(visitorPasswordInput, { target: { value: 'visitorPass' } });

            const form = visitorPasswordInput.closest('form')!;
            fireEvent.submit(form);

            expect(mutationMocks['visitorLogin'].mutate).toHaveBeenCalledWith('visitorPass');
        });

        it('refreshes CSRF before posting the visitor password', async () => {
            setNormalState({
                visitorUserEnabled: true,
                isVisitorPasswordSet: true,
            });
            vi.mocked(api.post).mockResolvedValue({ data: { success: true, role: 'visitor' } } as any);
            render(<LoginPage />);

            const result = await mutationFns['visitorLogin']('visitorPass');

            expect(ensureCsrfToken).toHaveBeenCalledWith({ refresh: true });
            expect(api.post).toHaveBeenCalledWith('/settings/verify-visitor-password', { password: 'visitorPass' });
            expect(result).toEqual({ success: true, role: 'visitor' });
        });

        it('does not submit visitor form when waitTime > 0', () => {
            setNormalState({
                visitorUserEnabled: true,
                isVisitorPasswordSet: true,
            });
            const { container } = render(<LoginPage />);
            triggerAdminRateLimit(5000);

            // Switch to visitor tab
            const visitorTab = screen.getByText('visitorUser');
            fireEvent.click(visitorTab);

            const visitorPasswordInput = container.querySelector('#visitorPassword') as HTMLInputElement;
            fireEvent.change(visitorPasswordInput, { target: { value: 'visitorPass' } });

            const form = visitorPasswordInput.closest('form')!;
            fireEvent.submit(form);

            expect(mutationMocks['visitorLogin'].mutate).not.toHaveBeenCalled();
        });

        it('toggles visitor password visibility', () => {
            setNormalState({
                visitorUserEnabled: true,
                isVisitorPasswordSet: true,
            });
            const { container } = render(<LoginPage />);

            // Switch to visitor tab
            fireEvent.click(screen.getByText('visitorUser'));

            const visitorPasswordInput = container.querySelector('#visitorPassword') as HTMLInputElement;
            expect(visitorPasswordInput).toHaveAttribute('type', 'password');

            // There are two toggle buttons (admin and visitor), get the visible one
            const toggleButtons = screen.getAllByLabelText('togglePasswordVisibility');
            const visibleToggle = toggleButtons[toggleButtons.length - 1];
            fireEvent.click(visibleToggle);
            expect(visitorPasswordInput).toHaveAttribute('type', 'text');
        });
    });

    // 9. Passkey button shown when passkeysExist and passwordLoginAllowed
    describe('passkey button', () => {
        it('shows passkey button as outlined variant when passkeysExist and passwordLoginAllowed', () => {
            setNormalState({ passkeysExist: true, passwordLoginAllowed: true });
            render(<LoginPage />);

            const passkeyButton = screen.getByText('loginWithPasskey');
            expect(passkeyButton).toBeInTheDocument();
            // Should also see the OR divider
            expect(screen.getByText('OR')).toBeInTheDocument();
        });
    });

    // 10. Passkey-only mode
    describe('passkey-only mode', () => {
        it('shows passkey button as primary (contained) when passwordLoginAllowed is false', () => {
            setNormalState({
                passkeysExist: true,
                passwordLoginAllowed: false,
            });
            render(<LoginPage />);

            const passkeyButton = screen.getByText('loginWithPasskey');
            expect(passkeyButton).toBeInTheDocument();
            // OR divider should NOT be shown
            expect(screen.queryByText('OR')).not.toBeInTheDocument();
            // Password field should NOT be shown
            expect(screen.queryByLabelText('password')).not.toBeInTheDocument();
        });
    });

    // 11. Reset password button shown
    describe('reset password button', () => {
        it('shows reset password button', () => {
            render(<LoginPage />);

            expect(screen.getByText('resetPassword')).toBeInTheDocument();
        });
    });

    // 13. Wait time warning
    describe('wait time warning', () => {
        it('shows Alert when waitTime > 0 from a rate-limit response', () => {
            setNormalState();
            render(<LoginPage />);
            triggerAdminRateLimit(5000);

            expect(screen.getAllByText(/waitTimeMessage 5 seconds/).length).toBeGreaterThan(0);
        });

        it('disables sign in button when waitTime > 0', () => {
            setNormalState();
            const { container } = render(<LoginPage />);
            triggerAdminRateLimit(5000);

            const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
            expect(submitButton).toBeDisabled();
        });
    });

    // 14. Website name display
    describe('website name display', () => {
        it('shows custom website name', () => {
            setNormalState({ websiteName: 'MyCustomSite' });
            render(<LoginPage />);

            expect(screen.getByText('MyCustomSite')).toBeInTheDocument();
        });

        it('shows "Powered by MyTube" when website name is not MyTube', () => {
            setNormalState({ websiteName: 'MyCustomSite' });
            render(<LoginPage />);

            expect(screen.getByText('Powered by MyTube')).toBeInTheDocument();
        });

        it('does not show "Powered by MyTube" when website name is MyTube', () => {
            setNormalState({ websiteName: 'MyTube' });
            render(<LoginPage />);

            expect(screen.queryByText('Powered by MyTube')).not.toBeInTheDocument();
        });
    });

    // 15. VersionInfo renders (real component)
    describe('VersionInfo', () => {
        it('renders VersionInfo component with version text', () => {
            setNormalState();
            render(<LoginPage />);

            // Real VersionInfo renders a version string like "vX.Y.Z"
            // It uses import.meta.env.VITE_APP_VERSION
            expect(screen.getByText(/v\d/)).toBeInTheDocument();
        });
    });

    // 16. Reset password guidance
    describe('reset password flow', () => {
        it('opens guidance modal when reset button clicked', () => {
            setNormalState();
            render(<LoginPage />);

            fireEvent.click(screen.getByText('resetPassword'));

            const dialog = screen.getByRole('dialog');
            expect(dialog).toBeInTheDocument();
            expect(within(dialog).getByText('resetPassword')).toBeInTheDocument();
            expect(within(dialog).getByText(/backend environment/)).toBeInTheDocument();
            expect(within(dialog).getByText(/node dist\/scripts\/reset-password\.js NEW_PASSWORD/)).toBeInTheDocument();
            expect(within(dialog).getByText(/docker exec -it mytube-backend node \/app\/dist\/scripts\/reset-password\.js NEW_PASSWORD/)).toBeInTheDocument();
        });

        it('closes reset guidance modal when confirm is clicked', async () => {
            setNormalState();
            render(<LoginPage />);

            fireEvent.click(screen.getByText('resetPassword'));
            const dialog = screen.getByRole('dialog');
            const confirmButton = within(dialog).getByText('confirm');
            fireEvent.click(confirmButton);

            await waitFor(() => {
                expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            });
        });
    });

    // 17. AlertModal shown on login error via mutation onError
    describe('alert modal via mutation callbacks', () => {
        it('shows alert modal when admin login receives incorrect password', () => {
            setNormalState();
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['adminLogin']?.onError?.({
                    response: {
                        status: 401,
                        data: { message: 'Incorrect admin password' },
                    },
                });
            });

            // Real AlertModal renders a MUI Dialog
            const dialog = screen.getByRole('dialog');
            expect(dialog).toBeInTheDocument();
            expect(within(dialog).getByText('error')).toBeInTheDocument();
            expect(within(dialog).getByText('incorrectPassword')).toBeInTheDocument();
        });

        it('shows alert with wait time when too many attempts (429)', () => {
            setNormalState();
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['adminLogin']?.onError?.({
                    response: {
                        status: 429,
                        data: { waitTime: 60000 },
                    },
                });
            });

            const dialog = screen.getByRole('dialog');
            expect(dialog).toBeInTheDocument();
            expect(within(dialog).getByText(/tooManyAttempts/)).toBeInTheDocument();
        });

        it('shows alert on login network error via onError', () => {
            setNormalState();
            render(<LoginPage />);

            // Simulate a network error
            act(() => {
                mutationCallbacks['adminLogin']?.onError?.(new Error('Network error'));
            });

            const dialog = screen.getByRole('dialog');
            expect(dialog).toBeInTheDocument();
            expect(within(dialog).getByText('loginFailed')).toBeInTheDocument();
        });

        it('closes alert modal when confirm is clicked', async () => {
            setNormalState();
            render(<LoginPage />);

            // Trigger alert
            act(() => {
                mutationCallbacks['adminLogin']?.onError?.(new Error('Network error'));
            });

            const dialog = screen.getByRole('dialog');
            expect(dialog).toBeInTheDocument();

            // Click the confirm/close button in AlertModal
            const confirmButton = within(dialog).getByText('confirm');
            fireEvent.click(confirmButton);

            // Dialog should close (MUI Dialog uses transitions)
            await waitFor(() => {
                expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            });
        });

        it('shows generic loginFailed for unknown status codes', () => {
            setNormalState();
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['adminLogin']?.onError?.({
                    response: {
                        status: 500,
                        data: { message: 'Server error' },
                    },
                });
            });

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('loginFailed')).toBeInTheDocument();
        });
    });

    // 18. Successful login calls login()
    describe('successful login', () => {
        it('calls login with role on admin success', () => {
            setNormalState();
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['adminLogin']?.onSuccess?.({
                    success: true,
                    role: 'admin',
                });
            });

            expect(mockLogin).toHaveBeenCalledWith('admin');
        });

        it('calls login with role on visitor success', () => {
            setNormalState({
                visitorUserEnabled: true,
                isVisitorPasswordSet: true,
            });
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['visitorLogin']?.onSuccess?.({
                    success: true,
                    role: 'visitor',
                });
            });

            expect(mockLogin).toHaveBeenCalledWith('visitor');
        });
    });

    // 20. Auto-login when loginRequired is false
    describe('auto-login', () => {
        it('calls login() automatically when loginRequired is false', () => {
            setNormalState({ loginRequired: false });
            render(<LoginPage />);

            expect(mockLogin).toHaveBeenCalled();
        });
    });

    // 22. Visitor login error callbacks
    describe('visitor login error callbacks', () => {
        it('shows alert on visitor login 429 too many attempts', () => {
            setNormalState({
                visitorUserEnabled: true,
                isVisitorPasswordSet: true,
            });
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['visitorLogin']?.onError?.({
                    response: {
                        status: 429,
                        data: { waitTime: 30000 },
                    },
                });
            });

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText(/tooManyAttempts/)).toBeInTheDocument();
        });

        it('shows alert on visitor login incorrect password', () => {
            setNormalState({
                visitorUserEnabled: true,
                isVisitorPasswordSet: true,
            });
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['visitorLogin']?.onError?.({
                    response: {
                        status: 401,
                        data: { message: 'Incorrect visitor password' },
                    },
                });
            });

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('incorrectPassword')).toBeInTheDocument();
        });

        it('shows alert on visitor login network error', () => {
            setNormalState({
                visitorUserEnabled: true,
                isVisitorPasswordSet: true,
            });
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['visitorLogin']?.onError?.(new Error('Network error'));
            });

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('loginFailed')).toBeInTheDocument();
        });

        it('shows generic loginFailed for visitor unknown status codes', () => {
            setNormalState({
                visitorUserEnabled: true,
                isVisitorPasswordSet: true,
            });
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['visitorLogin']?.onError?.({
                    response: {
                        status: 500,
                        data: { message: 'Server error' },
                    },
                });
            });

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('loginFailed')).toBeInTheDocument();
        });

    });

    // 23. formatWaitTime edge cases
    describe('formatWaitTime', () => {
        it('formats minutes correctly', () => {
            setNormalState();
            render(<LoginPage />);
            triggerAdminRateLimit(120000);

            expect(screen.getAllByText(/2 minutes/).length).toBeGreaterThan(0);
        });

        it('formats hours correctly', () => {
            setNormalState();
            render(<LoginPage />);
            triggerAdminRateLimit(7200000);

            expect(screen.getAllByText(/2 hours/).length).toBeGreaterThan(0);
        });

        it('formats days correctly', () => {
            setNormalState();
            render(<LoginPage />);
            triggerAdminRateLimit(172800000);

            expect(screen.getAllByText(/2 days/).length).toBeGreaterThan(0);
        });

        it('formats singular second correctly', () => {
            setNormalState();
            render(<LoginPage />);
            triggerAdminRateLimit(1000);

            expect(screen.getAllByText(/1 second(?!s)/).length).toBeGreaterThan(0);
        });

        it('formats singular minute correctly', () => {
            setNormalState();
            render(<LoginPage />);
            triggerAdminRateLimit(60000);

            expect(screen.getAllByText(/1 minute(?!s)/).length).toBeGreaterThan(0);
        });

        it('formats sub-second as "a moment"', () => {
            setNormalState();
            render(<LoginPage />);
            triggerAdminRateLimit(500);

            expect(screen.getAllByText(/a moment/).length).toBeGreaterThan(0);
        });
    });

    // 24. Passkey login callbacks
    describe('passkey login callbacks', () => {
        it('calls login with role on passkey success', () => {
            setNormalState({ passkeysExist: true, passwordLoginAllowed: true });
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['passkeyLogin']?.onSuccess?.({
                    role: 'admin',
                });
            });

            expect(mockLogin).toHaveBeenCalledWith('admin');
        });

        it('calls login without role on passkey success without role', () => {
            setNormalState({ passkeysExist: true, passwordLoginAllowed: true });
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['passkeyLogin']?.onSuccess?.({});
            });

            expect(mockLogin).toHaveBeenCalled();
        });

        it('shows alert on passkey login error with backend error message', () => {
            setNormalState({ passkeysExist: true, passwordLoginAllowed: true });
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['passkeyLogin']?.onError?.({
                    response: { data: { error: 'No passkeys registered' } },
                });
            });

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('No passkeys registered')).toBeInTheDocument();
        });

        it('shows alert on passkey login error with message field', () => {
            setNormalState({ passkeysExist: true, passwordLoginAllowed: true });
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['passkeyLogin']?.onError?.({
                    response: { data: { message: 'Server error' } },
                });
            });

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('Server error')).toBeInTheDocument();
        });

        it('shows alert on passkey login error with generic message', () => {
            setNormalState({ passkeysExist: true, passwordLoginAllowed: true });
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['passkeyLogin']?.onError?.({
                    message: 'Something went wrong',
                });
            });

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('Something went wrong')).toBeInTheDocument();
        });

        it('shows translated error when WebAuthn error key matches', () => {
            vi.mocked(getWebAuthnErrorTranslationKey).mockReturnValueOnce('webAuthnCancelled' as ReturnType<typeof getWebAuthnErrorTranslationKey>);
            setNormalState({ passkeysExist: true, passwordLoginAllowed: true });
            render(<LoginPage />);

            act(() => {
                mutationCallbacks['passkeyLogin']?.onError?.({
                    message: 'The operation was cancelled',
                });
            });

            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('webAuthnCancelled')).toBeInTheDocument();
        });
    });
});
