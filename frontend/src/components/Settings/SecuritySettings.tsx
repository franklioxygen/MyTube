import { Box, Button, FormControlLabel, Switch, TextField } from '@mui/material';
import { startRegistration } from '@simplewebauthn/browser';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
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
                    />
                }
                label={t('enableLogin')}
            />

            {settings.loginEnabled && (
                <Box sx={{ mt: 2, maxWidth: 400 }}>
                    <TextField
                        fullWidth
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
