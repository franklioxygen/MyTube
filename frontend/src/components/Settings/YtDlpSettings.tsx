import {
    Alert,
    Box,
    Button,
    FormControlLabel,
    Link,
    MenuItem,
    Switch,
    TextField,
    Typography
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { YtDlpSafeConfig } from '../../types';

interface YtDlpSettingsProps {
    config: YtDlpSafeConfig;
    proxyOnlyYoutube?: boolean;
    disabled?: boolean;
    showLegacyTextDisabledHint?: boolean;
    onChange: (config: YtDlpSafeConfig) => void;
    onProxyOnlyYoutubeChange?: (checked: boolean) => void;
}

const RESOLUTION_OPTIONS: Array<{ label: string; value: string }> = [
    { label: 'Auto', value: '' },
    { label: '4320p (8K)', value: '4320' },
    { label: '2160p (4K)', value: '2160' },
    { label: '1440p', value: '1440' },
    { label: '1080p', value: '1080' },
    { label: '720p', value: '720' },
    { label: '480p', value: '480' },
    { label: '360p', value: '360' },
];

const MERGE_OUTPUT_OPTIONS: Array<{ label: string; value: string }> = [
    { label: 'Auto', value: '' },
    { label: 'mp4', value: 'mp4' },
    { label: 'webm', value: 'webm' },
    { label: 'mkv', value: 'mkv' },
];

const FORCE_IP_OPTIONS: Array<{ label: string; value: string }> = [
    { label: 'Auto', value: '' },
    { label: 'IPv4', value: 'ipv4' },
    { label: 'IPv6', value: 'ipv6' },
];

const parseOptionalInteger = (rawValue: string): number | undefined => {
    const trimmed = rawValue.trim();
    if (trimmed.length === 0) {
        return undefined;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }
    return Math.trunc(parsed);
};

const YtDlpSettings: React.FC<YtDlpSettingsProps> = ({
    config,
    proxyOnlyYoutube = false,
    disabled = false,
    showLegacyTextDisabledHint = false,
    onChange,
    onProxyOnlyYoutubeChange
}) => {
    const { t } = useLanguage();
    const [isExpanded, setIsExpanded] = useState(false);
    const [localConfig, setLocalConfig] = useState<YtDlpSafeConfig>(config || {});

    useEffect(() => {
        setLocalConfig(config || {});
    }, [config]);

    const handleCustomize = () => {
        setIsExpanded((prev) => !prev);
    };

    const updateConfig = <K extends keyof YtDlpSafeConfig>(
        field: K,
        value: YtDlpSafeConfig[K] | undefined
    ) => {
        setLocalConfig((previous) => {
            const nextConfig: YtDlpSafeConfig = { ...previous };
            if (value === undefined || value === null || value === '') {
                delete nextConfig[field];
            } else {
                nextConfig[field] = value;
            }
            onChange(nextConfig);
            return nextConfig;
        });
    };

    const handleReset = () => {
        setLocalConfig({});
        onChange({});
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, mb: 2 }}>
                <Box>
                    <Typography variant="body2" color="text.secondary">
                        {t('ytDlpConfigurationDescription') || 'Configure yt-dlp options. See '}
                        <Link
                            href="https://github.com/yt-dlp/yt-dlp?tab=readme-ov-file#configuration"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {t('ytDlpConfigurationDocs') || 'documentation'}
                        </Link>
                        {' '}
                        {t('ytDlpConfigurationDescriptionEnd') || 'for more information.'}
                    </Typography>
                </Box>
                <Button
                    variant="outlined"
                    onClick={handleCustomize}
                    disabled={disabled}
                >
                    {isExpanded ? (t('hide') || 'Hide') : (t('customize') || 'Customize')}
                </Button>
            </Box>

            {showLegacyTextDisabledHint && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    {t('featureDisabledInStrictMode') || 'Legacy yt-dlp text configuration is disabled in strict security model. Use structured options below.'}
                </Alert>
            )}

            {isExpanded && (
                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={proxyOnlyYoutube}
                                onChange={(e) => onProxyOnlyYoutubeChange && onProxyOnlyYoutubeChange(e.target.checked)}
                                color="primary"
                                disabled={disabled}
                            />
                        }
                        label={t('proxyOnlyApplyToYoutube') || 'Proxy only apply to Youtube'}
                    />

                    <TextField
                        select
                        fullWidth
                        label={t('maxResolution') || 'Max Resolution'}
                        value={localConfig.maxResolution !== undefined ? String(localConfig.maxResolution) : ''}
                        onChange={(e) =>
                            updateConfig(
                                'maxResolution',
                                parseOptionalInteger(e.target.value) as YtDlpSafeConfig['maxResolution'] | undefined
                            )
                        }
                        disabled={disabled}
                    >
                        {RESOLUTION_OPTIONS.map((option) => (
                            <MenuItem key={option.value || 'auto'} value={option.value}>
                                {option.label}
                            </MenuItem>
                        ))}
                    </TextField>

                    <TextField
                        select
                        fullWidth
                        label={t('mergeOutputFormat') || 'Merge Output Format'}
                        value={localConfig.mergeOutputFormat || ''}
                        onChange={(e) =>
                            updateConfig(
                                'mergeOutputFormat',
                                (e.target.value || undefined) as YtDlpSafeConfig['mergeOutputFormat'] | undefined
                            )
                        }
                        disabled={disabled}
                    >
                        {MERGE_OUTPUT_OPTIONS.map((option) => (
                            <MenuItem key={option.value || 'auto'} value={option.value}>
                                {option.label}
                            </MenuItem>
                        ))}
                    </TextField>

                    <TextField
                        fullWidth
                        label={t('proxy') || 'Proxy'}
                        value={localConfig.proxy || ''}
                        onChange={(e) => updateConfig('proxy', e.target.value || undefined)}
                        disabled={disabled}
                        placeholder="http://127.0.0.1:7890"
                    />

                    <TextField
                        fullWidth
                        label={t('limitRate') || 'Limit Rate'}
                        value={localConfig.limitRate || ''}
                        onChange={(e) => updateConfig('limitRate', e.target.value || undefined)}
                        disabled={disabled}
                        placeholder="2M"
                    />

                    <TextField
                        fullWidth
                        type="number"
                        label={t('retries') || 'Retries'}
                        value={localConfig.retries ?? ''}
                        onChange={(e) => updateConfig('retries', parseOptionalInteger(e.target.value))}
                        disabled={disabled}
                    />

                    <TextField
                        fullWidth
                        type="number"
                        label={t('concurrentFragments') || 'Concurrent Fragments'}
                        value={localConfig.concurrentFragments ?? ''}
                        onChange={(e) => updateConfig('concurrentFragments', parseOptionalInteger(e.target.value))}
                        disabled={disabled}
                    />

                    <TextField
                        fullWidth
                        type="number"
                        label={t('socketTimeout') || 'Socket Timeout (s)'}
                        value={localConfig.socketTimeout ?? ''}
                        onChange={(e) => updateConfig('socketTimeout', parseOptionalInteger(e.target.value))}
                        disabled={disabled}
                    />

                    <TextField
                        select
                        fullWidth
                        label={t('forceIpVersion') || 'Force IP Version'}
                        value={localConfig.forceIpVersion || ''}
                        onChange={(e) =>
                            updateConfig(
                                'forceIpVersion',
                                (e.target.value || undefined) as YtDlpSafeConfig['forceIpVersion'] | undefined
                            )
                        }
                        disabled={disabled}
                    >
                        {FORCE_IP_OPTIONS.map((option) => (
                            <MenuItem key={option.value || 'auto'} value={option.value}>
                                {option.label}
                            </MenuItem>
                        ))}
                    </TextField>

                    <TextField
                        fullWidth
                        label="XFF"
                        value={localConfig.xff || ''}
                        onChange={(e) => updateConfig('xff', e.target.value || undefined)}
                        disabled={disabled}
                        placeholder="default / US"
                    />

                    <TextField
                        fullWidth
                        type="number"
                        label={t('sleepRequests') || 'Sleep Requests (s)'}
                        value={localConfig.sleepRequests ?? ''}
                        onChange={(e) => updateConfig('sleepRequests', parseOptionalInteger(e.target.value))}
                        disabled={disabled}
                    />

                    <TextField
                        fullWidth
                        type="number"
                        label={t('sleepInterval') || 'Sleep Interval (s)'}
                        value={localConfig.sleepInterval ?? ''}
                        onChange={(e) => updateConfig('sleepInterval', parseOptionalInteger(e.target.value))}
                        disabled={disabled}
                    />

                    <TextField
                        fullWidth
                        type="number"
                        label={t('maxSleepInterval') || 'Max Sleep Interval (s)'}
                        value={localConfig.maxSleepInterval ?? ''}
                        onChange={(e) => updateConfig('maxSleepInterval', parseOptionalInteger(e.target.value))}
                        disabled={disabled}
                    />

                    <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 1 }}>
                        <Button
                            variant="outlined"
                            color="warning"
                            onClick={handleReset}
                            disabled={disabled}
                        >
                            {t('reset') || 'Reset'}
                        </Button>
                    </Box>
                </Box>
            )}
        </Box>
    );
};

export default YtDlpSettings;
