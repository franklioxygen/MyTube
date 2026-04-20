import type { QueryClient } from '@tanstack/react-query';
import { Settings } from '../types';
import { getWaitTime } from './apiClient';
import { api } from './apiClient';
import { stableQueryConfig } from './queryConfig';

export interface AuthSettingsResponse {
    loginRequired?: boolean;
    authenticatedRole?: 'admin' | 'visitor' | null;
}

const getErrorStatus = (error: unknown): number | undefined => {
    if (typeof error !== 'object' || error === null || !('response' in error)) {
        return undefined;
    }

    const response = (error as { response?: { status?: number } }).response;
    return response?.status;
};

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
    } catch (error: unknown) {
        if (isUnauthenticatedAuthProbeStatus(getErrorStatus(error))) {
            return null;
        }

        throw error;
    }
};

export const authSettingsQueryOptions = {
    queryKey: ['authSettings'],
    queryFn: fetchAuthSettings,
    retry: (failureCount: number, error: unknown) => {
        const status = getErrorStatus(error);
        if (isUnauthenticatedAuthProbeStatus(status)) {
            return false;
        }

        if (isRateLimitedAuthProbeStatus(status)) {
            return failureCount < 1;
        }

        return failureCount < 1;
    },
    retryDelay: (_attemptIndex: number, error: unknown) => {
        if (isRateLimitedAuthProbeStatus(getErrorStatus(error))) {
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
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: (failureCount: number, error: unknown) => {
        if (getErrorStatus(error) === 401) {
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
