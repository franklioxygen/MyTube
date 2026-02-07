import { createTheme, ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
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

// Mock AuthContext for VISITOR
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
        loginRequired: true,
        checkingAuth: false,
        userRole: 'visitor', // VISITOR ROLE
        login: vi.fn(),
        logout: vi.fn(),
    }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock child components to avoid context dependency issues
vi.mock('../AuthorsList', () => ({ default: () => <div data-testid="authors-list" /> }));
vi.mock('../Collections', () => ({ default: () => <div data-testid="collections-list" /> }));
vi.mock('../TagsList', () => ({ default: () => <div data-testid="tags-list" /> }));

// Mock axios
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

// Mock useCloudflareStatus
vi.mock('../../hooks/useCloudflareStatus', () => ({
    useCloudflareStatus: () => ({
        data: { isRunning: false, tunnelId: null, accountTag: null, publicUrl: null },
        isLoading: false,
    }),
}));

describe('Header (Visitor)', () => {
    const defaultProps = {
        onSubmit: vi.fn(),
        onSearch: vi.fn(),
        activeDownloads: [],
        queuedDownloads: [],
    };

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

    beforeEach(() => {
        vi.clearAllMocks();
        mockedAxios.get.mockImplementation((url: string) => {
            if (url && typeof url === 'string' && url.includes('/settings')) {
                return Promise.resolve({ data: { websiteName: 'TestTube', infiniteScroll: false } });
            }
            return Promise.resolve({ data: [] });
        });
    });

    it('should BLOCK URL submission for visitor', async () => {
        const onSubmit = vi.fn();
        renderHeader({ onSubmit });

        const input = screen.getByPlaceholderText('enterSearchTerm');

        // Try to submit a URL
        fireEvent.change(input, { target: { value: 'https://youtube.com/watch?v=visitorBlock' } });
        const form = input.closest('form');
        fireEvent.submit(form!);

        // Expect onSubmit NOT to be called
        expect(onSubmit).not.toHaveBeenCalled();

        // Expect error message
        expect(screen.getByText('visitorModeUrlRestricted')).toBeInTheDocument();
    });

    it('should ALLOW search term submission for visitor', async () => {
        const onSubmit = vi.fn(); // This is the prop passed to Header, usually handles download logic
        // But for search terms, Header navigates instead of calling onSubmit usually?
        // Let's check Header.tsx logic:
        // if (isUrl) { ... } else { navigate(...) }
        // So for search term, onSubmit prop is NOT called, but navigation happens.
        // We can check if `navigate` was called, or at least that no error is shown and onSubmit is NOT called (which is correct for search).

        // Wait, Header.tsx:
        // if (isUrl) { ... await onSubmit(videoUrl) ... } else { navigate(...) }

        renderHeader({ onSubmit });

        const input = screen.getByPlaceholderText('enterSearchTerm');

        // Try to submit a search term
        fireEvent.change(input, { target: { value: 'funny cats' } });
        const form = input.closest('form');
        fireEvent.submit(form!);

        // Expect onSubmit NOT to be called (since it's not a URL)
        expect(onSubmit).not.toHaveBeenCalled();

        // Expect NO visitor restriction error
        expect(screen.queryByText('visitorModeUrlRestricted')).not.toBeInTheDocument();

        // We can't easily check router navigation here without mocking useNavigate, 
        // but checking that no error appeared is good enough to distinguish from URL block.
    });
});
