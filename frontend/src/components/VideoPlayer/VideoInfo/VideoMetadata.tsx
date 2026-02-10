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

    const fallbackCopy = (text: string): boolean => {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.setAttribute('aria-hidden', 'true');

        // Keep in viewport for mobile Safari selection reliability.
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.width = '1px';
        textArea.style.height = '1px';
        textArea.style.padding = '0';
        textArea.style.border = '0';
        textArea.style.outline = '0';
        textArea.style.opacity = '0';
        textArea.style.pointerEvents = 'none';
        textArea.style.zIndex = '-1';

        document.body.appendChild(textArea);

        try {
            textArea.focus({ preventScroll: true });
            textArea.select();
            textArea.setSelectionRange(0, text.length);

            const successful = document.execCommand('copy');
            const selectedLength = (textArea.selectionEnd ?? 0) - (textArea.selectionStart ?? 0);

            return successful && selectedLength > 0;
        } catch (error) {
            console.warn('Fallback copy failed:', error);
            return false;
        } finally {
            document.body.removeChild(textArea);
        }
    };

    const handleCopyLink = async (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
        e.preventDefault();
        e.stopPropagation();

        const value = url.trim();
        if (!value) {
            showSnackbar(t('copyFailed'), 'error');
            return;
        }

        // 1. Try modern Clipboard API (if secure context)
        try {
            if (
                typeof navigator !== 'undefined' &&
                typeof window !== 'undefined' &&
                window.isSecureContext &&
                navigator.clipboard?.writeText
            ) {
                await navigator.clipboard.writeText(value);
                showSnackbar(t('linkCopied'), 'success');
                return;
            }
        } catch (error) {
            console.warn('Clipboard writeText failed:', error);
        }

        // 2. Fallback for non-secure context or older browsers
        if (fallbackCopy(value)) {
            showSnackbar(t('linkCopied'), 'success');
        } else {
            showSnackbar(`${t('copyFailed')}: ${value}`, 'error');
        }
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
