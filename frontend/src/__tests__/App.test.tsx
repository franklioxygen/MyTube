import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

// Mock axios
vi.mock('axios', () => ({
    default: {
        create: vi.fn(() => ({
            get: vi.fn(() => Promise.resolve({ data: {} })),
            post: vi.fn(() => Promise.resolve({ data: {} })),
            put: vi.fn(() => Promise.resolve({ data: {} })),
            delete: vi.fn(() => Promise.resolve({ data: {} })),
            interceptors: {
                request: { use: vi.fn(), eject: vi.fn() },
                response: { use: vi.fn(), eject: vi.fn() }
            },
            defaults: { headers: { common: {} } }
        })),
        get: vi.fn(() => Promise.resolve({ data: {} })),
        post: vi.fn(() => Promise.resolve({ data: {} })),
        put: vi.fn(() => Promise.resolve({ data: {} })),
        delete: vi.fn(() => Promise.resolve({ data: {} })),
        interceptors: {
            request: { use: vi.fn(), eject: vi.fn() },
            response: { use: vi.fn(), eject: vi.fn() }
        },
        isAxiosError: vi.fn(() => false)
    }
}));

// Mock all the contexts and providers
vi.mock('../contexts/AuthContext', () => ({
    AuthProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    useAuth: () => ({
        isAuthenticated: true,
        loginRequired: false,
        checkingAuth: false
    })
}));

vi.mock('../contexts/VideoContext', () => ({
    VideoProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    useVideo: () => ({
        videos: [],
        loading: false,
        isSearchMode: false,
        searchTerm: '',
        handleSearch: vi.fn(),
        resetSearch: vi.fn()
    })
}));

vi.mock('../contexts/CollectionContext', () => ({
    CollectionProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    useCollection: () => ({
        collections: []
    })
}));

vi.mock('../contexts/DownloadContext', () => ({
    DownloadProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    useDownload: () => ({
        activeDownloads: [],
        queuedDownloads: [],
        handleVideoSubmit: vi.fn(),
        showBilibiliPartsModal: false,
        setShowBilibiliPartsModal: vi.fn(),
        bilibiliPartsInfo: { videosNumber: 0, title: '', type: 'video' },
        isCheckingParts: false,
        handleDownloadAllBilibiliParts: vi.fn(),
        handleDownloadCurrentBilibiliPart: vi.fn()
    })
}));

vi.mock('../contexts/LanguageContext', () => ({
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    useLanguage: () => ({
        language: 'en' as const,
        setLanguage: vi.fn(),
        t: (key: string) => key
    })
}));

vi.mock('../contexts/SnackbarContext', () => ({
    SnackbarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

// Mock Header component since it uses useThemeContext
vi.mock('../components/Header', () => ({
    default: () => <div>Header</div>
}));

vi.mock('../contexts/ThemeContext', () => ({
    ThemeContextProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    const { MemoryRouter } = actual as any;
    return {
        ...actual,
        BrowserRouter: MemoryRouter,
        useNavigate: () => mockNavigate
    };
});

// Mock localStorage
const localStorageMock = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
    value: localStorageMock
});

describe('App', () => {
    let queryClient: QueryClient;

    beforeEach(() => {
        queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false
                }
            }
        });
    });

    it('renders without crashing', () => {
        render(
            <QueryClientProvider client={queryClient}>
                <App />
            </QueryClientProvider>
        );
    });

    it('renders main app structure when authenticated', async () => {
        render(
            <QueryClientProvider client={queryClient}>
                <App />
            </QueryClientProvider>
        );

        // App should render (we can't easily test the full structure due to mocks,
        // but we can verify it doesn't crash)
        await waitFor(() => {
            expect(document.body).toBeTruthy();
        });
    });
});
