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
    FormControl,
    FormControlLabel,
    Grid,
    InputLabel,
    MenuItem,
    Select,
    Slider,
    Snackbar,
    Switch,
    TextField,
    Typography
} from '@mui/material';
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';

const API_URL = import.meta.env.VITE_API_URL;

interface Settings {
    loginEnabled: boolean;
    password?: string;
    isPasswordSet?: boolean;
    defaultAutoPlay: boolean;
    defaultAutoLoop: boolean;
    maxConcurrentDownloads: number;
    language: string;
}

const SettingsPage: React.FC = () => {
    const [settings, setSettings] = useState<Settings>({
        loginEnabled: false,
        password: '',
        defaultAutoPlay: false,
        defaultAutoLoop: false,
        maxConcurrentDownloads: 3,
        language: 'en'
    });
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const { t, setLanguage } = useLanguage();

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            const response = await axios.get(`${API_URL}/settings`);
            setSettings(response.data);
        } catch (error) {
            console.error('Error fetching settings:', error);
            setMessage({ text: t('settingsFailed'), type: 'error' });
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
            setMessage({ text: t('settingsSaved'), type: 'success' });

            // Clear password field after save
            setSettings(prev => ({ ...prev, password: '', isPasswordSet: true }));
        } catch (error) {
            console.error('Error saving settings:', error);
            setMessage({ text: t('settingsFailed'), type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (field: keyof Settings, value: any) => {
        setSettings(prev => ({ ...prev, [field]: value }));
        if (field === 'language') {
            setLanguage(value);
        }
    };

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    {t('settings')}
                </Typography>
                <Button
                    component={Link}
                    to="/"
                    variant="outlined"
                    startIcon={<ArrowBack />}
                >
                    {t('backToHome')}
                </Button>
            </Box>

            <Card variant="outlined">
                <CardContent>
                    <Grid container spacing={4}>
                        {/* General Settings */}
                        <Grid size={12}>
                            <Typography variant="h6" gutterBottom>{t('general')}</Typography>
                            <Box sx={{ maxWidth: 400 }}>
                                <FormControl fullWidth>
                                    <InputLabel id="language-select-label">{t('language')}</InputLabel>
                                    <Select
                                        labelId="language-select-label"
                                        id="language-select"
                                        value={settings.language || 'en'}
                                        label={t('language')}
                                        onChange={(e) => handleChange('language', e.target.value)}
                                    >
                                        <MenuItem value="en">English</MenuItem>
                                        <MenuItem value="zh">Chinese</MenuItem>
                                    </Select>
                                </FormControl>
                            </Box>
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Security Settings */}
                        <Grid size={12}>
                            <Typography variant="h6" gutterBottom>{t('security')}</Typography>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={settings.loginEnabled}
                                        onChange={(e) => handleChange('loginEnabled', e.target.checked)}
                                    />
                                }
                                label={t('enableLogin')}
                            />

                            {settings.loginEnabled && (
                                <Box sx={{ mt: 2, maxWidth: 400 }}>
                                    <TextField
                                        fullWidth
                                        label={t('password')}
                                        type="password"
                                        value={settings.password || ''}
                                        onChange={(e) => handleChange('password', e.target.value)}
                                        helperText={
                                            settings.isPasswordSet
                                                ? t('passwordHelper')
                                                : t('passwordSetHelper')
                                        }
                                    />
                                </Box>
                            )}
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Video Defaults */}
                        <Grid size={12}>
                            <Typography variant="h6" gutterBottom>{t('videoDefaults')}</Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={settings.defaultAutoPlay}
                                            onChange={(e) => handleChange('defaultAutoPlay', e.target.checked)}
                                        />
                                    }
                                    label={t('autoPlay')}
                                />
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={settings.defaultAutoLoop}
                                            onChange={(e) => handleChange('defaultAutoLoop', e.target.checked)}
                                        />
                                    }
                                    label={t('autoLoop')}
                                />
                            </Box>
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Download Settings */}
                        <Grid size={12}>
                            <Typography variant="h6" gutterBottom>{t('downloadSettings')}</Typography>
                            <Typography gutterBottom>
                                {t('maxConcurrent')}: {settings.maxConcurrentDownloads}
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

                        <Grid size={12}><Divider /></Grid>

                        {/* Database Settings */}
                        <Grid size={12}>
                            <Typography variant="h6" gutterBottom>Database</Typography>
                            <Typography variant="body2" color="text.secondary" paragraph>
                                Migrate data from legacy JSON files to the new SQLite database.
                                This action is safe to run multiple times (duplicates will be skipped).
                            </Typography>
                            <Button
                                variant="outlined"
                                color="warning"
                                onClick={async () => {
                                    if (window.confirm('Are you sure you want to migrate data? This may take a few moments.')) {
                                        setSaving(true);
                                        try {
                                            const res = await axios.post(`${API_URL}/settings/migrate`);
                                            const results = res.data.results;
                                            console.log('Migration results:', results);

                                            let msg = 'Migration Report:\n';
                                            let hasData = false;

                                            if (results.warnings && results.warnings.length > 0) {
                                                msg += `\n⚠️ WARNINGS:\n${results.warnings.join('\n')}\n`;
                                            }

                                            const categories = ['videos', 'collections', 'settings', 'downloads'];
                                            categories.forEach(cat => {
                                                const data = results[cat];
                                                if (data) {
                                                    if (data.found) {
                                                        msg += `\n✅ ${cat}: ${data.count} items migrated`;
                                                        hasData = true;
                                                    } else {
                                                        msg += `\n❌ ${cat}: File not found at ${data.path}`;
                                                    }
                                                }
                                            });

                                            if (results.errors && results.errors.length > 0) {
                                                msg += `\n\n⛔ ERRORS:\n${results.errors.join('\n')}`;
                                            }

                                            if (!hasData && (!results.errors || results.errors.length === 0)) {
                                                msg += '\n\n⚠️ No data files were found to migrate. Please check your volume mappings.';
                                            }

                                            alert(msg);
                                            setMessage({ text: hasData ? 'Migration completed. See details in alert.' : 'Migration finished but no data found.', type: hasData ? 'success' : 'warning' });
                                        } catch (error: any) {
                                            console.error('Migration failed:', error);
                                            setMessage({
                                                text: `Migration failed: ${error.response?.data?.details || error.message}`,
                                                type: 'error'
                                            });
                                        } finally {
                                            setSaving(false);
                                        }
                                    }
                                }}
                                disabled={saving}
                            >
                                Migrate Data from JSON
                            </Button>
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
                                    {saving ? t('saving') : t('saveSettings')}
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
