
import {
    Alert,
    Box,
    Button,
    Container,
    Grid,
    Snackbar,
    Typography
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import React, { useEffect, useRef, useState } from 'react';
import CollapsibleSection from '../components/CollapsibleSection';
import ConfirmationModal from '../components/ConfirmationModal';
import AdvancedSettings from '../components/Settings/AdvancedSettings';
import BasicSettings from '../components/Settings/BasicSettings';
import CloudDriveSettings from '../components/Settings/CloudDriveSettings';
import CloudflareSettings from '../components/Settings/CloudflareSettings';
import CookieSettings from '../components/Settings/CookieSettings';
import DatabaseSettings from '../components/Settings/DatabaseSettings';
import DownloadSettings from '../components/Settings/DownloadSettings';
import HookSettings from '../components/Settings/HookSettings';
import InterfaceDisplaySettings from '../components/Settings/InterfaceDisplaySettings';
import SecuritySettings from '../components/Settings/SecuritySettings';
import TagsSettings from '../components/Settings/TagsSettings';
import VideoDefaultSettings from '../components/Settings/VideoDefaultSettings';
import YtDlpSettings from '../components/Settings/YtDlpSettings';
import { useAuth } from '../contexts/AuthContext';
import { useDownload } from '../contexts/DownloadContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSettingsModals } from '../hooks/useSettingsModals';
import { useSettingsMutations } from '../hooks/useSettingsMutations';
import { useStickyButton } from '../hooks/useStickyButton';
import { Settings } from '../types';
import ConsoleManager from '../utils/consoleManager';
import { SNACKBAR_AUTO_HIDE_DURATION } from '../utils/constants';
import { Language } from '../utils/translations';

const API_URL = import.meta.env.VITE_API_URL;

const SettingsPage: React.FC = () => {
    const { t, setLanguage } = useLanguage();
    const { activeDownloads } = useDownload();
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';

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
        openListPublicUrl: '',
        cloudDrivePath: '',
        itemsPerPage: 12,
        ytDlpConfig: '',
        showYoutubeSearch: true,
        proxyOnlyYoutube: false,
        moveSubtitlesToVideoFolder: false,
        moveThumbnailsToVideoFolder: false,
        hooks: {}
    });
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null);

    // Modal states
    const modals = useSettingsModals();
    const {
        showDeleteLegacyModal,
        setShowDeleteLegacyModal,
        showFormatConfirmModal,
        setShowFormatConfirmModal,
        showMigrateConfirmModal,
        setShowMigrateConfirmModal,
        showCleanupTempFilesModal,
        setShowCleanupTempFilesModal,
        infoModal,
        setInfoModal
    } = modals;

    const [debugMode, setDebugMode] = useState(ConsoleManager.getDebugMode());

    // Sticky Save Button Logic
    const observerTarget = useRef<HTMLDivElement | null>(null);
    const isSticky = useStickyButton(observerTarget);

    // Fetch settings
    const { data: settingsData, refetch } = useQuery({
        queryKey: ['settings'],
        queryFn: async () => {
            const response = await axios.get(`${API_URL}/settings`);
            return response.data;
        }
    });

    useEffect(() => {
        refetch();
    }, [refetch]);

    useEffect(() => {
        if (settingsData) {
            const newSettings = {
                ...settingsData,
                tags: settingsData.tags || []
            };
            setSettings(newSettings);
        }
    }, [settingsData]);

    // Settings mutations
    const mutations = useSettingsMutations({ setMessage, setInfoModal });
    const {
        saveMutation,
        migrateMutation,
        cleanupMutation,
        deleteLegacyMutation,
        formatFilenamesMutation,
        exportDatabaseMutation,
        importDatabaseMutation,
        cleanupBackupDatabasesMutation,
        restoreFromLastBackupMutation,
        lastBackupInfo,
        isSaving
    } = mutations;

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

    const handleExportDatabase = () => {
        exportDatabaseMutation.mutate();
    };

    const handleImportDatabase = (file: File) => {
        importDatabaseMutation.mutate(file);
    };

    const handleCleanupBackupDatabases = () => {
        cleanupBackupDatabasesMutation.mutate();
    };

    const handleRestoreFromLastBackup = () => {
        restoreFromLastBackupMutation.mutate();
    };

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    {t('settings')}
                </Typography>
            </Box>

            {/* Settings Card */}

            <Grid container spacing={2}>
                {/* 1. Basic Settings */}
                <Grid size={12}>
                    <CollapsibleSection title={t('basicSettings')} defaultExpanded={true}>
                        <BasicSettings
                            language={settings.language}
                            websiteName={settings.websiteName}
                            onChange={(field, value) => handleChange(field as keyof Settings, value)}
                        />
                    </CollapsibleSection>
                </Grid>

                {/* 2. Interface & Display */}
                {!isVisitor && (
                    <Grid size={12}>
                        <CollapsibleSection title={t('interfaceDisplay')} defaultExpanded={false}>
                            <InterfaceDisplaySettings
                                itemsPerPage={settings.itemsPerPage}
                                showYoutubeSearch={settings.showYoutubeSearch}
                                infiniteScroll={settings.infiniteScroll}
                                videoColumns={settings.videoColumns}
                                onChange={(field, value) => handleChange(field as keyof Settings, value)}
                            />
                        </CollapsibleSection>
                    </Grid>
                )}

                {/* 3. Security & Access */}
                {!isVisitor && (
                    <Grid size={12}>
                        <CollapsibleSection title={t('securityAccess')} defaultExpanded={false}>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <Box>
                                    <SecuritySettings
                                        settings={settings}
                                        onChange={handleChange}
                                    />
                                </Box>
                                <Box>
                                    <CookieSettings
                                        onSuccess={(msg) => setMessage({ text: msg, type: 'success' })}
                                        onError={(msg) => setMessage({ text: msg, type: 'error' })}
                                    />
                                </Box>
                                <Box>
                                    <CloudflareSettings
                                        enabled={settings.cloudflaredTunnelEnabled}
                                        token={settings.cloudflaredToken}
                                        onChange={(field, value) => handleChange(field as keyof Settings, value)}
                                    />
                                </Box>
                            </Box>
                        </CollapsibleSection>
                    </Grid>
                )}

                {!isVisitor && (
                    <>
                        {/* 4. Video Playback */}
                        <Grid size={12}>
                            <CollapsibleSection title={t('videoPlayback')} defaultExpanded={false}>
                                <VideoDefaultSettings
                                    settings={settings}
                                    onChange={handleChange}
                                />
                            </CollapsibleSection>
                        </Grid>

                        {/* 5. Download & Storage */}
                        <Grid size={12}>
                            <CollapsibleSection title={t('downloadStorage')} defaultExpanded={false}>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <Box>
                                        <Typography variant="h6" gutterBottom>{t('downloadSettings')}</Typography>
                                        <DownloadSettings
                                            settings={settings}
                                            onChange={handleChange}
                                            activeDownloadsCount={activeDownloads.length}
                                            onCleanup={() => setShowCleanupTempFilesModal(true)}
                                            isSaving={isSaving}
                                        />
                                    </Box>
                                    <Box>
                                        <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>{t('cloudDriveSettings')}</Typography>
                                        <CloudDriveSettings
                                            settings={settings}
                                            onChange={handleChange}
                                        />
                                    </Box>
                                    <Box>
                                        <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>{t('ytDlpConfiguration') || 'yt-dlp Configuration'}</Typography>
                                        <YtDlpSettings
                                            config={settings.ytDlpConfig || ''}
                                            proxyOnlyYoutube={settings.proxyOnlyYoutube || false}
                                            onChange={(config) => handleChange('ytDlpConfig', config)}
                                            onProxyOnlyYoutubeChange={(checked) => handleChange('proxyOnlyYoutube', checked)}
                                        />
                                    </Box>
                                </Box>
                            </CollapsibleSection>
                        </Grid>

                        {/* 6. Content Management */}
                        <Grid size={12}>
                            <CollapsibleSection title={t('contentManagement')} defaultExpanded={false}>
                                <TagsSettings
                                    tags={Array.isArray(settings.tags) ? settings.tags : []}
                                    onTagsChange={handleTagsChange}
                                />
                            </CollapsibleSection>
                        </Grid>

                        {/* 7. Data Management */}
                        <Grid size={12}>
                            <CollapsibleSection title={t('dataManagement')} defaultExpanded={false}>
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
                            </CollapsibleSection>
                        </Grid>

                        {/* 8. Advanced */}
                        <Grid size={12}>
                            <CollapsibleSection title={t('advanced')} defaultExpanded={false}>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <AdvancedSettings
                                        debugMode={debugMode}
                                        onDebugModeChange={setDebugMode}
                                    />
                                    <HookSettings
                                        settings={settings}
                                        onChange={handleChange}
                                    />
                                </Box>
                            </CollapsibleSection>
                        </Grid>
                    </>
                )}
            </Grid>


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
