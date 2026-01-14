import { CalendarToday, Download, Folder, HighQuality, Link as LinkIcon, VideoLibrary } from '@mui/icons-material';
import { Box, Typography, useTheme } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { useCloudStorageUrl } from '../../../hooks/useCloudStorageUrl';
import { Collection, Video } from '../../../types';

import { getBackendUrl } from '../../../utils/apiUrl';

const BACKEND_URL = getBackendUrl();

interface VideoMetadataProps {
    video: Video;
    videoCollections: Collection[];
    onCollectionClick: (id: string) => void;
    videoResolution: string | null;
}

const VideoMetadata: React.FC<VideoMetadataProps> = ({
    video,
    videoCollections,
    onCollectionClick,
    videoResolution
}) => {
    const theme = useTheme();
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const videoUrl = useCloudStorageUrl(video.videoPath, 'video');

    const fallbackCopy = (text: string) => {
        try {
            const textArea = document.createElement("textarea");
            textArea.value = text;

            // Ensure strictly hidden but selectable
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            textArea.style.top = "0";
            textArea.style.opacity = "0";
            textArea.setAttribute('readonly', '');

            document.body.appendChild(textArea);

            // iOS-specific selection
            if (navigator.userAgent.match(/ipad|iphone/i)) {
                const range = document.createRange();
                range.selectNodeContents(textArea);
                const selection = window.getSelection();
                if (selection) {
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
                textArea.setSelectionRange(0, 999999);
            } else {
                textArea.select();
            }

            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);

            if (successful) {
                showSnackbar(t('linkCopied'), 'success');
            } else {
                throw new Error('execCommand returned false');
            }
        } catch (err) {
            console.error('Fallback copy failed:', err);
            // Final fallback: show URL in snackbar/alert for manual copy
            showSnackbar(`${t('copyFailed')}: ${text}`, 'error');
        }
    };

    const handleCopyLink = async (e: React.MouseEvent, url: string) => {
        e.preventDefault();
        
        // 1. Try modern Clipboard API (if secure context)
        // Wrap everything in try-catch since accessing navigator.clipboard might throw
        try {
            // Check if clipboard API is available
            const hasClipboardAPI = typeof navigator !== 'undefined' && 
                                    navigator.clipboard && 
                                    typeof window !== 'undefined' && 
                                    window.isSecureContext;
            
            if (hasClipboardAPI && navigator.clipboard.writeText) {
                try {
                    await navigator.clipboard.writeText(url);
                    showSnackbar(t('linkCopied'), 'success');
                    return;
                } catch (error) {
                    console.warn('Clipboard writeText failed:', error);
                    // If writeText fails, try fallback
                    fallbackCopy(url);
                    return;
                }
            }
        } catch (error) {
            // If accessing navigator.clipboard throws, use fallback
            console.warn('Clipboard API not available:', error);
        }

        // 2. Fallback for non-secure context or older browsers
        fallbackCopy(url);
    };

    return (
        <Box sx={{ bgcolor: 'background.paper', p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 3, rowGap: 1 }}>
                {video.sourceUrl && (
                    <Typography
                        variant="body2"
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            fontSize: { xs: '0.75rem', sm: '0.875rem' }
                        }}
                    >
                        <a
                            href={video.sourceUrl}
                            onClick={(e) => handleCopyLink(e, video.sourceUrl!)}
                            style={{ color: theme.palette.primary.main, textDecoration: 'none', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                        >
                            <LinkIcon sx={{ mr: 0.5, fontSize: { xs: '0.875rem', sm: '1rem' } }} />
                            <strong>{t('originalLink')}</strong>
                        </a>
                    </Typography>
                )}
                {(videoUrl || (video.videoPath && !video.videoPath.startsWith("cloud:"))) && (
                    <Typography
                        variant="body2"
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            fontSize: { xs: '0.75rem', sm: '0.875rem' }
                        }}
                    >
                        <a href={videoUrl || (video.videoPath && (video.videoPath.startsWith("http://") || video.videoPath.startsWith("https://"))
                            ? video.videoPath
                            : `${BACKEND_URL}${video.videoPath}`)} download style={{ color: theme.palette.primary.main, textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
                            <Download sx={{ mr: 0.5, fontSize: { xs: '0.875rem', sm: '1rem' } }} />
                            <strong>{t('download')}</strong>
                        </a>
                    </Typography>
                )}
                {videoCollections.length > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                        {videoCollections.map((c, index) => (
                            <React.Fragment key={c.id}>
                                <Box
                                    component="span"
                                    onClick={() => onCollectionClick(c.id)}
                                    sx={{
                                        cursor: 'pointer',
                                        color: 'primary.main',
                                        fontWeight: 'bold',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        fontSize: { xs: '0.75rem', sm: '0.875rem' }
                                    }}
                                >
                                    <Folder sx={{ mr: 0.5, fontSize: { xs: '0.875rem', sm: '1rem' } }} />
                                    {c.name}
                                </Box>
                                {index < videoCollections.length - 1 ? <span style={{ marginRight: '4px' }}>, </span> : ''}
                            </React.Fragment>
                        ))}
                    </Box>
                )}
                <Typography
                    variant="body2"
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        fontSize: { xs: '0.75rem', sm: '0.875rem' }
                    }}
                >
                    <VideoLibrary sx={{ mr: 0.5, fontSize: { xs: '0.875rem', sm: '1rem' } }} />
                    {video.source ? video.source.charAt(0).toUpperCase() + video.source.slice(1) : 'Unknown'}
                </Typography>
                {video.addedAt && (
                    <Typography
                        variant="body2"
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            fontSize: { xs: '0.75rem', sm: '0.875rem' }
                        }}
                    >
                        <CalendarToday sx={{ mr: 0.5, fontSize: { xs: '0.875rem', sm: '1rem' } }} />
                        {new Date(video.addedAt).toISOString().split('T')[0]}
                    </Typography>
                )}
                {videoResolution && (
                    <Typography
                        variant="body2"
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            fontSize: { xs: '0.75rem', sm: '0.875rem' }
                        }}
                    >
                        <HighQuality sx={{ mr: 0.5, fontSize: { xs: '0.875rem', sm: '1rem' } }} />
                        {videoResolution && `${videoResolution}`}
                    </Typography>
                )}
            </Box>
        </Box>
    );
};

export default VideoMetadata;

