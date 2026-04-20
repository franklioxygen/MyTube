import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { Settings } from '../types';
import { api } from '../utils/apiClient';
import { settingsQueryOptions } from '../utils/settingsQueries';

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
        ...settingsQueryOptions,
        // Only query when authenticated to avoid 401 errors
        enabled: isAuthenticated,
    });

    const autoPlay = settings?.defaultAutoPlay || false;
    const autoLoop = settings?.defaultAutoLoop || false;
    const subtitlesEnabled = settings?.subtitlesEnabled ?? true;
    const pauseOnFocusLoss = settings?.pauseOnFocusLoss || false;

    const playFromBeginning = settings?.playFromBeginning || false;

    // Subtitle preference mutation
    const subtitlePreferenceMutation = useMutation({
        mutationFn: async (enabled: boolean) => {
            const response = await api.patch('/settings', {
                subtitlesEnabled: enabled
            });
            return response.data;
        },
        onSuccess: (data) => {
            if (data.success) {
                queryClient.setQueryData(['settings'], (old: Settings | undefined) =>
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
            const response = await api.patch('/settings', {
                defaultAutoLoop: enabled
            });
            return response.data;
        },
        onSuccess: (data) => {
            if (data.success) {
                queryClient.setQueryData(['settings'], (old: Settings | undefined) =>
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
