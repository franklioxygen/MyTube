import { Box, FormControlLabel, Switch, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';

interface CompatibilityModeToggleProps {
    enabled: boolean;
    supported: boolean;
    onChange: (enabled: boolean) => void;
}

/**
 * Switches the player between the standard `<video>` pipeline and the
 * canvas + WebCodecs proof of concept.
 */
const CompatibilityModeToggle: React.FC<CompatibilityModeToggleProps> = ({
    enabled,
    supported,
    onChange,
}) => {
    const { t } = useLanguage();

    const control = (
        <FormControlLabel
            disabled={!supported}
            control={
                <Switch
                    size="small"
                    checked={enabled && supported}
                    onChange={(event) => onChange(event.target.checked)}
                    inputProps={{ 'aria-label': t('compatibilityMode') }}
                />
            }
            label={
                <Box>
                    <Typography variant="body2">{t('compatibilityMode')}</Typography>
                    <Typography variant="caption" color="text.secondary">
                        {supported
                            ? t('compatibilityModeHint')
                            : t('compatibilityModeUnavailable')}
                    </Typography>
                </Box>
            }
            sx={{ alignItems: 'flex-start', m: 0, gap: 1 }}
        />
    );

    return (
        <Box sx={{ mt: 1.5 }}>
            {supported ? (
                control
            ) : (
                <Tooltip title={t('compatibilityModeUnavailable')}>
                    <span>{control}</span>
                </Tooltip>
            )}
        </Box>
    );
};

export default CompatibilityModeToggle;
