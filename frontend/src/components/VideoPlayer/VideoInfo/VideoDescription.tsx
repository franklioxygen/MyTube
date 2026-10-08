import { ExpandLess, ExpandMore } from '@mui/icons-material';
import { Box, Button, Link, Typography } from '@mui/material';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { splitDescriptionTimestamps } from '../../../utils/descriptionTimestamps';
import { parseDuration } from '../../../utils/formatUtils';

interface VideoDescriptionProps {
    description: string | undefined;
    /** The video's length; timestamps at or past its end stay plain text. */
    duration?: string | number;
    /** Jumps the player to a timestamp. Without it timestamps are plain text. */
    onSeek?: (seconds: number) => void;
}

const VideoDescription: React.FC<VideoDescriptionProps> = ({ description, duration, onSeek }) => {
    const { t } = useLanguage();
    const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
    const [showDescriptionExpandButton, setShowDescriptionExpandButton] = useState(false);
    const descriptionRef = useRef<HTMLParagraphElement>(null);
    const canSeek = Boolean(onSeek);
    const descriptionParts = useMemo(
        () => (description && canSeek ? splitDescriptionTimestamps(description, parseDuration(duration)) : null),
        [description, duration, canSeek]
    );

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

    // Focusing a timestamp hidden by the line clamp scrolls the clamped box
    // to it, leaving the collapsed view showing the wrong lines. Keep them out
    // of the tab order until the description is expanded.
    const isClamped = showDescriptionExpandButton && !isDescriptionExpanded;

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
                {descriptionParts && onSeek
                    ? descriptionParts.map((part, index) =>
                        typeof part === 'string' ? part : (
                            <Link
                                key={index}
                                component="button"
                                type="button"
                                underline="hover"
                                onClick={() => onSeek(part.seconds)}
                                tabIndex={isClamped ? -1 : undefined}
                                sx={{ font: 'inherit', verticalAlign: 'baseline' }}
                            >
                                {part.text}
                            </Link>
                        ))
                    : description}
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

