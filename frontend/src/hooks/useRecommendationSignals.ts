import { useQuery } from '@tanstack/react-query';
import { api } from '../utils/apiClient';
import { RecommendationSignals } from '../utils/recommendations';

interface UseRecommendationSignalsOptions {
    enabled?: boolean;
}

export const useRecommendationSignals = (
    options: UseRecommendationSignalsOptions = {}
) =>
    useQuery({
        queryKey: ['recommendations', 'signals'],
        queryFn: async (): Promise<RecommendationSignals | null> => {
            try {
                const response = await api.get('/recommendations/signals', {
                    validateStatus: (status) =>
                        (status >= 200 && status < 300) || status === 404,
                });
                if (response.status === 204 || response.status === 404) {
                    return null;
                }

                return response.data as RecommendationSignals;
            } catch {
                return null;
            }
        },
        enabled: options.enabled ?? true,
        staleTime: 6 * 60 * 60 * 1000,
        gcTime: 6 * 60 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: false,
    });
