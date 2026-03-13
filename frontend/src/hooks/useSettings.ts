import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { Settings } from '../types';
import { settingsQueryOptions } from '../utils/settingsQueries';

export const useSettings = () => {
    const { isAuthenticated } = useAuth();
    
    return useQuery<Settings>({
        ...settingsQueryOptions,
        enabled: isAuthenticated,
    });
};
