import { Box, Rating, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';

interface VideoRatingProps {
    rating: number | undefined;
    viewCount: number | undefined;
    onRatingChange: (newRating: number) => Promise<void>;
}

const VideoRating: React.FC<VideoRatingProps> = ({ rating, viewCount, onRatingChange }) => {
    const { t } = useLanguage();

    const handleRatingChangeInternal = (_: React.SyntheticEvent, newValue: number | null) => {
        if (newValue) {
            onRatingChange(newValue);
        }
    };

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Rating
                value={rating || 0}
                onChange={handleRatingChangeInternal}
            />
            <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                {rating ? `` : t('rateThisVideo')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                {viewCount || 0} {t('views')}
            </Typography>
        </Box>
    );
};

export default VideoRating;

