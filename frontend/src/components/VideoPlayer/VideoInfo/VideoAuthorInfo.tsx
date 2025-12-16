import { Avatar, Box, Typography } from '@mui/material';
import React from 'react';

interface VideoAuthorInfoProps {
    author: string;
    date: string | undefined;
    onAuthorClick: () => void;
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

const VideoAuthorInfo: React.FC<VideoAuthorInfoProps> = ({ author, date, onAuthorClick }) => {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Avatar sx={{ bgcolor: 'primary.main', mr: 2 }}>
                {author ? author.charAt(0).toUpperCase() : 'A'}
            </Avatar>
            <Box>
                <Typography
                    variant="subtitle1"
                    fontWeight="bold"
                    onClick={onAuthorClick}
                    sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                >
                    {author}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    {formatDate(date)}
                </Typography>
            </Box>
        </Box>
    );
};

export default VideoAuthorInfo;

