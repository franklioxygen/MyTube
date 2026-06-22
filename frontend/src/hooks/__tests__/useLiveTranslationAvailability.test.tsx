import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('../../utils/apiClient', () => ({
  api: { get: (...args: unknown[]) => get(...args) },
}));

// Mutable auth state the mocked context reads from.
const auth: {
  isAuthenticated: boolean;
  userRole: 'admin' | 'visitor' | null;
  loginRequired: boolean;
} = { isAuthenticated: true, userRole: 'visitor', loginRequired: true };
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => auth,
}));

import { useLiveTranslationAvailability } from '../useLiveTranslationAvailability';

function makeResponse(canUse: boolean, reason: string | null) {
  return {
    data: {
      enabled: true,
      available: true,
      canUse,
      model: 'gemini-3.5-live-translate-preview',
      sourceLanguage: 'auto',
      targetLanguage: 'en',
      apiKeyConfigured: true,
      requiresAdmin: true,
      reason,
    },
  };
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useLiveTranslationAvailability', () => {
  beforeEach(() => {
    get.mockReset();
    auth.isAuthenticated = true;
    auth.userRole = 'visitor';
    auth.loginRequired = true;
  });

  it('refetches (does not reuse the cache) when the requester role changes', async () => {
    // Shared cache across renders so a stale entry could be reused if the key
    // did not include the role.
    const wrapper = createWrapper();

    get.mockResolvedValueOnce(makeResponse(false, 'admin_required'));
    const visitor = renderHook(() => useLiveTranslationAvailability(), { wrapper });
    await waitFor(() => expect(visitor.result.current.data?.reason).toBe('admin_required'));
    expect(get).toHaveBeenCalledTimes(1);

    // Become admin in the same cache: a role-scoped key must trigger a new fetch.
    auth.userRole = 'admin';
    get.mockResolvedValueOnce(makeResponse(true, null));
    const admin = renderHook(() => useLiveTranslationAvailability(), { wrapper });
    await waitFor(() => expect(admin.result.current.data?.canUse).toBe(true));
    expect(get).toHaveBeenCalledTimes(2);
  });
});
