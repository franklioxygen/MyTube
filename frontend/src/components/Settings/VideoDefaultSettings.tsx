import { Box, FormControlLabel, Switch, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';

interface VideoDefaultSettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
}

const VideoDefaultSettings: React.FC<VideoDefaultSettingsProps> = ({ settings, onChange }) => {
    const { t } = useLanguage();

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('videoDefaults')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <FormControlLabel
                    control={
                        <Switch
                            checked={settings.defaultAutoPlay}
                            onChange={(e) => onChange('defaultAutoPlay', e.target.checked)}
                        />
                    }
                    label={t('autoPlay')}
                />
            </Box>
        </Box>
    );
};

export default VideoDefaultSettings;
