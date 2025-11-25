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
import ConfirmationModal from '../components/ConfirmationModal';
import { useLanguage } from '../contexts/LanguageContext';
import ConsoleManager from '../utils/consoleManager';
import { Language } from '../utils/translations';

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
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null);

    // Modal states
    const [showDeleteLegacyModal, setShowDeleteLegacyModal] = useState(false);
    const [showMigrateConfirmModal, setShowMigrateConfirmModal] = useState(false);
    const [infoModal, setInfoModal] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'info' | 'warning' }>({
        isOpen: false,
        title: '',
        message: '',
        type: 'info'
    });

    const [debugMode, setDebugMode] = useState(ConsoleManager.getDebugMode());

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

    const handleChange = (field: keyof Settings, value: string | boolean | number) => {
        setSettings(prev => ({ ...prev, [field]: value }));
        if (field === 'language') {
            setLanguage(value as Language);
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
                            <Typography variant="h6" gutterBottom>{t('database')}</Typography>
                            <Typography variant="body2" color="text.secondary" paragraph>
                                {t('migrateDataDescription')}
                            </Typography>
                            <Button
                                variant="outlined"
                                color="warning"
                                onClick={() => setShowMigrateConfirmModal(true)}
                                disabled={saving}
                            >
                                {t('migrateDataButton')}
                            </Button>

                            <Button
                                variant="outlined"
                                color="primary"
                                onClick={async () => {
                                    setSaving(true);
                                    try {
                                        const res = await axios.post(`${API_URL}/scan-files`);
                                        const { addedCount } = res.data;

                                        setInfoModal({
                                            isOpen: true,
                                            title: t('success'),
                                            message: t('scanFilesSuccess').replace('{count}', addedCount.toString()),
                                            type: 'success'
                                        });
                                    } catch (error: any) {
                                        console.error('Scan failed:', error);
                                        setInfoModal({
                                            isOpen: true,
                                            title: t('error'),
                                            message: `${t('scanFilesFailed')}: ${error.response?.data?.details || error.message}`,
                                            type: 'error'
                                        });
                                    } finally {
                                        setSaving(false);
                                    }
                                }}
                                disabled={saving}
                                sx={{ ml: 2 }}
                            >
                                {t('scanFiles')}
                            </Button>

                            <Box sx={{ mt: 3 }}>
                                <Typography variant="h6" gutterBottom>{t('removeLegacyData')}</Typography>
                                <Typography variant="body2" color="text.secondary" paragraph>
                                    {t('removeLegacyDataDescription')}
                                </Typography>
                                <Button
                                    variant="outlined"
                                    color="error"
                                    onClick={() => setShowDeleteLegacyModal(true)}
                                    disabled={saving}
                                >
                                    {t('deleteLegacyDataButton')}
                                </Button>
                            </Box>
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Advanced Settings */}
                        <Grid size={12}>
                            <Typography variant="h6" gutterBottom>{t('debugMode')}</Typography>
                            <Typography variant="body2" color="text.secondary" paragraph>
                                {t('debugModeDescription')}
                            </Typography>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={debugMode}
                                        onChange={(e) => {
                                            setDebugMode(e.target.checked);
                                            ConsoleManager.setDebugMode(e.target.checked);
                                        }}
                                    />
                                }
                                label={t('debugMode')}
                            />
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
            <ConfirmationModal
                isOpen={showDeleteLegacyModal}
                onClose={() => setShowDeleteLegacyModal(false)}
                onConfirm={async () => {
                    setSaving(true);
                    try {
                        const res = await axios.post(`${API_URL}/settings/delete-legacy`);
                        const results = res.data.results;
                        console.log('Delete legacy results:', results);

                        let msg = `${t('legacyDataDeleted')}\n`;
                        if (results.deleted.length > 0) {
                            msg += `\nDeleted: ${results.deleted.join(', ')}`;
                        }
                        if (results.failed.length > 0) {
                            msg += `\nFailed: ${results.failed.join(', ')}`;
                        }

                        if (results.failed.length > 0) {
                            msg += `\nFailed: ${results.failed.join(', ')}`;
                        }

                        setInfoModal({
                            isOpen: true,
                            title: t('success'),
                            message: msg,
                            type: 'success'
                        });
                    } catch (error: any) {
                        console.error('Failed to delete legacy data:', error);
                        setInfoModal({
                            isOpen: true,
                            title: t('error'),
                            message: `Failed to delete legacy data: ${error.response?.data?.details || error.message}`,
                            type: 'error'
                        });
                    } finally {
                        setSaving(false);
                    }
                }}
                title={t('removeLegacyDataConfirmTitle')}
                message={t('removeLegacyDataConfirmMessage')}
                confirmText={t('delete')}
                cancelText={t('cancel')}
                isDanger={true}
            />

            {/* Migrate Data Confirmation Modal */}
            <ConfirmationModal
                isOpen={showMigrateConfirmModal}
                onClose={() => setShowMigrateConfirmModal(false)}
                onConfirm={async () => {
                    setSaving(true);
                    try {
                        const res = await axios.post(`${API_URL}/settings/migrate`);
                        const results = res.data.results;
                        console.log('Migration results:', results);

                        let msg = `${t('migrationReport')}:\n`;
                        let hasData = false;

                        if (results.warnings && results.warnings.length > 0) {
                            msg += `\n⚠️ ${t('migrationWarnings')}:\n${results.warnings.join('\n')}\n`;
                        }

                        const categories = ['videos', 'collections', 'settings', 'downloads'];
                        categories.forEach(cat => {
                            const data = results[cat];
                            if (data) {
                                if (data.found) {
                                    msg += `\n✅ ${cat}: ${data.count} ${t('itemsMigrated')}`;
                                    hasData = true;
                                } else {
                                    msg += `\n❌ ${cat}: ${t('fileNotFound')} ${data.path}`;
                                }
                            }
                        });

                        if (results.errors && results.errors.length > 0) {
                            msg += `\n\n⛔ ${t('migrationErrors')}:\n${results.errors.join('\n')}`;
                        }

                        if (!hasData && (!results.errors || results.errors.length === 0)) {
                            msg += `\n\n⚠️ ${t('noDataFilesFound')}`;
                        }

                        setInfoModal({
                            isOpen: true,
                            title: hasData ? t('migrationResults') : t('migrationNoData'),
                            message: msg,
                            type: hasData ? 'success' : 'warning'
                        });
                    } catch (error: any) {
                        console.error('Migration failed:', error);
                        setInfoModal({
                            isOpen: true,
                            title: t('error'),
                            message: `${t('migrationFailed')}: ${error.response?.data?.details || error.message}`,
                            type: 'error'
                        });
                    } finally {
                        setSaving(false);
                    }
                }}
                title={t('migrateDataButton')}
                message={t('migrateConfirmation')}
                confirmText={t('confirm')}
                cancelText={t('cancel')}
            />

            {/* Info/Result Modal */}
            <ConfirmationModal
                isOpen={infoModal.isOpen}
                onClose={() => setInfoModal(prev => ({ ...prev, isOpen: false }))}
                onConfirm={() => setInfoModal(prev => ({ ...prev, isOpen: false }))}
                title={infoModal.title}
                message={infoModal.message}
                confirmText="OK"
                showCancel={false}
                isDanger={infoModal.type === 'error'}
            />
        </Container>
    );
};

export default SettingsPage;
