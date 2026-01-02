import { Box, CardContent, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Video } from '../../types';
import { formatRelativeDownloadTime } from '../../utils/formatUtils';
import { VideoCardCollectionInfo } from '../../utils/videoCardUtils';

interface VideoCardContentProps {
    video: Video;
    collectionInfo: VideoCardCollectionInfo;
    onAuthorClick: (e: React.MouseEvent) => void;
}

export const VideoCardContent: React.FC<VideoCardContentProps> = ({
    video,
    collectionInfo,
    onAuthorClick
}) => {
    const { t } = useLanguage();

    return (
        <CardContent sx={{ flexGrow: 1, p: 2, display: 'flex', flexDirection: 'column' }}>
            <Typography 
                gutterBottom 
                variant="subtitle1" 
                component="div" 
                sx={{ 
                    fontWeight: 600, 
                    lineHeight: 1.2, 
                    mb: 1, 
                    display: '-webkit-box', 
                    WebkitLineClamp: 2, 
                    WebkitBoxOrient: 'vertical', 
                    overflow: 'hidden' 
                }}
            >
                {collectionInfo.isFirstInAnyCollection ? (
                    <>
                        {collectionInfo.firstInCollectionNames[0]}
                        {collectionInfo.firstInCollectionNames.length > 1 && (
                            <Typography 
                                component="span" 
                                color="text.secondary" 
                                sx={{ fontSize: 'inherit' }}
                            >
                                {' '}+{collectionInfo.firstInCollectionNames.length - 1}
                            </Typography>
                        )}
                    </>
                ) : (
                    video.title
                )}
            </Typography>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 'auto', gap: 1 }}>
                <Typography
                    variant="body2"
                    color="text.secondary"
                    onClick={onAuthorClick}
                    sx={{
                        cursor: 'pointer',
                        '&:hover': { color: 'primary.main' },
                        fontWeight: 500,
                        flex: 1,
                        minWidth: 0, // Allows flex item to shrink below content size
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    }}
                >
                    {video.author}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <Typography variant="caption" color="text.secondary">
                        {formatRelativeDownloadTime(video.addedAt, video.date, t)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {video.viewCount || 0} {t('views')}
                    </Typography>
                </Box>
            </Box>
        </CardContent>
    );
};
