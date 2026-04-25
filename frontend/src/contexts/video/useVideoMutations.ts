import { useMutation, type QueryClient } from '@tanstack/react-query';
import { Video } from '../../types';
import { api } from '../../utils/apiClient';
import type { TranslateFn } from '../../utils/translateOrFallback';

interface UseVideoMutationsArgs {
    queryClient: QueryClient;
    showSnackbar: (message: string) => void;
    t: TranslateFn;
}

const updateVideoThumbnailInCache = (
    videos: Video[] | undefined,
    id: string,
    thumbnailUrl: unknown
): Video[] => {
    if (!videos) return [];

    return videos.map(video => {
        if (video.id !== id) return video;
        const thumbnailPath = typeof thumbnailUrl === 'string'
            ? thumbnailUrl.split('?')[0]
            : thumbnailUrl;
        return { ...video, thumbnailUrl, thumbnailPath };
    });
};

export const useVideoMutations = ({
    queryClient,
    showSnackbar,
    t,
}: UseVideoMutationsArgs) => {
    const deleteVideoMutation = useMutation({
        mutationFn: async ({ id }: { id: string; options?: { showSnackbar?: boolean } }) => {
            await api.delete(`/videos/${id}`);
            return id;
        },
        onSuccess: (id, variables) => {
            queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                old ? old.filter(video => video.id !== id) : []
            );
            if (variables.options?.showSnackbar !== false) {
                showSnackbar(t('videoRemovedSuccessfully'));
            }
        },
        onError: (error) => {
            console.error('Error deleting video:', error);
        }
    });

    const deleteVideo = async (id: string, options?: { showSnackbar?: boolean }) => {
        try {
            await deleteVideoMutation.mutateAsync({ id, options });
            return { success: true };
        } catch {
            return { success: false, error: t('failedToDeleteVideo') };
        }
    };

    const deleteVideos = async (ids: string[]) => {
        try {
            let successCount = 0;
            let failCount = 0;

            for (const id of ids) {
                try {
                    await deleteVideoMutation.mutateAsync({ id, options: { showSnackbar: false } });
                    successCount++;
                } catch (error) {
                    console.error(`Failed to delete video ${id}:`, error);
                    failCount++;
                }
            }

            if (failCount === 0) {
                showSnackbar(t('deleteFilteredVideosSuccess', { count: successCount }));
                return { success: true };
            }

            showSnackbar(`${t('deleteFilteredVideosSuccess', { count: successCount })} (${failCount} failed)`);
            return { success: false };
        } catch {
            return { success: false, error: t('failedToDeleteVideo') };
        }
    };

    const refreshThumbnailMutation = useMutation({
        mutationFn: async (id: string) => {
            const response = await api.post(`/videos/${id}/refresh-thumbnail`);
            return { id, data: response.data };
        },
        onSuccess: ({ id, data }) => {
            if (data.success) {
                queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                    updateVideoThumbnailInCache(old, id, data.thumbnailUrl)
                );
                showSnackbar(t('thumbnailRefreshed'));
            }
        },
        onError: (error) => {
            console.error('Error refreshing thumbnail:', error);
        }
    });

    const refreshThumbnail = async (id: string) => {
        try {
            const result = await refreshThumbnailMutation.mutateAsync(id);
            if (result.data.success) {
                return { success: true };
            }
            return { success: false, error: t('thumbnailRefreshFailed') };
        } catch {
            return { success: false, error: t('thumbnailRefreshFailed') };
        }
    };

    const uploadThumbnailMutation = useMutation({
        mutationFn: async ({ id, file }: { id: string; file: File }) => {
            const formData = new FormData();
            formData.append('thumbnail', file);
            const response = await api.post(`/videos/${id}/upload-thumbnail`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            return { id, data: response.data };
        },
        onSuccess: ({ id, data }) => {
            if (data.success) {
                queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                    updateVideoThumbnailInCache(old, id, data.thumbnailUrl)
                );
                showSnackbar(t('thumbnailUploaded') || 'Thumbnail uploaded');
            }
        },
        onError: (error) => {
            console.error('Error uploading thumbnail:', error);
        }
    });

    const uploadThumbnail = async (id: string, file: File): Promise<void> => {
        await uploadThumbnailMutation.mutateAsync({ id, file });
    };

    const updateVideoMutation = useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: Partial<Video> }) => {
            const response = await api.put(`/videos/${id}`, updates);
            return { id, updates, data: response.data };
        },
        onSuccess: ({ id, updates, data }) => {
            if (data.success) {
                queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                    old ? old.map(video =>
                        video.id === id ? { ...video, ...updates } : video
                    ) : []
                );
                queryClient.setQueryData(['video', id], (old: Video | undefined) =>
                    old ? { ...old, ...updates } : old
                );
                showSnackbar(t('videoUpdated'));
            }
        },
        onError: (error) => {
            console.error('Error updating video:', error);
        }
    });

    const updateVideo = async (id: string, updates: Partial<Video>) => {
        try {
            const result = await updateVideoMutation.mutateAsync({ id, updates });
            if (result.data.success) {
                return { success: true };
            }
            return { success: false, error: t('videoUpdateFailed') };
        } catch {
            return { success: false, error: t('videoUpdateFailed') };
        }
    };

    const incrementView = async (id: string) => {
        try {
            const res = await api.post(`/videos/${id}/view`);
            if (res.data.success) {
                const lastPlayedAt = Date.now();
                queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                    old ? old.map(video =>
                        video.id === id
                            ? { ...video, viewCount: res.data.viewCount, lastPlayedAt }
                            : video
                    ) : []
                );
                queryClient.setQueryData(['video', id], (old: Video | undefined) =>
                    old ? { ...old, viewCount: res.data.viewCount, lastPlayedAt } : old
                );
                return { success: true };
            }
            return { success: false, error: 'Failed to increment view' };
        } catch (error) {
            console.error('Error incrementing view count:', error);
            return { success: false, error: 'Failed to increment view' };
        }
    };

    return {
        deleteVideo,
        deleteVideos,
        refreshThumbnail,
        uploadThumbnail,
        updateVideo,
        incrementView,
    };
};
