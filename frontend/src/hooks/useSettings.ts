import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Settings } from '../types';
import { getApiUrl } from '../utils/apiUrl';
import { useAuth } from '../contexts/AuthContext';

const API_URL = getApiUrl();

export const useSettings = () => {
    const { isAuthenticated } = useAuth();
    
    return useQuery<Settings>({
        queryKey: ['settings'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings`);
            return response.data;
        },
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
