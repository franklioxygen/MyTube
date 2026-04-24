import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RssTokenList from '../RssFeedSettings/RssTokenList';

const apiMocks = vi.hoisted(() => ({
    get: vi.fn(),
}));

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

vi.mock('../../../utils/apiClient', () => ({
    api: {
        get: apiMocks.get,
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('../RssFeedSettings/RssTokenCard', () => ({
    default: ({ tagOptions }: { tagOptions: string[] }) => (
        <div data-testid="tag-options">{tagOptions.join('|')}</div>
    ),
}));

vi.mock('../RssFeedSettings/RssTokenDialog', () => ({
    default: () => null,
}));

const renderWithQueryClient = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <RssTokenList />
        </QueryClientProvider>
    );
};

describe('RssTokenList', () => {
    beforeEach(() => {
        apiMocks.get.mockReset();
    });

    it('builds tag filter options from parsed video tag arrays and legacy JSON strings', async () => {
        apiMocks.get.mockImplementation((url: string) => {
            if (url === '/rss/tokens') {
                return Promise.resolve({
                    data: {
                        tokens: [
                            {
                                id: 'token-id',
                                label: 'Feed',
                                role: 'visitor',
                                filters: {},
                                isActive: true,
                                accessCount: 0,
                                lastAccessedAt: null,
                                createdAt: Date.UTC(2026, 3, 20),
                                feedUrl: 'https://mytube.example/feed/token-id',
                            },
                        ],
                    },
                });
            }

            if (url === '/videos') {
                return Promise.resolve({
                    data: [
                        { author: 'A', channelUrl: 'https://example.com/a', tags: ['beta', 'alpha'] },
                        { author: 'B', channelUrl: 'https://example.com/b', tags: '["legacy","beta"]' },
                        { author: 'C', channelUrl: 'https://example.com/c', tags: 'not json' },
                    ],
                });
            }

            return Promise.resolve({ data: {} });
        });

        renderWithQueryClient();

        expect(await screen.findByTestId('tag-options')).toHaveTextContent('alpha|beta|legacy');
    });

    it('renders empty and error states for the token query', async () => {
        apiMocks.get.mockImplementation((url: string) => {
            if (url === '/rss/tokens') {
                return Promise.resolve({ data: { tokens: [] } });
            }
            if (url === '/videos') {
                return Promise.resolve({ data: [] });
            }
            return Promise.resolve({ data: {} });
        });

        const { unmount } = renderWithQueryClient();

        expect(await screen.findByText('rssNoFeeds')).toBeInTheDocument();
        unmount();

        apiMocks.get.mockImplementation((url: string) => {
            if (url === '/rss/tokens') {
                return Promise.reject(new Error('failed'));
            }
            return Promise.resolve({ data: [] });
        });

        renderWithQueryClient();

        await waitFor(() => expect(screen.getByText('rssLoadTokensError')).toBeInTheDocument());
    });
});
