import { FindInPage } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    TextField,
    Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import React, { useRef } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useScanStatus } from '../../hooks/useScanStatus';
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

    // Server-side scan state: the scan outlives this component, so a remount
    // (navigating away and back) must not reset the button to idle.
    const { data: scanStatus } = useScanStatus(canUseHostAdminFeatures);
    const isMountScanRunning = scanStatus?.scanType === 'mount';
    const isOtherScanRunning = !!scanStatus?.scanning && !isMountScanRunning;

    // Scan mount directories mutation. Lives here (not in useSettingsMutations)
    // because it composes with the page-local `settings` + `saveMutation`.
    const buildScanMessage = (addedCount: number, deletedCount: number) =>
        t('scanMountDirectoriesSuccess', { addedCount, deletedCount }) ||
        `Mount directories scan complete. Added ${addedCount} new videos. Deleted ${deletedCount} missing videos.`;

    // A failed save must still surface once the scan finishes, since the scan
    // result would otherwise overwrite the warning.
    const saveWarningRef = useRef<string | null>(null);

    const scanMountDirectoriesMutation = useMutation({
        mutationFn: async ({ directories }: { directories: string[] }) => {
            // Mount scans can take much longer than the global API default timeout.
            const res = await api.post('/scan-mount-directories', { directories }, { timeout: 0 });
            return { addedCount: res.data.addedCount, deletedCount: res.data.deletedCount };
        },
        onSuccess: (data) => {
            const scanMsg = buildScanMessage(data.addedCount, data.deletedCount);
            const saveWarning = saveWarningRef.current;

            setMessage(
                saveWarning
                    ? { text: `${scanMsg} Warning: ${saveWarning}`, type: 'warning' }
                    : { text: scanMsg, type: 'success' }
            );
        },
        onError: async (error: any) => {
            const detail = await getApiErrorMessage(error, t);
            setMessage({ text: `${t('scanFilesFailed') || 'Scan failed'}: ${detail}`, type: 'error' });
        }
    });

    // Persist what was typed as soon as the scan starts. Saving only on success
    // meant a scan that failed, timed out, or was navigated away from threw the
    // paths away and the operator had to retype them to try again.
    const persistMountDirectories = (mountDirectoriesText: string) => {
        saveWarningRef.current = null;

        if (saveMutation.isPending) {
            return;
        }

        saveMutation.mutate(
            { ...settings, mountDirectories: mountDirectoriesText },
            {
                onSuccess: () => {
                    setSettings(prev => ({ ...prev, mountDirectories: mountDirectoriesText }));
                },
                onError: async (saveError: any) => {
                    const saveErrorMsg =
                        await getApiErrorMessage(saveError, t) ||
                        t('settingsFailed') ||
                        'Failed to save settings.';
                    saveWarningRef.current = saveErrorMsg;
                    setMessage({ text: saveErrorMsg, type: 'warning' });
                }
            }
        );
    };

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

        persistMountDirectories(mountDirectoriesText);
        scanMountDirectoriesMutation.mutate({ directories });
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
                            loading={scanMountDirectoriesMutation.isPending || isMountScanRunning}
                            disabled={isOtherScanRunning}
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
