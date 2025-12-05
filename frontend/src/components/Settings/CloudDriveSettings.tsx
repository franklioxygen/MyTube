import { Box, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';

interface CloudDriveSettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
}

const CloudDriveSettings: React.FC<CloudDriveSettingsProps> = ({ settings, onChange }) => {
    const { t } = useLanguage();

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('cloudDriveSettings')} (beta)</Typography>
            <FormControlLabel
                control={
                    <Switch
                        checked={settings.cloudDriveEnabled || false}
                        onChange={(e) => onChange('cloudDriveEnabled', e.target.checked)}
                    />
                }
                label={t('enableAutoSave')}
            />

            {settings.cloudDriveEnabled && (
                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 600 }}>
                    <TextField
                        label={t('apiUrl')}
                        value={settings.openListApiUrl || ''}
                        onChange={(e) => onChange('openListApiUrl', e.target.value)}
                        helperText={t('apiUrlHelper')}
                        fullWidth
                    />
                    <TextField
                        label={t('token')}
                        value={settings.openListToken || ''}
                        onChange={(e) => onChange('openListToken', e.target.value)}
                        type="password"
                        fullWidth
                    />
                    <TextField
                        label={t('uploadPath')}
                        value={settings.cloudDrivePath || ''}
                        onChange={(e) => onChange('cloudDrivePath', e.target.value)}
                        helperText={t('cloudDrivePathHelper')}
                        fullWidth
                    />
                </Box>
            )}
        </Box>
    );
};

export default CloudDriveSettings;
