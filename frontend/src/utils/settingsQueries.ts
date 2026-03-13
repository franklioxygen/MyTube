import type { QueryClient } from '@tanstack/react-query';
import { Settings } from '../types';
import { getWaitTime } from './apiClient';
import { api } from './apiClient';
import { stableQueryConfig } from './queryConfig';

export interface AuthSettingsResponse {
    loginRequired?: boolean;
    authenticatedRole?: 'admin' | 'visitor' | null;
}

export const isUnauthenticatedAuthProbeStatus = (status?: number) =>
    status === 401 || status === 403;

export const isRateLimitedAuthProbeStatus = (status?: number) =>
    status === 429;

export const isTerminalAuthProbeStatus = (status?: number) =>
    isUnauthenticatedAuthProbeStatus(status) || isRateLimitedAuthProbeStatus(status);

export const fetchAuthSettings = async (): Promise<AuthSettingsResponse | null> => {
    try {
        const response = await api.get('/settings/password-enabled');
        return response.data as AuthSettingsResponse;
    } catch (error: any) {
        if (isUnauthenticatedAuthProbeStatus(error?.response?.status)) {
            return null;
        }

        throw error;
    }
};

export const authSettingsQueryOptions = {
    queryKey: ['authSettings'],
    queryFn: fetchAuthSettings,
    retry: (failureCount: number, error: any) => {
        if (isUnauthenticatedAuthProbeStatus(error?.response?.status)) {
            return false;
        }

        if (isRateLimitedAuthProbeStatus(error?.response?.status)) {
            return failureCount < 1;
        }

        return failureCount < 1;
    },
    retryDelay: (_attemptIndex: number, error: any) => {
        if (isRateLimitedAuthProbeStatus(error?.response?.status)) {
            return Math.max(getWaitTime(error), 1000);
        }

        return 250;
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
} as const;

export const fetchSettings = async (): Promise<Settings> => {
    const response = await api.get('/settings');
    return response.data;
};

export const settingsQueryOptions = {
    queryKey: ['settings'],
    queryFn: fetchSettings,
    ...stableQueryConfig,
    retry: (failureCount: number, error: any) => {
        if (error?.response?.status === 401) {
            return false;
        }

        return failureCount < 3;
    },
} as const;

export const canReadSettings = (authSettings?: AuthSettingsResponse | null) =>
    authSettings?.loginRequired === false ||
    authSettings?.authenticatedRole === 'admin' ||
    authSettings?.authenticatedRole === 'visitor';

export const fetchReadableSettings = async (
    queryClient: QueryClient,
    options: { forceRefresh?: boolean } = {}
) => {
    const authSettings = await queryClient.fetchQuery(authSettingsQueryOptions);
    if (!canReadSettings(authSettings)) {
        return null;
    }

    return queryClient.fetchQuery({
        ...settingsQueryOptions,
        staleTime: options.forceRefresh ? 0 : settingsQueryOptions.staleTime,
    });
};
