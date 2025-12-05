import { Box, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';

interface SecuritySettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
}

const SecuritySettings: React.FC<SecuritySettingsProps> = ({ settings, onChange }) => {
    const { t } = useLanguage();

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('security')}</Typography>
            <FormControlLabel
                control={
                    <Switch
                        checked={settings.loginEnabled}
                        onChange={(e) => onChange('loginEnabled', e.target.checked)}
                    />
                }
                label={t('enableLogin')}
            />

            {settings.loginEnabled && (
                <Box sx={{ mt: 2, maxWidth: 400 }}>
                    <TextField
                        fullWidth
                        label={t('password')}
                        type="password"
                        value={settings.password || ''}
                        onChange={(e) => onChange('password', e.target.value)}
                        helperText={
                            settings.isPasswordSet
                                ? t('passwordHelper')
                                : t('passwordSetHelper')
                        }
                    />
                </Box>
            )}
        </Box>
    );
};

export default SecuritySettings;
