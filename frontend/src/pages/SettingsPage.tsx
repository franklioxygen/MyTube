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
    Chip,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ConfirmationModal from '../components/ConfirmationModal';
import { useDownload } from '../contexts/DownloadContext';
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
    tags: string[];
    cloudDriveEnabled: boolean;
    openListApiUrl: string;
    openListToken: string;
    cloudDrivePath: string;
}

const SettingsPage: React.FC = () => {
    const queryClient = useQueryClient();
    const { t, setLanguage } = useLanguage();
    const { activeDownloads } = useDownload();

    const [settings, setSettings] = useState<Settings>({
        loginEnabled: false,
        password: '',
        defaultAutoPlay: false,
        defaultAutoLoop: false,
        maxConcurrentDownloads: 3,
        language: 'en',
        tags: [],
        cloudDriveEnabled: false,
        openListApiUrl: '',
        openListToken: '',
        cloudDrivePath: ''
    });
    const [newTag, setNewTag] = useState('');
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null);

    // Modal states
    const [showDeleteLegacyModal, setShowDeleteLegacyModal] = useState(false);
    const [showMigrateConfirmModal, setShowMigrateConfirmModal] = useState(false);
    const [showCleanupTempFilesModal, setShowCleanupTempFilesModal] = useState(false);
    const [infoModal, setInfoModal] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'info' | 'warning' }>({
        isOpen: false,
        title: '',
        message: '',
        type: 'info'
    });

    const [debugMode, setDebugMode] = useState(ConsoleManager.getDebugMode());

    // Fetch settings
    const { data: settingsData } = useQuery({
        queryKey: ['settings'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings`);
            return response.data;
        }
    });

    useEffect(() => {
        if (settingsData) {
            setSettings({
                ...settingsData,
                tags: settingsData.tags || []
            });
        }
    }, [settingsData]);

    // Save settings mutation
    const saveMutation = useMutation({
        mutationFn: async (newSettings: Settings) => {
            // Only send password if it has been changed (is not empty)
            const settingsToSend = { ...newSettings };
            if (!settingsToSend.password) {
                delete settingsToSend.password;
            }
            await axios.post(`${API_URL}/settings`, settingsToSend);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            setMessage({ text: t('settingsSaved'), type: 'success' });
            // Clear password field after save
            setSettings(prev => ({ ...prev, password: '', isPasswordSet: true }));
        },
        onError: () => {
            setMessage({ text: t('settingsFailed'), type: 'error' });
        }
    });

    const handleSave = () => {
        saveMutation.mutate(settings);
    };

    // Scan files mutation
    const scanMutation = useMutation({
        mutationFn: async () => {
            const res = await axios.post(`${API_URL}/scan-files`);
            return res.data;
        },
        onSuccess: (data) => {
            setInfoModal({
                isOpen: true,
                title: t('success'),
                message: t('scanFilesSuccess').replace('{count}', data.addedCount.toString()),
                type: 'success'
            });
        },
        onError: (error: any) => {
            setInfoModal({
                isOpen: true,
                title: t('error'),
                message: `${t('scanFilesFailed')}: ${error.response?.data?.details || error.message}`,
                type: 'error'
            });
        }
    });

    // Migrate data mutation
    const migrateMutation = useMutation({
        mutationFn: async () => {
            const res = await axios.post(`${API_URL}/settings/migrate`);
            return res.data.results;
        },
        onSuccess: (results) => {
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
        },
        onError: (error: any) => {
            setInfoModal({
                isOpen: true,
                title: t('error'),
                message: `${t('migrationFailed')}: ${error.response?.data?.details || error.message}`,
                type: 'error'
            });
        }
    });

    // Cleanup temp files mutation
    const cleanupMutation = useMutation({
        mutationFn: async () => {
            const res = await axios.post(`${API_URL}/cleanup-temp-files`);
            return res.data;
        },
        onSuccess: (data) => {
            const { deletedCount, errors } = data;
            let msg = t('cleanupTempFilesSuccess').replace('{count}', deletedCount.toString());
            if (errors && errors.length > 0) {
                msg += `\n\nErrors:\n${errors.join('\n')}`;
            }

            setInfoModal({
                isOpen: true,
                title: t('success'),
                message: msg,
                type: errors && errors.length > 0 ? 'warning' : 'success'
            });
        },
        onError: (error: any) => {
            const errorMsg = error.response?.data?.error === "Cannot clean up while downloads are active"
                ? t('cleanupTempFilesActiveDownloads')
                : `${t('cleanupTempFilesFailed')}: ${error.response?.data?.details || error.message}`;

            setInfoModal({
                isOpen: true,
                title: t('error'),
                message: errorMsg,
                type: 'error'
            });
        }
    });

    // Delete legacy data mutation
    const deleteLegacyMutation = useMutation({
        mutationFn: async () => {
            const res = await axios.post(`${API_URL}/settings/delete-legacy`);
            return res.data.results;
        },
        onSuccess: (results) => {
            let msg = `${t('legacyDataDeleted')}\n`;
            if (results.deleted.length > 0) {
                msg += `\nDeleted: ${results.deleted.join(', ')}`;
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
        },
        onError: (error: any) => {
            setInfoModal({
                isOpen: true,
                title: t('error'),
                message: `Failed to delete legacy data: ${error.response?.data?.details || error.message}`,
                type: 'error'
            });
        }
    });

    const handleChange = (field: keyof Settings, value: string | boolean | number) => {
        setSettings(prev => ({ ...prev, [field]: value }));
        if (field === 'language') {
            setLanguage(value as Language);
        }
    };

    const handleAddTag = () => {
        if (newTag && !settings.tags.includes(newTag)) {
            const updatedTags = [...settings.tags, newTag];
            setSettings(prev => ({ ...prev, tags: updatedTags }));
            setNewTag('');
        }
    };

    const handleDeleteTag = (tagToDelete: string) => {
        const updatedTags = settings.tags.filter(tag => tag !== tagToDelete);
        setSettings(prev => ({ ...prev, tags: updatedTags }));
    };

    const isSaving = saveMutation.isPending || scanMutation.isPending || migrateMutation.isPending || cleanupMutation.isPending || deleteLegacyMutation.isPending;

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
                                        <MenuItem value="zh">中文 (Chinese)</MenuItem>
                                        <MenuItem value="es">Español (Spanish)</MenuItem>
                                        <MenuItem value="de">Deutsch (German)</MenuItem>
                                        <MenuItem value="ja">日本語 (Japanese)</MenuItem>
                                        <MenuItem value="fr">Français (French)</MenuItem>
                                        <MenuItem value="ko">한국어 (Korean)</MenuItem>
                                        <MenuItem value="ar">العربية (Arabic)</MenuItem>
                                        <MenuItem value="pt">Português (Portuguese)</MenuItem>
                                        <MenuItem value="ru">Русский (Russian)</MenuItem>
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

                        {/* Tags Management */}
                        <Grid size={12}>
                            <Typography variant="h6" gutterBottom>{t('tagsManagement') || 'Tags Management'}</Typography>
                            <Typography variant="body2" color="text.secondary" paragraph>
                                {t('tagsManagementNote') || 'Please remember to click "Save Settings" after adding or removing tags to apply changes.'}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                                {settings.tags && settings.tags.map((tag) => (
                                    <Chip
                                        key={tag}
                                        label={tag}
                                        onDelete={() => handleDeleteTag(tag)}
                                    />
                                ))}
                            </Box>
                            <Box sx={{ display: 'flex', gap: 1, maxWidth: 400 }}>
                                <TextField
                                    label={t('newTag') || 'New Tag'}
                                    value={newTag}
                                    onChange={(e) => setNewTag(e.target.value)}
                                    size="small"
                                    fullWidth
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            handleAddTag();
                                        }
                                    }}
                                />
                                <Button variant="contained" onClick={handleAddTag}>
                                    {t('add') || 'Add'}
                                </Button>
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

                            <Box sx={{ mt: 3 }}>
                                <Typography variant="h6" gutterBottom>{t('cleanupTempFiles')}</Typography>
                                <Typography variant="body2" color="text.secondary" paragraph>
                                    {t('cleanupTempFilesDescription')}
                                </Typography>
                                {activeDownloads.length > 0 && (
                                    <Alert severity="warning" sx={{ mb: 2, maxWidth: 600 }}>
                                        {t('cleanupTempFilesActiveDownloads')}
                                    </Alert>
                                )}
                                <Button
                                    variant="outlined"
                                    color="warning"
                                    onClick={() => setShowCleanupTempFilesModal(true)}
                                    disabled={isSaving || activeDownloads.length > 0}
                                >
                                    {t('cleanupTempFiles')}
                                </Button>
                            </Box>
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Cloud Drive Settings */}
                        <Grid size={12}>
                            <Typography variant="h6" gutterBottom>{t('cloudDriveSettings')}</Typography>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={settings.cloudDriveEnabled || false}
                                        onChange={(e) => handleChange('cloudDriveEnabled', e.target.checked)}
                                    />
                                }
                                label={t('enableAutoSave')}
                            />

                            {settings.cloudDriveEnabled && (
                                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 600 }}>
                                    <TextField
                                        label={t('apiUrl')}
                                        value={settings.openListApiUrl || ''}
                                        onChange={(e) => handleChange('openListApiUrl', e.target.value)}
                                        helperText={t('apiUrlHelper')}
                                        fullWidth
                                    />
                                    <TextField
                                        label={t('token')}
                                        value={settings.openListToken || ''}
                                        onChange={(e) => handleChange('openListToken', e.target.value)}
                                        type="password"
                                        fullWidth
                                    />
                                    <TextField
                                        label={t('uploadPath')}
                                        value={settings.cloudDrivePath || ''}
                                        onChange={(e) => handleChange('cloudDrivePath', e.target.value)}
                                        helperText={t('cloudDrivePathHelper')}
                                        fullWidth
                                    />
                                </Box>
                            )}
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
                                disabled={isSaving}
                            >
                                {t('migrateDataButton')}
                            </Button>

                            <Button
                                variant="outlined"
                                color="primary"
                                onClick={() => scanMutation.mutate()}
                                disabled={isSaving}
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
                                    disabled={isSaving}
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
                                    disabled={isSaving}
                                >
                                    {isSaving ? t('saving') : t('saveSettings')}
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
                onConfirm={() => {
                    setShowDeleteLegacyModal(false);
                    deleteLegacyMutation.mutate();
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
                onConfirm={() => {
                    setShowMigrateConfirmModal(false);
                    migrateMutation.mutate();
                }}
                title={t('migrateDataButton')}
                message={t('migrateConfirmation')}
                confirmText={t('confirm')}
                cancelText={t('cancel')}
            />

            {/* Cleanup Temp Files Modal */}
            <ConfirmationModal
                isOpen={showCleanupTempFilesModal}
                onClose={() => setShowCleanupTempFilesModal(false)}
                onConfirm={() => {
                    setShowCleanupTempFilesModal(false);
                    cleanupMutation.mutate();
                }}
                title={t('cleanupTempFilesConfirmTitle')}
                message={t('cleanupTempFilesConfirmMessage')}
                confirmText={t('confirm')}
                cancelText={t('cancel')}
                isDanger={true}
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
        </Container >
    );
};

export default SettingsPage;
