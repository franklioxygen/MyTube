import { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useVideo } from '../contexts/VideoContext';
import { Video } from '../types';
import { getAvailablePlayers, getPlayerUrl } from '../utils/playerUtils';

interface UsePlayerSelectionProps {
    video: Video;
    getVideoUrl: () => Promise<string>;
}

/**
 * Hook to manage player selection menu and external player opening
 */
export const usePlayerSelection = ({ video, getVideoUrl }: UsePlayerSelectionProps) => {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const { incrementView } = useVideo();
    const [playerMenuAnchor, setPlayerMenuAnchor] = useState<null | HTMLElement>(null);

    const handlePlayerMenuClose = () => {
        setPlayerMenuAnchor(null);
    };

    const copyVideoUrlToClipboard = (resolvedVideoUrl: string) => {
        const fallbackCopy = () => {
            const textArea = document.createElement("textarea");
            textArea.value = resolvedVideoUrl;
            textArea.style.position = "fixed";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    showSnackbar(t('linkCopied'), 'success');
                } else {
                    showSnackbar(t('copyFailed'), 'error');
                }
            } catch {
                showSnackbar(t('copyFailed'), 'error');
            }
            document.body.removeChild(textArea);
        };

        const clipboard = navigator.clipboard;
        if (!clipboard?.writeText) {
            fallbackCopy();
            return;
        }

        void clipboard.writeText(resolvedVideoUrl).then(() => {
            showSnackbar(t('linkCopied'), 'success');
        }).catch(() => {
            fallbackCopy();
        });
    };

    const handlePlayerSelect = async (player: string) => {
        const resolvedVideoUrl = await getVideoUrl();

        if (!resolvedVideoUrl) {
            showSnackbar(t('error') || 'Video URL not available', 'error');
            handlePlayerMenuClose();
            return;
        }

        // Increment view count since we can't track watch time in external players
        await incrementView(video.id);

        try {
            let playerUrl = '';

            if (player === 'copy') {
                // Copy URL to clipboard
                copyVideoUrlToClipboard(resolvedVideoUrl);
                handlePlayerMenuClose();
                return;
            } else {
                playerUrl = getPlayerUrl(player, resolvedVideoUrl);
            }

            // Try to open the player URL using a hidden anchor element
            // This prevents navigation away from the page
            if (playerUrl) {
                const link = document.createElement('a');
                link.href = playerUrl;
                link.style.display = 'none';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                // Show a message after a short delay
                setTimeout(() => {
                    showSnackbar(t('openInExternalPlayer'), 'info');
                }, 500);
            }

        } catch (error) {
            console.error('Error opening player:', error);
            showSnackbar(t('copyFailed'), 'error');
        }

        handlePlayerMenuClose();
    };

    return {
        playerMenuAnchor,
        setPlayerMenuAnchor,
        handlePlayerMenuClose,
        handlePlayerSelect,
        getAvailablePlayers
    };
};
