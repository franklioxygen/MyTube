
import {
    Alert,
    Box,
    Button,
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
import React, { useEffect, useRef, useState } from 'react';
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
import { useVisitorMode } from '../contexts/VisitorModeContext';
import { Settings } from '../types';
import ConsoleManager from '../utils/consoleManager';
import { SNACKBAR_AUTO_HIDE_DURATION } from '../utils/constants';
import { generateTimestamp } from '../utils/formatUtils';
import { Language } from '../utils/translations';

const API_URL = import.meta.env.VITE_API_URL;

const SettingsPage: React.FC = () => {
    const { t, setLanguage } = useLanguage();
    const { activeDownloads } = useDownload();
    const { visitorMode } = useVisitorMode();

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
        moveSubtitlesToVideoFolder: false,
        moveThumbnailsToVideoFolder: false
    });
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null);

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

    // Sticky Save Button Logic
    const observerTarget = useRef<HTMLDivElement>(null);
    const [isSticky, setIsSticky] = useState(true);

    useEffect(() => {
        const handleScroll = () => {
            if (!observerTarget.current) return;
            const rect = observerTarget.current.getBoundingClientRect();
            // If reference element is below the viewport, show sticky button
            // rect.top is the distance from top of viewport to top of element
            // window.innerHeight is viewport height
            // If rect.top > window.innerHeight, it's below the fold.
            // We adding a small buffer (e.g. 10px) to ensure smooth transition
            setIsSticky(rect.top > window.innerHeight);
        };

        window.addEventListener('scroll', handleScroll);
        window.addEventListener('resize', handleScroll);
        // Initial check
        handleScroll();

        return () => {
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', handleScroll);
        };
    }, []);

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
            setMessage({ text: t('settingsSaved'), type: 'success' });
        },
        onError: () => {
            setMessage({ text: t('settingsFailed'), type: 'error' });
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

    const handleSave = () => {
        if (!saveMutation.isPending) {
            saveMutation.mutate(settings);
        }
    };

    const handleTagsChange = (newTags: string[]) => {
        setSettings(prev => ({ ...prev, tags: newTags }));
    };

    // Export database mutation
    const exportDatabaseMutation = useMutation({
        mutationFn: async () => {
            const response = await axios.get(`${API_URL}/settings/export-database`, {
                responseType: 'blob'
            });
            return response;
        },
        onSuccess: (response) => {
            // Create a blob URL and trigger download
            const blob = new Blob([response.data], { type: 'application/octet-stream' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            
            // Generate filename with timestamp using helper (same format as backend)
            const timestamp = generateTimestamp();
            const filename = `mytube-backup-${timestamp}.db`;
            
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            
            setMessage({ text: t('databaseExportedSuccess'), type: 'success' });
        },
        onError: (error: any) => {
            const errorDetails = error.response?.data?.details || error.message;
            setMessage({ 
                text: `${t('databaseExportFailed')}${errorDetails ? `: ${errorDetails}` : ''}`, 
                type: 'error' 
            });
        }
    });

    // Import database mutation
    const importDatabaseMutation = useMutation({
        mutationFn: async (file: File) => {
            const formData = new FormData();
            formData.append('file', file);
            const response = await axios.post(`${API_URL}/settings/import-database`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            return response.data;
        },
        onSuccess: () => {
            setInfoModal({
                isOpen: true,
                title: t('success'),
                message: t('databaseImportedSuccess'),
                type: 'success'
            });
        },
        onError: (error: any) => {
            const errorDetails = error.response?.data?.details || error.message;
            setInfoModal({
                isOpen: true,
                title: t('error'),
                message: `${t('databaseImportFailed')}${errorDetails ? `: ${errorDetails}` : ''}`,
                type: 'error'
            });
        }
    });

    const handleExportDatabase = () => {
        exportDatabaseMutation.mutate();
    };

    const handleImportDatabase = (file: File) => {
        importDatabaseMutation.mutate(file);
    };

    // Cleanup backup databases mutation
    const cleanupBackupDatabasesMutation = useMutation({
        mutationFn: async () => {
            const response = await axios.post(`${API_URL}/settings/cleanup-backup-databases`);
            return response.data;
        },
        onSuccess: (data) => {
            setMessage({ 
                text: data.message || t('backupDatabasesCleanedUp'), 
                type: 'success' 
            });
        },
        onError: (error: any) => {
            const errorDetails = error.response?.data?.details || error.message;
            setMessage({ 
                text: `${t('backupDatabasesCleanupFailed')}${errorDetails ? `: ${errorDetails}` : ''}`, 
                type: 'error' 
            });
        }
    });

    const handleCleanupBackupDatabases = () => {
        cleanupBackupDatabasesMutation.mutate();
    };

    // Get last backup info query
    const { data: lastBackupInfo, refetch: refetchLastBackupInfo } = useQuery({
        queryKey: ['lastBackupInfo'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings/last-backup-info`);
            return response.data;
        },
        refetchInterval: 30000, // Refetch every 30 seconds
    });

    // Restore from last backup mutation
    const restoreFromLastBackupMutation = useMutation({
        mutationFn: async () => {
            const response = await axios.post(`${API_URL}/settings/restore-from-last-backup`);
            return response.data;
        },
        onSuccess: () => {
            setInfoModal({
                isOpen: true,
                title: t('success'),
                message: t('restoreFromLastBackupSuccess'),
                type: 'success'
            });
            // Refetch last backup info after restore
            refetchLastBackupInfo();
        },
        onError: (error: any) => {
            const errorDetails = error.response?.data?.details || error.message;
            setInfoModal({
                isOpen: true,
                title: t('error'),
                message: `${t('restoreFromLastBackupFailed')}${errorDetails ? `: ${errorDetails}` : ''}`,
                type: 'error'
            });
        }
    });

    const handleRestoreFromLastBackup = () => {
        restoreFromLastBackupMutation.mutate();
    };

    const isSaving = saveMutation.isPending || migrateMutation.isPending || cleanupMutation.isPending || deleteLegacyMutation.isPending || formatFilenamesMutation.isPending || exportDatabaseMutation.isPending || importDatabaseMutation.isPending || cleanupBackupDatabasesMutation.isPending || restoreFromLastBackupMutation.isPending;

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    {t('settings')}
                </Typography>
            </Box>

            {/* Settings Card */}
            <Card variant="outlined">
                <CardContent>
                    <Grid container spacing={4}>
                        {/* General Settings - Only show visitor mode toggle when visitor mode is enabled */}
                        <Grid size={12}>
                            {visitorMode ? (
                                <GeneralSettings
                                    language={settings.language}
                                    websiteName={settings.websiteName}
                                    itemsPerPage={settings.itemsPerPage}
                                    showYoutubeSearch={settings.showYoutubeSearch}
                                    visitorMode={settings.visitorMode}
                                    onChange={(field, value) => handleChange(field as keyof Settings, value)}
                                />
                            ) : (
                                <GeneralSettings
                                    language={settings.language}
                                    websiteName={settings.websiteName}
                                    itemsPerPage={settings.itemsPerPage}
                                    showYoutubeSearch={settings.showYoutubeSearch}
                                    visitorMode={settings.visitorMode}
                                    onChange={(field, value) => handleChange(field as keyof Settings, value)}
                                />
                            )}
                        </Grid>

                        {!visitorMode && (
                            <>
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
                                        tags={Array.isArray(settings.tags) ? settings.tags : []}
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
                                        onExportDatabase={handleExportDatabase}
                                        onImportDatabase={handleImportDatabase}
                                        onCleanupBackupDatabases={handleCleanupBackupDatabases}
                                        onRestoreFromLastBackup={handleRestoreFromLastBackup}
                                        isSaving={isSaving}
                                        lastBackupInfo={lastBackupInfo}
                                        moveSubtitlesToVideoFolder={settings.moveSubtitlesToVideoFolder || false}
                                        onMoveSubtitlesToVideoFolderChange={(checked) => handleChange('moveSubtitlesToVideoFolder', checked)}
                                        moveThumbnailsToVideoFolder={settings.moveThumbnailsToVideoFolder || false}
                                        onMoveThumbnailsToVideoFolderChange={(checked) => handleChange('moveThumbnailsToVideoFolder', checked)}
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
                            </>
                        )}

                    </Grid>
                </CardContent>
            </Card>

            {/* Save Button */}
            {/* Save Button Placeholder & Logic */}
            <Box ref={observerTarget} sx={{
                display: 'flex',
                justifyContent: 'flex-start',
                mt: 3,
                py: 2,
                px: 3,
                mx: -3,
                bgcolor: 'background.default', // Match appearance so transition is seamless
                borderTop: 1,
                borderColor: 'divider',
            }}>
                <Button
                    variant="contained"
                    color="primary"
                    size="large"
                    onClick={handleSave}
                    disabled={saveMutation.isPending}
                    sx={{ visibility: isSticky ? 'hidden' : 'visible' }}
                >
                    {saveMutation.isPending ? t('saving') || 'Saving...' : t('save') || 'Save'}
                </Button>
            </Box>

            {/* Sticky Overlay Button */}
            {isSticky && (
                <Box sx={{
                    position: 'fixed',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    zIndex: 100,
                    bgcolor: 'background.default',
                    borderTop: 1,
                    borderColor: 'divider',
                    boxShadow: 4
                }}>
                    <Container maxWidth="xl">
                        <Box sx={{
                            display: 'flex',
                            justifyContent: 'flex-start',
                            py: 2,
                        }}>
                            <Button
                                variant="contained"
                                color="primary"
                                size="large"
                                onClick={handleSave}
                                disabled={saveMutation.isPending}
                            >
                                {saveMutation.isPending ? t('saving') || 'Saving...' : t('save') || 'Save'}
                            </Button>
                        </Box>
                    </Container>
                </Box>
            )}

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
                confirmText={t('ok')}
                showCancel={false}
                isDanger={infoModal.type === 'error'}
            />
        </Container >
    );
};

export default SettingsPage;
