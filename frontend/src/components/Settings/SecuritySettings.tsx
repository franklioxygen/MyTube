import DeleteIcon from '@mui/icons-material/Delete';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Box, Button, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import { startRegistration } from '@simplewebauthn/browser';
import { useMutation, useQuery } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import { api } from '../../utils/apiClient';
import { getWebAuthnErrorTranslationKey } from '../../utils/translations';
import AlertModal from '../AlertModal';
import ConfirmationModal from '../ConfirmationModal';

interface SecuritySettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
}

const generateApiKey = (): string => {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const copyTextToClipboard = async (text: string): Promise<boolean> => {
    const clipboardWriteText =
        typeof navigator.clipboard?.writeText === 'function'
            ? navigator.clipboard.writeText.bind(navigator.clipboard)
            : null;

    if (clipboardWriteText) {
        await clipboardWriteText(text);
        return true;
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        return document.execCommand('copy');
    } finally {
        document.body.removeChild(textArea);
    }
};

const SecuritySettings: React.FC<SecuritySettingsProps> = ({ settings, onChange }) => {
    const { t } = useLanguage();
    const [showRemoveModal, setShowRemoveModal] = useState(false);
    const [showRefreshKeyModal, setShowRefreshKeyModal] = useState(false);
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
            const response = await api.get('/settings/passkeys/exists');
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
            const optionsResponse = await api.post('/settings/passkeys/register', {
                userName: 'MyTube User',
            });
            const { options, challenge } = optionsResponse.data;

            // Step 2: Start registration with browser
            const attestationResponse = await startRegistration({
                optionsJSON: options,
            });

            // Step 3: Verify registration
            const verifyResponse = await api.post('/settings/passkeys/register/verify', {
                body: attestationResponse,
                challenge,
            });

            if (!verifyResponse.data.success) {
                throw new Error('Passkey registration failed');
            }
        },
        onSuccess: () => {
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
            await api.delete('/settings/passkeys');
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

    const handleApiKeyToggle = (enabled: boolean) => {
        onChange('apiKeyEnabled', enabled);
        if (enabled && !settings.apiKey) {
            onChange('apiKey', generateApiKey());
        }
    };

    const handleRefreshApiKey = () => {
        onChange('apiKey', generateApiKey());
    };

    const handleCopyApiKey = async () => {
        if (!settings.apiKey) {
            return;
        }

        try {
            const copied = await copyTextToClipboard(settings.apiKey);
            if (copied) {
                showAlert(t('success'), t('apiKeyCopied') || 'API key copied to clipboard');
                return;
            }

            showAlert(t('error'), t('apiKeyCopyFailed') || 'Failed to copy API key. Please copy it manually.');
        } catch (error) {
            console.error('Error copying API key:', error);
            showAlert(t('error'), t('apiKeyCopyFailed') || 'Failed to copy API key. Please copy it manually.');
        }
    };

    return (
        <Box>
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
                <Box sx={{ mt: 2 }}>

                    {settings.passwordLoginAllowed !== false && (
                        <TextField
                            fullWidth
                            sx={{ mb: 2, maxWidth: 400 }}
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

                    <Box>
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
                    </Box>
                    <Box sx={{ mt: 1, mb: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                            {t('allowPasswordLoginHelper') || 'When disabled, password login is not available. You must have at least one passkey to disable password login.'}
                        </Typography>
                    </Box>

                    <FormControlLabel
                        control={
                            <Switch
                                checked={settings.apiKeyEnabled === true}
                                onChange={(e) => handleApiKeyToggle(e.target.checked)}
                                disabled={!settings.loginEnabled}
                            />
                        }
                        label={t('enableApiKeyAuth') || 'Enable API Key Authentication'}
                    />

                    {settings.apiKeyEnabled === true && (
                        <>
                            <Box sx={{ mt: 1, mb: 2 }}>
                                <Typography variant="body2" color="text.secondary">
                                    {t('apiKeyAuthHelper') || 'When enabled, API requests can be authorized with X-API-Key without a login session.'}
                                </Typography>
                            </Box>
                            <Box sx={{ mb: 1, maxWidth: 400 }}>
                                <TextField
                                    fullWidth
                                    label={t('apiKey') || 'API Key'}
                                    value={settings.apiKey || ''}
                                    InputProps={{ readOnly: true }}
                                    helperText={t('apiKeySaveHint') || 'Save settings to activate changes to the API key.'}
                                />
                            </Box>
                            <Box sx={{ mb: 2, maxWidth: 400, display: 'flex', gap: 1 }}>
                                <Button
                                    fullWidth
                                    variant="outlined"
                                    startIcon={<RefreshIcon />}
                                    onClick={() => setShowRefreshKeyModal(true)}
                                >
                                    {t('refreshApiKey') || 'Refresh'}
                                </Button>
                                <Button
                                    fullWidth
                                    variant="outlined"
                                    startIcon={<ContentCopyIcon />}
                                    onClick={handleCopyApiKey}
                                    disabled={!settings.apiKey}
                                >
                                    {t('copyApiKey') || 'Copy'}
                                </Button>
                            </Box>
                        </>
                    )}

                    <Box sx={{ mt: 3, maxWidth: 400 }}>
                        <Box sx={{ mb: 2 }}>
                            <Button
                                variant="outlined"
                                startIcon={<FingerprintIcon />}
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
                            startIcon={<DeleteIcon />}
                            onClick={() => setShowRemoveModal(true)}
                            disabled={!settings.loginEnabled || !passkeysExist || removePasskeysMutation.isPending}
                            fullWidth
                        >
                            {t('removePasskeys') || 'Remove All Passkeys'}
                        </Button>
                    </Box>

                    <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>
                        {t('visitorUser') || 'Visitor User'}
                    </Typography>

                    <Box>
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={settings.visitorUserEnabled !== false}
                                    onChange={(e) => onChange('visitorUserEnabled', e.target.checked)}
                                    disabled={!settings.loginEnabled}
                                />
                            }
                            label={t('enableVisitorUser') || 'Enable Visitor User'}
                            sx={{ mt: 1 }}
                        />
                    </Box>


                    {settings.visitorUserEnabled !== false && (
                        <>
                            <Box sx={{ mt: 1, mb: 2 }}>
                                <Typography variant="body2" color="text.secondary">
                                    {t('visitorUserHelper') || 'Set a password for the Visitor User role. Users logging in with this password will have read-only access and cannot change settings.'}
                                </Typography>
                            </Box>
                            <TextField
                                fullWidth
                                sx={{ mb: 2, maxWidth: 400 }}
                                label={t('visitorPassword') || 'Visitor Password'}
                                type="text"
                                value={settings.visitorPassword || ''}
                                onChange={(e) => onChange('visitorPassword', e.target.value)}
                                helperText={
                                    settings.isVisitorPasswordSet
                                        ? (t('visitorPasswordSetHelper') || 'Password is set. Leave empty to keep it.')
                                        : (t('visitorPasswordHelper') || 'Password for the Visitor User to log in.')
                                }
                            />
                        </>
                    )}

                </Box>
            )}

            <ConfirmationModal
                isOpen={showRefreshKeyModal}
                onClose={() => setShowRefreshKeyModal(false)}
                onConfirm={() => {
                    handleRefreshApiKey();
                    setShowRefreshKeyModal(false);
                }}
                title={t('refreshApiKeyTitle') || 'Refresh API Key'}
                message={t('refreshApiKeyConfirm') || 'Regenerating the API key will invalidate the existing one. All clients using the old key will need to be updated after saving.'}
                confirmText={t('confirm') || 'Confirm'}
                cancelText={t('cancel') || 'Cancel'}
                isDanger={true}
            />

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
