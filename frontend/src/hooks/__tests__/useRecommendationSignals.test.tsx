import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  auth: {
    isAuthenticated: true,
    userRole: 'visitor' as 'admin' | 'visitor' | null,
    loginRequired: true,
  },
}));

vi.mock('../../utils/apiClient', () => ({
  api: { get: (...args: unknown[]) => mocks.get(...args) },
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mocks.auth,
}));

import { useRecommendationSignals } from '../useRecommendationSignals';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const makeSignals = (computedAt: number) => ({
  computedAt,
  perVideo: {},
  authorAffinity: {},
  tagAffinity: {},
  durationBands: [],
});

describe('useRecommendationSignals', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.auth.isAuthenticated = true;
    mocks.auth.userRole = 'visitor';
    mocks.auth.loginRequired = true;
  });

  it('refetches rather than reusing cached signals when the requester role changes', async () => {
    const wrapper = createWrapper();

    mocks.get.mockResolvedValueOnce({ status: 200, data: makeSignals(1) });
    const visitor = renderHook(() => useRecommendationSignals(), { wrapper });
    await waitFor(() => expect(visitor.result.current.data?.computedAt).toBe(1));
    expect(mocks.get).toHaveBeenCalledTimes(1);

    mocks.auth.userRole = 'admin';
    mocks.get.mockResolvedValueOnce({ status: 200, data: makeSignals(2) });
    const admin = renderHook(() => useRecommendationSignals(), { wrapper });
    await waitFor(() => expect(admin.result.current.data?.computedAt).toBe(2));
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
});
