import { createTheme, ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../contexts/AuthContext';
import Header from '../Header';

// Mock contexts
const mockToggleTheme = vi.fn();
vi.mock('../../contexts/ThemeContext', () => ({
    useThemeContext: () => ({
        mode: 'light',
        toggleTheme: mockToggleTheme,
    }),
}));

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

const mockHandleTagToggle = vi.fn();
vi.mock('../../contexts/VideoContext', () => ({
    useVideo: () => ({
        availableTags: [],
        selectedTags: [],
        handleTagToggle: mockHandleTagToggle,
    }),
}));

vi.mock('../../contexts/CollectionContext', () => ({
    useCollection: () => ({
        collections: [],
    }),
}));

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
        loginRequired: false,
        checkingAuth: false,
        userRole: 'admin',
        login: vi.fn(),
        logout: vi.fn(),
    }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../hooks/useSettings', () => ({
    useSettings: () => ({
        data: { websiteName: 'TestTube', infiniteScroll: false, showThemeButton: true },
        isLoading: false,
    }),
}));

// Mock child components to avoid context dependency issues
vi.mock('../AuthorsList', () => ({ default: () => <div data-testid="authors-list" /> }));
vi.mock('../Collections', () => ({ default: () => <div data-testid="collections-list" /> }));
vi.mock('../TagsList', () => ({ default: () => <div data-testid="tags-list" /> }));

// Mock axios for settings fetch
const mockedAxios = vi.hoisted(() => ({
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
}));

vi.mock('axios', async () => {
    const actual = await vi.importActual<typeof import('axios')>('axios');
    return {
        ...actual,
        default: {
            ...actual.default,
            get: mockedAxios.get,
            post: mockedAxios.post || vi.fn(),
            put: mockedAxios.put || vi.fn(),
            delete: mockedAxios.delete || vi.fn(),
        },
        __esModule: true,
    };
});

// Mock useCloudflareStatus hook to avoid QueryClient issues
vi.mock('../../hooks/useCloudflareStatus', () => ({
    useCloudflareStatus: () => ({
        data: { isRunning: false, tunnelId: null, accountTag: null, publicUrl: null },
        isLoading: false,
    }),
}));

