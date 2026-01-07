import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL;

/**
 * Hook to prefetch video details when user interacts with a video card
 */
export const useVideoPrefetch = (videoId: string) => {
    const queryClient = useQueryClient();

    const prefetchVideo = () => {
        queryClient.prefetchQuery({
            queryKey: ['video', videoId],
            queryFn: async () => {
                const response = await axios.get(`${API_URL}/videos/${videoId}`);
                return response.data;
            },
            staleTime: 1000 * 60 * 5, // Consider data fresh for 5 minutes
        });
    };

    return { prefetchVideo };
};
