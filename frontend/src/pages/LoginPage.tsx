import { ErrorOutline, Fingerprint, InfoOutlined, LockOutlined, Refresh, Visibility, VisibilityOff } from '@mui/icons-material';
import {
    Alert,
    Avatar,
    Box,
    Button,
    CircularProgress,
    Container,
    CssBaseline,
    Divider,
    IconButton,
    InputAdornment,
    Tab,
    Tabs,
    TextField,
    ThemeProvider,
    Tooltip,
    Typography
} from '@mui/material';
import { startAuthentication } from '@simplewebauthn/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import logo from '../assets/logo.svg';
import AlertModal from '../components/AlertModal';
import ConfirmationModal from '../components/ConfirmationModal';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import getTheme from '../theme';
import { getWebAuthnErrorTranslationKey } from '../utils/translations';

const API_URL = import.meta.env.VITE_API_URL;

const LoginPage: React.FC = () => {
    const [visitorPassword, setVisitorPassword] = useState('');
    const [showVisitorPassword, setShowVisitorPassword] = useState(false);
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [waitTime, setWaitTime] = useState(0); // in milliseconds
    const [activeTab, setActiveTab] = useState(0); // 0 = Admin, 1 = Visitor
    const [showResetModal, setShowResetModal] = useState(false);
    const [alertOpen, setAlertOpen] = useState(false);
    const [alertTitle, setAlertTitle] = useState('');
    const [alertMessage, setAlertMessage] = useState('');
    const [websiteName, setWebsiteName] = useState('MyTube');
    const [resetPasswordCooldown, setResetPasswordCooldown] = useState(0); // in milliseconds
    const { t } = useLanguage();
    const { login } = useAuth();
    const queryClient = useQueryClient();

    // Fetch website name and settings from settings
    const { data: settingsData } = useQuery({
        queryKey: ['settings'],
        queryFn: async () => {
            try {
                const response = await axios.get(`${API_URL}/settings`, { timeout: 5000, withCredentials: true });
                return response.data;
            } catch (error) {
                return null;
            }
        },
        retry: 1,
        retryDelay: 1000,
    });

    const passwordLoginAllowed = settingsData?.passwordLoginAllowed !== false;
    const allowResetPassword = settingsData?.allowResetPassword !== false;
    // Show visitor tab if visitorPassword is set (no longer depends on visitorMode setting)
    const showVisitorTab = !!settingsData?.isVisitorPasswordSet;

    // Update website name when settings are loaded
    useEffect(() => {
        if (settingsData && settingsData.websiteName) {
            setWebsiteName(settingsData.websiteName);
        }
    }, [settingsData]);

    // Check backend connection and password status
    const { data: statusData, isLoading: isCheckingConnection, isError: isConnectionError, refetch: retryConnection } = useQuery({
        queryKey: ['healthCheck'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings/password-enabled`, { timeout: 5000, withCredentials: true });
            return response.data;
        },
        retry: 1,
        retryDelay: 1000,
    });

    // Check if passkeys exist
    const { data: passkeysData } = useQuery({
        queryKey: ['passkeys-exists'],
        queryFn: async () => {
            try {
                const response = await axios.get(`${API_URL}/settings/passkeys/exists`, { timeout: 5000, withCredentials: true });
                return response.data;
            } catch (error) {
                return { exists: false };
            }
        },
        retry: 1,
        retryDelay: 1000,
        enabled: !isCheckingConnection && !isConnectionError,
    });

    const passkeysExist = passkeysData?.exists || false;

    // Fetch reset password cooldown from backend
    const { data: cooldownData } = useQuery({
        queryKey: ['resetPasswordCooldown'],
        queryFn: async () => {
            try {
                const response = await axios.get(`${API_URL}/settings/reset-password-cooldown`, { timeout: 5000, withCredentials: true });
                return response.data;
            } catch (error) {
                return { cooldown: 0 };
            }
        },
        retry: 1,
        retryDelay: 1000,
        enabled: !isCheckingConnection && !isConnectionError,
        refetchInterval: (query) => {
            // Refetch every second if there's an active cooldown
            const cooldown = query.state.data?.cooldown || 0;
            return cooldown > 0 ? 1000 : false;
        },
    });

    // Initialize wait time from server response
    useEffect(() => {
        if (statusData && statusData.waitTime) {
            setWaitTime(statusData.waitTime);
        }
    }, [statusData]);

    // Update reset password cooldown from server response
    useEffect(() => {
        if (cooldownData && cooldownData.cooldown !== undefined) {
            setResetPasswordCooldown(cooldownData.cooldown);
        }
    }, [cooldownData]);

    // Auto-login only if login is not required
    useEffect(() => {
        if (statusData && statusData.loginRequired === false) {
            login();
        }
    }, [statusData, login]);

    // Countdown timer for wait time
    useEffect(() => {
        if (waitTime > 0) {
            const interval = setInterval(() => {
                setWaitTime((prev) => {
                    const newTime = prev - 1000;
                    return newTime > 0 ? newTime : 0;
                });
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [waitTime]);

    // Countdown timer for reset password cooldown (updates local state while server refetches)
    useEffect(() => {
        if (resetPasswordCooldown > 0) {
            const interval = setInterval(() => {
                setResetPasswordCooldown((prev) => {
                    const newTime = prev - 1000;
                    return newTime > 0 ? newTime : 0;
                });
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [resetPasswordCooldown]);

    // Use dark theme for login page to match app style
    const theme = getTheme('dark');

    const formatWaitTime = (ms: number): string => {
        if (ms < 1000) return 'a moment';
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''}`;
        const days = Math.floor(hours / 24);
        return `${days} day${days !== 1 ? 's' : ''}`;
    };

    const showAlert = (title: string, message: string) => {
        setAlertTitle(title);
        setAlertMessage(message);
        setAlertOpen(true);
    };

    const adminLoginMutation = useMutation({
        mutationFn: async (passwordToVerify: string) => {
            const response = await axios.post(`${API_URL}/settings/verify-admin-password`, { password: passwordToVerify }, { withCredentials: true });
            return response.data;
        },
        onSuccess: (data) => {
            if (data.success) {
                setWaitTime(0); // Reset wait time on success
                login(data.token, data.role);
            } else {
                // Handle failures (incorrect password or too many attempts)
                // These are returned as 200 OK with success: false to avoid console errors
                const statusCode = data.statusCode || 401;
                const responseData = data;

                if (statusCode === 429) {
                    // Too many attempts - wait time required
                    const waitTimeMs = responseData.waitTime || 0;
                    setWaitTime(waitTimeMs);
                    const formattedTime = formatWaitTime(waitTimeMs);
                    showAlert(t('error'), `${t('tooManyAttempts')} ${t('waitTimeMessage').replace('{time}', formattedTime)}`);
                } else if (statusCode === 401) {
                    // Incorrect password - check if wait time is returned
                    const waitTimeMs = responseData.waitTime || 0;
                    if (waitTimeMs > 0) {
                        setWaitTime(waitTimeMs);
                        const formattedTime = formatWaitTime(waitTimeMs);
                        showAlert(t('error'), `${t('incorrectPassword')} ${t('waitTimeMessage').replace('{time}', formattedTime)}`);
                    } else {
                        showAlert(t('error'), t('incorrectPassword'));
                    }
                } else {
                    showAlert(t('error'), t('loginFailed'));
                }
            }
        },
        onError: (err: any) => {
            console.error('Login error:', err);
            // Handle actual network errors or unexpected 500s
            showAlert(t('error'), t('loginFailed'));
        }
    });

    // ...



    const visitorLoginMutation = useMutation({
        mutationFn: async (passwordToVerify: string) => {
            const response = await axios.post(`${API_URL}/settings/verify-visitor-password`, { password: passwordToVerify }, { withCredentials: true });
            return response.data;
        },
        onSuccess: (data) => {
            if (data.success) {
                setWaitTime(0); // Reset wait time on success
                // Token is now in HTTP-only cookie, role is in response
                login(data.role);
            } else {
                // Handle failures (incorrect password or too many attempts)
                const statusCode = data.statusCode || 401;
                const responseData = data;

                if (statusCode === 429) {
                    // Too many attempts - wait time required
                    const waitTimeMs = responseData.waitTime || 0;
                    setWaitTime(waitTimeMs);
                    const formattedTime = formatWaitTime(waitTimeMs);
                    showAlert(t('error'), `${t('tooManyAttempts')} ${t('waitTimeMessage').replace('{time}', formattedTime)}`);
                } else if (statusCode === 401) {
                    // Incorrect password - check if wait time is returned
                    const waitTimeMs = responseData.waitTime || 0;
                    if (waitTimeMs > 0) {
                        setWaitTime(waitTimeMs);
                        const formattedTime = formatWaitTime(waitTimeMs);
                        showAlert(t('error'), `${t('incorrectPassword')} ${t('waitTimeMessage').replace('{time}', formattedTime)}`);
                    } else {
                        showAlert(t('error'), t('incorrectPassword'));
                    }
                } else {
                    showAlert(t('error'), t('loginFailed'));
                }
            }
        },
        onError: (err: any) => {
            console.error('Login error:', err);
            // Handle actual network errors or unexpected 500s
            showAlert(t('error'), t('loginFailed'));
        }
    });

    const handleVisitorSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (waitTime > 0) {
            return;
        }
        setError('');
        visitorLoginMutation.mutate(visitorPassword);
    }

    const resetPasswordMutation = useMutation({
        mutationFn: async () => {
            const response = await axios.post(`${API_URL}/settings/reset-password`, {}, { withCredentials: true });
            return response.data;
        },
        onSuccess: () => {
            setShowResetModal(false);
            setError('');
            setWaitTime(0);
            // Invalidate queries to refresh cooldown status
            queryClient.invalidateQueries({ queryKey: ['healthCheck'] });
            queryClient.invalidateQueries({ queryKey: ['resetPasswordCooldown'] });
            // Show success message
            showAlert(t('success'), t('resetPasswordSuccess'));
        },
        onError: (err: any) => {
            console.error('Reset password error:', err);
            if (err.response && err.response.data && err.response.data.message) {
                // Server returned a specific error message (likely cooldown)
                showAlert(t('error'), err.response.data.message);
                // Refresh cooldown status
                queryClient.invalidateQueries({ queryKey: ['resetPasswordCooldown'] });
            } else {
                showAlert(t('error'), t('loginFailed'));
            }
        }
    });

    // Passkey authentication mutation
    const passkeyLoginMutation = useMutation({
        mutationFn: async () => {


            // Step 1: Get authentication options
            const optionsResponse = await axios.post(`${API_URL}/settings/passkeys/authenticate`, {}, { withCredentials: true });
            const { options, challenge } = optionsResponse.data;

            // Step 2: Start authentication with browser
            const assertionResponse = await startAuthentication(options);

            // Step 3: Verify authentication
            const verifyResponse = await axios.post(`${API_URL}/settings/passkeys/authenticate/verify`, {
                body: assertionResponse,
                challenge,
            }, { withCredentials: true });

            if (!verifyResponse.data.success) {
                throw new Error('Passkey authentication failed');
            }

            return verifyResponse.data;
        },
        onSuccess: (data) => {
            setError('');
            setWaitTime(0);
            // Token is now in HTTP-only cookie, role is in response
            if (data.role) {
                login(data.role);
            } else {
                login(); // Fallback if no role returned (shouldn't happen with new backend)
            }
        },
        onError: (err: any) => {
            console.error('Passkey login error:', err);
            // Extract error message from axios response or error object
            let errorMessage = t('passkeyLoginFailed') || 'Passkey authentication failed. Please try again.';

            if (err?.response?.data?.error) {
                // Backend error message (e.g., "No passkeys registered" or "No passkeys found for RP_ID")
                errorMessage = err.response.data.error;
            } else if (err?.response?.data?.message) {
                errorMessage = err.response.data.message;
            } else if (err?.message) {
                errorMessage = err.message;
            }

            // Check if this is a WebAuthn error that can be translated
            const translationKey = getWebAuthnErrorTranslationKey(errorMessage);
            if (translationKey) {
                errorMessage = t(translationKey) || errorMessage;
            }

            showAlert(t('error'), errorMessage);
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (waitTime > 0) {
            return; // Don't allow submission if wait time is active
        }
        setError('');
        adminLoginMutation.mutate(password);
    };

    const handleResetPassword = () => {
        resetPasswordMutation.mutate();
    };

    const handlePasskeyLogin = () => {
        // Check if we're in a secure context (HTTPS or localhost)
        // This is the most important check - WebAuthn requires secure context
        if (!window.isSecureContext) {
            const hostname = window.location.hostname;
            const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
            if (!isLocalhost) {
                showAlert(t('error'), t('passkeyRequiresHttps') || 'WebAuthn requires HTTPS or localhost. Please access the application via HTTPS or use localhost instead of an IP address.');
                return;
            }
        }

        // Check if WebAuthn is supported
        // Check multiple ways to detect WebAuthn support
        const hasWebAuthn =
            typeof window.PublicKeyCredential !== 'undefined' ||
            (typeof navigator !== 'undefined' && 'credentials' in navigator && 'create' in navigator.credentials);

        if (!hasWebAuthn) {
            showAlert(t('error'), t('passkeyWebAuthnNotSupported') || 'WebAuthn is not supported in this browser. Please use a modern browser that supports WebAuthn.');
            return;
        }

        passkeyLoginMutation.mutate();
    };

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Container component="main" maxWidth="xs">
                <Box
                    sx={{
                        marginTop: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                    }}
                >
                    {isCheckingConnection ? (
                        // Loading state while checking backend connection
                        <>
                            <CircularProgress sx={{ mb: 2 }} />
                            <Typography variant="body1" color="text.secondary">
                                {t('checkingConnection') || 'Checking connection...'}
                            </Typography>
                        </>
                    ) : isConnectionError ? (
                        // Backend connection error state
                        <>
                            <Avatar sx={{ m: 1, bgcolor: 'error.main', width: 56, height: 56 }}>
                                <ErrorOutline fontSize="large" />
                            </Avatar>
                            <Typography component="h1" variant="h5" sx={{ mt: 2, mb: 1 }}>
                                {t('connectionError') || 'Connection Error'}
                            </Typography>
                            <Alert severity="error" sx={{ mt: 2, mb: 2, width: '100%' }}>
                                {t('backendConnectionFailed') || 'Unable to connect to the server. Please check if the backend is running and port is open, then try again.'}
                            </Alert>
                            <Button
                                variant="contained"
                                onClick={() => retryConnection()}
                                sx={{ mt: 2 }}
                            >
                                {t('retry') || 'Retry'}
                            </Button>
                        </>
                    ) : (
                        // Normal login form
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                                <img src={logo} alt="Logo" height={48} />
                                <Box sx={{ ml: 1.5, display: 'flex', flexDirection: 'column' }}>
                                    <Typography variant="h4" sx={{ fontWeight: 'bold', lineHeight: 1 }}>
                                        {websiteName}
                                    </Typography>
                                    {websiteName !== 'MyTube' && (
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', lineHeight: 1.2, mt: 0.25 }}>
                                            Powered by MyTube
                                        </Typography>
                                    )}
                                </Box>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                                <LockOutlined sx={{ color: 'text.primary' }} />
                                <Typography component="h1" variant="h5">
                                    {t('signIn')}
                                </Typography>
                            </Box>
                            <Box sx={{ mt: 1, width: '100%' }}>
                                {showVisitorTab && (
                                    <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                                        <Tabs value={activeTab} onChange={(_: React.SyntheticEvent, newValue: number) => setActiveTab(newValue)} aria-label="login tabs" variant="fullWidth">
                                            <Tab label={t('admin') || 'Admin'} id="login-tab-0" aria-controls="login-tabpanel-0" />
                                            <Tab label={t('visitorUser') || 'Visitor'} id="login-tab-1" aria-controls="login-tabpanel-1" />
                                        </Tabs>
                                    </Box>
                                )}

                                {/* Admin Tab Panel (and default view when visitor tab is not shown) */}
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
                                                    <TextField
                                                        margin="normal"
                                                        required
                                                        fullWidth
                                                        name="password"
                                                        label={t('password') || 'Admin Password'}
                                                        type={showPassword ? 'text' : 'password'}
                                                        id="password"
                                                        autoComplete="current-password"
                                                        value={password}
                                                        onChange={(e) => setPassword(e.target.value)}
                                                        autoFocus={!showVisitorTab || activeTab === 0}
                                                        disabled={waitTime > 0 || adminLoginMutation.isPending}
                                                        helperText={t('defaultPasswordHint') || "Default password: 123"}
                                                        slotProps={{
                                                            input: {
                                                                endAdornment: (
                                                                    <InputAdornment position="end">
                                                                        <IconButton
                                                                            aria-label={t('togglePasswordVisibility')}
                                                                            onClick={() => setShowPassword(!showPassword)}
                                                                            edge="end"
                                                                        >
                                                                            {showPassword ? <VisibilityOff /> : <Visibility />}
                                                                        </IconButton>
                                                                    </InputAdornment>
                                                                )
                                                            }
                                                        }}
                                                    />
                                                    <Button
                                                        type="submit"
                                                        fullWidth
                                                        variant="contained"
                                                        sx={{ mt: 3, mb: 2 }}
                                                        disabled={adminLoginMutation.isPending || waitTime > 0}
                                                    >
                                                        {adminLoginMutation.isPending ? (t('verifying') || 'Verifying...') : (t('signIn') || 'Admin Sign In')}
                                                    </Button>
                                                </Box>
                                            )}

                                            {passkeysExist && (
                                                <>
                                                    <Divider sx={{ my: 2 }}>OR</Divider>
                                                    <Button
                                                        fullWidth
                                                        variant="outlined"
                                                        startIcon={<Fingerprint />}
                                                        onClick={handlePasskeyLogin}
                                                        sx={{ mb: 2 }}
                                                        disabled={passkeyLoginMutation.isPending || waitTime > 0}
                                                    >
                                                        {passkeyLoginMutation.isPending
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
                                                    onClick={handlePasskeyLogin}
                                                    sx={{ mt: 3, mb: 2 }}
                                                    disabled={passkeyLoginMutation.isPending || waitTime > 0}
                                                >
                                                    {passkeyLoginMutation.isPending
                                                        ? (t('authenticating') || 'Authenticating...')
                                                        : (t('loginWithPasskey') || 'Login with Passkey')}
                                                </Button>
                                            )}

                                            {allowResetPassword && (
                                                <Button
                                                    fullWidth
                                                    variant="outlined"
                                                    startIcon={<Refresh />}
                                                    onClick={() => setShowResetModal(true)}
                                                    sx={{ mb: 2 }}
                                                    disabled={resetPasswordMutation.isPending || resetPasswordCooldown > 0}
                                                >
                                                    {resetPasswordCooldown > 0
                                                        ? `${t('resetPassword')} (${formatWaitTime(resetPasswordCooldown)})`
                                                        : t('resetPassword')}
                                                </Button>
                                            )}

                                            {!allowResetPassword && passwordLoginAllowed && (
                                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2 }}>
                                                    <Tooltip title={t('resetPasswordDisabledInfo') || 'Click for information about resetting password'}>
                                                        <IconButton
                                                            onClick={() => showAlert(
                                                                t('resetPassword') || 'Reset Password',
                                                                t('resetPasswordDisabledInfo') || 'Password reset is disabled. To reset your password, run the following command in the backend directory:\n\nnpm run reset-password\n\nOr:\n\nts-node scripts/reset-password.ts\n\nThis will generate a new random password and enable password login.'
                                                            )}
                                                            color="primary"
                                                            sx={{
                                                                '&:hover': {
                                                                    backgroundColor: 'action.hover'
                                                                }
                                                            }}
                                                        >
                                                            <InfoOutlined />
                                                        </IconButton>
                                                    </Tooltip>
                                                </Box>
                                            )}
                                        </>
                                    )}
                                </div>

                                {/* Visitor Tab Panel */}
                                {showVisitorTab && (
                                    <div
                                        role="tabpanel"
                                        hidden={activeTab !== 1}
                                        id="login-tabpanel-1"
                                        aria-labelledby="login-tab-1"
                                    >
                                        {activeTab === 1 && (
                                            <Box component="form" onSubmit={handleVisitorSubmit} noValidate>
                                                <TextField
                                                    margin="normal"
                                                    required
                                                    fullWidth
                                                    name="visitorPassword"
                                                    label={t('visitorPassword') || 'Visitor Password'}
                                                    type={showVisitorPassword ? 'text' : 'password'}
                                                    id="visitorPassword"
                                                    value={visitorPassword}
                                                    onChange={(e) => setVisitorPassword(e.target.value)}
                                                    autoFocus={activeTab === 1}
                                                    disabled={waitTime > 0 || visitorLoginMutation.isPending}
                                                    slotProps={{
                                                        input: {
                                                            endAdornment: (
                                                                <InputAdornment position="end">
                                                                    <IconButton
                                                                        aria-label={t('togglePasswordVisibility')}
                                                                        onClick={() => setShowVisitorPassword(!showVisitorPassword)}
                                                                        edge="end"
                                                                    >
                                                                        {showVisitorPassword ? <VisibilityOff /> : <Visibility />}
                                                                    </IconButton>
                                                                </InputAdornment>
                                                            )
                                                        }
                                                    }}
                                                />
                                                <Button
                                                    type="submit"
                                                    fullWidth
                                                    variant="contained"
                                                    sx={{ mt: 3, mb: 2 }}
                                                    disabled={visitorLoginMutation.isPending || waitTime > 0}
                                                >
                                                    {visitorLoginMutation.isPending ? (t('verifying') || 'Verifying...') : (t('visitorSignIn') || 'Visitor Sign In')}
                                                </Button>
                                            </Box>
                                        )}
                                    </div>
                                )}
                                <Box sx={{ minHeight: waitTime > 0 || (error && waitTime === 0) ? 'auto' : 0, mt: 2 }}>
                                    {waitTime > 0 && (
                                        <Alert severity="warning" sx={{ width: '100%' }}>
                                            {t('waitTimeMessage').replace('{time}', formatWaitTime(waitTime))}
                                        </Alert>
                                    )}
                                    {error && waitTime === 0 && (
                                        <Alert severity="error" sx={{ width: '100%' }}>
                                            {error}
                                        </Alert>
                                    )}
                                </Box>
                            </Box>
                        </>
                    )}
                </Box>
            </Container>
            <ConfirmationModal
                isOpen={showResetModal}
                onClose={() => setShowResetModal(false)}
                onConfirm={handleResetPassword}
                title={t('resetPasswordTitle')}
                message={`${t('resetPasswordMessage')}\n\n${t('resetPasswordScriptGuide')}`}
                confirmText={t('resetPasswordConfirm')}
                cancelText={t('cancel')}
                isDanger={true}
            />
            <AlertModal
                open={alertOpen}
                onClose={() => setAlertOpen(false)}
                title={alertTitle}
                message={alertMessage}
            />
        </ThemeProvider>
    );
};

export default LoginPage;
