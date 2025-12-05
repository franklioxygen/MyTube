import { Alert, Box, Button, Slider, Typography } from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';

interface DownloadSettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
    activeDownloadsCount: number;
    onCleanup: () => void;
    isSaving: boolean;
}

const DownloadSettings: React.FC<DownloadSettingsProps> = ({
    settings,
    onChange,
    activeDownloadsCount,
    onCleanup,
    isSaving
}) => {
    const { t } = useLanguage();

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('downloadSettings')}</Typography>
            <Typography gutterBottom>
                {t('maxConcurrent')}: {settings.maxConcurrentDownloads}
            </Typography>
            <Box sx={{ maxWidth: 400, px: 2 }}>
                <Slider
                    value={settings.maxConcurrentDownloads}
                    onChange={(_, value) => onChange('maxConcurrentDownloads', value)}
                    min={1}
                    max={10}
                    step={1}
                    marks
                    valueLabelDisplay="auto"
                />
            </Box>

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>{t('cleanupTempFiles')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('cleanupTempFilesDescription')}
                </Typography>
                {activeDownloadsCount > 0 && (
                    <Alert severity="warning" sx={{ mb: 2, maxWidth: 600 }}>
                        {t('cleanupTempFilesActiveDownloads')}
                    </Alert>
                )}
                <Button
                    variant="outlined"
                    color="warning"
                    onClick={onCleanup}
                    disabled={isSaving || activeDownloadsCount > 0}
                >
                    {t('cleanupTempFiles')}
                </Button>
            </Box>
        </Box>
    );
};

export default DownloadSettings;
