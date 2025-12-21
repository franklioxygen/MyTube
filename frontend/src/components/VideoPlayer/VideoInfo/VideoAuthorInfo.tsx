import { Notifications, NotificationsActive } from '@mui/icons-material';
import { Avatar, Box, IconButton, Tooltip, Typography, useMediaQuery } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useVisitorMode } from '../../../contexts/VisitorModeContext';

interface VideoAuthorInfoProps {
    author: string;
    date: string | undefined;
    onAuthorClick: () => void;
    source?: 'youtube' | 'bilibili' | 'local' | 'missav';
    isSubscribed?: boolean;
    onSubscribe?: () => void;
    onUnsubscribe?: () => void;
}

// Format the date (assuming format YYYYMMDD from youtube-dl)
const formatDate = (dateString?: string) => {
    if (!dateString || dateString.length !== 8) {
        return 'Unknown date';
    }

    const year = dateString.substring(0, 4);
    const month = dateString.substring(4, 6);
    const day = dateString.substring(6, 8);

    return `${year}-${month}-${day}`;
};

const VideoAuthorInfo: React.FC<VideoAuthorInfoProps> = ({ 
    author, 
    date, 
    onAuthorClick,
    source,
    isSubscribed,
    onSubscribe,
    onUnsubscribe
}) => {
    const { t } = useLanguage();
    const { visitorMode } = useVisitorMode();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    const showSubscribeButton = (source === 'youtube' || source === 'bilibili') && !visitorMode;

    const handleSubscribeClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isSubscribed && onUnsubscribe) {
            onUnsubscribe();
        } else if (!isSubscribed && onSubscribe) {
            onSubscribe();
        }
    };

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Avatar 
                sx={{ 
                    bgcolor: 'primary.main', 
                    mr: { xs: 1, sm: 2 },
                    cursor: 'pointer',
                    '&:hover': { opacity: 0.8 }
                }}
                onClick={onAuthorClick}
            >
                {author ? author.charAt(0).toUpperCase() : 'A'}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                    variant="subtitle1"
                    fontWeight="bold"
                    onClick={onAuthorClick}
                    sx={{ 
                        cursor: 'pointer', 
                        '&:hover': { color: 'primary.main' },
                        maxWidth: { xs: '200px', sm: 'none' },
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    }}
                >
                    {author}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    {formatDate(date)}
                </Typography>
            </Box>
            {showSubscribeButton && (
                <Tooltip title={isSubscribed ? t('unsubscribe') : t('subscribe')} disableHoverListener={isTouch}>
                    <IconButton
                        size="small"
                        onClick={handleSubscribeClick}
                        color={isSubscribed ? 'primary' : 'default'}
                        sx={{ ml: { xs: 1, sm: 1 } }}
                    >
                        {isSubscribed ? <NotificationsActive /> : <Notifications />}
                    </IconButton>
                </Tooltip>
            )}
        </Box>
    );
};

export default VideoAuthorInfo;

