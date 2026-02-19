import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { api } from '../../../utils/apiClient';
import { Video } from '../../../types';

export const useVideoReDownload = () => {
    const [downloadingItems, setDownloadingItems] = useState<Set<string>>(new Set());
    const queryClient = useQueryClient();
    const { showSnackbar } = useSnackbar();
    const { t } = useLanguage();

    const handleReDownload = async (video: Video) => {
        if (!video.sourceUrl) {
            showSnackbar('No source URL available', 'error');
            return;
        }

        // Prevent duplicate downloads
        if (downloadingItems.has(video.sourceUrl)) {
            showSnackbar('Download already in progress', 'warning');
            return;
        }

        setDownloadingItems(prev => new Set(prev).add(video.sourceUrl));

        try {
            const response = await api.post('/download', {
                youtubeUrl: video.sourceUrl,
                forceDownload: true
            });

            if (response.data.downloadId) {
                showSnackbar(t('videoDownloading') || 'Video downloading');
                queryClient.invalidateQueries({ queryKey: ['downloadStatus'] });
            }
        } catch (error: unknown) {
            console.error('Error re-downloading video:', error);
            const axiosError = error as { response?: { data?: { error?: string } } };
            showSnackbar(axiosError.response?.data?.error || t('error'), 'error');
        } finally {
            setTimeout(() => {
                setDownloadingItems(prev => {
                    const next = new Set(prev);
                    next.delete(video.sourceUrl);
                    return next;
                });
            }, 1000);
        }
    };

    return { handleReDownload };
};