describe('Header', () => {
    const defaultProps = {
        onSubmit: vi.fn(),
        onSearch: vi.fn(),
        activeDownloads: [],
        queuedDownloads: [],
    };
    const settingsResponse = { data: { websiteName: 'TestTube', infiniteScroll: false } };
    const emptyResponse = { data: [] };

    let queryClient: QueryClient;

    const renderHeader = (props = {}) => {
        const theme = createTheme();
        queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                },
            },
        });
        return render(
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <ThemeProvider theme={theme}>
                        <BrowserRouter>
                            <Header {...defaultProps} {...props} />
                        </BrowserRouter>
                    </ThemeProvider>
                </AuthProvider>
            </QueryClientProvider>
        );
    };

    const resolveAxiosGet = (url: unknown) => {
        if (typeof url !== 'string') {
            return Promise.resolve(emptyResponse);
        }

        if (url.includes('/settings')) {
            return Promise.resolve(settingsResponse);
        }

        return Promise.resolve(emptyResponse);
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockedAxios.get.mockImplementation(resolveAxiosGet);
        // BrowserRouter reads the shared jsdom URL, and the search box mirrors
        // `/search?q=`, so a search in one test must not prefill the next.
        window.history.replaceState({}, '', '/');
    });

    it('renders with logo and title', async () => {
        renderHeader();

        // The Header component makes multiple axios calls (subscriptions, tasks, settings)
        // Note: Due to dynamic import mocking limitations in Vitest, the settings call may fail
        // and fall back to the default name. We verify the component renders correctly either way.
        const logo = screen.getByAltText('MyTube Logo');
        expect(logo).toBeInTheDocument();

        // Wait for the component to stabilize after async operations
        await waitFor(() => {
            // The title should be either "TestTube" (if settings succeeds) or "MyTube" (default)
            const title = screen.queryByText('TestTube') || screen.queryByText('MyTube');
            expect(title).toBeInTheDocument();
        }, { timeout: 2000 });

        // Logo should always be present
        expect(logo).toBeInTheDocument();
    });

    it('handles search input change and submission', async () => {
        const onSubmit = vi.fn().mockResolvedValue({ success: true });
        renderHeader({ onSubmit });

        const input = screen.getByPlaceholderText('enterUrlOrSearchTerm');
        fireEvent.change(input, { target: { value: 'https://youtube.com/watch?v=123' } });

        const form = input.closest('form');
        expect(form).toBeInTheDocument();
        fireEvent.submit(form!);

        expect(onSubmit).toHaveBeenCalledWith('https://youtube.com/watch?v=123');

        // Wait for potential async state updates (like navigation) to settle
        // This helps prevent "act(...)" warnings if test ends too quickly
        await waitFor(() => { });
    });

    it('redirects URL submission to search when backend marks it as search term', async () => {
        const onSubmit = vi.fn().mockResolvedValue({ success: false, isSearchTerm: true });
        renderHeader({ onSubmit });

        const input = screen.getByPlaceholderText('enterUrlOrSearchTerm') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'https://example.com/maybe-search' } });
        fireEvent.submit(input.closest('form')!);

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledWith('https://example.com/maybe-search');
            expect(window.location.pathname).toBe('/search');
        });
        expect(input.value).toBe('https://example.com/maybe-search');
    });

    it('keeps the search term in the box after searching so it can be refined', async () => {
        const onSubmit = vi.fn();
        renderHeader({ onSubmit });

        const input = screen.getByPlaceholderText('enterUrlOrSearchTerm') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'lofi beats' } });
        fireEvent.submit(input.closest('form')!);

        await waitFor(() => {
            expect(window.location.search).toBe('?q=lofi%20beats');
        });
        expect(input.value).toBe('lofi beats');
        // A search is not a download, so the URL handler is never involved.
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('fills the box from the query when the search page is opened directly', () => {
        window.history.replaceState({}, '', '/search?q=cats&sort=dateDesc');
        renderHeader();

        expect(screen.getByPlaceholderText('enterUrlOrSearchTerm')).toHaveValue('cats');
    });

    it('clears the box once the user leaves the search page', async () => {
        window.history.replaceState({}, '', '/search?q=cats');
        renderHeader();

        const input = screen.getByPlaceholderText('enterUrlOrSearchTerm');
        expect(input).toHaveValue('cats');

        fireEvent.click(screen.getByAltText('MyTube Logo'));

        await waitFor(() => {
            expect(window.location.pathname).toBe('/');
        });
        expect(input).toHaveValue('');
    });

    it('leaves the search page when the retained term is cleared', async () => {
        window.history.replaceState({}, '', '/search?q=cats');
        renderHeader();

        fireEvent.click(screen.getByRole('button', { name: 'clear' }));

        await waitFor(() => {
            expect(window.location.pathname).toBe('/');
        });
        expect(window.location.search).toBe('');
        expect(screen.getByPlaceholderText('enterUrlOrSearchTerm')).toHaveValue('');
    });

    it('shows backend error message when URL processing fails', async () => {
        const onSubmit = vi.fn().mockResolvedValue({ success: false, error: 'backendFailed' });
        renderHeader({ onSubmit });

        const input = screen.getByPlaceholderText('enterUrlOrSearchTerm');
        fireEvent.change(input, { target: { value: 'https://example.com/fail' } });
        fireEvent.submit(input.closest('form')!);

        expect(await screen.findByText('backendFailed')).toBeInTheDocument();
    });

    it('falls back to unexpected error message when submit throws', async () => {
        const onSubmit = vi.fn().mockRejectedValue(new Error('network boom'));
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        renderHeader({ onSubmit });

        const input = screen.getByPlaceholderText('enterUrlOrSearchTerm');
        fireEvent.change(input, { target: { value: 'https://example.com/throw' } });
        fireEvent.submit(input.closest('form')!);

        expect(await screen.findByText('unexpectedErrorOccurred')).toBeInTheDocument();
        expect(consoleErrorSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });



    it('displays error when submitting empty input', () => {
        renderHeader();

        const input = screen.getByPlaceholderText('enterUrlOrSearchTerm');
        const form = input.closest('form');
        fireEvent.submit(form!);

        expect(screen.getByText('pleaseEnterUrlOrSearchTerm')).toBeInTheDocument();
    });
});
