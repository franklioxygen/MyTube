import { useQuery } from '@tanstack/react-query';
import { Settings } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../utils/apiClient';
import { stableQueryConfig } from '../utils/queryConfig';

export const useSettings = () => {
    const { isAuthenticated } = useAuth();
    
    return useQuery<Settings>({
        queryKey: ['settings'],
        queryFn: async () => {
            const response = await api.get('/settings');
            return response.data;
        },
        ...stableQueryConfig,
        // Only query when authenticated to avoid 401 errors on login page
        enabled: isAuthenticated,
        retry: (failureCount, error: any) => {
            // Don't retry on 401 errors (unauthorized) - user is not authenticated
            if (error?.response?.status === 401) {
                return false;
            }
            // Retry other errors up to 3 times
            return failureCount < 3;
        },
    });
};
