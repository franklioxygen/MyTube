import { Star, StarBorder } from '@mui/icons-material';
import { IconButton, Tooltip } from '@mui/material';

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
        </Tooltip>
    );
};

export default FavoriteToggle;
