import { Alert, Box, Button, CircularProgress, Divider, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import { api } from '../../utils/apiClient';
import ConsoleManager from '../../utils/consoleManager';

interface AdvancedSettingsProps {
    debugMode: boolean;
    onDebugModeChange: (enabled: boolean) => void;
    telegramEnabled?: boolean;
    telegramBotToken?: string;
    telegramChatId?: string;
    telegramNotifyOnSuccess?: boolean;
    telegramNotifyOnFail?: boolean;
    onChange: (field: keyof Settings, value: any) => void;
}

const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
    debugMode,
    onDebugModeChange,
    telegramEnabled = false,
    telegramBotToken = '',
    telegramChatId = '',
    telegramNotifyOnSuccess = true,
    telegramNotifyOnFail = true,
    onChange,
}) => {
    const { t } = useLanguage();
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const handleDebugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const checked = e.target.checked;
        onDebugModeChange(checked);
        ConsoleManager.setDebugMode(checked);
    };

    const handleTestTelegram = async () => {
        if (!telegramBotToken || !telegramChatId) {
            setTestResult({ type: 'error', message: t('telegramTestMissingFields') });
            return;
        }
        setTesting(true);
        setTestResult(null);
        try {
            await api.post('/settings/telegram/test', {
                botToken: telegramBotToken,
                chatId: telegramChatId,
            });
            setTestResult({ type: 'success', message: t('telegramTestSuccess') });
        } catch (error: any) {
            const message = error.response?.data?.error || error.message;
            setTestResult({ type: 'error', message: t('telegramTestFailed', { error: message }) });
        } finally {
            setTesting(false);
        }
    };

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('debugModeDescription')}
            </Typography>
            <FormControlLabel
                control={
                    <Switch
                        checked={debugMode}
                        onChange={handleDebugChange}
                    />
                }
                label={t('debugMode')}
            />

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" sx={{ mb: 1 }}>
                {t('telegramNotifications')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('telegramNotificationsDescription')}
            </Typography>

            <FormControlLabel
                control={
                    <Switch
                        checked={telegramEnabled}
                        onChange={(e) => onChange('telegramEnabled', e.target.checked)}
                    />
                }
                label={t('telegramEnabled')}
            />

            <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                    label={t('telegramBotToken')}
                    type="password"
                    value={telegramBotToken}
                    onChange={(e) => onChange('telegramBotToken', e.target.value)}
                    helperText={t('telegramBotTokenHelper')}
                    disabled={!telegramEnabled}
                    fullWidth
                    size="small"
                />
                <TextField
                    label={t('telegramChatId')}
                    value={telegramChatId}
                    onChange={(e) => onChange('telegramChatId', e.target.value)}
                    helperText={t('telegramChatIdHelper')}
                    disabled={!telegramEnabled}
                    fullWidth
                    size="small"
                />

                <Box sx={{ display: 'flex', gap: 2 }}>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={telegramNotifyOnSuccess}
                                onChange={(e) => onChange('telegramNotifyOnSuccess', e.target.checked)}
                                disabled={!telegramEnabled}
                            />
                        }
                        label={t('telegramNotifyOnSuccess')}
                    />
                    <FormControlLabel
                        control={
                            <Switch
                                checked={telegramNotifyOnFail}
                                onChange={(e) => onChange('telegramNotifyOnFail', e.target.checked)}
                                disabled={!telegramEnabled}
                            />
                        }
                        label={t('telegramNotifyOnFail')}
                    />
                </Box>

                <Box>
                    <Button
                        variant="outlined"
                        onClick={handleTestTelegram}
                        disabled={!telegramEnabled || !telegramBotToken || !telegramChatId || testing}
                        startIcon={testing ? <CircularProgress size={16} /> : undefined}
                    >
                        {t('telegramTestButton')}
                    </Button>
                </Box>

                {testResult && (
                    <Alert severity={testResult.type === 'success' ? 'success' : 'error'} onClose={() => setTestResult(null)}>
                        {testResult.message}
                    </Alert>
                )}
            </Box>
        </Box>
    );
};

export default AdvancedSettings;
