import { Box, FormControlLabel, Switch, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import PasswordModal from '../PasswordModal';

const API_URL = import.meta.env.VITE_API_URL;

interface VisitorModeSettingsProps {
    visitorMode?: boolean;
    savedVisitorMode?: boolean;
    onChange: (field: string, value: string | number | boolean) => void;
}

const VisitorModeSettings: React.FC<VisitorModeSettingsProps> = ({ visitorMode, savedVisitorMode: _savedVisitorMode, onChange }) => {
    const { t } = useLanguage();
    const queryClient = useQueryClient();

    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [passwordError, setPasswordError] = useState('');
    const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);
    const [pendingVisitorMode, setPendingVisitorMode] = useState<boolean | null>(null);
    const [remainingWaitTime, setRemainingWaitTime] = useState(0);
    const [baseError, setBaseError] = useState('');

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
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [remainingWaitTime, baseError, t]);

    return (
        <Box>
            <Box>
                <FormControlLabel
                    control={
                        <Switch
                            checked={visitorMode ?? false}
                            onChange={(e) => handleVisitorModeChange(e.target.checked)}
                        />
                    }
                    label={t('visitorMode') || "Visitor Mode (Read-only)"}
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, ml: 4.5 }}>
                    {t('visitorModeDescription') || "Read-only mode. Hidden videos will not be visible to visitors."}
                </Typography>
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

export default VisitorModeSettings;
