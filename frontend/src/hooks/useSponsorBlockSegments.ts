import { useQuery } from '@tanstack/react-query';
import type { SponsorBlockResponse } from '../types';
import { api } from '../utils/apiClient';

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
        staleTime: 10 * 60 * 1000,
    });
}
