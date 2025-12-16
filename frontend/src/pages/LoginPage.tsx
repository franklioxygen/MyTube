import { ErrorOutline, LockOutlined, Refresh } from '@mui/icons-material';
import {
    Alert,
    Avatar,
    Box,
    Button,
    CircularProgress,
    Container,
    CssBaseline,
    TextField,
    ThemeProvider,
    Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import logo from '../assets/logo.svg';
import ConfirmationModal from '../components/ConfirmationModal';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import getTheme from '../theme';

const API_URL = import.meta.env.VITE_API_URL;

const LoginPage: React.FC = () => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [waitTime, setWaitTime] = useState(0); // in milliseconds
    const [showResetModal, setShowResetModal] = useState(false);
    const [websiteName, setWebsiteName] = useState('MyTube');
    const { t } = useLanguage();
    const { login } = useAuth();
    const queryClient = useQueryClient();

    // Fetch website name from settings
    const { data: settingsData } = useQuery({
        queryKey: ['settings'],
        queryFn: async () => {
            try {
                const response = await axios.get(`${API_URL}/settings`, { timeout: 5000 });
                return response.data;
            } catch (error) {
                return null;
            }
        },
        retry: 1,
        retryDelay: 1000,
    });

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
            const response = await axios.get(`${API_URL}/settings/password-enabled`, { timeout: 5000 });
            return response.data;
        },
        retry: 1,
        retryDelay: 1000,
    });

    // Initialize wait time from server response
    useEffect(() => {
        if (statusData && statusData.waitTime) {
            setWaitTime(statusData.waitTime);
        }
    }, [statusData]);

    // Auto-login if password is not enabled
    useEffect(() => {
        if (statusData && statusData.enabled === false) {
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

    const loginMutation = useMutation({
        mutationFn: async (password: string) => {
            const response = await axios.post(`${API_URL}/settings/verify-password`, { password });
            return response.data;
        },
        onSuccess: (data) => {
            if (data.success) {
                setWaitTime(0); // Reset wait time on success
                login();
            } else {
                setError(t('incorrectPassword'));
            }
        },
        onError: (err: any) => {
            console.error('Login error:', err);
            if (err.response) {
                const responseData = err.response.data;
                if (err.response.status === 429) {
                    // Too many attempts - wait time required
                    const waitTimeMs = responseData.waitTime || 0;
                    setWaitTime(waitTimeMs);
                    const formattedTime = formatWaitTime(waitTimeMs);
                    setError(
                        `${t('tooManyAttempts')} ${t('waitTimeMessage').replace('{time}', formattedTime)}`
                    );
                } else if (err.response.status === 401) {
                    // Incorrect password - check if wait time is returned
                    const waitTimeMs = responseData.waitTime || 0;
                    if (waitTimeMs > 0) {
                        setWaitTime(waitTimeMs);
                        const formattedTime = formatWaitTime(waitTimeMs);
                        setError(
                            `${t('incorrectPassword')} ${t('waitTimeMessage').replace('{time}', formattedTime)}`
                        );
                    } else {
                        setError(t('incorrectPassword'));
                    }
                } else {
                    setError(t('loginFailed'));
                }
            } else {
                setError(t('loginFailed'));
            }
        }
    });

    const resetPasswordMutation = useMutation({
        mutationFn: async () => {
            const response = await axios.post(`${API_URL}/settings/reset-password`);
            return response.data;
        },
        onSuccess: () => {
            setShowResetModal(false);
            setError('');
            setWaitTime(0);
            queryClient.invalidateQueries({ queryKey: ['healthCheck'] });
            // Show success message
            alert(t('resetPasswordSuccess'));
        },
        onError: (err: any) => {
            console.error('Reset password error:', err);
            setError(t('loginFailed'));
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (waitTime > 0) {
            return; // Don't allow submission if wait time is active
        }
        setError('');
        loginMutation.mutate(password);
    };

    const handleResetPassword = () => {
        resetPasswordMutation.mutate();
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
                            <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1, width: '100%' }}>
                                <TextField
                                    margin="normal"
                                    required
                                    fullWidth
                                    name="password"
                                    label={t('password')}
                                    type="password"
                                    id="password"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    autoFocus
                                    disabled={waitTime > 0 || loginMutation.isPending}
                                    helperText={t('defaultPasswordHint') || "Default password: 123"}
                                />
                                <Button
                                    type="submit"
                                    fullWidth
                                    variant="contained"
                                    sx={{ mt: 3, mb: 2 }}
                                    disabled={loginMutation.isPending || waitTime > 0}
                                >
                                    {loginMutation.isPending ? (t('verifying') || 'Verifying...') : t('signIn')}
                                </Button>
                                <Button
                                    fullWidth
                                    variant="outlined"
                                    startIcon={<Refresh />}
                                    onClick={() => setShowResetModal(true)}
                                    sx={{ mb: 2 }}
                                    disabled={resetPasswordMutation.isPending}
                                >
                                    {t('resetPassword')}
                                </Button>
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
                message={t('resetPasswordMessage')}
                confirmText={t('resetPasswordConfirm')}
                cancelText={t('cancel')}
                isDanger={true}
            />
        </ThemeProvider>
    );
};

export default LoginPage;
