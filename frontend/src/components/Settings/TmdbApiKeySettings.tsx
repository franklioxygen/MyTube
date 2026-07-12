import { FindInPage } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    TextField,
    Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import { api } from '../../utils/apiClient';
import { createTranslateOrFallback } from '../../utils/translateOrFallback';

interface TmdbApiKeySettingsProps {
    tmdbApiKey: string;
    onChange: (field: keyof Settings, value: string | boolean | number) => void;
}

interface TmdbCredentialTestResult {
    type: 'success' | 'error';
    message: string;
}

const getTMDBCredentialMessage = (
    translateOrFallback: (key: any, fallback: string) => string,
    messageKey?: string,
    fallback?: string
): string => {
    switch (messageKey) {
        case 'tmdbCredentialMissing':
            return translateOrFallback('tmdbCredentialMissing', 'Please enter a TMDB credential first.');
        case 'tmdbCredentialValid':
            return translateOrFallback('tmdbCredentialValid', 'TMDB credential is valid.');
        case 'tmdbCredentialValidApiKey':
            return translateOrFallback('tmdbCredentialValidApiKey', 'TMDB API key is valid.');
        case 'tmdbCredentialValidReadAccessToken':
            return translateOrFallback(
                'tmdbCredentialValidReadAccessToken',
                'TMDB Read Access Token is valid.'
            );
        case 'tmdbCredentialInvalid':
            return translateOrFallback(
                'tmdbCredentialInvalid',
                'TMDB credential is invalid. Check whether it is a valid API key or Read Access Token.'
            );
        case 'tmdbCredentialRequestFailed':
            return translateOrFallback(
                'tmdbCredentialRequestFailed',
                'Failed to reach TMDB. Please try again.'
            );
        case 'tmdbCredentialTestFailed':
            return translateOrFallback(
                'tmdbCredentialTestFailed',
                'Failed to test TMDB credential.'
            );
        default:
            return fallback || translateOrFallback(
                'tmdbCredentialTestFailed',
                'Failed to test TMDB credential.'
            );
    }
};

const TmdbApiKeySettings: React.FC<TmdbApiKeySettingsProps> = ({
    tmdbApiKey,
    onChange,
}) => {
    const { t } = useLanguage();
    const translateOrFallback = createTranslateOrFallback(t);
    const [tmdbCredentialTesting, setTmdbCredentialTesting] = useState(false);
    const [tmdbCredentialTestResult, setTmdbCredentialTestResult] = useState<TmdbCredentialTestResult | null>(null);

    const handleTestTMDBCredential = async () => {
        const apiKey = tmdbApiKey?.trim() || '';

        if (!apiKey) {
            setTmdbCredentialTestResult({
                type: 'error',
                message: getTMDBCredentialMessage(translateOrFallback, 'tmdbCredentialMissing'),
            });
            return;
        }

        setTmdbCredentialTesting(true);
        setTmdbCredentialTestResult(null);

        try {
            const res = await api.post('/settings/tmdb/test', { tmdbApiKey: apiKey });
            setTmdbCredentialTestResult({
                type: 'success',
                message: getTMDBCredentialMessage(
                    translateOrFallback,
                    res.data?.messageKey,
                    res.data?.message ||
                        translateOrFallback('tmdbCredentialValid', 'TMDB credential is valid.')
                ),
            });
        } catch (error: unknown) {
            const errorKey = (error as { response?: { data?: { errorKey?: string } } })
                .response?.data?.errorKey;
            setTmdbCredentialTestResult({
                type: 'error',
                message: getTMDBCredentialMessage(
                    translateOrFallback,
                    errorKey,
                    translateOrFallback('tmdbCredentialTestFailed', 'Failed to test TMDB credential.')
                ),
            });
        } finally {
            setTmdbCredentialTesting(false);
        }
    };

    return (
        <Box sx={{ maxWidth: 400 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
                {t('tmdbApiKey')}
            </Typography>
            <TextField
                fullWidth
                value={tmdbApiKey || ''}
                onChange={(e) => {
                    onChange('tmdbApiKey', e.target.value);
                    setTmdbCredentialTestResult(null);
                }}
                type="password"
                helperText={t('tmdbApiKeyHelper')}
                placeholder="Enter your TMDB API key"
            />
            <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                <Button
                    variant="outlined"
                    startIcon={<FindInPage />}
                    onClick={handleTestTMDBCredential}
                    disabled={!tmdbApiKey?.trim()}
                    loading={tmdbCredentialTesting}
                    loadingPosition="start"
                >
                    {translateOrFallback('testTmdbCredential', 'Test Credential')}
                </Button>
            </Box>
            {tmdbCredentialTestResult && (
                <Alert
                    severity={tmdbCredentialTestResult.type === 'success' ? 'success' : 'error'}
                    onClose={() => setTmdbCredentialTestResult(null)}
                    sx={{ mt: 2 }}
                >
                    {tmdbCredentialTestResult.message}
                </Alert>
            )}
        </Box>
    );
};

export default TmdbApiKeySettings;
