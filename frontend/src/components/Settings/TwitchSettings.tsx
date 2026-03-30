import { Visibility, VisibilityOff } from '@mui/icons-material';
import {
    Button,
    Box,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    IconButton,
    InputAdornment,
    Link,
    TextField,
    Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import {
    getTwitchCredentialValidationCode,
    normalizeTwitchCredential,
} from '../../utils/twitch';

interface TwitchSettingsProps {
    twitchClientId?: string;
    twitchClientSecret?: string;
    onChange: (field: 'twitchClientId' | 'twitchClientSecret', value: string) => void;
}

const TwitchSettings: React.FC<TwitchSettingsProps> = ({
    twitchClientId,
    twitchClientSecret,
    onChange,
}) => {
    const { t } = useLanguage();
    const [showSecret, setShowSecret] = useState(false);
    const [showHelpModal, setShowHelpModal] = useState(false);
    const credentialValidationCode = getTwitchCredentialValidationCode(
        twitchClientId,
        twitchClientSecret,
    );
    const normalizedClientId = normalizeTwitchCredential(twitchClientId);
    const normalizedClientSecret = normalizeTwitchCredential(twitchClientSecret);
    const clientIdError =
        credentialValidationCode === 'missing_client_id' ||
        credentialValidationCode === 'invalid_client_id';
    const clientSecretError =
        credentialValidationCode === 'missing_client_secret' ||
        credentialValidationCode === 'invalid_client_secret';

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 640 }}>
            <Typography variant="body2" color="text.primary">
                {t('twitchSubscriptionDescription') || 'MyTube will check this Twitch channel for new VODs and download them after Twitch publishes them.'}
            </Typography>
            <Link
                component="button"
                type="button"
                onClick={() => setShowHelpModal(true)}
                underline="hover"
                sx={{ alignSelf: 'flex-start', fontWeight: 500 }}
            >
                {t('twitchClientHelpLink') || 'How to get Twitch Client ID and Secret'}
            </Link>
            <Typography variant="body2" color="text.secondary">
                {t('twitchSubscriptionCredentialsHelper') || 'Twitch client credentials are optional. Without them, MyTube falls back to yt-dlp polling in best-effort mode. Adding credentials makes channel detection more reliable.'}
            </Typography>
            <TextField
                label={t('twitchClientId')}
                value={twitchClientId || ''}
                onChange={(event) => onChange('twitchClientId', event.target.value)}
                fullWidth
                error={clientIdError}
                slotProps={{
                    htmlInput: {
                        spellCheck: 'false',
                        autoCapitalize: 'none',
                        autoCorrect: 'off',
                    },
                }}
                onBlur={() => {
                    if ((twitchClientId || '') !== normalizedClientId) {
                        onChange('twitchClientId', normalizedClientId);
                    }
                }}
            />
            <TextField
                label={t('twitchClientSecret')}
                type={showSecret ? 'text' : 'password'}
                value={twitchClientSecret || ''}
                onChange={(event) => onChange('twitchClientSecret', event.target.value)}
                fullWidth
                error={clientSecretError}
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="end">
                            <IconButton
                                aria-label={t('togglePasswordVisibility')}
                                edge="end"
                                onClick={() => setShowSecret((current) => !current)}
                            >
                                {showSecret ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                        </InputAdornment>
                    ),
                }}
                slotProps={{
                    htmlInput: {
                        spellCheck: 'false',
                        autoCapitalize: 'none',
                        autoCorrect: 'off',
                    },
                }}
                onBlur={() => {
                    if ((twitchClientSecret || '') !== normalizedClientSecret) {
                        onChange('twitchClientSecret', normalizedClientSecret);
                    }
                }}
            />
            <Dialog
                open={showHelpModal}
                onClose={() => setShowHelpModal(false)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>{t('twitchClientHelpTitle') || 'Get Twitch Client ID and Secret'}</DialogTitle>
                <DialogContent dividers>
                    <DialogContentText sx={{ mb: 2, color: 'text.primary' }}>
                        {t('twitchClientHelpIntro') || 'You need to create a Twitch application in the Twitch Developer Console first.'}
                    </DialogContentText>
                    <Typography component="ol" sx={{ pl: 3, mb: 2 }}>
                        <Typography component="li" sx={{ mb: 1 }}>
                            {t('twitchClientHelpStep1') || 'Open the Twitch Developer Console and sign in with your Twitch account.'}
                        </Typography>
                        <Typography component="li" sx={{ mb: 1 }}>
                            {t('twitchClientHelpStep2') || 'Create a new application for MyTube.'}
                        </Typography>
                        <Typography component="li" sx={{ mb: 1 }}>
                            {t('twitchClientHelpStep3') || 'Set an OAuth Redirect URL. If you only use server-side subscriptions, a placeholder such as http://localhost is sufficient.'}
                        </Typography>
                        <Typography component="li" sx={{ mb: 1 }}>
                            {t('twitchClientHelpStep4') || 'After the app is created, copy the Client ID from the application details page.'}
                        </Typography>
                        <Typography component="li" sx={{ mb: 1 }}>
                            {t('twitchClientHelpStep5') || 'Generate or reveal a Client Secret, then paste both values into MyTube settings.'}
                        </Typography>
                    </Typography>
                    <Typography variant="body2" color="warning.main" sx={{ mb: 2 }}>
                        {t('twitchClientHelpSecurity') || 'Keep the Client Secret private and do not share it in screenshots or public pages.'}
                    </Typography>
                    <Typography variant="body2">
                        <Link
                            href="https://dev.twitch.tv/console/apps"
                            target="_blank"
                            rel="noreferrer"
                            underline="hover"
                        >
                            {t('twitchDeveloperConsole') || 'Twitch Developer Console'}
                        </Link>
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                        <Link
                            href="https://dev.twitch.tv/docs/authentication/register-app/"
                            target="_blank"
                            rel="noreferrer"
                            underline="hover"
                        >
                            {t('twitchDeveloperDocs') || 'Twitch Developer Docs'}
                        </Link>
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={() => setShowHelpModal(false)} color="primary">
                        {t('close') || 'Close'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default TwitchSettings;
