import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../utils/apiClient';
import { Video } from '../types';
import { buildAuthorAvatarPathMap, withCanonicalAuthorAvatar } from '../utils/authorAvatar';
import { isRemoteVideo } from '../utils/libraryItem';
import { defaultQueryConfig } from '../utils/queryConfig';

interface UseVideoQueriesProps {
    videoId: string | undefined;
    videos: Video[];
    showComments: boolean;
}

/**
 * Custom hook to manage all video-related data fetching
 */
export function useVideoQueries({ videoId, videos, showComments }: UseVideoQueriesProps) {
    const avatarPathByKey = useMemo(
        () => buildAuthorAvatarPathMap(videos),
        [videos]
    );

    // Fetch video details. The list row from VideoContext renders instantly as
    // placeholder, but the full row must still be fetched: the list endpoint
    // omits description/subtitles (heavy columns), so seeding it as
    // initialData would let the global staleTime suppress the fetch and leave
    // the player without them.
    const { data: rawVideo, isLoading: loading, isFetchedAfterMount, error } = useQuery({
        queryKey: ['video', videoId],
        queryFn: async () => {
            const response = await api.get(`/videos/${videoId}`);
            return response.data;
        },
        placeholderData: () => {
            return videos.find(v => v.id === videoId);
        },
        // A cached remote detail may predate its peer going offline or
        // changing the asset, so it is always stale: re-read when the player
        // mounts and when it switches to the video (the route keeps the player
        // mounted across /video/:id changes, where refetchOnMount never runs).
        staleTime: (query) =>
            isRemoteVideo(query.state.data as Video | undefined) ? 0 : defaultQueryConfig.staleTime,
        enabled: !!videoId,
        retry: false
    });
    const video = useMemo(
        () => rawVideo ? withCanonicalAuthorAvatar(rawVideo, avatarPathByKey) : rawVideo,
        [avatarPathByKey, rawVideo]
    );

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
        /** True once this visit has fetched the detail (not list or cached data). */
        isFetchedAfterMount,
        error,
        comments,
        loadingComments
    };
}
