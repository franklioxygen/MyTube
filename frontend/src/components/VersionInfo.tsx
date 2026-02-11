import { Chip, Link, Tooltip, Typography } from '@mui/material';
import type { TypographyProps } from '@mui/material';
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

interface VersionInfoProps {
    showUpdateBadge?: boolean;
    textColor?: TypographyProps['color'];
}

const VersionInfo = ({ showUpdateBadge = true, textColor = 'text.secondary' }: VersionInfoProps) => {
    const [updateInfo, setUpdateInfo] = useState<{
        hasUpdate: boolean;
        latestVersion: string;
        releaseUrl: string;
    } | null>(null);

    useEffect(() => {
        if (!showUpdateBadge) {
            return;
        }

        const checkVersion = async () => {
            try {
                const response = await api.get('/system/version');
                if (response.data && response.data.latestVersion) {
                    const currentVersion = import.meta.env.VITE_APP_VERSION;
                    const latestVersion = response.data.latestVersion;
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
    }, [showUpdateBadge]);

    return (
        <>
            <Tooltip
                title={`Built on ${new Date(import.meta.env.VITE_BUILD_DATE).toLocaleString()}`}
                arrow
            >
                <Typography variant="caption" color={textColor} sx={{ cursor: 'help' }}>
                    v{import.meta.env.VITE_APP_VERSION}
                </Typography>
            </Tooltip>
            {showUpdateBadge && updateInfo?.hasUpdate && (
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
        </>
    );
};

export default VersionInfo;
