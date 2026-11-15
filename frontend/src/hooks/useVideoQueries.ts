import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { api } from '../utils/apiClient';
import { Video } from '../types';
import { buildAuthorAvatarPathMap, withCanonicalAuthorAvatar } from '../utils/authorAvatar';
import { isRemoteVideo } from '../utils/libraryItem';
import { defaultQueryConfig } from '../utils/queryConfig';

/**
 * A detail records which opening of the video requested it. The field
 * survives cache updates (progress, edits), so only a request completed during
 * this opening marks the detail as fresh; a timestamp or flag would also be
 * set by those updates.
 */
const FETCHED_FOR_OPENING = 'fetchedForOpening';

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
    // A new key whenever the player mounts or switches to a video: the
    // instance id is unique per mount, and the count per switch within it.
    const instance = useId();
    const [switches, setSwitches] = useState({ videoId, count: 0 });
    let current = switches;
    if (switches.videoId !== videoId) {
        current = { videoId, count: switches.count + 1 };
        setSwitches(current);
    }
    const opening = `${instance}:${current.count}`;

    const { data: rawVideo, isLoading: loading, error } = useQuery({
        queryKey: ['video', videoId],
        queryFn: async () => {
            const response = await api.get(`/videos/${videoId}`);
            return { ...response.data, [FETCHED_FOR_OPENING]: opening };
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
        /**
         * True once a detail request made during this opening has succeeded:
         * not for the list row, a detail cached from an earlier opening, or a
         * cache update such as a progress flush.
         */
        isDetailFresh: rawVideo?.[FETCHED_FOR_OPENING] === opening,
        error,
        comments,
        loadingComments
    };
}
