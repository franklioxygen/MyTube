import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../AuthContext';

// Mock dependencies
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

const TestComponent = () => {
    const { isAuthenticated, loginRequired, login, logout } = useAuth();
    return (
        <div>
            <div data-testid="auth-status">{isAuthenticated ? 'Authenticated' : 'Not Authenticated'}</div>
            <div data-testid="login-required">{loginRequired ? 'Required' : 'Optional'}</div>
            <button onClick={() => login('mock-token')}>Login</button>
            <button onClick={logout}>Logout</button>
        </div>
    );
};

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
        },
    },
});

const renderWithProviders = (ui: React.ReactNode) => {
    return render(
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                {ui}
            </AuthProvider>
        </QueryClientProvider>
    );
};

describe('AuthContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        queryClient.clear();
    });

    it('should initialize with default authentication state', async () => {
        // Mock default settings: login required, password set
        mockedAxios.get.mockResolvedValueOnce({
            data: { loginEnabled: true, isPasswordSet: true }
        });

        renderWithProviders(<TestComponent />);

        // Initially assumes required until fetched
        expect(screen.getByTestId('login-required')).toHaveTextContent('Required');

        await waitFor(() => {
            expect(mockedAxios.get).toHaveBeenCalled();
        });
    });

    it('should automatically authenticate if login is not enabled', async () => {
        mockedAxios.get.mockResolvedValueOnce({
            data: { loginEnabled: false, isPasswordSet: true }
        });

        renderWithProviders(<TestComponent />);

        await waitFor(() => {
            expect(screen.getByTestId('auth-status')).toHaveTextContent('Authenticated');
            expect(screen.getByTestId('login-required')).toHaveTextContent('Optional');
        });
    });

    it('should automatically authenticate if password is not set', async () => {
        mockedAxios.get.mockResolvedValueOnce({
            data: { loginEnabled: true, isPasswordSet: false }
        });

        renderWithProviders(<TestComponent />);

        await waitFor(() => {
            expect(screen.getByTestId('auth-status')).toHaveTextContent('Authenticated');
            expect(screen.getByTestId('login-required')).toHaveTextContent('Optional');
        });
    });

    it('should check local storage for existing auth', async () => {
        localStorage.setItem('mytube_authenticated', 'true');
        mockedAxios.get.mockResolvedValueOnce({
            data: { loginEnabled: true, isPasswordSet: true }
        });

        renderWithProviders(<TestComponent />);

        await waitFor(() => {
            expect(screen.getByTestId('auth-status')).toHaveTextContent('Authenticated');
        });
    });

    it('should require login if settings say so and no stored auth', async () => {
        mockedAxios.get.mockResolvedValueOnce({
            data: { loginEnabled: true, isPasswordSet: true }
        });

        renderWithProviders(<TestComponent />);

        await waitFor(() => {
            expect(screen.getByTestId('auth-status')).toHaveTextContent('Not Authenticated');
            expect(screen.getByTestId('login-required')).toHaveTextContent('Required');
        });
    });

    it('should handle login', async () => {
        mockedAxios.get.mockResolvedValueOnce({
            data: { loginEnabled: true, isPasswordSet: true }
        });
        const user = userEvent.setup();

        renderWithProviders(<TestComponent />);

        await waitFor(() => {
            expect(screen.getByTestId('auth-status')).toHaveTextContent('Not Authenticated');
        });

        await user.click(screen.getByText('Login'));

        expect(screen.getByTestId('auth-status')).toHaveTextContent('Authenticated');
        expect(localStorage.getItem('mytube_authenticated')).toBe('true');
    });

    it('should handle logout', async () => {
        localStorage.setItem('mytube_authenticated', 'true');
        mockedAxios.get.mockResolvedValueOnce({
            data: { loginEnabled: true, isPasswordSet: true }
        });
        const user = userEvent.setup();

        renderWithProviders(<TestComponent />);

        await waitFor(() => {
            expect(screen.getByTestId('auth-status')).toHaveTextContent('Authenticated');
        });

        await user.click(screen.getByText('Logout'));

        expect(screen.getByTestId('auth-status')).toHaveTextContent('Not Authenticated');
        expect(localStorage.getItem('mytube_authenticated')).toBeNull();
    });
});
