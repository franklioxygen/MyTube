import { Fingerprint, Refresh } from '@mui/icons-material';
import {
    Box,
    Button,
    Divider,
} from '@mui/material';
import type { FormEvent } from 'react';
import type { TranslateFn } from '../../utils/translateOrFallback';
import { PasswordField } from './PasswordField';

interface AdminLoginPanelProps {
    activeTab: number;
    adminLoginPending: boolean;
    onPasskeyLogin: () => void;
    onPasswordChange: (password: string) => void;
    onPasswordSubmit: (password: string) => void;
    onResetPassword: () => void;
    onTogglePasswordVisibility: () => void;
    passkeyLoginPending: boolean;
    passkeysExist: boolean;
    password: string;
    passwordLoginAllowed: boolean;
    showPassword: boolean;
    showVisitorTab: boolean;
    t: TranslateFn;
    waitTime: number;
}

export const AdminLoginPanel: React.FC<AdminLoginPanelProps> = ({
    activeTab,
    adminLoginPending,
    onPasskeyLogin,
    onPasswordChange,
    onPasswordSubmit,
    onResetPassword,
    onTogglePasswordVisibility,
    passkeyLoginPending,
    passkeysExist,
    password,
    passwordLoginAllowed,
    showPassword,
    showVisitorTab,
    t,
    waitTime,
}) => {
    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        if (waitTime > 0) {
            return;
        }
        onPasswordSubmit(password);
    };

    const passwordDisabled = waitTime > 0 || adminLoginPending;
    const passkeyDisabled = passkeyLoginPending || waitTime > 0;

    return (
        <div
            role="tabpanel"
            hidden={showVisitorTab && activeTab !== 0}
            id="login-tabpanel-0"
            aria-labelledby="login-tab-0"
        >
            {(showVisitorTab ? activeTab === 0 : true) && (
                <>
                    {passwordLoginAllowed && (
                        <Box component="form" onSubmit={handleSubmit} noValidate>
                            <PasswordField
                                name="password"
                                label={t('password') || 'Admin Password'}
                                id="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={(event) => onPasswordChange(event.target.value)}
                                autoFocus={!showVisitorTab || activeTab === 0}
                                disabled={passwordDisabled}
                                helperText={t('defaultPasswordHint') || 'Use the admin password configured in Settings.'}
                                showPassword={showPassword}
                                onToggleVisibility={onTogglePasswordVisibility}
                                t={t}
                            />
                            <Button
                                type="submit"
                                fullWidth
                                variant="contained"
                                sx={{ mt: 3, mb: 2 }}
                                disabled={passwordDisabled}
                            >
                                {adminLoginPending ? (t('verifying') || 'Verifying...') : (t('signIn') || 'Admin Sign In')}
                            </Button>
                        </Box>
                    )}

                    {passwordLoginAllowed && passkeysExist && (
                        <>
                            <Divider sx={{ my: 2 }}>OR</Divider>
                            <Button
                                fullWidth
                                variant="outlined"
                                startIcon={<Fingerprint />}
                                onClick={onPasskeyLogin}
                                sx={{ mb: 2 }}
                                disabled={passkeyDisabled}
                            >
                                {passkeyLoginPending
                                    ? (t('authenticating') || 'Authenticating...')
                                    : (t('loginWithPasskey') || 'Login with Passkey')}
                            </Button>
                        </>
                    )}

                    {!passwordLoginAllowed && passkeysExist && (
                        <Button
                            fullWidth
                            variant="contained"
                            startIcon={<Fingerprint />}
                            onClick={onPasskeyLogin}
                            sx={{ mt: 3, mb: 2 }}
                            disabled={passkeyDisabled}
                        >
                            {passkeyLoginPending
                                ? (t('authenticating') || 'Authenticating...')
                                : (t('loginWithPasskey') || 'Login with Passkey')}
                        </Button>
                    )}

                    <Button
                        fullWidth
                        variant="outlined"
                        startIcon={<Refresh />}
                        onClick={onResetPassword}
                        sx={{ mb: 2 }}
                    >
                        {t('resetPassword')}
                    </Button>
                </>
            )}
        </div>
    );
};
