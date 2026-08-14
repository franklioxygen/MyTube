import { useThumbnailCandidates } from '../../hooks/useThumbnailCandidates';
import type { Video } from '../../types';

/**
 * Favorite rails render covers mostly as CSS backgrounds, which have no
 * load-error event to walk a fallback chain with, so they take the best
 * candidate only. The candidate order itself comes from the shared resolver.
 */
export const useFavoriteThumbnail = (video?: Video): string =>
    useThumbnailCandidates(video).src;
