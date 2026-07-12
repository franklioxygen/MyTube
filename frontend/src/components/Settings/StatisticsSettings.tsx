import { getApiErrorMessage } from '../../utils/errors';
import {
    Alert,
    Box,
    Button,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Select,
    Switch,
    Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import { api } from '../../utils/apiClient';

interface StatisticsSettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
}

const StatisticsSettings: React.FC<StatisticsSettingsProps> = ({ settings, onChange }) => {
    const { t } = useLanguage();
    const [clearing, setClearing] = useState(false);
    const [feedback, setFeedback] = useState<{
        type: 'success' | 'error';
        message: string;
    } | null>(null);

    const enabled = settings.statisticsEnabled === true;
    const captureSearchText = settings.statisticsCaptureSearchText === true;
    const trackVisitorActivity = settings.statisticsTrackVisitorActivity === true;
    const keepWhenDisabled = settings.statisticsKeepDataWhenDisabled !== false;
    const retentionDays = settings.statisticsRetentionDays ?? 365;

    const handleClear = async () => {
        if (!confirm(t('statisticsClearConfirm') || 'Clear all collected statistics data?')) {
            return;
        }
        setClearing(true);
        setFeedback(null);
        try {
            await api.delete('/statistics');
            setFeedback({
                type: 'success',
                message: t('statisticsClearSuccess') || 'Statistics data cleared.',
            });
        } catch (error: unknown) {
            setFeedback({
                type: 'error',
                message: getApiErrorMessage(error) ?? '',
            });
        } finally {
            setClearing(false);
        }
    };

    return (
        <Box sx={{ mt: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
                {t('statisticsSection') || 'Statistics'}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                {t('statisticsHelper') || 'Statistics are stored locally in MyTube only.'}
            </Typography>

            <Box id="statisticsEnabled-setting">
                <FormControlLabel
                    control={
                        <Switch
                            checked={enabled}
                            onChange={(e) => onChange('statisticsEnabled', e.target.checked)}
                        />
                    }
                    label={t('statisticsEnableLabel') || 'Enable statistics collection'}
                />
            </Box>

            {enabled && (
                <>
                    <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <FormControl size="small" sx={{ maxWidth: 300 }}>
                            <InputLabel id="statistics-retention-label">
                                {t('statisticsRetentionLabel') || 'Keep detailed event data'}
                            </InputLabel>
                            <Select
                                labelId="statistics-retention-label"
                                label={t('statisticsRetentionLabel') || 'Keep detailed event data'}
                                value={retentionDays === null ? 'forever' : String(retentionDays)}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    if (value === 'forever') {
                                        onChange('statisticsRetentionDays', null);
                                    } else {
                                        onChange('statisticsRetentionDays', Number(value));
                                    }
                                }}
                            >
                                <MenuItem value="90">{t('statisticsRetention90') || '90 days'}</MenuItem>
                                <MenuItem value="365">{t('statisticsRetention365') || '365 days'}</MenuItem>
                                <MenuItem value="forever">{t('statisticsRetentionForever') || 'Forever'}</MenuItem>
                            </Select>
                        </FormControl>

                        <FormControlLabel
                            control={
                                <Switch
                                    checked={captureSearchText}
                                    onChange={(e) => onChange('statisticsCaptureSearchText', e.target.checked)}
                                />
                            }
                            label={t('statisticsCaptureSearchTextLabel') || 'Include raw search text in reports'}
                        />

                        <FormControlLabel
                            control={
                                <Switch
                                    checked={trackVisitorActivity}
                                    onChange={(e) => onChange('statisticsTrackVisitorActivity', e.target.checked)}
                                />
                            }
                            label={t('statisticsTrackVisitorLabel') || 'Track visitor usage'}
                        />

                        <FormControlLabel
                            control={
                                <Switch
                                    checked={keepWhenDisabled}
                                    onChange={(e) => onChange('statisticsKeepDataWhenDisabled', e.target.checked)}
                                />
                            }
                            label={t('statisticsKeepDataLabel') || 'Keep data when collection is disabled'}
                        />
                    </Box>
                </>
            )}

            <Box sx={{ mt: 2 }}>
                <Button
                    variant="outlined"
                    color="error"
                    onClick={handleClear}
                    loading={clearing}
                    loadingPosition="start"
                >
                    {t('statisticsClear') || 'Clear collected statistics'}
                </Button>
            </Box>

            {feedback && (
                <Alert severity={feedback.type} sx={{ mt: 2 }}>
                    {feedback.message}
                </Alert>
            )}
        </Box>
    );
};

export default StatisticsSettings;
