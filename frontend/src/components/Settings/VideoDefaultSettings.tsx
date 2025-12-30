import { Box, FormControlLabel, Switch } from '@mui/material';
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
                <FormControlLabel
                    control={
                        <Switch
                            checked={settings.pauseOnFocusLoss || false}
                            onChange={(e) => onChange('pauseOnFocusLoss', e.target.checked)}
                        />
                    }
                    label={t('pauseOnFocusLoss') || "Pause video when window loses focus"}
                />
            </Box>
        </Box>
    );
};

export default VideoDefaultSettings;
