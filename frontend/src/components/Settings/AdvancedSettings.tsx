import { Box, FormControlLabel, Switch, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import ConsoleManager from '../../utils/consoleManager';

interface AdvancedSettingsProps {
    debugMode: boolean;
    onDebugModeChange: (enabled: boolean) => void;
}

const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({ debugMode, onDebugModeChange }) => {
    const { t } = useLanguage();

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const checked = e.target.checked;
        onDebugModeChange(checked);
        ConsoleManager.setDebugMode(checked);
    };

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('debugMode')}</Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
                {t('debugModeDescription')}
            </Typography>
            <FormControlLabel
                control={
                    <Switch
                        checked={debugMode}
                        onChange={handleChange}
                    />
                }
                label={t('debugMode')}
            />
        </Box>
    );
};

export default AdvancedSettings;
