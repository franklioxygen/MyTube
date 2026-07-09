import {
    Alert,
    Box,
    Button,
    Divider,
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
import { VIDEO_CODEC_OPTIONS, VIDEO_CONTAINER_OPTIONS } from '../../utils/videoCodecs';
import FilenameTemplateSettings from './FilenameTemplateSettings';

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
    isSaving,
}) => {
    const { t } = useLanguage();
    const retryIntervalOptions = [1, 5, 10, 30, 60];

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

            <Box sx={{ mt: 3 }} id="autoRetry-setting">
                <FormControlLabel
                    control={
                        <Switch
                            checked={settings.autoRetryEnabled || false}
                            onChange={(e) => onChange('autoRetryEnabled', e.target.checked)}
                        />
                    }
                    label={t('autoRetry') || 'Auto Retry'}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                    {t('autoRetryDescription') || 'Automatically reschedule failed downloads after a fixed delay.'}
                </Typography>

                {settings.autoRetryEnabled && (
                    <Box
                        sx={{
                            display: 'grid',
                            gap: 2,
                            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 240px))' },
                            alignItems: 'start',
                            mb: 2,
                        }}
                    >
                        <Box>
                            <Typography variant="subtitle2" gutterBottom>
                                {t('retryTimes') || 'Retry Times'}
                            </Typography>
                            <FormControl fullWidth>
                                <Select
                                    value={settings.autoRetryTimes ?? 3}
                                    onChange={(e) => onChange('autoRetryTimes', Number(e.target.value))}
                                >
                                    {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                                        <MenuItem key={value} value={value}>
                                            {value}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                {t('retryTimesDescription') || 'Select how many times the system retries a failed task.'}
                            </Typography>
                        </Box>

                        <Box>
                            <Typography variant="subtitle2" gutterBottom>
                                {t('retryInterval') || 'Retry Interval'}
                            </Typography>
                            <FormControl fullWidth>
                                <Select
                                    value={settings.autoRetryIntervalMinutes ?? 5}
                                    onChange={(e) => onChange('autoRetryIntervalMinutes', Number(e.target.value))}
                                >
                                    {retryIntervalOptions.map((value) => (
                                        <MenuItem key={value} value={value}>
                                            {`${value} ${t('minuteShort') || 'min'}`}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                {t('retryIntervalDescription') || 'Select how long the system waits before retrying a failed task.'}
                            </Typography>
                        </Box>
                    </Box>
                )}
            </Box>

            <Box sx={{ mt: 3 }} id="downloadHistoryRetention-setting">
                <Typography variant="subtitle2" gutterBottom>
                    {t('downloadHistoryRetention') || 'Download History Retention'}
                </Typography>
                <FormControl fullWidth sx={{ maxWidth: 240 }}>
                    <Select
                        value={settings.downloadHistoryRetentionDays ?? 0}
                        onChange={(e) => onChange('downloadHistoryRetentionDays', Number(e.target.value))}
                    >
                        <MenuItem value={0}>
                            {t('downloadHistoryRetentionKeepForever') || 'Keep forever'}
                        </MenuItem>
                        {[30, 90, 180, 365].map((days) => (
                            <MenuItem key={days} value={days}>
                                {`${days} ${t('retentionDaysUnit') || 'days'}`}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                    {t('downloadHistoryRetentionDescription') ||
                        'Automatically delete completed download history entries older than this. Entries for deleted videos and scheduled retries are always kept.'}
                </Typography>
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

            <Box sx={{ mt: 3 }} id="defaultVideoCodec-setting">
                <Typography variant="h6" gutterBottom>{t('defaultVideoCodec')}</Typography>
                <FormControl fullWidth sx={{ maxWidth: 400 }}>
                    <Select
                        labelId="default-video-codec-label"
                        id="default-video-codec"
                        value={settings.defaultVideoCodec ?? ''}
                        onChange={(e) => onChange('defaultVideoCodec', e.target.value)}
                        displayEmpty
                        renderValue={(v) =>
                            v === ''
                                ? t('defaultVideoCodecDefault')
                                : (() => {
                                      const opt = VIDEO_CODEC_OPTIONS.find((o) => o.value === v);
                                      return opt ? t(opt.labelKey) : v;
                                  })()
                        }
                    >
                        <MenuItem value="">
                            <em>{t('defaultVideoCodecDefault')}</em>
                        </MenuItem>
                        {VIDEO_CODEC_OPTIONS.map((opt) => (
                            <MenuItem key={opt.value} value={opt.value}>
                                {t(opt.labelKey)}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                    {t('defaultVideoCodecDescription')}
                </Typography>
            </Box>

            <Box sx={{ mt: 3 }} id="preferredVideoContainer-setting">
                <Typography variant="h6" gutterBottom>{t('preferredVideoContainer')}</Typography>
                <FormControl fullWidth sx={{ maxWidth: 400 }}>
                    <Select
                        labelId="preferred-video-container-label"
                        id="preferred-video-container"
                        value={settings.preferredVideoContainer ?? 'auto'}
                        onChange={(e) => onChange('preferredVideoContainer', e.target.value)}
                        inputProps={{ 'aria-label': t('preferredVideoContainer') }}
                        renderValue={(v) => {
                            const opt = VIDEO_CONTAINER_OPTIONS.find((o) => o.value === v);
                            return opt ? t(opt.labelKey) : v;
                        }}
                    >
                        {VIDEO_CONTAINER_OPTIONS.map((opt) => (
                            <MenuItem key={opt.value} value={opt.value}>
                                {t(opt.labelKey)}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                    {t('preferredVideoContainerDescription')}
                </Typography>
            </Box>

            <Box sx={{ mt: 3 }} id="preferredVideoResolution-setting">
                <Typography variant="h6" gutterBottom>{t('preferredVideoResolution')}</Typography>
                <FormControl fullWidth sx={{ maxWidth: 400 }}>
                    <Select
                        labelId="preferred-video-resolution-label"
                        id="preferred-video-resolution"
                        value={settings.preferredVideoResolution ?? 'auto'}
                        onChange={(e) => onChange('preferredVideoResolution', e.target.value)}
                    >
                        <MenuItem value="auto">{t('preferredVideoResolutionAuto')}</MenuItem>
                        <MenuItem value="2160">2160p (4K)</MenuItem>
                        <MenuItem value="1440">1440p (2K)</MenuItem>
                        <MenuItem value="1080">1080p</MenuItem>
                        <MenuItem value="720">720p</MenuItem>
                        <MenuItem value="480">480p</MenuItem>
                        <MenuItem value="360">360p</MenuItem>
                    </Select>
                </FormControl>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1 }}>
                    {t('preferredVideoResolutionDescription')}
                </Typography>
                <FormControlLabel
                    control={
                        <Switch
                            checked={settings.preferredVideoResolutionStrict ?? false}
                            onChange={(e) => onChange('preferredVideoResolutionStrict', e.target.checked)}
                            disabled={(settings.preferredVideoResolution ?? 'auto') === 'auto'}
                        />
                    }
                    label={t('preferredVideoResolutionStrict')}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
                    {t('preferredVideoResolutionStrictDescription')}
                </Typography>
            </Box>

            <Divider sx={{ my: 3 }} />

            <FilenameTemplateSettings
                settings={settings}
                onChange={onChange}
            />

            <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>{t('cleanupTempFiles')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('cleanupTempFilesDescription')}
                </Typography>
                {activeDownloadsCount > 0 && (
                    <Alert severity="warning" sx={{ mb: 2, maxWidth: 920 }}>
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
