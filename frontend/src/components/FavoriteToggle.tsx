import { Star, StarBorder } from '@mui/icons-material';
import { Box, IconButton, Tooltip } from '@mui/material';

interface FavoriteToggleProps {
    active: boolean;
    onToggle: () => void;
    label: string;
    activeLabel?: string;
    size?: 'small' | 'medium';
    color?: 'primary' | 'warning';
    disabled?: boolean;
}

const FavoriteToggle: React.FC<FavoriteToggleProps> = ({
    active,
    onToggle,
    label,
    activeLabel,
    size = 'small',
    color,
    disabled = false,
}) => {
    const accessibleLabel = active ? (activeLabel ?? label) : label;

    return (
        <Tooltip title={accessibleLabel}>
            {/* Wrap in a span so the Tooltip still receives events when the
                button is disabled (a disabled button fires no events). */}
            <Box component="span" sx={{ display: 'inline-flex' }}>
                <IconButton
                    type="button"
                    size={size}
                    color={active ? (color ?? 'warning') : 'primary'}
                    aria-label={accessibleLabel}
                    aria-pressed={active}
                    onClick={onToggle}
                    disabled={disabled}
                >
                    {active ? <Star /> : <StarBorder />}
                </IconButton>
            </Box>
        </Tooltip>
    );
};

export default FavoriteToggle;
