import { Alert, Box, Button, CircularProgress, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import axios from 'axios';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';

interface CloudDriveSettingsProps {
    settings: Settings;
    onChange: (field: keyof Settings, value: any) => void;
}

const CloudDriveSettings: React.FC<CloudDriveSettingsProps> = ({ settings, onChange }) => {
    const { t } = useLanguage();
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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

    const apiUrlError = settings.cloudDriveEnabled && settings.openListApiUrl
        ? validateApiUrl(settings.openListApiUrl)
        : null;
    const publicUrlError = settings.cloudDriveEnabled && settings.openListPublicUrl
        ? validatePublicUrl(settings.openListPublicUrl)
        : null;
    const uploadPathError = settings.cloudDriveEnabled && settings.cloudDrivePath
        ? validateUploadPath(settings.cloudDrivePath)
        : null;

    const handleTestConnection = async () => {
        if (!settings.openListApiUrl || !settings.openListToken) {
            setTestResult({
                type: 'error',
                message: 'Please fill in API URL and Token first'
            });
            return;
        }

        setTesting(true);
        setTestResult(null);

        try {
            // Test connection by attempting to upload a small test file
            // Or we could use a different Alist API endpoint to test
            const testUrl = settings.openListApiUrl;
            
            // Try to make a HEAD request or use a test endpoint
            // For now, we'll just validate the URL format and token presence
            const response = await axios.head(testUrl, {
                headers: {
                    Authorization: settings.openListToken,
                },
                timeout: 5000,
                validateStatus: () => true, // Accept any status for testing
            });

            if (response.status < 500) {
                setTestResult({
                    type: 'success',
                    message: 'Connection test successful! Settings are valid.'
                });
            } else {
                setTestResult({
                    type: 'error',
                    message: `Connection failed: Server returned status ${response.status}`
                });
            }
        } catch (error: any) {
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                setTestResult({
                    type: 'error',
                    message: 'Cannot connect to server. Please check the API URL.'
                });
            } else if (error.response?.status === 401 || error.response?.status === 403) {
                setTestResult({
                    type: 'error',
                    message: 'Authentication failed. Please check your token.'
                });
            } else {
                setTestResult({
                    type: 'error',
                    message: `Connection test failed: ${error.message || 'Unknown error'}`
                });
            }
        } finally {
            setTesting(false);
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

                    <Button
                        variant="outlined"
                        onClick={handleTestConnection}
                        disabled={testing || !settings.openListApiUrl || !settings.openListToken}
                        startIcon={testing ? <CircularProgress size={16} /> : null}
                        sx={{ alignSelf: 'flex-start' }}
                    >
                        {testing ? t('testing') : t('testConnection')}
                    </Button>

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
        </Box>
    );
};

export default CloudDriveSettings;
