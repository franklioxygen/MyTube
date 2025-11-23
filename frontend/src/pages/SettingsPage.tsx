import {
    ArrowBack,
    Save
} from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Container,
    Divider,
    FormControlLabel,
    Grid,
    Slider,
    Snackbar,
    Switch,
    TextField,
    Typography
} from '@mui/material';
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL;

interface Settings {
    loginEnabled: boolean;
    password?: string;
    isPasswordSet?: boolean;
    defaultAutoPlay: boolean;
    defaultAutoLoop: boolean;
    maxConcurrentDownloads: number;
}

const SettingsPage: React.FC = () => {
    const [settings, setSettings] = useState<Settings>({
        loginEnabled: false,
        password: '',
        defaultAutoPlay: false,
        defaultAutoLoop: false,
        maxConcurrentDownloads: 3
    });
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            const response = await axios.get(`${API_URL}/settings`);
            setSettings(response.data);
        } catch (error) {
            console.error('Error fetching settings:', error);
            setMessage({ text: 'Failed to load settings', type: 'error' });
        } finally {
            // Loading finished
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // Only send password if it has been changed (is not empty)
            const settingsToSend = { ...settings };
            if (!settingsToSend.password) {
                delete settingsToSend.password;
            }

            await axios.post(`${API_URL}/settings`, settingsToSend);
            setMessage({ text: 'Settings saved successfully', type: 'success' });

            // Clear password field after save
            setSettings(prev => ({ ...prev, password: '', isPasswordSet: true }));
        } catch (error) {
            console.error('Error saving settings:', error);
            setMessage({ text: 'Failed to save settings', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (field: keyof Settings, value: any) => {
        setSettings(prev => ({ ...prev, [field]: value }));
    };

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    Settings
                </Typography>
                <Button
                    component={Link}
                    to="/manage"
                    variant="outlined"
                    startIcon={<ArrowBack />}
                >
                    Back to Manage
                </Button>
            </Box>

            <Card variant="outlined">
                <CardContent>
                    <Grid container spacing={4}>
                        {/* Security Settings */}
                        <Grid size={12}>
                            <Typography variant="h6" gutterBottom>Security</Typography>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={settings.loginEnabled}
                                        onChange={(e) => handleChange('loginEnabled', e.target.checked)}
                                    />
                                }
                                label="Enable Login Protection"
                            />

                            {settings.loginEnabled && (
                                <Box sx={{ mt: 2, maxWidth: 400 }}>
                                    <TextField
                                        fullWidth
                                        label="Password"
                                        type="password"
                                        value={settings.password || ''}
                                        onChange={(e) => handleChange('password', e.target.value)}
                                        helperText={
                                            settings.isPasswordSet
                                                ? "Leave empty to keep current password, or type to change"
                                                : "Set a password for accessing the application"
                                        }
                                    />
                                </Box>
                            )}
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Video Defaults */}
                        <Grid size={12}>
                            <Typography variant="h6" gutterBottom>Video Player Defaults</Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={settings.defaultAutoPlay}
                                            onChange={(e) => handleChange('defaultAutoPlay', e.target.checked)}
                                        />
                                    }
                                    label="Auto-play Videos"
                                />
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={settings.defaultAutoLoop}
                                            onChange={(e) => handleChange('defaultAutoLoop', e.target.checked)}
                                        />
                                    }
                                    label="Auto-loop Videos"
                                />
                            </Box>
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Download Settings */}
                        <Grid size={12}>
                            <Typography variant="h6" gutterBottom>Download Settings</Typography>
                            <Typography gutterBottom>
                                Max Concurrent Downloads: {settings.maxConcurrentDownloads}
                            </Typography>
                            <Box sx={{ maxWidth: 400, px: 2 }}>
                                <Slider
                                    value={settings.maxConcurrentDownloads}
                                    onChange={(_, value) => handleChange('maxConcurrentDownloads', value)}
                                    min={1}
                                    max={10}
                                    step={1}
                                    marks
                                    valueLabelDisplay="auto"
                                />
                            </Box>
                        </Grid>

                        <Grid size={12}>
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                                <Button
                                    variant="contained"
                                    size="large"
                                    startIcon={<Save />}
                                    onClick={handleSave}
                                    disabled={saving}
                                >
                                    {saving ? 'Saving...' : 'Save Settings'}
                                </Button>
                            </Box>
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>

            <Snackbar
                open={!!message}
                autoHideDuration={6000}
                onClose={() => setMessage(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity={message?.type} onClose={() => setMessage(null)}>
                    {message?.text}
                </Alert>
            </Snackbar>
        </Container>
    );
};

export default SettingsPage;
