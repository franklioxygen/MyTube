import { Box, Rating, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';

interface VideoRatingProps {
    rating: number | undefined;
    viewCount: number | undefined;
    /** Omitted when rating is not possible here; the rating is then shown read-only. */
    onRatingChange?: (newRating: number) => Promise<void>;
    showViewCount?: boolean;
}

const VideoRating: React.FC<VideoRatingProps> = ({ rating, viewCount, onRatingChange, showViewCount = true }) => {
    const { t } = useLanguage();

    const handleRatingChangeInternal = (_: React.SyntheticEvent, newValue: number | null) => {
        if (newValue && onRatingChange) {
            onRatingChange(newValue);
        }
    };

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Rating
                value={rating || 0}
                onChange={handleRatingChangeInternal}
                readOnly={!onRatingChange}
            />
            {onRatingChange && (
                <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                    {rating ? `` : t('rateThisVideo')}
                </Typography>
            )}
            {showViewCount && (
                <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                    {viewCount || 0} {t('views')}
                </Typography>
            )}
        </Box>
    );
};

export default VideoRating;

