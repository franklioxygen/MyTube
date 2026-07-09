import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFavoriteAuthors } from '../useFavoriteAuthors';
import { useFavoriteCollections } from '../useFavoriteCollections';

const apiMock = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
}));

vi.mock('../../utils/apiClient', () => ({ api: apiMock }));
vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true, loginRequired: true, userRole: 'admin', username: 'admin' }),
}));
vi.mock('../../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('../../contexts/SnackbarContext', () => ({ useSnackbar: () => ({ showSnackbar: vi.fn() }) }));

describe('favorite hooks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMock.get.mockResolvedValue({ data: [] });
        apiMock.post.mockResolvedValue({ data: { success: true } });
        apiMock.delete.mockResolvedValue({ data: { success: true } });
    });

    const createWrapper = () => {
        const client = new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        });
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        );
        return { client, wrapper };
    };

    it('posts a collection favorite while applying the optimistic entry', async () => {
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useFavoriteCollections(), { wrapper });

        act(() => result.current.toggle('collection-1', { name: 'Saved' }));

        await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/favorites/collections/collection-1'));
        expect(apiMock.delete).not.toHaveBeenCalled();
    });

    it('posts author metadata and uses the body form required for exact author keys', async () => {
        const { wrapper } = createWrapper();
        const { result } = renderHook(() => useFavoriteAuthors(), { wrapper });

        act(() => result.current.toggle({
            author: 'AC/DC',
            displayName: 'AC/DC',
            channelUrl: 'https://example.com/acdc',
        }));

        await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/favorites/authors', expect.objectContaining({ author: 'AC/DC' })));
        expect(apiMock.delete).not.toHaveBeenCalled();
    });
});
