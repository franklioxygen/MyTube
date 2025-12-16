import { ExpandLess, ExpandMore } from '@mui/icons-material';
import { Box, Button, Typography } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';

interface VideoDescriptionProps {
    description: string | undefined;
}

const VideoDescription: React.FC<VideoDescriptionProps> = ({ description }) => {
    const { t } = useLanguage();
    const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
    const [showDescriptionExpandButton, setShowDescriptionExpandButton] = useState(false);
    const descriptionRef = useRef<HTMLParagraphElement>(null);

    useEffect(() => {
        const checkDescriptionOverflow = () => {
            const element = descriptionRef.current;
            if (element && !isDescriptionExpanded) {
                setShowDescriptionExpandButton(element.scrollHeight > element.clientHeight);
            }
        };

        checkDescriptionOverflow();
        window.addEventListener('resize', checkDescriptionOverflow);
        return () => window.removeEventListener('resize', checkDescriptionOverflow);
    }, [description, isDescriptionExpanded]);

    if (!description) {
        return null;
    }

    return (
        <Box sx={{ mt: 2 }}>
            <Typography
                ref={descriptionRef}
                variant="body2"
                color="text.primary"
                sx={{
                    whiteSpace: 'pre-wrap',
                    display: '-webkit-box',
                    overflow: 'hidden',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: isDescriptionExpanded ? 'unset' : 3,
                }}
            >
                {description}
            </Typography>
            {showDescriptionExpandButton && (
                <Button
                    size="small"
                    onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                    startIcon={isDescriptionExpanded ? <ExpandLess /> : <ExpandMore />}
                    sx={{ mt: 0.5, p: 0, minWidth: 'auto', textTransform: 'none' }}
                >
                    {isDescriptionExpanded ? t('collapse') : t('expand')}
                </Button>
            )}
        </Box>
    );
};

export default VideoDescription;

