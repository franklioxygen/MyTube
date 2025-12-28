import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useVideo } from '../contexts/VideoContext';
import { Video } from '../types';

const API_URL = import.meta.env.VITE_API_URL;

interface UseVideoMutationsProps {
    videoId: string | undefined;
    onDeleteSuccess?: () => void;
}

/**
 * Custom hook to manage all video-related API mutations
 */
export function useVideoMutations({ videoId, onDeleteSuccess }: UseVideoMutationsProps) {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const queryClient = useQueryClient();
    const { deleteVideo } = useVideo();

    // Rating mutation
    const ratingMutation = useMutation({
        mutationFn: async (newValue: number) => {
            await axios.post(`${API_URL}/videos/${videoId}/rate`, { rating: newValue });
            return newValue;
        },
        onSuccess: (newValue) => {
            queryClient.setQueryData(['video', videoId], (old: Video | undefined) => 
                old ? { ...old, rating: newValue } : old
            );
        }
    });

    // Title mutation
    const titleMutation = useMutation({
        mutationFn: async (newTitle: string) => {
            const response = await axios.put(`${API_URL}/videos/${videoId}`, { title: newTitle });
            return response.data;
        },
        onSuccess: (data, newTitle) => {
            if (data.success) {
                queryClient.setQueryData(['video', videoId], (old: Video | undefined) => 
                    old ? { ...old, title: newTitle } : old
                );
                showSnackbar(t('titleUpdated'));
            }
        },
        onError: () => {
            showSnackbar(t('titleUpdateFailed'), 'error');
        }
    });

    // Tags mutation
    const tagsMutation = useMutation({
        mutationFn: async (newTags: string[]) => {
            const response = await axios.put(`${API_URL}/videos/${videoId}`, { tags: newTags });
            return response.data;
        },
        onSuccess: (data, newTags) => {
            if (data.success) {
                queryClient.setQueryData(['video', videoId], (old: Video | undefined) => 
                    old ? { ...old, tags: newTags } : old
                );
            }
        },
        onError: () => {
            showSnackbar(t('error'), 'error');
        }
    });

    // Visibility mutation
    const visibilityMutation = useMutation({
        mutationFn: async (visibility: number) => {
            const response = await axios.put(`${API_URL}/videos/${videoId}`, { visibility });
            return response.data;
        },
        onSuccess: (data, visibility) => {
            if (data.success) {
                queryClient.setQueryData(['video', videoId], (old: Video | undefined) => 
                    old ? { ...old, visibility } : old
                );
                queryClient.setQueryData(['videos'], (old: Video[] | undefined) =>
                    old ? old.map(v => v.id === videoId ? { ...v, visibility } : v) : []
                );
                showSnackbar(visibility === 1 ? t('showVideo') : t('hideVideo'), 'success');
            }
        },
        onError: () => {
            showSnackbar(t('error'), 'error');
        }
    });

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: async (videoIdToDelete: string) => {
            return await deleteVideo(videoIdToDelete);
        },
        onSuccess: (result) => {
            if (result.success) {
                onDeleteSuccess?.();
            }
        }
    });

    return {
        ratingMutation,
        titleMutation,
        tagsMutation,
        visibilityMutation,
        deleteMutation
    };
}
