import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';

const API_URL = import.meta.env.VITE_API_URL;

/**
 * Custom hook to manage video player settings (subtitles, loop, auto-play)
 */
export function useVideoPlayerSettings() {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const queryClient = useQueryClient();

    // Fetch settings
    const { data: settings } = useQuery({
        queryKey: ['settings'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings`);
            return response.data;
        }
    });

    const autoPlay = settings?.defaultAutoPlay || false;
    const autoLoop = settings?.defaultAutoLoop || false;
    const subtitlesEnabled = settings?.subtitlesEnabled ?? true;
    const pauseOnFocusLoss = settings?.pauseOnFocusLoss || false;

    // Subtitle preference mutation
    const subtitlePreferenceMutation = useMutation({
        mutationFn: async (enabled: boolean) => {
            const response = await axios.post(`${API_URL}/settings`, { 
                ...settings, 
                subtitlesEnabled: enabled 
            });
            return response.data;
        },
        onSuccess: (data) => {
            if (data.success) {
                queryClient.setQueryData(['settings'], (old: any) => 
                    old ? { ...old, subtitlesEnabled: data.settings.subtitlesEnabled } : old
                );
            }
        },
        onError: () => {
            showSnackbar(t('error'), 'error');
        }
    });

    // Loop preference mutation
    const loopPreferenceMutation = useMutation({
        mutationFn: async (enabled: boolean) => {
            const response = await axios.post(`${API_URL}/settings`, { 
                ...settings, 
                defaultAutoLoop: enabled 
            });
            return response.data;
        },
        onSuccess: (data) => {
            if (data.success) {
                queryClient.setQueryData(['settings'], (old: any) => 
                    old ? { ...old, defaultAutoLoop: data.settings.defaultAutoLoop } : old
                );
            }
        },
        onError: () => {
            showSnackbar(t('error'), 'error');
        }
    });

    const handleSubtitlesToggle = async (enabled: boolean) => {
        await subtitlePreferenceMutation.mutateAsync(enabled);
    };

    const handleLoopToggle = async (enabled: boolean) => {
        await loopPreferenceMutation.mutateAsync(enabled);
    };

    const availableTags = Array.isArray(settings?.tags) ? settings.tags : [];

    return {
        autoPlay,
        autoLoop,
        subtitlesEnabled,
        pauseOnFocusLoss,
        availableTags,
        handleSubtitlesToggle,
        handleLoopToggle
    };
}
