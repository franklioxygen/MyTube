import { Box, Button, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import { startRegistration } from '@simplewebauthn/browser';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import { getWebAuthnErrorTranslationKey } from '../../utils/translations';
import AlertModal from '../AlertModal';
import ConfirmationModal from '../ConfirmationModal';

const API_URL = import.meta.env.VITE_API_URL;

interface SecuritySettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
}

const SecuritySettings: React.FC<SecuritySettingsProps> = ({ settings, onChange }) => {
    const { t } = useLanguage();
    const [showRemoveModal, setShowRemoveModal] = useState(false);
    const [alertOpen, setAlertOpen] = useState(false);
    const [alertTitle, setAlertTitle] = useState('');
    const [alertMessage, setAlertMessage] = useState('');

    const showAlert = (title: string, message: string) => {
        setAlertTitle(title);
        setAlertMessage(message);
        setAlertOpen(true);
    };

    // Check if passkeys exist
    const { data: passkeysData, refetch: refetchPasskeys } = useQuery({
        queryKey: ['passkeys-exists'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings/passkeys/exists`);
            return response.data;
        },
    });

    const passkeysExist = passkeysData?.exists || false;

    // If passkeys don't exist, automatically enable and lock password login
    useEffect(() => {
        if (!passkeysExist && settings.loginEnabled && settings.passwordLoginAllowed === false) {
            onChange('passwordLoginAllowed', true);
        }
    }, [passkeysExist, settings.loginEnabled, settings.passwordLoginAllowed, onChange]);

    // Create passkey mutation
    const createPasskeyMutation = useMutation({
        mutationFn: async () => {


            // Step 1: Get registration options
            const optionsResponse = await axios.post(`${API_URL}/settings/passkeys/register`, {
                userName: 'MyTube User',
            });
            const { options, challenge } = optionsResponse.data;

            // Step 2: Start registration with browser
            const attestationResponse = await startRegistration(options);

            // Step 3: Verify registration
            const verifyResponse = await axios.post(`${API_URL}/settings/passkeys/register/verify`, {
                body: attestationResponse,
                challenge,
            });

            if (!verifyResponse.data.success) {
                throw new Error('Passkey registration failed');
            }
        },
        onSuccess: () => {
            refetchPasskeys();
            refetchPasskeys();
            showAlert(t('success'), t('passkeyCreated') || 'Passkey created successfully');
        },
        onError: (error: any) => {
            console.error('Error creating passkey:', error);
            // Extract error message from axios response or error object
            let errorMessage = t('passkeyCreationFailed') || 'Failed to create passkey. Please try again.';

            if (error?.response?.data?.error) {
                // Backend error message
                errorMessage = error.response.data.error;
            } else if (error?.response?.data?.message) {
                errorMessage = error.response.data.message;
            } else if (error?.message) {
                errorMessage = error.message;
            }

            // Check if this is a WebAuthn error that can be translated
            const translationKey = getWebAuthnErrorTranslationKey(errorMessage);
            if (translationKey) {
                errorMessage = t(translationKey) || errorMessage;
            }

            showAlert(t('error'), errorMessage);
        },
    });

    // Remove passkeys mutation
    const removePasskeysMutation = useMutation({
        mutationFn: async () => {
            await axios.delete(`${API_URL}/settings/passkeys`);
        },
        onSuccess: () => {
            refetchPasskeys();
            setShowRemoveModal(false);
            showAlert(t('success'), t('passkeysRemoved') || 'All passkeys have been removed');
        },
        onError: (error: any) => {
            console.error('Error removing passkeys:', error);
            showAlert(t('error'), t('passkeysRemoveFailed') || 'Failed to remove passkeys. Please try again.');
        },
    });

    const handleCreatePasskey = () => {
        // Check if we're in a secure context (HTTPS or localhost)
        // This is the most important check - WebAuthn requires secure context
        if (!window.isSecureContext) {
            const hostname = window.location.hostname;
            const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
            if (!isLocalhost) {
                showAlert(t('error'), t('passkeyRequiresHttps') || 'WebAuthn requires HTTPS or localhost. Please access the application via HTTPS or use localhost instead of an IP address.');
                return;
            }
        }

        // Check if WebAuthn is supported
        // Check multiple ways to detect WebAuthn support
        const hasWebAuthn =
            typeof window.PublicKeyCredential !== 'undefined' ||
            (typeof navigator !== 'undefined' && 'credentials' in navigator && 'create' in navigator.credentials);

        if (!hasWebAuthn) {
            showAlert(t('error'), t('passkeyWebAuthnNotSupported') || 'WebAuthn is not supported in this browser. Please use a modern browser that supports WebAuthn.');
            return;
        }

        createPasskeyMutation.mutate();
    };

    const handleRemovePasskeys = () => {
        removePasskeysMutation.mutate();
    };

    return (
        <Box>
            <FormControlLabel
                control={
                    <Switch
                        checked={settings.loginEnabled}
                        onChange={(e) => onChange('loginEnabled', e.target.checked)}
                        disabled={settings.visitorMode} // Locked enabled if visitor mode is on
                    />
                }
                label={t('enableLogin')}
            />

            {settings.loginEnabled && (
                <Box sx={{ mt: 2, maxWidth: 400 }}>

                    {settings.passwordLoginAllowed !== false && (
                        <TextField
                            fullWidth
                            sx={{ mb: 2 }}
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
                    )}

                    <FormControlLabel
                        control={
                            <Switch
                                checked={!passkeysExist ? true : (settings.passwordLoginAllowed !== false)}
                                onChange={(e) => onChange('passwordLoginAllowed', e.target.checked)}
                                disabled={!settings.loginEnabled || !passkeysExist}
                            />
                        }
                        label={t('allowPasswordLogin') || 'Allow Password Login'}
                    />
                    <Box sx={{ mt: 1, mb: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                            {t('allowPasswordLoginHelper') || 'When disabled, password login is not available. You must have at least one passkey to disable password login.'}
                        </Typography>
                    </Box>

                    <FormControlLabel
                        control={
                            <Switch
                                checked={settings.visitorMode === true}
                                onChange={(e) => {
                                    const enabled = e.target.checked;
                                    onChange('visitorMode', enabled);
                                    // Lock loginEnabled to true if visitor mode is enabled
                                    if (enabled) {
                                        if (!settings.loginEnabled) {
                                            onChange('loginEnabled', true);
                                        }
                                        if (!settings.visitorPassword) {
                                            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
                                            const array = new Uint32Array(12);
                                            window.crypto.getRandomValues(array);
                                            const newPassword = Array.from(array, x => chars[x % chars.length]).join('');
                                            onChange('visitorPassword', newPassword);
                                        }
                                    }
                                }}
                                disabled={!settings.loginEnabled && settings.visitorMode} // Unlock only if login is enabled? Actually user said "loginEnabled should be locked enabled". So if visitor mode is ON, loginEnabled switch (above) should be disabled or force checked.
                            />
                        }
                        label={t('visitorUser') || 'Visitor User'}
                    />
                    <Box sx={{ mt: 1, mb: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                            {t('visitorUserHelper') || 'Enable a restricted Visitor User role. Visitors have read-only access and cannot change settings.'}
                        </Typography>
                    </Box>

                    {settings.visitorMode && (
                        <TextField
                            fullWidth
                            sx={{ mb: 2 }}
                            label={t('visitorPassword') || 'Visitor Password'}
                            type="text" // User said "It should be visible" - wait, "show a input ... It should be visible". Does it mean the input is visible, or the password text is visible? "let admin setup visior password. It should be visible." Usually setup inputs are passwords but maybe they want it visible to see what it is? let's stick to type="text" or "password" with show toggle. "It should be visible" likely means the input field itself appears. I will use standard password field for security but maybe default show? Or just text if implied. "It should be visible" logically refers to the input field appearing. Safe bet is standard password field behavior.
                            value={settings.visitorPassword || ''}
                            onChange={(e) => onChange('visitorPassword', e.target.value)}
                            helperText={
                                settings.isVisitorPasswordSet
                                    ? (t('visitorPasswordSetHelper') || 'Password is set. Leave empty to keep it.')
                                    : (t('visitorPasswordHelper') || 'Password for the Visitor User to log in.')
                            }
                        />
                    )}

                    <FormControlLabel
                        control={
                            <Switch
                                checked={settings.allowResetPassword !== false}
                                onChange={(e) => onChange('allowResetPassword', e.target.checked)}
                                disabled={!settings.loginEnabled}
                            />
                        }
                        label={t('allowResetPassword') || 'Allow Reset Password'}
                    />
                    <Box sx={{ mt: 1, mb: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                            {t('allowResetPasswordHelper') || 'When disabled, the reset password button will not be shown on the login page and the reset password API will be blocked.'}
                        </Typography>
                    </Box>

                    <Box sx={{ mt: 3 }}>
                        <Box sx={{ mb: 2 }}>
                            <Button
                                variant="outlined"
                                onClick={handleCreatePasskey}
                                disabled={!settings.loginEnabled || createPasskeyMutation.isPending}
                                fullWidth
                            >
                                {createPasskeyMutation.isPending
                                    ? (t('creatingPasskey') || 'Creating...')
                                    : (t('createPasskey') || 'Create Passkey')}
                            </Button>
                        </Box>
                        <Button
                            variant="outlined"
                            color="error"
                            onClick={() => setShowRemoveModal(true)}
                            disabled={!settings.loginEnabled || !passkeysExist || removePasskeysMutation.isPending}
                            fullWidth
                        >
                            {t('removePasskeys') || 'Remove All Passkeys'}
                        </Button>
                    </Box>
                </Box>
            )}

            <ConfirmationModal
                isOpen={showRemoveModal}
                onClose={() => setShowRemoveModal(false)}
                onConfirm={handleRemovePasskeys}
                title={t('removePasskeysTitle') || 'Remove All Passkeys'}
                message={t('removePasskeysMessage') || 'Are you sure you want to remove all passkeys? This action cannot be undone.'}
                confirmText={t('remove') || 'Remove'}
                cancelText={t('cancel') || 'Cancel'}
                isDanger={true}
            />

            <AlertModal
                open={alertOpen}
                onClose={() => setAlertOpen(false)}
                title={alertTitle}
                message={alertMessage}
            />
        </Box>
    );
};

export default SecuritySettings;
