import { LockOutlined } from '@mui/icons-material';
import {
    Alert,
    Avatar,
    Box,
    Button,
    Container,
    CssBaseline,
    TextField,
    ThemeProvider,
    Typography
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import getTheme from '../theme';

const API_URL = import.meta.env.VITE_API_URL;

interface LoginPageProps {
    onLoginSuccess: () => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const { t } = useLanguage();

    // Use dark theme for login page to match app style
    const theme = getTheme('dark');

    const loginMutation = useMutation({
        mutationFn: async (password: string) => {
            const response = await axios.post(`${API_URL}/settings/verify-password`, { password });
            return response.data;
        },
        onSuccess: (data) => {
            if (data.success) {
                onLoginSuccess();
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
                </Box>
            </Container>
        </ThemeProvider>
    );
};

export default LoginPage;
