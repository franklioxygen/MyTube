import { hasAxiosStatus, hasAnyAxiosStatus } from '../utils/errors';
import { ErrorOutline, Fingerprint, LockOutlined, Refresh, Visibility, VisibilityOff } from '@mui/icons-material';
import {
    Alert,
    Avatar,
    Box,
    Button,
    CircularProgress,
    Container,
    Divider,
    IconButton,
    InputAdornment,
    Tab,
    Tabs,
    TextField,
    Typography
} from '@mui/material';
import { startAuthentication } from '@simplewebauthn/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import logo from '../assets/logo.svg';
import AlertModal from '../components/AlertModal';
import VersionInfo from '../components/VersionInfo';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { api, ensureCsrfToken, getErrorMessage, getWaitTime, isAuthError, isRateLimitError } from '../utils/apiClient';
import { createTranslateOrFallback } from '../utils/translateOrFallback';
import { getWebAuthnErrorTranslationKey } from '../utils/translations';
import GesturePattern from '../components/Auth/GesturePattern';
import {
    GESTURE_LOGIN_STATUS_QUERY_KEY,
    authenticateGestureLogin,
    fetchGestureLoginStatus,
    getGestureErrorBody,
    type GestureLoginStatus,
} from '../utils/gestureLogin';

const LoginPage: React.FC = () => {
    const [visitorUsername, setVisitorUsername] = useState('');
    const [visitorPassword, setVisitorPassword] = useState('');
    const [showVisitorPassword, setShowVisitorPassword] = useState(false);
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [waitTime, setWaitTime] = useState(0); // in milliseconds
    const [activeTab, setActiveTab] = useState(0); // 0 = Admin, 1 = Visitor
    const [alertOpen, setAlertOpen] = useState(false);
    const [alertTitle, setAlertTitle] = useState('');
    const [alertMessage, setAlertMessage] = useState('');
    // Gesture throttling is tracked separately from `waitTime`: the server
    // buckets are independent, and a gesture throttle must never disable the
    // password field that is the documented recovery path.
    const [gestureWaitTime, setGestureWaitTime] = useState(0);
    const [gestureMessage, setGestureMessage] = useState('');
    const [gestureOutcome, setGestureOutcome] = useState<'idle' | 'error' | 'success'>('idle');
    const passwordFieldRef = React.useRef<HTMLInputElement | null>(null);
    const { t } = useLanguage();
    const { login } = useAuth();
    const queryClient = useQueryClient();

    // Check backend connection and password status
    // This endpoint now includes visitor password info and other login-related settings
    const { data: statusData, isLoading: isCheckingConnection, isError: isConnectionError, refetch: retryConnection } = useQuery({
        queryKey: ['healthCheck'],
        queryFn: async () => {
            try {
                const response = await api.get('/settings/password-enabled', { timeout: 5000 });
                return response.data;
            } catch (error: unknown) {
                // Handle 401 errors (expected when not authenticated)
                if (hasAxiosStatus(error, 401)) {
                    // Return default values for 401
                    return { loginRequired: true, passwordEnabled: false };
                }
                // Handle 429 errors (rate limited) - return default values
                if (hasAxiosStatus(error, 429)) {
                    // Return default values for rate limiting
                    return { loginRequired: true, passwordEnabled: false };
                }
                throw error;
            }
        },
        retry: (failureCount, error: any) => {
            // Don't retry on 401 or 429 errors
            if (error?.response?.status === 401 || error?.response?.status === 429) {
                return false;
            }
            // Retry other errors once
            return failureCount < 1;
        },
        retryDelay: 1000,
    });

    // Get settings from password-enabled endpoint (doesn't require auth)
    // This endpoint now includes visitor password info and other login-related settings
    const passwordEnabledData = statusData;
    const websiteName = passwordEnabledData?.websiteName || 'MyTube';

    const passwordLoginAllowed = passwordEnabledData?.passwordLoginAllowed !== false;
    const visitorUserEnabled = passwordEnabledData?.visitorUserEnabled !== false;
    const showVisitorTab = visitorUserEnabled && (!!passwordEnabledData?.hasVisitorUsers || !!passwordEnabledData?.isVisitorPasswordSet);

    // Check if passkeys exist
    const { data: passkeysData } = useQuery({
        queryKey: ['passkeys-exists'],
        queryFn: async () => {
            try {
                const response = await api.get('/settings/passkeys/exists', { timeout: 5000 });
                return response.data;
            } catch (error: unknown) {
                // Handle 401 or 429 errors gracefully
                if (hasAnyAxiosStatus(error, [401, 429])) {
                    return { exists: false };
                }
                // Log other errors but still return default
                console.error('Error checking passkeys:', error);
                return { exists: false };
            }
        },
        retry: (failureCount, error: any) => {
            // Don't retry on 401 or 429 errors
            if (error?.response?.status === 401 || error?.response?.status === 429) {
                return false;
            }
            // Retry other errors once
            return failureCount < 1;
        },
        retryDelay: 1000,
        enabled: !isCheckingConnection && !isConnectionError,
    });

    const passkeysExist = passkeysData?.exists || false;

    const { data: gestureStatus } = useQuery<GestureLoginStatus>({
        queryKey: GESTURE_LOGIN_STATUS_QUERY_KEY,
        queryFn: fetchGestureLoginStatus,
        // A failed status request leaves the state unknown. It is never turned
        // into "not configured": rendering a grid on a guess is worse than
        // rendering nothing, and the password form is always there.
        retry: false,
        staleTime: 0,
        enabled: !isCheckingConnection && !isConnectionError,
    });

    const gestureAvailable = gestureStatus?.available === true;
    const gestureLocked = gestureStatus?.locked === true;


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

    useEffect(() => {
        if (gestureWaitTime > 0) {
            const interval = setInterval(() => {
                setGestureWaitTime((prev) => (prev - 1000 > 0 ? prev - 1000 : 0));
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [gestureWaitTime]);

    const handleLoginTabChange = (_event: React.SyntheticEvent, newValue: number) => {
        // The grid unmounts when leaving Admin, which abandons its active
        // stroke. Clear page-owned feedback in the same user event so it does
        // not reappear when the user returns.
        if (newValue !== 0) {
            setGestureMessage('');
            setGestureOutcome('idle');
        }
        setActiveTab(newValue);
    };

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

    const getTranslatedOrFallback = createTranslateOrFallback(t);

    const showResetInstructions = () => {
        const title = t('resetPassword') || 'Reset Password';
        const message = getTranslatedOrFallback(
            'resetPasswordRecoveryMessage',
            'Password recovery must be performed from the backend environment. Set a new password explicitly instead of relying on generated credentials in logs.'
        );
        const guide = getTranslatedOrFallback(
            'resetPasswordRecoveryGuide',
            [
                'Choose the command that matches your environment:',
                '',
                'Backend shell',
                '  node dist/scripts/reset-password.js <new-password>',
                '',
                'Docker host',
                '  docker exec -it mytube-backend node /app/dist/scripts/reset-password.js <new-password>',
                '',
                'Use the backend directory/container that has access to the persistent app data.',
            ].join('\n')
        );

        showAlert(title, `${message}\n\n${guide}`);
    };

    const getPasswordErrorMessage = (error: unknown, fallbackMessage: string) => {
        const message = getErrorMessage(error);
        if (
            message === 'Incorrect password' ||
            message === 'Incorrect admin password' ||
            message === 'Incorrect visitor password' ||
            message === 'Incorrect username or password'
        ) {
            return fallbackMessage;
        }
        return message || fallbackMessage;
    };

    const handlePasswordLoginError = (error: unknown, fallbackMessage: string) => {
        console.error('Login error:', error);

        const waitTimeMs = getWaitTime(error);
        const message = getPasswordErrorMessage(error, fallbackMessage);

        if (isRateLimitError(error)) {
            setWaitTime(waitTimeMs);
            const formattedTime = formatWaitTime(waitTimeMs);
            showAlert(t('error'), `${t('tooManyAttempts')} ${t('waitTimeMessage').replace('{time}', formattedTime)}`);
            return;
        }

        if (isAuthError(error)) {
            if (waitTimeMs > 0) {
                setWaitTime(waitTimeMs);
                const formattedTime = formatWaitTime(waitTimeMs);
                showAlert(t('error'), `${message} ${t('waitTimeMessage').replace('{time}', formattedTime)}`);
                return;
            }

            showAlert(t('error'), message);
            return;
        }

        showAlert(t('error'), t('loginFailed'));
    };

    const adminLoginMutation = useMutation({
        mutationFn: async (passwordToVerify: string) => {
            await ensureCsrfToken({ refresh: true });
            const response = await api.post('/settings/verify-admin-password', { password: passwordToVerify });
            return response.data;
        },
        onSuccess: (data) => {
            setWaitTime(0);
            // A successful admin password login clears a gesture lock on the
            // server, so the cached status must not outlive it.
            queryClient.invalidateQueries({ queryKey: GESTURE_LOGIN_STATUS_QUERY_KEY });
            login(data.role);
        },
        onError: (error: unknown) => {
            handlePasswordLoginError(error, t('incorrectPassword'));
        }
    });

    const setGestureStatusCache = (patch: Partial<GestureLoginStatus>) => {
        queryClient.setQueryData<GestureLoginStatus>(
            GESTURE_LOGIN_STATUS_QUERY_KEY,
            (previous) => (previous ? { ...previous, ...patch } : previous)
        );
    };

    const gestureLoginMutation = useMutation({
        mutationFn: async (pattern: number[]) => {
            await ensureCsrfToken({ refresh: true });
            return authenticateGestureLogin(pattern);
        },
        onSuccess: (data) => {
            setGestureOutcome('success');
            setGestureMessage('');
            login(data.role);
        },
        onError: (error: unknown) => {
            const body = getGestureErrorBody(error);
            setGestureOutcome('error');

            if (isRateLimitError(error) && body.code !== 'gesture_locked') {
                // Throttled, not locked. Only the gesture is paused; the
                // password form below stays usable.
                const waitMs = getWaitTime(error);
                setGestureWaitTime(waitMs);
                setGestureMessage(
                    `${t('tooManyAttempts')} ${t('waitTimeMessage').replace('{time}', formatWaitTime(waitMs))}`
                );
                return;
            }

            if (body.code === 'gesture_locked') {
                setGestureStatusCache({ locked: true, available: false, attemptsRemaining: 0 });
                setGestureMessage(
                    t('gestureLoginLockedPasswordRecovery') ||
                        'Gesture Login is locked after 3 incorrect attempts. Sign in once with your admin password to restore it.'
                );
                // The grid is about to disappear; put the caret where the user
                // now has to act.
                window.setTimeout(() => passwordFieldRef.current?.focus(), 0);
                return;
            }

            if (body.code === 'gesture_incorrect' && typeof body.attemptsRemaining === 'number') {
                setGestureStatusCache({ attemptsRemaining: body.attemptsRemaining });
                setGestureMessage(
                    (t('gestureLoginIncorrectAttemptsRemaining') ||
                        'Incorrect gesture. {count} attempts remaining.'
                    ).replace('{count}', String(body.attemptsRemaining))
                );
                return;
            }

            if (body.code === 'gesture_unavailable') {
                setGestureStatusCache({ available: false });
                setGestureMessage(t('gestureLoginUnavailable') || 'Gesture Login is not available.');
                return;
            }

            // Network or 5xx: the server state is unknown. Never decrement the
            // remaining count locally from a request that may not have landed.
            setGestureMessage(t('loginFailed') || 'Login failed. Please try again.');
            queryClient.invalidateQueries({ queryKey: GESTURE_LOGIN_STATUS_QUERY_KEY });
        },
    });

    const handleGestureComplete = (pattern: number[]) => {
        if (
            gestureLoginMutation.isPending ||
            gestureWaitTime > 0 ||
            !gestureAvailable
        ) {
            return;
        }
        setGestureOutcome('idle');
        setGestureMessage('');
        gestureLoginMutation.mutate(pattern);
    };

    const visitorLoginMutation = useMutation({
        mutationFn: async (credentials: { username: string; password: string }) => {
            await ensureCsrfToken({ refresh: true });
            const response = await api.post('/settings/verify-user-login', credentials);
            return response.data;
        },
        onSuccess: (data) => {
            setWaitTime(0);
            login(data.role, data.username ?? visitorUsername);
        },
        onError: (error: unknown) => {
            handlePasswordLoginError(error, t('incorrectUsernameOrPassword') || t('incorrectPassword'));
        }
    });

    const handleVisitorSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (waitTime > 0) {
            return;
        }
        visitorLoginMutation.mutate({
            username: visitorUsername,
            password: visitorPassword,
        });
    }

    // Passkey authentication mutation
    const passkeyLoginMutation = useMutation({
        mutationFn: async () => {


            // Step 1: Get authentication options
            const optionsResponse = await api.post('/settings/passkeys/authenticate');
            const { options, challenge } = optionsResponse.data;

            // Step 2: Start authentication with browser
            const assertionResponse = await startAuthentication({
                optionsJSON: options,
            });

            // Step 3: Verify authentication
            const verifyResponse = await api.post('/settings/passkeys/authenticate/verify', {
                body: assertionResponse,
                challenge,
            });

            if (!verifyResponse.data.success) {
                throw new Error('Passkey authentication failed');
            }

            return verifyResponse.data;
        },
        onSuccess: (data) => {
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
        adminLoginMutation.mutate(password);
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
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                bgcolor: 'background.default',
            }}
        >
            <Container component="main" maxWidth="xs" sx={{ flex: 1 }}>
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
                                        <Tabs value={activeTab} onChange={handleLoginTabChange} aria-label="login tabs" variant="fullWidth">
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
                                            {gestureAvailable && (
                                                <Box sx={{ mb: 2 }} data-testid="gesture-login-panel">
                                                    <GesturePattern
                                                        mode="verify"
                                                        disabled={
                                                            gestureLoginMutation.isPending || gestureWaitTime > 0
                                                        }
                                                        outcome={gestureOutcome}
                                                        onComplete={handleGestureComplete}
                                                        ariaLabel={t('gestureLogin') || 'Gesture Login'}
                                                        instructions={
                                                            t('gestureLoginSignInInstruction') ||
                                                            'Press and hold to draw; release to sign in.'
                                                        }
                                                        liveMessage={gestureMessage}
                                                        minimumDotsMessage={
                                                            t('gestureLoginMinimumDots') ||
                                                            'Draw a gesture connecting at least 3 dots.'
                                                        }
                                                    />
                                                    {gestureLoginMutation.isPending && (
                                                        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
                                                            <CircularProgress size={20} />
                                                        </Box>
                                                    )}
                                                    {gestureMessage && (
                                                        <Alert severity="warning" sx={{ mt: 1 }} data-testid="gesture-login-message">
                                                            {gestureMessage}
                                                        </Alert>
                                                    )}
                                                    {passwordLoginAllowed && (
                                                        <Divider sx={{ my: 2 }}>{t('or') || 'OR'}</Divider>
                                                    )}
                                                </Box>
                                            )}

                                            {!gestureAvailable && gestureLocked && (
                                                <Alert severity="warning" sx={{ mb: 2 }} data-testid="gesture-locked-notice">
                                                    {t('gestureLoginLockedPasswordRecovery') ||
                                                        'Gesture Login is locked after 3 incorrect attempts. Sign in once with your admin password to restore it.'}
                                                </Alert>
                                            )}

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
                                                        inputRef={passwordFieldRef}
                                                        value={password}
                                                        onChange={(e) => setPassword(e.target.value)}
                                                        autoFocus={!showVisitorTab || activeTab === 0}
                                                        disabled={waitTime > 0 || adminLoginMutation.isPending}
                                                        helperText={t('defaultPasswordHint') || 'Use the admin password configured in Settings.'}
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
                                                        disabled={waitTime > 0}
                                                        loading={adminLoginMutation.isPending}
                                                        loadingPosition="start"
                                                    >
                                                        {t('signIn') || 'Admin Sign In'}
                                                    </Button>
                                                </Box>
                                            )}

                                            {passwordLoginAllowed && passkeysExist && (
                                                <>
                                                    <Divider sx={{ my: 2 }}>{t('or') || 'OR'}</Divider>
                                                    <Button
                                                        fullWidth
                                                        variant="outlined"
                                                        startIcon={<Fingerprint />}
                                                        onClick={handlePasskeyLogin}
                                                        sx={{ mb: 2 }}
                                                        disabled={waitTime > 0}
                                                        loading={passkeyLoginMutation.isPending}
                                                        loadingPosition="start"
                                                    >
                                                        {t('loginWithPasskey') || 'Login with Passkey'}
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
                                                    disabled={waitTime > 0}
                                                    loading={passkeyLoginMutation.isPending}
                                                    loadingPosition="start"
                                                >
                                                    {t('loginWithPasskey') || 'Login with Passkey'}
                                                </Button>
                                            )}

                                            <Button
                                                fullWidth
                                                variant="outlined"
                                                startIcon={<Refresh />}
                                                onClick={showResetInstructions}
                                                sx={{ mb: 2 }}
                                            >
                                                {t('resetPassword')}
                                            </Button>
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
                                                    name="username"
                                                    label={t('username') || 'Username'}
                                                    type="text"
                                                    id="visitorUsername"
                                                    value={visitorUsername}
                                                    onChange={(e) => setVisitorUsername(e.target.value)}
                                                    autoComplete="username"
                                                    autoFocus={activeTab === 1}
                                                    disabled={waitTime > 0 || visitorLoginMutation.isPending}
                                                    helperText={t('visitorLoginHint') || 'If you used the old shared password, your username is "visitor".'}
                                                />
                                                <TextField
                                                    margin="normal"
                                                    required
                                                    fullWidth
                                                    name="password"
                                                    label={t('password') || 'Password'}
                                                    type={showVisitorPassword ? 'text' : 'password'}
                                                    id="visitorPassword"
                                                    value={visitorPassword}
                                                    onChange={(e) => setVisitorPassword(e.target.value)}
                                                    autoComplete="current-password"
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
                                                    disabled={waitTime > 0}
                                                    loading={visitorLoginMutation.isPending}
                                                    loadingPosition="start"
                                                >
                                                    {t('visitorSignIn') || 'Visitor Sign In'}
                                                </Button>
                                            </Box>
                                        )}
                                    </div>
                                )}
                                <Box sx={{ minHeight: waitTime > 0 ? 'auto' : 0, mt: 2 }}>
                                    {waitTime > 0 && (
                                        <Alert severity="warning" sx={{ width: '100%' }}>
                                            {t('waitTimeMessage').replace('{time}', formatWaitTime(waitTime))}
                                        </Alert>
                                    )}
                                </Box>
                            </Box>
                        </>
                    )}
                </Box>
            </Container>
            <Box sx={{ pb: 3, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <VersionInfo showUpdateBadge={false} />
            </Box>
            <AlertModal
                open={alertOpen}
                onClose={() => setAlertOpen(false)}
                title={alertTitle}
                message={alertMessage}
            />
        </Box>
    );
};

export default LoginPage;
