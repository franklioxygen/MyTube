import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthorProfile } from '../useAuthorProfile';
const state = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), remove: vi.fn(), profile: { author: 'A', effectiveAvatarPath: '/avatars/old.jpg' } }));
vi.mock('../../utils/apiClient', () => ({ api: { get: state.get, put: state.put, delete: state.remove } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ loginRequired: false, userRole: null }) }));
beforeEach(() => {
    vi.clearAllMocks();
    state.profile = { author: 'A', effectiveAvatarPath: '/avatars/old.jpg' };
    state.get.mockImplementation(async () => ({ data: { data: state.profile } }));
});
describe('author avatar reconciliation', () => {
    it('refreshes profile and all dependent views after an ambiguous committed save', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        client.setQueryData(['videos'], [{ id: 'v1', authorAvatarPath: '/avatars/old.jpg' }]);
        client.setQueryData(['video', 'v1'], { id: 'v1', authorAvatarPath: '/avatars/old.jpg' });
        client.setQueryData(['favorite-authors', 'owner'], [{ author: 'A', avatarPath: '/avatars/old.jpg' }]);
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const { result, unmount } = renderHook(() => useAuthorProfile('A'), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        state.remove.mockImplementationOnce(async () => {
            state.profile = { author: 'A', effectiveAvatarPath: '/avatars/auto.jpg' };
            throw new Error('response timeout after commit');
        });
        await act(async () => { await expect(result.current.save(null)).rejects.toThrow('timeout'); });
        await act(async () => { await result.current.reconcile(); });
        await waitFor(() => expect(result.current.data?.effectiveAvatarPath).toBe('/avatars/auto.jpg'));
        for (const key of [['videos'], ['video', 'v1'], ['favorite-authors', 'owner']]) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
        unmount(); client.clear();
    });
});
