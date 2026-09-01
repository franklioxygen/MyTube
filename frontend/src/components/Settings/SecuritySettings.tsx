import DeleteIcon from '@mui/icons-material/Delete';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Box, Button, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import { startRegistration } from '@simplewebauthn/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import { api } from '../../utils/apiClient';
import { copyTextToClipboard } from '../../utils/clipboard';
import { runMutationAsync } from '../../utils/mutationUtils';
import { getWebAuthnErrorTranslationKey } from '../../utils/translations';
import {
    GESTURE_LOGIN_STATUS_QUERY_KEY,
    fetchGestureLoginStatus,
    removeGestureLogin,
} from '../../utils/gestureLogin';
import GestureLoginSetupDialog from '../Auth/GestureLoginSetupDialog';
import AlertModal from '../AlertModal';
import ConfirmationModal from '../ConfirmationModal';
import UserManagementSettings from './UserManagementSettings';

interface SecuritySettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
}

const isLocalhostHostname = (hostname: string): boolean => {
    const normalizedHostname = hostname
        .replace(/^\[(.*)\]$/, '$1')
        .toLowerCase();
    const isIpv4LoopbackLiteral = /^127(?:\.\d{1,3}){3}$/.test(normalizedHostname);
    return normalizedHostname === 'localhost'
        || normalizedHostname === '::1'
        || isIpv4LoopbackLiteral
        || normalizedHostname.endsWith('.localhost');
};

