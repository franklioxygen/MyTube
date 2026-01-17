import { Alert, Box, CircularProgress, FormControlLabel, Switch, TextField, Tooltip, Typography } from '@mui/material';
import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useCloudflareStatus } from '../../hooks/useCloudflareStatus';

interface CloudflareSettingsProps {
    enabled?: boolean;
    token?: string;
    allowedHosts?: string;
    onChange: (field: string, value: string | number | boolean) => void;
}

const CloudflareSettings: React.FC<CloudflareSettingsProps> = ({ enabled, token, allowedHosts, onChange }) => {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';
    const [showCopied, setShowCopied] = useState(false);

    const handleCopyUrl = async (url: string) => {
        // Validate URL to prevent XSS
        if (!url || typeof url !== 'string') {
            showSnackbar(t('copyFailed'), 'error');
            return;
        }
        
        // Sanitize URL: remove any potentially dangerous characters
        // Only allow safe URL characters (alphanumeric, common URL symbols)
        const sanitizedUrl = url.replace(/[^\w\s\-\.:\/?#\[\]@!$&'()*+,;=]/g, '');
        
        try {
            // Try modern clipboard API first
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(sanitizedUrl);
                setShowCopied(true);
                setTimeout(() => setShowCopied(false), 2000);
            } else {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = sanitizedUrl;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    const successful = document.execCommand('copy');
                    if (successful) {
                        setShowCopied(true);
                        setTimeout(() => setShowCopied(false), 2000);
                    } else {
                        showSnackbar(t('copyFailed'), 'error');
                    }
                } catch (err) {
                    showSnackbar(t('copyFailed'), 'error');
                } finally {
                    document.body.removeChild(textArea);
                }
            }
        } catch (err) {
            showSnackbar(t('copyFailed'), 'error');
        }
    };

    // Poll for Cloudflare Tunnel status
    const { data: cloudflaredStatus, isLoading } = useCloudflareStatus(enabled ?? false);

    // Validate: if token is provided, allowedHosts is required
    const allowedHostsError = token && token.trim() && (!allowedHosts || !allowedHosts.trim())
        ? t('allowedHostsRequired') || 'Allowed domains is required when tunnel token is provided'
        : null;

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>{t('cloudflaredTunnel') || 'Cloudflare Tunnel'}</Typography>
            <FormControlLabel
                control={
                    <Switch
                        checked={enabled ?? false}
                        onChange={(e) => onChange('cloudflaredTunnelEnabled', e.target.checked)}
                        disabled={isVisitor}
                    />
                }
                label={t('enableCloudflaredTunnel')}
            />

            {(enabled) && (
                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 400 }}>
                    <TextField
                        fullWidth
                        label={t('cloudflaredToken')}
                        value={token || ''}
                        onChange={(e) => onChange('cloudflaredToken', e.target.value)}
                        disabled={isVisitor}
                        helperText={t('cloudflaredTokenHelper') || "Paste your tunnel token here, or leave empty to use a random Quick Tunnel."}
                    />
                    <TextField
                        fullWidth
                        label={t('allowedHosts') || 'Allowed Hosts'}
                        value={allowedHosts || ''}
                        onChange={(e) => onChange('allowedHosts', e.target.value)}
                        disabled={isVisitor}
                        error={!!allowedHostsError}
                        helperText={allowedHostsError || t('allowedHostsHelper') || "Comma-separated list of allowed hosts for Vite dev server. Restart dev server after changing."}
                        placeholder="example.com, another-domain.com"
                        required={!!token && !!token.trim()}
                    />
                </Box>
            )}

            {enabled && (isLoading || (!cloudflaredStatus && enabled) || (cloudflaredStatus?.isRunning && !token && !cloudflaredStatus.publicUrl)) ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                    <CircularProgress />
                    {cloudflaredStatus?.isRunning && !token && !cloudflaredStatus.publicUrl && (
                        <Typography variant="body2" sx={{ ml: 2, mt: 0.5 }}>
                            {t('waitingForUrl')}
                        </Typography>
                    )}
                </Box>
            ) : (enabled && cloudflaredStatus && (
                <Box sx={{ mt: 2, p: 2, bgcolor: 'background.paper', borderRadius: 1, border: 1, borderColor: 'divider' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1 }}>
                        <Typography variant="subtitle2">{t('status') || 'Status'}:</Typography>
                        <Typography variant="body2" color={cloudflaredStatus.isRunning ? 'success.main' : 'error.main'} fontWeight="bold">
                            {cloudflaredStatus.isRunning ? t('running') : t('stopped')}
                        </Typography>
                    </Box>

                    {cloudflaredStatus.tunnelId && (
                        <Box sx={{ mb: 1 }}>
                            <Typography variant="subtitle2">{t('tunnelId')}:</Typography>
                            <Typography variant="body2" fontFamily="monospace">
                                {cloudflaredStatus.tunnelId}
                            </Typography>
                        </Box>
                    )}

                    {cloudflaredStatus.accountTag && (
                        <Box sx={{ mb: 1 }}>
                            <Typography variant="subtitle2">{t('accountTag')}:</Typography>
                            <Typography variant="body2" fontFamily="monospace">
                                {cloudflaredStatus.accountTag}
                            </Typography>
                        </Box>
                    )}

                    {cloudflaredStatus.publicUrl && (
                        <Box sx={{ mb: 1 }}>
                            <Typography variant="subtitle2">{t('publicUrl')}:</Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Tooltip title={showCopied ? t('copied') : t('clickToCopy')} arrow>
                                    <Typography
                                        variant="body2"
                                        fontFamily="monospace"
                                        sx={{
                                            wordBreak: 'break-all',
                                            cursor: 'pointer',
                                            '&:hover': { textDecoration: 'underline', color: 'primary.main' }
                                        }}
                                        onClick={() => handleCopyUrl(cloudflaredStatus.publicUrl!)}
                                    >
                                        {cloudflaredStatus.publicUrl}
                                    </Typography>
                                </Tooltip>
                            </Box>
                            <Alert severity="warning" sx={{ mt: 1, py: 0 }}>
                                {t('quickTunnelWarning')}
                            </Alert>
                        </Box>
                    )}

                    {!cloudflaredStatus.publicUrl && (
                        <Alert severity="info" sx={{ mt: 1 }}>
                            {t('managedInDashboard')}
                        </Alert>
                    )}
                </Box>
            ))}
        </Box>
    );
};

export default CloudflareSettings;
