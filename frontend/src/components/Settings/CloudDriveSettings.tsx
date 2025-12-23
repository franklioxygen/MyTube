import { Alert, Box, Button, CircularProgress, FormControlLabel, LinearProgress, Switch, TextField, Typography } from '@mui/material';
import axios from 'axios';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import ConfirmationModal from '../ConfirmationModal';

interface CloudDriveSettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
}

interface SyncProgress {
    type: 'progress' | 'complete' | 'error';
    current?: number;
    total?: number;
    currentFile?: string;
    message?: string;
    report?: {
        total: number;
        uploaded: number;
        skipped: number;
        failed: number;
        errors: string[];
    };
}

const CloudDriveSettings: React.FC<CloudDriveSettingsProps> = ({ settings, onChange }) => {
    const { t } = useLanguage();
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [showSyncModal, setShowSyncModal] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);

    // Validate API URL format
    const validateApiUrl = (url: string): string | null => {
        if (!url.trim()) {
            return 'This field is required';
        }
        try {
            const urlObj = new URL(url);
            if (!urlObj.protocol.startsWith('http')) {
                return 'URL must start with http:// or https://';
            }
            if (!url.includes('/api/fs/put')) {
                return 'URL should end with /api/fs/put';
            }
        } catch {
            return 'Invalid URL format';
        }
        return null;
    };

    // Validate public URL format
    const validatePublicUrl = (url: string): string | null => {
        if (!url.trim()) {
            return null; // Optional field
        }
        try {
            const urlObj = new URL(url);
            if (!urlObj.protocol.startsWith('http')) {
                return 'URL must start with http:// or https://';
            }
        } catch {
            return 'Invalid URL format';
        }
        return null;
    };

    // Validate upload path
    const validateUploadPath = (path: string): string | null => {
        if (!path.trim()) {
            return null; // Optional field, but recommend starting with /
        }
        if (!path.startsWith('/')) {
            return 'Path should start with / (e.g., /mytube-uploads)';
        }
        return null;
    };

    // Validate scan paths (multi-line)
    const validateScanPaths = (paths: string): string | null => {
        if (!paths.trim()) {
            return null; // Optional field
        }
        const lines = paths.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        for (const line of lines) {
            if (!line.startsWith('/')) {
                return 'Each path should start with / (e.g., /a/movies)';
            }
        }
        return null;
    };

    const apiUrlError = settings.cloudDriveEnabled && settings.openListApiUrl
        ? validateApiUrl(settings.openListApiUrl)
        : null;
    const publicUrlError = settings.cloudDriveEnabled && settings.openListPublicUrl
        ? validatePublicUrl(settings.openListPublicUrl)
        : null;
    const uploadPathError = settings.cloudDriveEnabled && settings.cloudDrivePath
        ? validateUploadPath(settings.cloudDrivePath)
        : null;
    const scanPathsError = settings.cloudDriveEnabled && settings.cloudDriveScanPaths
        ? validateScanPaths(settings.cloudDriveScanPaths)
        : null;

    const handleTestConnection = async () => {
        if (!settings.openListApiUrl || !settings.openListToken) {
            setTestResult({
                type: 'error',
                message: t('fillApiUrlToken')
            });
            return;
        }

        setTesting(true);
        setTestResult(null);

        try {
            // Use Public URL if available, otherwise fall back to API URL
            // Public URL is what users will actually access, so it's more important to test
            let testUrl = settings.openListPublicUrl?.trim() || settings.openListApiUrl.trim();

            // If the URL doesn't start with http:// or https://, it's invalid
            if (!testUrl.startsWith('http://') && !testUrl.startsWith('https://')) {
                throw new Error('Invalid URL format');
            }

            // For public URL, test the root path; for API URL, use the URL as-is
            if (settings.openListPublicUrl) {
                // Ensure the public URL doesn't have a trailing slash for the root test
                testUrl = testUrl.replace(/\/$/, '');
            }

            // Use axios.request with explicit config to avoid any baseURL defaults
            // This ensures we're using the exact URL from settings
            const response = await axios.request({
                method: 'HEAD',
                url: testUrl,
                headers: {
                    Authorization: settings.openListToken,
                },
                timeout: 5000,
                validateStatus: () => true, // Accept any status for testing
            });

            if (response.status < 500) {
                setTestResult({
                    type: 'success',
                    message: t('connectionTestSuccess')
                });
            } else {
                setTestResult({
                    type: 'error',
                    message: t('connectionFailedStatus', { status: response.status })
                });
            }
        } catch (error: any) {
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                setTestResult({
                    type: 'error',
                    message: t('connectionFailedUrl')
                });
            } else if (error.response?.status === 401 || error.response?.status === 403) {
                setTestResult({
                    type: 'error',
                    message: t('authFailed')
                });
            } else {
                setTestResult({
                    type: 'error',
                    message: t('connectionTestFailed', { error: error.message || t('error') })
                });
            }
        } finally {
            setTesting(false);
        }
    };

    const handleSync = async () => {
        setShowSyncModal(false);
        setSyncing(true);
        setSyncProgress(null);
        setTestResult(null);

        try {
            const API_URL = import.meta.env.VITE_API_URL || '';
            const response = await fetch(`${API_URL}/cloud/sync`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Sync failed: ${response.statusText}`);
            }

            // Read streaming response
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) {
                throw new Error('Failed to get response reader');
            }

            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const progress: SyncProgress = JSON.parse(line);
                            setSyncProgress(progress);

                            if (progress.type === 'complete' || progress.type === 'error') {
                                setSyncing(false);
                            }
                        } catch (e) {
                            console.error('Failed to parse progress:', e, line);
                        }
                    }
                }
            }

            // Process any remaining buffer
            if (buffer.trim()) {
                try {
                    const progress: SyncProgress = JSON.parse(buffer);
                    setSyncProgress(progress);
                    if (progress.type === 'complete' || progress.type === 'error') {
                        setSyncing(false);
                    }
                } catch (e) {
                    console.error('Failed to parse final progress:', e);
                }
            }
        } catch (error: any) {
            setSyncing(false);
            setTestResult({
                type: 'error',
                message: error.message || t('syncFailedMessage'),
            });
        }
    };

    return (
        <Box>
            <Typography variant="h6" gutterBottom>{t('cloudDriveSettings')} (beta)</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('cloudDriveDescription')}
            </Typography>

            <FormControlLabel
                control={
                    <Switch
                        checked={settings.cloudDriveEnabled || false}
                        onChange={(e) => onChange('cloudDriveEnabled', e.target.checked)}
                    />
                }
                label={t('enableAutoSave')}
            />

            {settings.cloudDriveEnabled && (
                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 600 }}>
                    <TextField
                        label={t('apiUrl')}
                        value={settings.openListApiUrl || ''}
                        onChange={(e) => onChange('openListApiUrl', e.target.value)}
                        helperText={t('apiUrlHelper')}
                        error={!!apiUrlError}
                        required
                        fullWidth
                    />
                    {apiUrlError && (
                        <Typography variant="caption" color="error" sx={{ mt: -1.5 }}>
                            {apiUrlError}
                        </Typography>
                    )}

                    <TextField
                        label={t('token')}
                        value={settings.openListToken || ''}
                        onChange={(e) => onChange('openListToken', e.target.value)}
                        type="password"
                        helperText="Alist API token for authentication"
                        required
                        fullWidth
                    />

                    <TextField
                        label={t('publicUrl')}
                        value={settings.openListPublicUrl || ''}
                        onChange={(e) => onChange('openListPublicUrl', e.target.value)}
                        helperText={t('publicUrlHelper')}
                        error={!!publicUrlError}
                        placeholder="https://your-cloudflare-tunnel-domain.com"
                        fullWidth
                    />
                    {publicUrlError && (
                        <Typography variant="caption" color="error" sx={{ mt: -1.5 }}>
                            {publicUrlError}
                        </Typography>
                    )}

                    <TextField
                        label={t('uploadPath')}
                        value={settings.cloudDrivePath || ''}
                        onChange={(e) => onChange('cloudDrivePath', e.target.value)}
                        helperText={t('cloudDrivePathHelper')}
                        error={!!uploadPathError}
                        placeholder="/mytube-uploads"
                        fullWidth
                    />
                    {uploadPathError && (
                        <Typography variant="caption" color="error" sx={{ mt: -1.5 }}>
                            {uploadPathError}
                        </Typography>
                    )}

                    <TextField
                        label={t('scanPaths')}
                        value={settings.cloudDriveScanPaths || ''}
                        onChange={(e) => onChange('cloudDriveScanPaths', e.target.value)}
                        helperText={t('scanPathsHelper')}
                        error={!!scanPathsError}
                        placeholder="/a/Movies&#10;/b/Documentaries"
                        multiline
                        rows={4}
                        fullWidth
                    />
                    {scanPathsError && (
                        <Typography variant="caption" color="error" sx={{ mt: -1.5 }}>
                            {scanPathsError}
                        </Typography>
                    )}

                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        <Button
                            variant="outlined"
                            onClick={handleTestConnection}
                            disabled={testing || syncing || !settings.openListApiUrl || !settings.openListToken}
                            startIcon={testing ? <CircularProgress size={16} /> : null}
                        >
                            {testing ? t('testing') : t('testConnection')}
                        </Button>

                        <Button
                            variant="contained"
                            color="primary"
                            onClick={() => setShowSyncModal(true)}
                            disabled={testing || syncing || !settings.openListApiUrl || !settings.openListToken}
                        >
                            {t('sync')}
                        </Button>
                    </Box>

                    {syncing && syncProgress && (
                        <Box sx={{ mt: 2 }}>
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                {syncProgress.current === 0 && syncProgress.total !== undefined
                                    ? t('foundVideosToSync', { count: syncProgress.total })
                                    : syncProgress.currentFile
                                        ? t('uploadingVideo', { title: syncProgress.currentFile })
                                        : syncProgress.message || t('syncing')}
                            </Typography>
                            {syncProgress.current !== undefined && syncProgress.total !== undefined && (
                                <>
                                    <LinearProgress
                                        variant="determinate"
                                        value={(syncProgress.current / syncProgress.total) * 100}
                                        sx={{ mb: 1 }}
                                    />
                                    <Typography variant="caption" color="text.secondary">
                                        {syncProgress.current} / {syncProgress.total} files
                                        {syncProgress.currentFile && ` - ${syncProgress.currentFile}`}
                                    </Typography>
                                </>
                            )}
                        </Box>
                    )}

                    {!syncing && syncProgress?.type === 'complete' && syncProgress.report && (
                        <Alert severity="success" sx={{ mt: 2 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                                {t('syncCompleted')}
                            </Typography>
                            <Typography variant="body2">
                                {t('syncReport', {
                                    total: syncProgress.report.total,
                                    uploaded: syncProgress.report.uploaded,
                                    failed: syncProgress.report.failed
                                })}
                            </Typography>
                            {syncProgress.report.errors.length > 0 && (
                                <Box sx={{ mt: 1 }}>
                                    <Typography variant="caption" color="error">
                                        {t('syncErrors')}
                                    </Typography>
                                    <Box component="ul" sx={{ mt: 0.5, pl: 2, mb: 0 }}>
                                        {syncProgress.report.errors.map((error, idx) => (
                                            <li key={idx}>
                                                <Typography variant="caption" color="error">
                                                    {error}
                                                </Typography>
                                            </li>
                                        ))}
                                    </Box>
                                </Box>
                            )}
                        </Alert>
                    )}

                    {!syncing && syncProgress?.type === 'error' && (
                        <Alert severity="error" sx={{ mt: 2 }} onClose={() => setSyncProgress(null)}>
                            {syncProgress.message || t('syncFailed')}
                        </Alert>
                    )}

                    {testResult && (
                        <Alert severity={testResult.type} onClose={() => setTestResult(null)}>
                            {testResult.message}
                        </Alert>
                    )}

                    <Alert severity="info" sx={{ mt: 1 }}>
                        <Typography variant="body2">
                            <strong>{t('note')}:</strong> {t('cloudDriveNote')}
                        </Typography>
                    </Alert>
                </Box>
            )}

            <ConfirmationModal
                isOpen={showSyncModal}
                onClose={() => setShowSyncModal(false)}
                onConfirm={handleSync}
                title={t('syncToCloud')}
                message={t('syncWarning')}
                confirmText={t('confirm') || 'Confirm'}
                cancelText={t('cancel') || 'Cancel'}
                isDanger={true}
            />
        </Box>
    );
};

export default CloudDriveSettings;