const generateApiKey = (): string => {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
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

    const queryClient = useQueryClient();
    const [gestureDialogOpen, setGestureDialogOpen] = useState(false);
    const [gestureDialogMode, setGestureDialogMode] = useState<'create' | 'change'>('create');
    const [showRemoveGestureModal, setShowRemoveGestureModal] = useState(false);

    const {
        data: gestureStatus,
        isLoading: gestureStatusLoading,
        isError: gestureStatusError,
        refetch: refetchGestureStatus,
    } = useQuery({
        queryKey: GESTURE_LOGIN_STATUS_QUERY_KEY,
        queryFn: fetchGestureLoginStatus,
    });

    const removeGestureMutation = useMutation({
        mutationFn: () => removeGestureLogin(),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: GESTURE_LOGIN_STATUS_QUERY_KEY });
            setShowRemoveGestureModal(false);
        },
        onError: () => {
            setShowRemoveGestureModal(false);
            showAlert(
                t('error'),
                t('gestureLoginRemoveFailed') || 'Gesture Login could not be removed. Please try again.'
            );
        },
    });

    // Enrolment needs the prerequisite to be true in BOTH the persisted status
    // and the unsaved draft. Persisted-only would let the admin enrol against a
    // draft they are about to turn off; draft-only would enrol against a
    // prerequisite the server has not accepted yet and would reject.
    const gestureDraftPrerequisites =
        settings.loginEnabled === true && settings.passwordLoginAllowed !== false;
    const gestureConfigured = gestureStatus?.configured === true;
    const gestureLocked = gestureStatus?.locked === true;
    const gestureResetRequired = gestureStatus?.resetRequired === true;
    // Never act on an unknown state: a failed or pending status request must
    // not render a switch that looks like a deliberate OFF.
    const gestureStatusKnown = !gestureStatusLoading && !gestureStatusError && !!gestureStatus;
    const canStartGestureEnrollment =
        gestureStatusKnown &&
        gestureDraftPrerequisites &&
        gestureStatus.canConfigure &&
        !gestureConfigured;

    const isSecureOriginForPasskeys =
        window.isSecureContext || isLocalhostHostname(window.location.hostname);
    const canChangePasswordLoginSetting =
        isSecureOriginForPasskeys || settings.passwordLoginAllowed === false;

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
        // WebAuthn requires HTTPS or localhost.
        if (!isSecureOriginForPasskeys) {
            showAlert(t('error'), t('passkeyRequiresHttps') || 'WebAuthn requires HTTPS or localhost. Please access the application via HTTPS or use localhost instead of an IP address.');
            return;
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

    const handleRemovePasskeys = async () => {
        await runMutationAsync(removePasskeysMutation, undefined);
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
                                    disabled={!settings.loginEnabled || !passkeysExist || !canChangePasswordLoginSetting || gestureConfigured}
                                />
                            }
                            label={t('allowPasswordLogin') || 'Allow Password Login'}
                        />
                    </Box>
                    <Box sx={{ mt: 1, mb: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                            {t('allowPasswordLoginHelper') || 'When disabled, password login is not available. You must have at least one passkey to disable password login.'}
                        </Typography>
                        {!isSecureOriginForPasskeys && (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                {t('allowPasswordLoginHttpsOnlyHelper') || 'To disable password login, open this page over HTTPS or localhost. Passkey-only login requires a secure origin.'}
                            </Typography>
                        )}
                        {gestureConfigured && (
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ mt: 0.5 }}
                                data-testid="gesture-blocks-password-login"
                            >
                                {t('gestureLoginDisablePasswordBlocked') || 'Turn off Gesture Login before disabling password login.'}
                            </Typography>
                        )}
                    </Box>

                    <Box data-testid="gesture-login-section">
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={gestureConfigured}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setGestureDialogMode('create');
                                            setGestureDialogOpen(true);
                                        } else {
                                            setShowRemoveGestureModal(true);
                                        }
                                    }}
                                    disabled={
                                        removeGestureMutation.isPending ||
                                        (gestureConfigured
                                            ? false
                                            : !canStartGestureEnrollment)
                                    }
                                    inputProps={{ 'aria-label': t('gestureLogin') || 'Gesture Login' }}
                                />
                            }
                            label={t('gestureLogin') || 'Gesture Login'}
                        />
                    </Box>
                    <Box sx={{ mt: 1, mb: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                            {t('gestureLoginHelper') || 'Draw a 3x3 pattern to sign in as admin. Password login stays available as recovery after three incorrect gestures.'}
                        </Typography>

                        {gestureStatusLoading && (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="gesture-status-loading">
                                {t('loading') || 'Loading...'}
                            </Typography>
                        )}

                        {gestureStatusError && (
                            <Box sx={{ mt: 0.5 }} data-testid="gesture-status-error">
                                <Typography variant="body2" color="error">
                                    {t('gestureLoginStatusFailed') || 'Gesture Login status could not be loaded.'}
                                </Typography>
                                <Button size="small" onClick={() => refetchGestureStatus()}>
                                    {t('gestureLoginRetryStatus') || 'Retry'}
                                </Button>
                            </Box>
                        )}

                        {gestureStatusKnown && !gestureConfigured && !gestureResetRequired && !gestureDraftPrerequisites && (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="gesture-prerequisite-hint">
                                {t('gestureLoginPasswordRequired') || 'Enable and save password login first.'}
                            </Typography>
                        )}

                        {gestureStatusKnown && !gestureConfigured && !gestureResetRequired && gestureDraftPrerequisites && !gestureStatus.canConfigure && (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="gesture-save-first-hint">
                                {t('gestureLoginSavePrerequisitesFirst') || 'Save login and password settings before enabling Gesture Login.'}
                            </Typography>
                        )}

                        {gestureStatusKnown && gestureResetRequired && (
                            <Box sx={{ mt: 0.5 }} data-testid="gesture-reset-required">
                                <Typography variant="body2" color="error">
                                    {t('gestureLoginResetRequired') || 'Your saved gesture can no longer be verified on this server. Set a new one.'}
                                </Typography>
                                <Button
                                    size="small"
                                    onClick={() => {
                                        setGestureDialogMode('change');
                                        setGestureDialogOpen(true);
                                    }}
                                >
                                    {t('gestureLoginSetNew') || 'Set New Gesture'}
                                </Button>
                            </Box>
                        )}

                        {gestureStatusKnown && gestureConfigured && gestureLocked && (
                            <Typography variant="body2" color="error" sx={{ mt: 0.5 }} data-testid="gesture-locked-hint">
                                {t('gestureLoginLockedSettings') || 'Temporarily locked. Sign out and complete one admin password login to restore it.'}
                            </Typography>
                        )}

                        {gestureStatusKnown && gestureConfigured && !gestureLocked && (
                            <Button
                                size="small"
                                sx={{ mt: 0.5 }}
                                data-testid="gesture-change-button"
                                onClick={() => {
                                    setGestureDialogMode('change');
                                    setGestureDialogOpen(true);
                                }}
                            >
                                {t('gestureLoginChange') || 'Change Gesture'}
                            </Button>
                        )}
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
                                disabled={!settings.loginEnabled}
                                loading={createPasskeyMutation.isPending}
                                loadingPosition="start"
                                fullWidth
                            >
                                {t('createPasskey') || 'Create Passkey'}
                            </Button>
                        </Box>
                        <Button
                            variant="outlined"
                            color="error"
                            startIcon={<DeleteIcon />}
                            onClick={() => setShowRemoveModal(true)}
                            disabled={!settings.loginEnabled || !passkeysExist}
                            loading={removePasskeysMutation.isPending}
                            loadingPosition="start"
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
                        <UserManagementSettings
                            loginEnabled={settings.loginEnabled}
                            visitorUserEnabled={true}
                        />
                    )}

                </Box>
            )}

            <ConfirmationModal
                isOpen={showRefreshKeyModal}
                onClose={() => setShowRefreshKeyModal(false)}
                onConfirm={() => {
                    handleRefreshApiKey();
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

            <ConfirmationModal
                isOpen={showRemoveGestureModal}
                onClose={() => setShowRemoveGestureModal(false)}
                onConfirm={() => removeGestureMutation.mutate()}
                title={t('gestureLoginRemoveTitle') || 'Turn Off Gesture Login'}
                message={t('gestureLoginRemoveMessage') || 'This deletes the saved gesture immediately. This action cannot be undone.'}
                confirmText={t('remove') || 'Remove'}
                cancelText={t('cancel') || 'Cancel'}
                isDanger={true}
            />

            <GestureLoginSetupDialog
                open={gestureDialogOpen}
                mode={gestureDialogMode}
                onClose={() => setGestureDialogOpen(false)}
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
