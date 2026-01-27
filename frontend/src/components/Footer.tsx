import { GitHub } from '@mui/icons-material';
import { Box, Chip, Container, Link, Tooltip, Typography, useTheme } from '@mui/material';
import { useEffect, useState } from 'react';
import { api } from '../utils/apiClient';

// Helper to compare semantic versions (v1 > v2)
const isNewerVersion = (latest: string, current: string): boolean => {
    try {
        const v1 = latest.split('.').map(Number);
        const v2 = current.split('.').map(Number);

        for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
            const num1 = v1[i] || 0;
            const num2 = v2[i] || 0;
            if (num1 > num2) return true;
            if (num1 < num2) return false;
        }
        return false;
    } catch {
        // Fallback to string comparison if parsing fails
        return latest !== current;
    }
};

const Footer = () => {
    const theme = useTheme();
    const [updateInfo, setUpdateInfo] = useState<{
        hasUpdate: boolean;
        latestVersion: string;
        releaseUrl: string;
    } | null>(null);

    useEffect(() => {
        const checkVersion = async () => {
            try {
                const response = await api.get('/system/version');
                if (response.data && response.data.latestVersion) {
                    const currentVersion = import.meta.env.VITE_APP_VERSION;
                    const latestVersion = response.data.latestVersion;
                    // Compare frontend version with latest version
                    const hasUpdate = isNewerVersion(latestVersion, currentVersion);

                    if (hasUpdate) {
                        setUpdateInfo({
                            hasUpdate: true,
                            latestVersion,
                            releaseUrl: response.data.releaseUrl || ''
                        });
                    } else {
                        setUpdateInfo(null);
                    }
                }
            } catch (error) {
                // Silently fail for version check
                console.debug('Failed to check version:', error);
            }
        };

        checkVersion();
    }, []);

    return (
        <Box
            component="footer"
            sx={{
                py: 2,
                px: 2,
                mt: 'auto',
                backgroundColor: theme.palette.mode === 'light'
                    ? theme.palette.grey[200]
                    : theme.palette.grey[900],
                borderTop: `1px solid ${theme.palette.divider}`
            }}
        >
            <Container maxWidth="lg">
                <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>

                    <Box sx={{ display: 'flex', alignItems: 'center', mt: { xs: 1, sm: 0 } }}>
                        <Link
                            href="https://github.com/franklioxygen/MyTube"
                            target="_blank"
                            rel="noopener noreferrer"
                            color="text.secondary"
                            underline="none"
                            variant="caption"
                            sx={{ display: 'flex', alignItems: 'center', mr: 2 }}
                        >
                            <GitHub sx={{ fontSize: 'inherit', mr: 0.5 }} />
                            MyTube
                        </Link>
                        <Tooltip
                            title={`Built on ${new Date(import.meta.env.VITE_BUILD_DATE).toLocaleString()}`}
                            arrow
                        >
                            <Typography variant="caption" color="text.secondary" sx={{ cursor: 'help' }}>
                                v{import.meta.env.VITE_APP_VERSION}
                            </Typography>
                        </Tooltip>
                        {updateInfo?.hasUpdate && (
                            <Tooltip title={`New version available: v${updateInfo.latestVersion}`}>
                                <Link
                                    href={updateInfo.releaseUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    sx={{ ml: 1, textDecoration: 'none', display: 'flex', alignItems: 'center' }}
                                >
                                    <Chip
                                        label="Update"
                                        color="success"
                                        size="small"
                                        sx={{
                                            height: 16,
                                            fontSize: '0.65rem',
                                            cursor: 'pointer',
                                            '& .MuiChip-label': { px: 1 }
                                        }}
                                    />
                                </Link>
                            </Tooltip>
                        )}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                        Created by franklioxygen
                    </Typography>
                </Box>
            </Container>
        </Box>
    );
};

export default Footer;
