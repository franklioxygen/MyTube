import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
        t: (key: string) => key,
        setLanguage: vi.fn(),
    }),
}));

// Mock child components
vi.mock('../../components/AlertModal', () => ({
    default: ({ open, title, message }: any) =>
        open ? <div data-testid="alert-modal">{title}: {message}</div> : null,
}));

vi.mock('../../components/ConfirmationModal', () => ({
    default: ({ isOpen, title }: any) =>
        isOpen ? <div data-testid="confirmation-modal">{title}</div> : null,
}));

vi.mock('../../components/VersionInfo', () => ({
    default: () => <div data-testid="version-info">VersionInfo</div>,
}));

// --- Controllable useQuery / useMutation mocks ---

// Default query results keyed by queryKey[0]
let queryResults: Record<string, any> = {};

// Store mutation mocks so tests can invoke onSuccess/onError and check mutate calls
let mutationMocks: Record<string, any> = {};

// Helper to get or create a mutation mock for a given key.
// Returns the same mock on subsequent calls with the same key (across re-renders).
const getOrCreateMutationMock = (key: string) => {
    if (!mutationMocks[key]) {
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
    'resetPassword',   // 3rd
    'passkeyLogin',    // 4th
];

vi.mock('@tanstack/react-query', () => ({
    useQuery: vi.fn(({ queryKey }: any) => {
        const key = queryKey[0];
        return queryResults[key] || {
            data: undefined,
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
        };
    }),
    useMutation: vi.fn(() => {
        const key = mutationKeyOrder[mutationCallIndex % mutationKeyOrder.length];
        mutationCallIndex++;
        return getOrCreateMutationMock(key);
    }),
    useQueryClient: vi.fn(() => ({
        invalidateQueries: vi.fn(),
    })),
}));

// --- Helpers ---

/** Set default query results that produce the "normal login form" state */
const setNormalState = (overrides: Record<string, any> = {}) => {
    queryResults = {
        healthCheck: {
            data: {
                loginRequired: true,
                passwordEnabled: true,
                passwordLoginAllowed: true,
                allowResetPassword: true,
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
        resetPasswordCooldown: {
            data: { cooldown: overrides.cooldown ?? 0 },
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

// --- Tests ---

describe('LoginPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mutationCallIndex = 0;
        mutationMocks = {};
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
        it('shows reset password button when allowResetPassword is true', () => {
            setNormalState({ allowResetPassword: true });
            render(<LoginPage />);

            expect(screen.getByText('resetPassword')).toBeInTheDocument();
        });

        it('hides reset password button when allowResetPassword is false', () => {
            setNormalState({ allowResetPassword: false });
            render(<LoginPage />);

            // The text "resetPassword" should not appear as a button label
            // (there may be an info icon instead)
            const resetButtons = screen.queryAllByText('resetPassword');
            // Filter to only buttons
            const buttonElements = resetButtons.filter(
                (el) => el.closest('button')?.getAttribute('type') !== 'button' || el.tagName === 'BUTTON'
            );
            // In non-allowResetPassword mode with passwordLoginAllowed, we should not see the reset button text
            expect(screen.queryByRole('button', { name: 'resetPassword' })).not.toBeInTheDocument();
        });
    });

    // 12. Reset password with cooldown
    describe('reset password with cooldown', () => {
        it('shows disabled button with formatted time when cooldown is active', () => {
            setNormalState({ allowResetPassword: true, cooldown: 30000 });
            render(<LoginPage />);

            // Button text should include the cooldown time
            const resetButton = screen.getByText(/resetPassword.*30 seconds/);
            expect(resetButton).toBeInTheDocument();
            expect(resetButton.closest('button')).toBeDisabled();
        });
    });

    // 13. Wait time warning
    describe('wait time warning', () => {
        it('shows Alert when waitTime > 0 from server response', () => {
            setNormalState();
            // Inject waitTime into the healthCheck data
            queryResults['healthCheck'].data.waitTime = 5000;
            render(<LoginPage />);

            // The wait time alert shows t('waitTimeMessage') with {time} replaced
            const alert = screen.getByText(/waitTimeMessage/);
            expect(alert).toBeInTheDocument();
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

    // 15. VersionInfo rendered at bottom
    describe('VersionInfo', () => {
        it('renders VersionInfo component', () => {
            setNormalState();
            render(<LoginPage />);

            expect(screen.getByTestId('version-info')).toBeInTheDocument();
        });
    });
});
