
import {
    Alert,
    Box,
    Card,
    CardContent,
    Container,
    Divider,
    Grid,
    Snackbar,
    Typography
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import ConfirmationModal from '../components/ConfirmationModal';
import AdvancedSettings from '../components/Settings/AdvancedSettings';
import CloudDriveSettings from '../components/Settings/CloudDriveSettings';
import CookieSettings from '../components/Settings/CookieSettings';
import DatabaseSettings from '../components/Settings/DatabaseSettings';
import DownloadSettings from '../components/Settings/DownloadSettings';
import GeneralSettings from '../components/Settings/GeneralSettings';
import SecuritySettings from '../components/Settings/SecuritySettings';
import TagsSettings from '../components/Settings/TagsSettings';
import VideoDefaultSettings from '../components/Settings/VideoDefaultSettings';
import YtDlpSettings from '../components/Settings/YtDlpSettings';
import { useDownload } from '../contexts/DownloadContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useDebounce } from '../hooks/useDebounce';
import { Settings } from '../types';
import ConsoleManager from '../utils/consoleManager';
import { SNACKBAR_AUTO_HIDE_DURATION } from '../utils/constants';
import { Language } from '../utils/translations';

const API_URL = import.meta.env.VITE_API_URL;

const SettingsPage: React.FC = () => {
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
        cloudDrivePath: '',
        itemsPerPage: 12,
        ytDlpConfig: '',
        showYoutubeSearch: true,
        proxyOnlyYoutube: false,
        moveSubtitlesToVideoFolder: false
    });
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null);
    const debouncedSettings = useDebounce(settings, 1000);
    const lastSavedSettingsRef = React.useRef<Settings | null>(null);

    // Modal states
    const [showDeleteLegacyModal, setShowDeleteLegacyModal] = useState(false);
    const [showFormatConfirmModal, setShowFormatConfirmModal] = useState(false);
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
            const newSettings = {
                ...settingsData,
                tags: settingsData.tags || []
            };
            setSettings(newSettings);
            // Initialize sync reference with fetched data
            if (!lastSavedSettingsRef.current) {
                lastSavedSettingsRef.current = newSettings;
            }
        }
    }, [settingsData]);

    const areSettingsEqual = (s1: Settings, s2: Settings) => {
        const { password: p1, ...rest1 } = s1;
        const { password: p2, ...rest2 } = s2;
        // If password is set in current settings, it's a change (we assume s2 is lastSaved, which has cleared password)
        if (p1) return false;
        return JSON.stringify(rest1) === JSON.stringify(rest2);
    };

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
        onSuccess: (_data, variables) => {
            // Do not invalidate queries to prevent overwriting user input while typing
            setMessage({ text: t('settingsSaved'), type: 'success' });
            // Update reference to the settings we just successfully saved
            // We must clear password from the reference as it is cleared in state on success (effectively)
            const { password, ...rest } = variables;
            lastSavedSettingsRef.current = { ...rest, password: '' } as Settings;
        },
        onError: () => {
            setMessage({ text: t('settingsFailed'), type: 'error' });
        }
    });

    // Autosave effect
    useEffect(() => {
        if (!lastSavedSettingsRef.current) return;

        if (!areSettingsEqual(debouncedSettings, lastSavedSettingsRef.current)) {
            // Check saveMutation.isPending
            if (!saveMutation.isPending) {
                saveMutation.mutate(debouncedSettings);
            }
        }
    }, [debouncedSettings, saveMutation.isPending]);



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

    // Format legacy filenames mutation
    const formatFilenamesMutation = useMutation({
        mutationFn: async () => {
            const res = await axios.post(`${API_URL}/settings/format-filenames`);
            return res.data.results;
        },
        onSuccess: (results) => {
            // Construct message using translations
            let msg = t('formatFilenamesSuccess')
                .replace('{processed}', results.processed.toString())
                .replace('{renamed}', results.renamed.toString())
                .replace('{errors}', results.errors.toString());

            if (results.details && results.details.length > 0) {
                // truncate details if too long
                const detailsToShow = results.details.slice(0, 10);
                msg += `\n\n${t('formatFilenamesDetails')}\n${detailsToShow.join('\n')}`;
                if (results.details.length > 10) {
                    msg += `\n${t('formatFilenamesMore').replace('{count}', (results.details.length - 10).toString())}`;
                }
            }

            setInfoModal({
                isOpen: true,
                title: t('success'),
                message: msg,
                type: results.errors > 0 ? 'warning' : 'success'
            });
        },
        onError: (error: any) => {
            setInfoModal({
                isOpen: true,
                title: t('error'),
                message: t('formatFilenamesError').replace('{error}', error.response?.data?.details || error.message),
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

    const handleImmediateSave = () => {
        if (!saveMutation.isPending) {
            saveMutation.mutate(settings);
        }
    };

    const handleTagsChange = (newTags: string[]) => {
        setSettings(prev => ({ ...prev, tags: newTags }));
    };

    const isSaving = saveMutation.isPending || migrateMutation.isPending || cleanupMutation.isPending || deleteLegacyMutation.isPending || formatFilenamesMutation.isPending;

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    {t('settings')}
                </Typography>
            </Box>

            <Card variant="outlined">
                <CardContent>
                    <Grid container spacing={4}>
                        {/* General Settings */}
                        <Grid size={12}>
                            <GeneralSettings
                                language={settings.language}
                                websiteName={settings.websiteName}
                                itemsPerPage={settings.itemsPerPage}
                                showYoutubeSearch={settings.showYoutubeSearch}
                                onChange={(field, value) => handleChange(field as keyof Settings, value)}
                            />
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Cookie Upload Settings */}
                        <Grid size={12}>
                            <CookieSettings
                                onSuccess={(msg) => setMessage({ text: msg, type: 'success' })}
                                onError={(msg) => setMessage({ text: msg, type: 'error' })}
                            />
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Security Settings */}
                        <Grid size={12}>
                            <SecuritySettings
                                settings={settings}
                                onChange={handleChange}
                            />
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Video Defaults */}
                        <Grid size={12}>
                            <VideoDefaultSettings
                                settings={settings}
                                onChange={handleChange}
                            />
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Tags Management */}
                        <Grid size={12}>
                            <TagsSettings
                                tags={settings.tags}
                                onTagsChange={handleTagsChange}
                            />
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Download Settings */}
                        <Grid size={12}>
                            <DownloadSettings
                                settings={settings}
                                onChange={handleChange}
                                activeDownloadsCount={activeDownloads.length}
                                onCleanup={() => setShowCleanupTempFilesModal(true)}
                                isSaving={isSaving}
                            />
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Cloud Drive Settings */}
                        <Grid size={12}>
                            <CloudDriveSettings
                                settings={settings}
                                onChange={handleChange}
                            />
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Database Settings */}
                        <Grid size={12}>
                            <DatabaseSettings
                                onMigrate={() => setShowMigrateConfirmModal(true)}
                                onDeleteLegacy={() => setShowDeleteLegacyModal(true)}
                                onFormatFilenames={() => setShowFormatConfirmModal(true)}
                                isSaving={isSaving}
                                moveSubtitlesToVideoFolder={settings.moveSubtitlesToVideoFolder || false}
                                onMoveSubtitlesToVideoFolderChange={(checked) => handleChange('moveSubtitlesToVideoFolder', checked)}
                            />
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* yt-dlp Configuration */}
                        <Grid size={12}>
                            <YtDlpSettings
                                config={settings.ytDlpConfig || ''}
                                proxyOnlyYoutube={settings.proxyOnlyYoutube || false}
                                onChange={(config) => handleChange('ytDlpConfig', config)}
                                onProxyOnlyYoutubeChange={(checked) => handleChange('proxyOnlyYoutube', checked)}
                                onSave={handleImmediateSave}
                            />
                        </Grid>

                        <Grid size={12}><Divider /></Grid>

                        {/* Advanced Settings */}
                        <Grid size={12}>
                            <AdvancedSettings
                                debugMode={debugMode}
                                onDebugModeChange={setDebugMode}
                            />
                        </Grid>



                    </Grid>
                </CardContent>
            </Card>

            <Snackbar
                open={!!message}
                autoHideDuration={SNACKBAR_AUTO_HIDE_DURATION}
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

            {/* Format Filenames Confirmation Modal */}
            <ConfirmationModal
                isOpen={showFormatConfirmModal}
                onClose={() => setShowFormatConfirmModal(false)}
                onConfirm={() => {
                    setShowFormatConfirmModal(false);
                    formatFilenamesMutation.mutate();
                }}
                title={t('formatLegacyFilenamesButton')}
                message={t('formatLegacyFilenamesDescription')} // Reusing description as message, or could add a specific confirm message
                confirmText={t('confirm')}
                cancelText={t('cancel')}
                isDanger={true}
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
