import { createTheme, ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../../contexts/VisitorModeContext', () => ({
    useVisitorMode: () => ({
        visitorMode: false,
    }),
}));

// Mock child components to avoid context dependency issues
vi.mock('../AuthorsList', () => ({ default: () => <div data-testid="authors-list" /> }));
vi.mock('../Collections', () => ({ default: () => <div data-testid="collections-list" /> }));
vi.mock('../TagsList', () => ({ default: () => <div data-testid="tags-list" /> }));

// Mock axios for settings fetch
const mockAxiosGet = vi.fn();
vi.mock('axios', () => ({
    __esModule: true,
    default: {
        get: (...args: any[]) => mockAxiosGet(...args),
    },
}));

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
                <ThemeProvider theme={theme}>
                    <BrowserRouter>
                        <Header {...defaultProps} {...props} />
                    </BrowserRouter>
                </ThemeProvider>
            </QueryClientProvider>
        );
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Default mock implementation
        mockAxiosGet.mockImplementation((url) => {
            if (url && url.includes('/settings')) {
                return Promise.resolve({ data: { websiteName: 'TestTube', infiniteScroll: false } });
            }
            return Promise.resolve({ data: [] });
        });
    });

    it('renders with logo and title', async () => {
        renderHeader();

        // Wait for the settings fetch to complete and update the title
        await waitFor(() => {
            expect(mockAxiosGet).toHaveBeenCalledWith(expect.stringContaining('/settings'));
        });

        // Use findByText to allow for async updates if any
        expect(await screen.findByText('TestTube')).toBeInTheDocument();
        expect(screen.getByAltText('MyTube Logo')).toBeInTheDocument();
    });

    it('handles search input change and submission', () => {
        const onSubmit = vi.fn().mockResolvedValue({ success: true });
        renderHeader({ onSubmit });

        const input = screen.getByPlaceholderText('enterUrlOrSearchTerm');
        fireEvent.change(input, { target: { value: 'https://youtube.com/watch?v=123' } });

        const form = input.closest('form');
        expect(form).toBeInTheDocument();
        fireEvent.submit(form!);

        expect(onSubmit).toHaveBeenCalledWith('https://youtube.com/watch?v=123');
    });

    it('toggles theme when button is clicked', () => {
        renderHeader();

        const themeButton = screen.getAllByRole('button').find(btn => btn.querySelector('svg[data-testid="Brightness4Icon"]'));
        expect(themeButton).toBeDefined();
        fireEvent.click(themeButton!);

        expect(mockToggleTheme).toHaveBeenCalled();
    });

    it('displays error when submitting empty input', () => {
        renderHeader();

        const input = screen.getByPlaceholderText('enterUrlOrSearchTerm');
        const form = input.closest('form');
        fireEvent.submit(form!);

        expect(screen.getByText('pleaseEnterUrlOrSearchTerm')).toBeInTheDocument();
    });
});
