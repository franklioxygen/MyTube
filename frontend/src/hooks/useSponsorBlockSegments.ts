import { useQuery } from '@tanstack/react-query';
import type { SponsorBlockResponse } from '../types';
import { api } from '../utils/apiClient';

const STALE_MS = 10 * 60 * 1000;
/**
 * "unavailable" means the server could not ask SponsorBlock just then (too
 * many lookups at once, or backing off upstream), not that the video has no
 * segments, so it is asked again while the player stays open.
 */
export const UNAVAILABLE_RETRY_MS = 30 * 1000;

const isUnavailable = (data: SponsorBlockResponse | undefined) => data?.status === 'unavailable';

/**
 * SponsorBlock segments for one library video (issue #555), or nothing while
 * `videoId` is undefined. Playback never waits for this; a failed lookup just
 * means nothing is skipped.
 */
export function useSponsorBlockSegments(videoId: string | undefined) {
    return useQuery({
        queryKey: ['sponsorblock', videoId],
        queryFn: async () =>
            (await api.get<SponsorBlockResponse>(`/videos/${encodeURIComponent(videoId!)}/sponsorblock`)).data,
        enabled: Boolean(videoId),
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: (query) => (isUnavailable(query.state.data) ? 0 : STALE_MS),
        refetchInterval: (query) => (isUnavailable(query.state.data) ? UNAVAILABLE_RETRY_MS : false),
    });
}
