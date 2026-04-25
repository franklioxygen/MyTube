import { useQuery } from '@tanstack/react-query';
import { api } from '../../utils/apiClient';
import { isAuthOrRateLimitStatus } from './loginUtils';

export interface PasswordEnabledData {
    loginRequired?: boolean;
    passwordEnabled?: boolean;
    passwordLoginAllowed?: boolean;
    visitorUserEnabled?: boolean;
    isVisitorPasswordSet?: boolean;
    websiteName?: string;
}

interface PasskeysData {
    exists?: boolean;
}

const defaultLoginStatus: PasswordEnabledData = {
    loginRequired: true,
    passwordEnabled: false,
};

export const useLoginStatus = () => {
    const {
        data: statusData,
        isLoading: isCheckingConnection,
        isError: isConnectionError,
        refetch: retryConnection,
    } = useQuery<PasswordEnabledData>({
        queryKey: ['healthCheck'],
        queryFn: async () => {
            try {
                const response = await api.get<PasswordEnabledData>(
                    '/settings/password-enabled',
                    { timeout: 5000 }
                );
                return response.data;
            } catch (error: unknown) {
                if (isAuthOrRateLimitStatus(error)) {
                    return defaultLoginStatus;
                }
                throw error;
            }
        },
        retry: (failureCount, error) => {
            if (isAuthOrRateLimitStatus(error)) {
                return false;
            }
            return failureCount < 1;
        },
        retryDelay: 1000,
    });

    const { data: passkeysData } = useQuery<PasskeysData>({
        queryKey: ['passkeys-exists'],
        queryFn: async () => {
            try {
                const response = await api.get<PasskeysData>(
                    '/settings/passkeys/exists',
                    { timeout: 5000 }
                );
                return response.data;
            } catch (error: unknown) {
                if (!isAuthOrRateLimitStatus(error)) {
                    console.error('Error checking passkeys:', error);
                }
                return { exists: false };
            }
        },
        retry: (failureCount, error) => {
            if (isAuthOrRateLimitStatus(error)) {
                return false;
            }
            return failureCount < 1;
        },
        retryDelay: 1000,
        enabled: !isCheckingConnection && !isConnectionError,
    });

    const passwordEnabledData = statusData;
    const passwordLoginAllowed = passwordEnabledData?.passwordLoginAllowed !== false;
    const visitorUserEnabled = passwordEnabledData?.visitorUserEnabled !== false;
    const showVisitorTab = visitorUserEnabled && !!passwordEnabledData?.isVisitorPasswordSet;
    const passkeysExist = passkeysData?.exists || false;

    return {
        statusData,
        passwordEnabledData,
        passwordLoginAllowed,
        showVisitorTab,
        passkeysExist,
        isCheckingConnection,
        isConnectionError,
        retryConnection,
    };
};
