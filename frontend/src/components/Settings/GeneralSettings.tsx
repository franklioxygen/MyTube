import { Box, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Switch, TextField, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import PasswordModal from '../PasswordModal';

const API_URL = import.meta.env.VITE_API_URL;

interface GeneralSettingsProps {
    language: string;
    websiteName?: string;
    itemsPerPage?: number;
    showYoutubeSearch?: boolean;
    visitorMode?: boolean;
    savedVisitorMode?: boolean;
    infiniteScroll?: boolean;
    videoColumns?: number;
    onChange: (field: string, value: string | number | boolean) => void;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = (props) => {
    const { language, websiteName, showYoutubeSearch, visitorMode, savedVisitorMode, infiniteScroll, videoColumns, onChange } = props;
    const { t } = useLanguage();
    const queryClient = useQueryClient();

    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [passwordError, setPasswordError] = useState('');
    const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);
    const [pendingVisitorMode, setPendingVisitorMode] = useState<boolean | null>(null);
    const [remainingWaitTime, setRemainingWaitTime] = useState(0);
    const [baseError, setBaseError] = useState('');

    // Use saved value for visibility, current value for toggle state
    const isVisitorMode = savedVisitorMode ?? visitorMode ?? false;

    const handleVisitorModeChange = (checked: boolean) => {
        setPendingVisitorMode(checked);
        setPasswordError('');
        setBaseError('');
        setRemainingWaitTime(0);
        setShowPasswordModal(true);
    };

    const handlePasswordConfirm = async (password: string) => {
        setIsVerifyingPassword(true);
        setPasswordError('');
        setBaseError('');

        try {
            await axios.post(`${API_URL}/settings/verify-password`, { password });

            // If successful, save the setting immediately
            if (pendingVisitorMode !== null) {
                // Save to backend
                await axios.post(`${API_URL}/settings`, { visitorMode: pendingVisitorMode });

                // Invalidate settings query to ensure global state (VisitorModeContext) updates immediately
                await queryClient.invalidateQueries({ queryKey: ['settings'] });

                // Update parent state
                onChange('visitorMode', pendingVisitorMode);
            }
            setShowPasswordModal(false);
            setPendingVisitorMode(null);
        } catch (error: any) {
            console.error('Password verification failed:', error);
            if (error.response) {
                const { status, data } = error.response;
                if (status === 429) {
                    const waitTimeMs = data.waitTime || 0;
                    const seconds = Math.ceil(waitTimeMs / 1000);
                    setRemainingWaitTime(seconds);
                    setBaseError(t('tooManyAttempts') || 'Too many attempts.');
                } else if (status === 401) {
                    const waitTimeMs = data.waitTime || 0;
                    if (waitTimeMs > 0) {
                        const seconds = Math.ceil(waitTimeMs / 1000);
                        setRemainingWaitTime(seconds);
                        setBaseError(t('incorrectPassword') || 'Incorrect password.');
                    } else {
                        setPasswordError(t('incorrectPassword') || 'Incorrect password');
                    }
                } else {
                    setPasswordError(t('loginFailed') || 'Verification failed');
                }
            } else {
                setPasswordError(t('networkError' as any) || 'Network error');
            }
        } finally {
            setIsVerifyingPassword(false);
        }
    };

    const handleClosePasswordModal = () => {
        setShowPasswordModal(false);
        setPendingVisitorMode(null);
        setPasswordError('');
        setBaseError('');
        setRemainingWaitTime(0);
    };

    // Effect to handle countdown
    useEffect(() => {
        let interval: NodeJS.Timeout;

        if (remainingWaitTime > 0) {
            // Update error message immediately
            const waitMsg = t('waitTimeMessage')?.replace('{time}', `${remainingWaitTime}s`) || `Please wait ${remainingWaitTime}s.`;
            setPasswordError(`${baseError} ${waitMsg}`);

            interval = setInterval(() => {
                setRemainingWaitTime((prev) => {
                    if (prev <= 1) {
                        // Countdown finished
                        setPasswordError(baseError);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else if (baseError && !passwordError) {
            // Restore base error if countdown finished but no explicit error set (though logic above handles it)
            // simplified: if remainingTime hits 0, the effect re-runs. 
            // We handled the 0 case in the setRemainingWaitTime callback or we can handle it here if it transitions to 0.
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [remainingWaitTime, baseError, t]);

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('general')}</Typography>
            <Box sx={{ maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {!isVisitorMode && (
                    <>
                        <FormControl fullWidth>
                            <InputLabel id="language-select-label">{t('language')}</InputLabel>
                            <Select
                                labelId="language-select-label"
                                id="language-select"
                                value={language || 'en'}
                                label={t('language')}
                                onChange={(e) => onChange('language', e.target.value)}
                            >
                                <MenuItem value="en">English</MenuItem>
                                <MenuItem value="zh">中文 (Chinese)</MenuItem>
                                <MenuItem value="es">Español (Spanish)</MenuItem>
                                <MenuItem value="de">Deutsch (German)</MenuItem>
                                <MenuItem value="ja">日本語 (Japanese)</MenuItem>
                                <MenuItem value="fr">Français (French)</MenuItem>
                                <MenuItem value="ko">한국어 (Korean)</MenuItem>
                                <MenuItem value="ar">العربية (Arabic)</MenuItem>
                                <MenuItem value="pt">Português (Portuguese)</MenuItem>
                                <MenuItem value="ru">Русский (Russian)</MenuItem>
                            </Select>
                        </FormControl>

                        <TextField
                            fullWidth
                            label={t('websiteName')}
                            value={websiteName || ''}
                            onChange={(e) => onChange('websiteName', e.target.value)}
                            placeholder="MyTube"
                            helperText={t('websiteNameHelper', {
                                current: (websiteName || '').length,
                                max: 15,
                                default: 'MyTube'
                            })}
                            slotProps={{ htmlInput: { maxLength: 15 } }}
                        />

                        <TextField
                            fullWidth
                            label={t('itemsPerPage') || "Items Per Page"}
                            type="number"
                            value={props.itemsPerPage || 12}
                            onChange={(e) => {
                                const val = parseInt(e.target.value);
                                if (!isNaN(val) && val > 0) {
                                    onChange('itemsPerPage', val);
                                }
                            }}
                            disabled={infiniteScroll ?? false}
                            helperText={
                                infiniteScroll
                                    ? t('infiniteScrollDisabled') || "Disabled when Infinite Scroll is enabled"
                                    : (t('itemsPerPageHelper') || "Number of videos to show per page (Default: 12)")
                            }
                            slotProps={{ htmlInput: { min: 1 } }}
                        />

                        <FormControl fullWidth>
                            <InputLabel id="video-columns-select-label">{t('maxVideoColumns') || 'Maximum Video Columns (Homepage)'}</InputLabel>
                            <Select
                                labelId="video-columns-select-label"
                                id="video-columns-select"
                                value={videoColumns || 4}
                                label={t('videoColumns') || 'Video Columns (Homepage)'}
                                onChange={(e) => onChange('videoColumns', Number(e.target.value))}
                            >
                                <MenuItem value={2}>{t('columnsCount', { count: 2 }) || '2 Columns'}</MenuItem>
                                <MenuItem value={3}>{t('columnsCount', { count: 3 }) || '3 Columns'}</MenuItem>
                                <MenuItem value={4}>{t('columnsCount', { count: 4 }) || '4 Columns'}</MenuItem>
                                <MenuItem value={5}>{t('columnsCount', { count: 5 }) || '5 Columns'}</MenuItem>
                                <MenuItem value={6}>{t('columnsCount', { count: 6 }) || '6 Columns'}</MenuItem>
                            </Select>
                        </FormControl>

                        <FormControlLabel
                            control={
                                <Switch
                                    checked={infiniteScroll ?? false}
                                    onChange={(e) => onChange('infiniteScroll', e.target.checked)}
                                />
                            }
                            label={t('infiniteScroll') || "Infinite Scroll"}
                        />

                        <FormControlLabel
                            control={
                                <Switch
                                    checked={showYoutubeSearch ?? true}
                                    onChange={(e) => onChange('showYoutubeSearch', e.target.checked)}
                                />
                            }
                            label={t('showYoutubeSearch') || "Show YouTube Search Results"}
                        />
                    </>
                )}

                <FormControlLabel
                    control={
                        <Switch
                            checked={visitorMode ?? false}
                            onChange={(e) => handleVisitorModeChange(e.target.checked)}
                        />
                    }
                    label={t('visitorMode') || "Visitor Mode (Read-only)"}
                />
            </Box>

            <PasswordModal
                isOpen={showPasswordModal}
                onClose={handleClosePasswordModal}
                onConfirm={handlePasswordConfirm}
                title={t('password' as any) || "Enter Website Password"}
                message={t('visitorModePasswordPrompt' as any) || "Please enter the website password to change Visitor Mode settings."}
                error={passwordError}
                isLoading={isVerifyingPassword}
            />
        </Box>
    );
};

export default GeneralSettings;
