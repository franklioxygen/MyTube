import { useQuery } from '@tanstack/react-query';
import { api } from '../utils/apiClient';
import { Video } from '../types';

interface UseVideoQueriesProps {
    videoId: string | undefined;
    videos: Video[];
    showComments: boolean;
}

/**
 * Custom hook to manage all video-related data fetching
 */
export function useVideoQueries({ videoId, videos, showComments }: UseVideoQueriesProps) {
    // Fetch video details. The list row from VideoContext renders instantly as
    // placeholder, but the full row must still be fetched: the list endpoint
    // omits description/subtitles (heavy columns), so seeding it as
    // initialData would let the global staleTime suppress the fetch and leave
    // the player without them.
    const { data: video, isLoading: loading, error } = useQuery({
        queryKey: ['video', videoId],
        queryFn: async () => {
            const response = await api.get(`/videos/${videoId}`);
            return response.data;
        },
        placeholderData: () => {
            return videos.find(v => v.id === videoId);
        },
        enabled: !!videoId,
        retry: false
    });

    // Fetch comments
    const { data: comments = [], isLoading: loadingComments } = useQuery({
        queryKey: ['comments', videoId],
        queryFn: async () => {
            const response = await api.get(`/videos/${videoId}/comments`);
            return response.data;
        },
        enabled: showComments && !!videoId
    });

    return {
        video,
        loading,
        error,
        comments,
        loadingComments
    };
}
