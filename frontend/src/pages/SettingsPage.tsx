
import {
    FindInPage
} from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    Container,
    Grid,
    Snackbar,
    Tab,
    Tabs,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import TextField from '@mui/material/TextField';
import { useMutation } from '@tanstack/react-query';
import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
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
import { useThemeContext } from '../contexts/ThemeContext';
import { useSettings } from '../hooks/useSettings';
import { useSettingsModals } from '../hooks/useSettingsModals';
import { useSettingsMutations } from '../hooks/useSettingsMutations';
import { useStickyButton } from '../hooks/useStickyButton';
import { Settings } from '../types';
import { api } from '../utils/apiClient';
import ConsoleManager from '../utils/consoleManager';
import { SNACKBAR_AUTO_HIDE_DURATION } from '../utils/constants';
import { Language } from '../utils/translations';

const SettingsPage: React.FC = () => {
    const { t, setLanguage } = useLanguage();
    const { activeDownloads } = useDownload();
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';
    const theme = useTheme();
    const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
    const location = useLocation();

    const [settings, setSettings] = useState<Settings>({
        loginEnabled: false,
        password: '',
        defaultAutoPlay: false,
        defaultAutoLoop: false,
        maxConcurrentDownloads: 3,
        language: 'en',
        theme: 'system',
        showThemeButton: true,
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
        saveAuthorFilesToCollection: false,
        hooks: {},
        playSoundOnTaskComplete: '',
        mountDirectories: '',
        defaultSort: 'dateDesc',
        preferredAudioLanguage: ''
    });
    const { setPreference } = useThemeContext();
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null);
    const [isGlowing, setIsGlowing] = useState(false);
    const [currentTab, setCurrentTab] = useState(0);

    const triggerGlow = () => {
        setIsGlowing(false);
        setTimeout(() => setIsGlowing(true), 10);
    };

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
    const { data: settingsData } = useSettings();

    // Handle initial tab selection from URL and scrolling
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const tabParam = params.get('tab');
        if (tabParam) {
            const tabIndex = parseInt(tabParam, 10);
            if (!isNaN(tabIndex)) {
                setCurrentTab(tabIndex);
            }
        }

        // Handle scrolling to element if hash is present
        if (location.hash) {
            const id = location.hash.replace('#', '');
            // Small delay to allow tab content to render
            setTimeout(() => {
                const element = document.getElementById(id);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Provide a visual cue
                    element.style.transition = 'background-color 0.5s ease';
                    const originalBg = element.style.backgroundColor;
                    element.style.backgroundColor = 'rgba(255, 235, 59, 0.3)'; // Light yellow highlight
                    setTimeout(() => {
                        element.style.backgroundColor = originalBg;
                    }, 2000);
                }
            }, 500);
        }
    }, [location.search, location.hash]);

    useEffect(() => {
        if (settingsData) {
            const newSettings = {
                ...settingsData,
                tags: settingsData.tags || [],
                mountDirectories: settingsData.mountDirectories || ''
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
        renameTagMutation,
        lastBackupInfo,
        isSaving
    } = mutations;

    // Scan mount directories mutation
    const scanMountDirectoriesMutation = useMutation({
        mutationFn: async ({ directories, mountDirectoriesText }: { directories: string[]; mountDirectoriesText: string }) => {
            // Send directories to the API
            const res = await api.post('/scan-mount-directories', { directories });
            // Return scan results along with mountDirectoriesText for saving
            return { addedCount: res.data.addedCount, deletedCount: res.data.deletedCount, mountDirectoriesText };
        },
        onSuccess: (data) => {
            // Save settings after successful scan to persist mountDirectories
            // Use the mountDirectoriesText passed to the mutation to ensure we save the latest value
            const settingsToSave = {
                ...settings,
                mountDirectories: data.mountDirectoriesText
            };

            if (!saveMutation.isPending) {
                saveMutation.mutate(settingsToSave, {
                    onSuccess: () => {
                        const scanMsg = t('scanMountDirectoriesSuccess', {
                            addedCount: data.addedCount,
                            deletedCount: data.deletedCount
                        }) || `Mount directories scan complete. Added ${data.addedCount} new videos. Deleted ${data.deletedCount} missing videos.`;
                        const saveMsg = t('settingsSaved') || 'Settings saved.';
                        setMessage({ text: `${scanMsg} ${saveMsg}`, type: 'success' });
                        // Update local settings state to reflect saved mountDirectories
                        setSettings(prev => ({ ...prev, mountDirectories: data.mountDirectoriesText }));
                    },
                    onError: (saveError: any) => {
                        const scanMsg = t('scanMountDirectoriesSuccess', {
                            addedCount: data.addedCount,
                            deletedCount: data.deletedCount
                        }) || `Mount directories scan complete. Added ${data.addedCount} new videos. Deleted ${data.deletedCount} missing videos.`;
                        const saveErrorMsg = saveError.response?.data?.message || t('settingsFailed') || 'Failed to save settings.';
                        setMessage({ text: `${scanMsg} Warning: ${saveErrorMsg}`, type: 'warning' });
                    }
                });
            } else {
                const scanMsg = t('scanMountDirectoriesSuccess', {
                    addedCount: data.addedCount,
                    deletedCount: data.deletedCount
                }) || `Mount directories scan complete. Added ${data.addedCount} new videos. Deleted ${data.deletedCount} missing videos.`;
                setMessage({ text: scanMsg, type: 'success' });
            }
        },
        onError: (error: any) => {
            setMessage({ text: `${t('scanFilesFailed') || 'Scan failed'}: ${error.response?.data?.error || error.response?.data?.details || error.message}`, type: 'error' });
        }
    });

    const handleChange = (field: keyof Settings, value: string | boolean | number) => {
        setSettings(prev => ({ ...prev, [field]: value }));
        if (field === 'language') {
            setLanguage(value as Language);
        }
        if (field === 'theme') {
            setPreference(value as any);
        }
        triggerGlow();
    };

    const handleSave = () => {
        if (!saveMutation.isPending) {
            saveMutation.mutate(settings);
        }
    };

    const handleTagsChange = (newTags: string[]) => {
        setSettings(prev => ({ ...prev, tags: newTags }));
        triggerGlow();
    };

    const handleRenameTag = (oldTag: string, newTag: string) => {
        if (!oldTag || !newTag || oldTag === newTag) return;
        renameTagMutation.mutate({ oldTag, newTag });
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

    const handleScanMountDirectories = () => {
        const mountDirectoriesText = settings.mountDirectories || '';
        const directories = mountDirectoriesText
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        if (directories.length === 0) {
            setMessage({ text: t('mountDirectoriesEmptyError'), type: 'error' });
            return;
        }
        scanMountDirectoriesMutation.mutate({ directories, mountDirectoriesText });
    };

    // Content renderers for each section (used by both desktop and mobile views)
    const renderBasicSettingsContent = () => (
        <BasicSettings
            language={settings.language}
            theme={settings.theme}
            showThemeButton={settings.showThemeButton}
            websiteName={settings.websiteName}
            onChange={(field, value) => handleChange(field as keyof Settings, value)}
        />
    );

    const renderInterfaceDisplayContent = () => (
        <InterfaceDisplaySettings
            itemsPerPage={settings.itemsPerPage}
            showYoutubeSearch={settings.showYoutubeSearch}
            infiniteScroll={settings.infiniteScroll}
            videoColumns={settings.videoColumns}
            playSoundOnTaskComplete={settings.playSoundOnTaskComplete}
            defaultSort={settings.defaultSort}
            showTagsOnThumbnail={settings.showTagsOnThumbnail}
            onChange={(field, value) => handleChange(field as keyof Settings, value)}
        />
    );

    const renderSecurityAccessContent = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <SecuritySettings
                settings={settings}
                onChange={handleChange}
            />
            <CookieSettings
                onSuccess={(msg) => setMessage({ text: msg, type: 'success' })}
                onError={(msg) => setMessage({ text: msg, type: 'error' })}
            />
            <CloudflareSettings
                enabled={settings.cloudflaredTunnelEnabled}
                token={settings.cloudflaredToken}
                allowedHosts={settings.allowedHosts}
                onChange={(field, value) => handleChange(field as keyof Settings, value)}
            />
        </Box>
    );

    const renderVideoPlaybackContent = () => (
        <VideoDefaultSettings
            settings={settings}
            onChange={handleChange}
        />
    );

    const renderDownloadStorageContent = () => (
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
    );

    const renderMountDirectories = () => (
        <Box sx={{ maxWidth: 400 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
                {t('mountDirectories')}
            </Typography>
            <TextField
                fullWidth
                multiline
                rows={4}
                value={settings.mountDirectories || ''}
                onChange={(e) => handleChange('mountDirectories' as keyof Settings, e.target.value)}
                placeholder={t('mountDirectoriesPlaceholder')}
                helperText={t('mountDirectoriesHelper')}
            />
            <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                <Button
                    variant="outlined"
                    startIcon={<FindInPage />}
                    onClick={handleScanMountDirectories}
                    disabled={scanMountDirectoriesMutation.isPending}
                >
                    {scanMountDirectoriesMutation.isPending ? (t('scanning') || 'Scanning...') : (t('scanFiles') || 'Scan Files')}
                </Button>
            </Box>
        </Box>
    );

    const renderTmdbApiKey = () => (
        <Box sx={{ maxWidth: 400 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
                {t('tmdbApiKey')}
            </Typography>
            <TextField
                fullWidth
                value={settings.tmdbApiKey || ''}
                onChange={(e) => handleChange('tmdbApiKey' as keyof Settings, e.target.value)}
                type="password"
                helperText={t('tmdbApiKeyHelper')}
                placeholder="Enter your TMDB API key"
            />
        </Box>
    );

    const renderContentManagementContent = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <TagsSettings
                tags={Array.isArray(settings.tags) ? settings.tags : []}
                onTagsChange={handleTagsChange}
                onRenameTag={handleRenameTag}
                onTagConflict={() => setMessage({ text: t('tagConflictCaseInsensitive'), type: 'error' })}
                isRenaming={renameTagMutation.isPending}
            />
            {renderMountDirectories()}
            {renderTmdbApiKey()}
        </Box>
    );

    const renderDataManagementContent = () => (
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
            saveAuthorFilesToCollection={settings.saveAuthorFilesToCollection || false}
            onSaveAuthorFilesToCollectionChange={(checked) => handleChange('saveAuthorFilesToCollection', checked)}
        />
    );

    const renderAdvancedContent = () => (
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
    );

    // Helper function to render settings sections for mobile view
    const renderSettingsSections = () => (
        <>
            {/* 1. Basic Settings */}
            <Grid size={12}>
                <CollapsibleSection title={t('basicSettings')} defaultExpanded={true}>
                    {renderBasicSettingsContent()}
                </CollapsibleSection>
            </Grid>

            {/* 2. Interface & Display */}
            {!isVisitor && (
                <Grid size={12}>
                    <CollapsibleSection title={t('interfaceDisplay')} defaultExpanded={false}>
                        {renderInterfaceDisplayContent()}
                    </CollapsibleSection>
                </Grid>
            )}

            {/* 3. Security & Access */}
            {!isVisitor && (
                <Grid size={12}>
                    <CollapsibleSection title={t('securityAccess')} defaultExpanded={false}>
                        {renderSecurityAccessContent()}
                    </CollapsibleSection>
                </Grid>
            )}

            {!isVisitor && (
                <>
                    {/* 4. Video Playback */}
                    <Grid size={12}>
                        <CollapsibleSection title={t('videoPlayback')} defaultExpanded={false}>
                            {renderVideoPlaybackContent()}
                        </CollapsibleSection>
                    </Grid>

                    {/* 5. Download & Storage */}
                    <Grid size={12}>
                        <CollapsibleSection title={t('downloadStorage')} defaultExpanded={false}>
                            {renderDownloadStorageContent()}
                        </CollapsibleSection>
                    </Grid>

                    {/* 6. Content Management */}
                    <Grid size={12}>
                        <CollapsibleSection title={t('contentManagement')} defaultExpanded={false}>
                            {renderContentManagementContent()}
                        </CollapsibleSection>
                    </Grid>

                    {/* 7. Data Management */}
                    <Grid size={12}>
                        <CollapsibleSection title={t('dataManagement')} defaultExpanded={false}>
                            {renderDataManagementContent()}
                        </CollapsibleSection>
                    </Grid>

                    {/* 8. Advanced */}
                    <Grid size={12}>
                        <CollapsibleSection title={t('advanced')} defaultExpanded={false}>
                            {renderAdvancedContent()}
                        </CollapsibleSection>
                    </Grid>
                </>
            )}
        </>
    );

    // Build tabs array (only non-visitor tabs after first)
    const tabs = [
        { label: t('basicSettings'), index: 0 },
        ...(!isVisitor ? [
            { label: t('interfaceDisplay'), index: 1 },
            { label: t('securityAccess'), index: 2 },
            { label: t('videoPlayback'), index: 3 },
            { label: t('downloadStorage'), index: 4 },
            { label: t('contentManagement'), index: 5 },
            { label: t('dataManagement'), index: 6 },
            { label: t('advanced'), index: 7 }
        ] : [])
    ];

    const renderDesktopTabContent = () => {
        if (currentTab === 0) return renderBasicSettingsContent();
        if (isVisitor) return null;

        switch (currentTab) {
            case 1:
                return renderInterfaceDisplayContent();
            case 2:
                return renderSecurityAccessContent();
            case 3:
                return renderVideoPlaybackContent();
            case 4:
                return renderDownloadStorageContent();
            case 5:
                return renderContentManagementContent();
            case 6:
                return renderDataManagementContent();
            case 7:
                return renderAdvancedContent();
            default:
                return null;
        }
    };

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    {t('settings')}
                </Typography>
            </Box>

            {/* Desktop: Tabs View */}
            {isDesktop ? (
                <Box sx={{ mx: -3 }}>
                    <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3, px: 3 }}>
                        <Tabs
                            value={currentTab}
                            onChange={(_, newValue) => setCurrentTab(newValue)}
                            variant="scrollable"
                            scrollButtons="auto"
                            aria-label="settings tabs"
                            sx={{ minHeight: 48 }}
                        >
                            {tabs.map((tabItem) => (
                                <Tab key={tabItem.index} label={tabItem.label} value={tabItem.index} />
                            ))}
                        </Tabs>
                    </Box>
                    <Box sx={{ py: 3, px: 3 }}>
                        {renderDesktopTabContent()}
                    </Box>
                </Box>
            ) : (
                /* Mobile: Collapsible Sections View */
                <Grid container spacing={2}>
                    {renderSettingsSections()}
                </Grid>
            )}


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
                    className={isGlowing ? 'button-glow-animation' : ''}
                    onAnimationEnd={() => setIsGlowing(false)}
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
                    <Container maxWidth="lg">
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
                                className={isGlowing ? 'button-glow-animation' : ''}
                                onAnimationEnd={() => setIsGlowing(false)}
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
