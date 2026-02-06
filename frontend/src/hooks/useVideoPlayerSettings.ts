import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { getApiUrl } from '../utils/apiUrl';

const API_URL = getApiUrl();

/**
 * Custom hook to manage video player settings (subtitles, loop, auto-play)
 */
export function useVideoPlayerSettings() {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();

    // Fetch settings
    const { data: settings } = useQuery({
        queryKey: ['settings'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings`);
            return response.data;
        },
        // Only query when authenticated to avoid 401 errors
        enabled: isAuthenticated,
        retry: (failureCount, error: any) => {
            // Don't retry on 401 errors (unauthorized) - user is not authenticated
            if (error?.response?.status === 401) {
                return false;
            }
            // Retry other errors up to 3 times
            return failureCount < 3;
        },
    });

    const autoPlay = settings?.defaultAutoPlay || false;
    const autoLoop = settings?.defaultAutoLoop || false;
    const subtitlesEnabled = settings?.subtitlesEnabled ?? true;
    const pauseOnFocusLoss = settings?.pauseOnFocusLoss || false;

    const playFromBeginning = settings?.playFromBeginning || false;

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
        playFromBeginning,
        availableTags,
        handleSubtitlesToggle,
        handleLoopToggle
    };
}
