import { Translate as TranslateIcon } from '@mui/icons-material';
import {
    Badge,
    Box,
    CircularProgress,
    IconButton,
    SxProps,
    Theme,
    Tooltip,
    useMediaQuery,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useLiveTranslationControl } from '../../../contexts/LiveTranslationContext';

interface LiveTranslationControlButtonProps {
    /** Forwarded to the IconButton, e.g. responsive `display` / `padding`. */
    sx?: SxProps<Theme>;
}

// Fixed-size content slot (matches the 24px glyph of the sibling control-bar
// buttons) so the button keeps the same footprint across idle / connecting /
// active states. The translate glyph itself is rendered one step smaller so it
// no longer looks visually heavier than its neighbours.
const contentSlotSx: SxProps<Theme> = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1.5rem',
    height: '1.5rem',
};

const badgeTextSx: SxProps<Theme> = {
    ...contentSlotSx,
    fontSize: '0.8rem',
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: '0.02em',
};

/**
 * In-player Live Translate trigger, styled to sit inline with the other control
 * bar icon buttons. While translating, the icon is replaced by the target
 * language badge (e.g. "EN", "CN") in the normal control color, and a small
 * pulsing red "live" dot marks the active session. The dot is a self-contained
 * MUI Badge so it reads identically in windowed and fullscreen modes without
 * repurposing the error text color.
 *
 * Renders nothing when used outside a LiveTranslationProvider or when the
 * feature is disabled.
 */
const LiveTranslationControlButton: React.FC<LiveTranslationControlButtonProps> = ({ sx }) => {
    const { t } = useLanguage();
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');
    const { shouldRender, isActive, isConnecting, disabledReason, targetAbbreviation, onToggle } =
        useLiveTranslationControl();

    if (!shouldRender) {
        return null;
    }

    const disabled = !!disabledReason && !isActive && !isConnecting;
    const showLiveDot = isActive && !isConnecting;
    const ariaLabel = isActive ? t('stopLiveTranslation') : t('liveTranslate');
    const tooltipTitle = disabledReason
        ? disabledReason
        : isConnecting
          ? t('liveTranslationConnecting')
          : isActive
            ? t('stopLiveTranslation')
            : t('liveTranslate');

    const content = isConnecting ? (
        <Box component="span" sx={contentSlotSx}>
            <CircularProgress size={18} color="inherit" />
        </Box>
    ) : isActive ? (
        <Box component="span" sx={badgeTextSx}>
            {targetAbbreviation}
        </Box>
    ) : (
        <Box component="span" sx={contentSlotSx}>
            <TranslateIcon fontSize="small" />
        </Box>
    );

    const button = (
        <IconButton
            size="small"
            onClick={onToggle}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-pressed={isActive}
            sx={sx}
        >
            <Badge
                variant="dot"
                color="error"
                overlap="circular"
                invisible={!showLiveDot}
                anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                sx={(theme) => ({
                    '& .MuiBadge-badge': {
                        animation: 'liveTranslationPulse 1.8s ease-in-out infinite',
                        '@media (prefers-reduced-motion: reduce)': {
                            animation: 'none',
                        },
                    },
                    '@keyframes liveTranslationPulse': {
                        '0%': {
                            boxShadow: `0 0 0 0 ${alpha(theme.palette.error.main, 0.6)}`,
                        },
                        '70%': {
                            boxShadow: `0 0 0 5px ${alpha(theme.palette.error.main, 0)}`,
                        },
                        '100%': {
                            boxShadow: `0 0 0 0 ${alpha(theme.palette.error.main, 0)}`,
                        },
                    },
                })}
            >
                {content}
            </Badge>
        </IconButton>
    );

    return (
        <Tooltip title={tooltipTitle} disableHoverListener={isTouch}>
            {disabled ? <span>{button}</span> : button}
        </Tooltip>
    );
};

export default LiveTranslationControlButton;
