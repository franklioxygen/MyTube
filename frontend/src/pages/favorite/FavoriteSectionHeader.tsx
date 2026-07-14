import { Box, Chip, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { brand, modeColors } from '../../theme/colors';

interface FavoriteSectionHeaderProps {
    id: string;
    title: string;
    subtitle?: string;
    count?: number;
    icon?: ReactNode;
}

/**
 * Shared rail heading: a gradient accent bar, the section title, an optional
 * count pill, and an optional one-line subtitle. Keeps every favorites rail
 * visually consistent and gives the page a deliberate, editorial rhythm.
 */
const FavoriteSectionHeader: React.FC<FavoriteSectionHeaderProps> = ({
    id,
    title,
    subtitle,
    count,
    icon,
}) => (
    <Box sx={{ mb: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box
                aria-hidden
                sx={{
                    width: 4,
                    height: 22,
                    borderRadius: 2,
                    background: (theme) => `linear-gradient(180deg, ${brand.primaryDark}, ${modeColors(theme.palette.mode).secondary})`,
                    flexShrink: 0,
                }}
            />
            {icon}
            <Typography id={id} variant="h6" component="h2" fontWeight={700} sx={{ letterSpacing: 0.2 }}>
                {title}
            </Typography>
            {typeof count === 'number' && count > 0 && (
                <Chip
                    label={count}
                    size="small"
                    sx={{
                        height: 22,
                        minWidth: 22,
                        fontWeight: 700,
                        bgcolor: 'action.selected',
                        '& .MuiChip-label': { px: 1 },
                    }}
                />
            )}
        </Box>
        {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, ml: 2.25 }}>
                {subtitle}
            </Typography>
        )}
    </Box>
);

export default FavoriteSectionHeader;
