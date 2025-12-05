import { ErrorOutline, LockOutlined } from '@mui/icons-material';
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
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import getTheme from '../theme';

const API_URL = import.meta.env.VITE_API_URL;

const LoginPage: React.FC = () => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const { t } = useLanguage();
    const { login } = useAuth();

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

    // Auto-login if password is not enabled
    useEffect(() => {
        if (statusData && statusData.enabled === false) {
            login();
        }
    }, [statusData, login]);

    // Use dark theme for login page to match app style
    const theme = getTheme('dark');

    const loginMutation = useMutation({
        mutationFn: async (password: string) => {
            const response = await axios.post(`${API_URL}/settings/verify-password`, { password });
            return response.data;
        },
        onSuccess: (data) => {
            if (data.success) {
                login();
            } else {
                setError(t('incorrectPassword'));
            }
        },
        onError: (err: any) => {
            console.error('Login error:', err);
            if (err.response && err.response.status === 401) {
                setError(t('incorrectPassword'));
            } else {
                setError(t('loginFailed'));
            }
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        loginMutation.mutate(password);
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
                            <Avatar sx={{ m: 1, bgcolor: 'secondary.main' }}>
                                <LockOutlined />
                            </Avatar>
                            <Typography component="h1" variant="h5">
                                {t('signIn')}
                            </Typography>
                            <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1 }}>
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
                                    helperText={t('defaultPasswordHint') || "Default password: 123"}
                                />
                                {error && (
                                    <Alert severity="error" sx={{ mt: 2 }}>
                                        {error}
                                    </Alert>
                                )}
                                <Button
                                    type="submit"
                                    fullWidth
                                    variant="contained"
                                    sx={{ mt: 3, mb: 2 }}
                                    disabled={loginMutation.isPending}
                                >
                                    {loginMutation.isPending ? t('verifying') : t('signIn')}
                                </Button>
                            </Box>
                        </>
                    )}
                </Box>
            </Container>
        </ThemeProvider>
    );
};

export default LoginPage;
