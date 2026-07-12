import { FindInPage } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    TextField,
    Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import { api, getApiErrorMessage } from '../../utils/apiClient';
import { createTranslateOrFallback } from '../../utils/translateOrFallback';

type MessageType = { text: string; type: 'success' | 'error' | 'warning' | 'info' };

interface MountDirectoriesSettingsProps {
    mountDirectories: string;
    onChange: (field: keyof Settings, value: string | boolean | number) => void;
    canUseHostAdminFeatures: boolean;
    settings: Settings;
    setSettings: React.Dispatch<React.SetStateAction<Settings>>;
    saveMutation: {
        isPending: boolean;
        mutate: (
            variables: Settings,
            options?: {
                onSuccess?: () => void;
                onError?: (error: any) => Promise<void> | void;
            }
        ) => void;
    };
    onShowDetails: () => void;
    detailsButtonAriaLabel: string;
    setMessage: (msg: MessageType | null) => void;
}

const MountDirectoriesSettings: React.FC<MountDirectoriesSettingsProps> = ({
    mountDirectories,
    onChange,
    canUseHostAdminFeatures,
    settings,
    setSettings,
    saveMutation,
    onShowDetails,
    detailsButtonAriaLabel,
    setMessage,
}) => {
    const { t } = useLanguage();
    const translateOrFallback = createTranslateOrFallback(t);

    // Scan mount directories mutation. Lives here (not in useSettingsMutations)
    // because it composes with the page-local `settings` + `saveMutation`.
    const scanMountDirectoriesMutation = useMutation({
        mutationFn: async ({ directories, mountDirectoriesText }: { directories: string[]; mountDirectoriesText: string }) => {
            // Mount scans can take much longer than the global API default timeout.
            const res = await api.post('/scan-mount-directories', { directories }, { timeout: 0 });
            // Return scan results along with mountDirectoriesText for saving
            return { addedCount: res.data.addedCount, deletedCount: res.data.deletedCount, mountDirectoriesText };
        },
        onSuccess: (data) => {
            // Save settings after successful scan to persist mountDirectories
            // Use the mountDirectoriesText passed to the mutation to ensure we save the latest value
            const settingsToSave = {
                ...settings,
                mountDirectories: data.mountDirectoriesText
            };

            if (!saveMutation.isPending) {
                saveMutation.mutate(settingsToSave, {
                    onSuccess: () => {
                        const scanMsg = t('scanMountDirectoriesSuccess', {
                            addedCount: data.addedCount,
                            deletedCount: data.deletedCount
                        }) || `Mount directories scan complete. Added ${data.addedCount} new videos. Deleted ${data.deletedCount} missing videos.`;
                        const saveMsg = t('settingsSaved') || 'Settings saved.';
                        setMessage({ text: `${scanMsg} ${saveMsg}`, type: 'success' });
                        // Update local settings state to reflect saved mountDirectories
                        setSettings(prev => ({ ...prev, mountDirectories: data.mountDirectoriesText }));
                    },
                    onError: async (saveError: any) => {
                        const scanMsg = t('scanMountDirectoriesSuccess', {
                            addedCount: data.addedCount,
                            deletedCount: data.deletedCount
                        }) || `Mount directories scan complete. Added ${data.addedCount} new videos. Deleted ${data.deletedCount} missing videos.`;
                        const saveErrorMsg = await getApiErrorMessage(saveError, t) || t('settingsFailed') || 'Failed to save settings.';
                        setMessage({ text: `${scanMsg} Warning: ${saveErrorMsg}`, type: 'warning' });
                    }
                });
            } else {
                const scanMsg = t('scanMountDirectoriesSuccess', {
                    addedCount: data.addedCount,
                    deletedCount: data.deletedCount
                }) || `Mount directories scan complete. Added ${data.addedCount} new videos. Deleted ${data.deletedCount} missing videos.`;
                setMessage({ text: scanMsg, type: 'success' });
            }
        },
        onError: async (error: any) => {
            const detail = await getApiErrorMessage(error, t);
            setMessage({ text: `${t('scanFilesFailed') || 'Scan failed'}: ${detail}`, type: 'error' });
        }
    });

    const handleScanMountDirectories = () => {
        const mountDirectoriesText = mountDirectories || '';
        const directories = mountDirectoriesText
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        if (directories.length === 0) {
            setMessage({ text: t('mountDirectoriesEmptyError'), type: 'error' });
            return;
        }
        scanMountDirectoriesMutation.mutate({ directories, mountDirectoriesText });
    };

    const renderDetailsButton = () => (
        <Button
            variant="text"
            size="small"
            onClick={onShowDetails}
            aria-label={detailsButtonAriaLabel}
            sx={{ minWidth: 0, p: 0, ml: 0.5, verticalAlign: 'baseline', textTransform: 'none' }}
        >
            {translateOrFallback('deploymentSecurityDetails', 'Details')}
        </Button>
    );

    return (
        <Box sx={{ maxWidth: 400 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
                {t('mountDirectories')}
            </Typography>
            {canUseHostAdminFeatures ? (
                <>
                    <TextField
                        fullWidth
                        multiline
                        rows={4}
                        value={mountDirectories || ''}
                        onChange={(e) => onChange('mountDirectories', e.target.value)}
                        placeholder={t('mountDirectoriesPlaceholder')}
                        helperText={t('mountDirectoriesHelper')}
                    />
                    <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                        <Button
                            variant="outlined"
                            startIcon={<FindInPage />}
                            onClick={handleScanMountDirectories}
                            loading={scanMountDirectoriesMutation.isPending}
                            loadingPosition="start"
                        >
                            {t('scanFiles') || 'Scan Files'}
                        </Button>
                    </Box>
                </>
            ) : (
                <Alert severity="info">
                    {translateOrFallback(
                        'mountDirectoriesPolicyNotice',
                        'Mount directories require host-level admin trust.'
                    )}
                    {renderDetailsButton()}
                </Alert>
            )}
        </Box>
    );
};

export default MountDirectoriesSettings;
