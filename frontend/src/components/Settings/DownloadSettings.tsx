import {
    Alert,
    Box,
    Button,
    FormControl,
    FormControlLabel,
    MenuItem,
    Select,
    Slider,
    Switch,
    Typography
} from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import { PREFERRED_AUDIO_LANGUAGE_OPTIONS } from '../../utils/audioLanguages';

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
            <Typography gutterBottom>
                {t('maxConcurrent')}: {settings.maxConcurrentDownloads}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('maxConcurrentDescription')}
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

            <Box sx={{ mt: 3 }} id="dontSkipDeletedVideo-setting">
                <FormControlLabel
                    control={
                        <Switch
                            checked={settings.dontSkipDeletedVideo || false}
                            onChange={(e) => onChange('dontSkipDeletedVideo', e.target.checked)}
                        />
                    }
                    label={t('dontSkipDeletedVideo')}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                    {t('dontSkipDeletedVideoDescription')}
                </Typography>
            </Box>

            <Box sx={{ mt: 3 }} id="preferredAudioLanguage-setting">
                <Typography variant="h6" gutterBottom>{t('preferredAudioLanguage')}</Typography>
                <FormControl fullWidth sx={{ maxWidth: 400 }}>
                    <Select
                        labelId="preferred-audio-language-label"
                        id="preferred-audio-language"
                        value={settings.preferredAudioLanguage ?? ''}
                        onChange={(e) => onChange('preferredAudioLanguage', e.target.value)}
                        displayEmpty
                        renderValue={(v) =>
                            v === ''
                                ? t('preferredAudioLanguageDefault')
                                : (() => {
                                      const opt = PREFERRED_AUDIO_LANGUAGE_OPTIONS.find((o) => o.value === v);
                                      return opt ? t(opt.labelKey) : v;
                                  })()
                        }
                    >
                        <MenuItem value="">
                            <em>{t('preferredAudioLanguageDefault')}</em>
                        </MenuItem>
                        {PREFERRED_AUDIO_LANGUAGE_OPTIONS.map((opt) => (
                            <MenuItem key={opt.value} value={opt.value}>
                                {t(opt.labelKey)}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                    {t('preferredAudioLanguageDescription')}
                </Typography>
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
