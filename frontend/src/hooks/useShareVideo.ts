import { useSnackbar } from '../contexts/SnackbarContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Video } from '../types';

export const useShareVideo = (video: Video) => {
    const { showSnackbar } = useSnackbar();
    const { t } = useLanguage();

    const handleShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: video.title,
                    text: `Check out this video: ${video.title}`,
                    url: window.location.href,
                });
            } catch (error) {
                console.error('Error sharing:', error);
            }
        } else {
            const url = window.location.href;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                try {
                    await navigator.clipboard.writeText(url);
                    showSnackbar(t('linkCopied'), 'success');
                } catch (error) {
                    console.error('Error copying to clipboard:', error);
                    showSnackbar(t('copyFailed'), 'error');
                }
            } else {
                // Fallback for secure context requirement or unsupported browsers
                const textArea = document.createElement("textarea");
                textArea.value = url;
                textArea.style.position = "fixed";  // Avoid scrolling to bottom
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
                } catch (err) {
                    console.error('Fallback: Unable to copy', err);
                    showSnackbar(t('copyFailed'), 'error');
                }

                document.body.removeChild(textArea);
            }
        }
    };

    return { handleShare };
};

