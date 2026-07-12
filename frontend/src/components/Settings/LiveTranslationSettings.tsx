import { Visibility, VisibilityOff } from '@mui/icons-material';
import {
    Box,
    Button,
    FormControl,
    FormControlLabel,
    IconButton,
    InputAdornment,
    InputLabel,
    Link,
    MenuItem,
    Select,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Settings } from '../../types';
import {
    LIVE_TRANSLATION_TARGET_LANGUAGE_OPTIONS,
} from '../../utils/liveTranslationLanguages';

const LIVE_TRANSLATION_MODELS: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'gemini-3.5-live-translate-preview', label: 'Gemini 3.5 Live Translate (Preview)' },
];

const GEMINI_DOCS_URL =
    'https://ai.google.dev/gemini-api/docs/live-api/live-translate';

interface LiveTranslationSettingsProps {
    settings: Settings;
    apiKeyConfigured: boolean;
    apiKeyDraft: string;
    clearApiKeyRequested: boolean;
    onChange: (field: keyof Settings, value: string | boolean) => void;
    onApiKeyDraftChange: (value: string) => void;
    onClearApiKey?: () => void;
}

const LiveTranslationSettings: React.FC<LiveTranslationSettingsProps> = ({
    settings,
    apiKeyConfigured,
    apiKeyDraft,
    clearApiKeyRequested,
    onChange,
    onApiKeyDraftChange,
    onClearApiKey,
}) => {
    const { t } = useLanguage();
    const [showApiKey, setShowApiKey] = useState(false);

    const enabled = settings.liveTranslationEnabled === true;
    const model = settings.liveTranslationModel || 'gemini-3.5-live-translate-preview';
    const targetLanguage = settings.liveTranslationTargetLanguage || 'en';
    // A configured key is still considered present unless the admin requested a clear.
    const effectiveKeyConfigured = apiKeyConfigured && !clearApiKeyRequested;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 640 }}>
            <Typography variant="h6">{t('liveTranslation')}</Typography>
            <Typography variant="body2" color="text.secondary">
                {t('liveTranslationDescription')}
            </Typography>

            <FormControlLabel
                control={
                    <Switch
                        checked={enabled}
                        onChange={(e) => onChange('liveTranslationEnabled', e.target.checked)}
                    />
                }
                label={t('enableLiveTranslation')}
            />

            {enabled && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                    <Box>
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={settings.liveTranslationKeepOriginalAudio === true}
                                    onChange={(e) =>
                                        onChange(
                                            'liveTranslationKeepOriginalAudio',
                                            e.target.checked,
                                        )
                                    }
                                />
                            }
                            label={t('liveTranslationKeepOriginalAudio')}
                        />
                        <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                            {t('liveTranslationKeepOriginalAudioDescription')}
                        </Typography>
                    </Box>

                    <Box>
                        <TextField
                            fullWidth
                            label={t('liveTranslationApiKey')}
                            type={showApiKey ? 'text' : 'password'}
                            value={apiKeyDraft}
                            placeholder={
                                effectiveKeyConfigured
                                    ? t('liveTranslationApiKeyConfigured')
                                    : undefined
                            }
                            onChange={(e) => onApiKeyDraftChange(e.target.value)}
                            helperText={
                                effectiveKeyConfigured
                                    ? t('liveTranslationApiKeyReplaceHelper')
                                    : undefined
                            }
                            InputProps={{
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton
                                            aria-label={t('togglePasswordVisibility')}
                                            edge="end"
                                            onClick={() => setShowApiKey((v) => !v)}
                                        >
                                            {showApiKey ? <VisibilityOff /> : <Visibility />}
                                        </IconButton>
                                    </InputAdornment>
                                ),
                            }}
                            slotProps={{
                                htmlInput: {
                                    spellCheck: 'false',
                                    autoCapitalize: 'none',
                                    autoCorrect: 'off',
                                    autoComplete: 'off',
                                },
                            }}
                        />
                        {effectiveKeyConfigured && onClearApiKey && (
                            <Button
                                size="small"
                                color="error"
                                onClick={onClearApiKey}
                                sx={{ mt: 1, textTransform: 'none' }}
                            >
                                {t('liveTranslationClearApiKey')}
                            </Button>
                        )}
                    </Box>

                    <FormControl fullWidth>
                        <InputLabel id="live-translation-model-label">
                            {t('liveTranslationModel')}
                        </InputLabel>
                        <Select
                            labelId="live-translation-model-label"
                            label={t('liveTranslationModel')}
                            value={model}
                            onChange={(e) => onChange('liveTranslationModel', e.target.value)}
                        >
                            {LIVE_TRANSLATION_MODELS.map((option) => (
                                <MenuItem key={option.value} value={option.value}>
                                    {option.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <FormControl fullWidth>
                        <InputLabel id="live-translation-target-label">
                            {t('liveTranslationTargetLanguage')}
                        </InputLabel>
                        <Select
                            labelId="live-translation-target-label"
                            label={t('liveTranslationTargetLanguage')}
                            value={targetLanguage}
                            onChange={(e) =>
                                onChange('liveTranslationTargetLanguage', e.target.value)
                            }
                        >
                            {LIVE_TRANSLATION_TARGET_LANGUAGE_OPTIONS.map((option) => (
                                <MenuItem key={option.code} value={option.code}>
                                    {option.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <Link
                        href={GEMINI_DOCS_URL}
                        target="_blank"
                        rel="noreferrer"
                        underline="hover"
                        sx={{ alignSelf: 'flex-start' }}
                    >
                        {t('liveTranslationDocumentation')}
                    </Link>
                </Box>
            )}
        </Box>
    );
};

export default LiveTranslationSettings;
