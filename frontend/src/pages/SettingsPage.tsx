
import {
    Alert,
    Box,
    Button,
    Container,
    Snackbar,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import ConfirmationModal from '../components/ConfirmationModal';
import DeploymentSecurityDetailsModal from '../components/Settings/DeploymentSecurityDetailsModal';
import { useAuth } from '../contexts/AuthContext';
import { useDownload } from '../contexts/DownloadContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { useSettings } from '../hooks/useSettings';
import { useSettingsModals } from '../hooks/useSettingsModals';
import { useSettingsMutations } from '../hooks/useSettingsMutations';
import { useStickyButton } from '../hooks/useStickyButton';
import { AdminTrustLevel, Settings } from '../types';
import { api, getApiErrorMessage } from '../utils/apiClient';
import ConsoleManager from '../utils/consoleManager';
import { SNACKBAR_AUTO_HIDE_DURATION } from '../utils/constants';
import { getTwitchCredentialValidationCode } from '../utils/twitch';
import { createTranslateOrFallback } from '../utils/translateOrFallback';
import { Language } from '../utils/translations';
import { SettingsSections } from './settings/SettingsSections';

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
        apiKeyEnabled: false,
        apiKey: '',
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
        preferredAudioLanguage: '',
        twitchClientId: '',
        twitchClientSecret: '',
    });
    const { setPreference } = useThemeContext();
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null);
    const [tmdbCredentialTesting, setTmdbCredentialTesting] = useState(false);
    const [tmdbCredentialTestResult, setTmdbCredentialTestResult] = useState<{
        type: 'success' | 'error';
        message: string;
    } | null>(null);
    const [isGlowing, setIsGlowing] = useState(false);
    const [currentTab, setCurrentTab] = useState(0);
    const [showTrustDetailsModal, setShowTrustDetailsModal] = useState(false);
    const twitchCredentialValidationCode = getTwitchCredentialValidationCode(
        settings.twitchClientId,
        settings.twitchClientSecret,
    );
    const hasTwitchCredentialValidationError = twitchCredentialValidationCode !== null;
    const translateOrFallback = createTranslateOrFallback(t);
    const getTMDBCredentialMessage = (
        messageKey?: string,
        fallback?: string
    ): string => {
        switch (messageKey) {
            case 'tmdbCredentialMissing':
                return translateOrFallback('tmdbCredentialMissing', 'Please enter a TMDB credential first.');
            case 'tmdbCredentialValid':
                return translateOrFallback('tmdbCredentialValid', 'TMDB credential is valid.');
            case 'tmdbCredentialValidApiKey':
                return translateOrFallback('tmdbCredentialValidApiKey', 'TMDB API key is valid.');
            case 'tmdbCredentialValidReadAccessToken':
                return translateOrFallback(
                    'tmdbCredentialValidReadAccessToken',
                    'TMDB Read Access Token is valid.'
                );
            case 'tmdbCredentialInvalid':
                return translateOrFallback(
                    'tmdbCredentialInvalid',
                    'TMDB credential is invalid. Check whether it is a valid API key or Read Access Token.'
                );
            case 'tmdbCredentialRequestFailed':
                return translateOrFallback(
                    'tmdbCredentialRequestFailed',
                    'Failed to reach TMDB. Please try again.'
                );
            case 'tmdbCredentialTestFailed':
                return translateOrFallback(
                    'tmdbCredentialTestFailed',
                    'Failed to test TMDB credential.'
                );
            default:
                return fallback || translateOrFallback(
                    'tmdbCredentialTestFailed',
                    'Failed to test TMDB credential.'
                );
        }
    };
    const deploymentSecurityDetailsTitle = translateOrFallback(
        'deploymentSecurityDetailsTitle',
        'Deployment Security Details',
    );

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
    const deploymentSecurity = settings.deploymentSecurity ?? settingsData?.deploymentSecurity;
    const adminTrustLevel: AdminTrustLevel | undefined = deploymentSecurity?.adminTrustLevel;
    const canUseContainerAdminFeatures = adminTrustLevel === 'container' || adminTrustLevel === 'host';
    const canUseHostAdminFeatures = adminTrustLevel === 'host';

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
        previewMergeDatabaseMutation,
        mergeDatabaseMutation,
        cleanupBackupDatabasesMutation,
        restoreFromLastBackupMutation,
        renameTagMutation,
        lastBackupInfo,
        isSaving
    } = mutations;

    // Scan mount directories mutation
    const scanMountDirectoriesMutation = useMutation({
        mutationFn: async ({ directories, mountDirectoriesText }: { directories: string[]; mountDirectoriesText: string }) => {
            // Mount scans can take much longer than the global API default timeout.
            const res = await api.post('/scan-mount-directories', { directories }, { timeout: 0 });
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
                    onError: async (saveError: any) => {
                        const scanMsg = t('scanMountDirectoriesSuccess', {
                            addedCount: data.addedCount,
                            deletedCount: data.deletedCount
                        }) || `Mount directories scan complete. Added ${data.addedCount} new videos. Deleted ${data.deletedCount} missing videos.`;
                        const saveErrorMsg = await getApiErrorMessage(saveError, t) || t('settingsFailed') || 'Failed to save settings.';
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
        onError: async (error: any) => {
            const detail = await getApiErrorMessage(error, t);
            setMessage({ text: `${t('scanFilesFailed') || 'Scan failed'}: ${detail}`, type: 'error' });
        }
    });

    const handleChange = (field: keyof Settings, value: string | boolean | number) => {
        setSettings(prev => ({ ...prev, [field]: value }));
        if (field === 'tmdbApiKey') {
            setTmdbCredentialTestResult(null);
        }
        if (field === 'language') {
            setLanguage(value as Language);
        }
        if (field === 'theme') {
            setPreference(value as any);
        }
        triggerGlow();
    };

    const handleTestTMDBCredential = async () => {
        const tmdbApiKey = settings.tmdbApiKey?.trim() || '';

        if (!tmdbApiKey) {
            setTmdbCredentialTestResult({
                type: 'error',
                message: getTMDBCredentialMessage('tmdbCredentialMissing'),
            });
            return;
        }

        setTmdbCredentialTesting(true);
        setTmdbCredentialTestResult(null);

        try {
            const res = await api.post('/settings/tmdb/test', { tmdbApiKey });
            setTmdbCredentialTestResult({
                type: 'success',
                message: getTMDBCredentialMessage(
                    res.data?.messageKey,
                    res.data?.message ||
                        translateOrFallback('tmdbCredentialValid', 'TMDB credential is valid.')
                ),
            });
        } catch (error: any) {
            setTmdbCredentialTestResult({
                type: 'error',
                message: getTMDBCredentialMessage(
                    error.response?.data?.errorKey,
                    translateOrFallback('tmdbCredentialTestFailed', 'Failed to test TMDB credential.')
                ),
            });
        } finally {
            setTmdbCredentialTesting(false);
        }
    };

    const handleSave = () => {
        if (!saveMutation.isPending && !hasTwitchCredentialValidationError) {
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

    const handleMergeDatabase = (file: File) => {
        mergeDatabaseMutation.mutate(file);
    };

    const handlePreviewMergeDatabase = async (file: File) => {
        return await previewMergeDatabaseMutation.mutateAsync(file);
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

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    {t('settings')}
                </Typography>
            </Box>

            <SettingsSections
                activeDownloadsCount={activeDownloads.length}
                adminTrustLevel={adminTrustLevel}
                canUseContainerAdminFeatures={canUseContainerAdminFeatures}
                canUseHostAdminFeatures={canUseHostAdminFeatures}
                currentTab={currentTab}
                debugMode={debugMode}
                deploymentSecurity={deploymentSecurity}
                deploymentSecurityDetailsTitle={deploymentSecurityDetailsTitle}
                isDesktop={isDesktop}
                isSaving={isSaving}
                isVisitor={isVisitor}
                lastBackupInfo={lastBackupInfo}
                onCleanupBackupDatabases={handleCleanupBackupDatabases}
                onCleanupTempFiles={() => setShowCleanupTempFilesModal(true)}
                onDeleteLegacy={() => setShowDeleteLegacyModal(true)}
                onExportDatabase={handleExportDatabase}
                onFormatFilenames={() => setShowFormatConfirmModal(true)}
                onImportDatabase={handleImportDatabase}
                onMergeDatabase={handleMergeDatabase}
                onMigrate={() => setShowMigrateConfirmModal(true)}
                onPreviewMergeDatabase={handlePreviewMergeDatabase}
                onRestoreFromLastBackup={handleRestoreFromLastBackup}
                onScanMountDirectories={handleScanMountDirectories}
                onSettingsChange={handleChange}
                onShowTrustDetails={() => setShowTrustDetailsModal(true)}
                onTagConflict={() => setMessage({ text: t('tagConflictCaseInsensitive'), type: 'error' })}
                onTagsChange={handleTagsChange}
                onRenameTag={handleRenameTag}
                renameTagPending={renameTagMutation.isPending}
                scanMountDirectoriesPending={scanMountDirectoriesMutation.isPending}
                setCurrentTab={setCurrentTab}
                setDebugMode={setDebugMode}
                setMessage={setMessage}
                setTmdbCredentialTestResult={setTmdbCredentialTestResult}
                settings={settings}
                t={t}
                testTmdbCredential={handleTestTMDBCredential}
                tmdbCredentialTesting={tmdbCredentialTesting}
                tmdbCredentialTestResult={tmdbCredentialTestResult}
                translateOrFallback={translateOrFallback}
            />


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
                    disabled={saveMutation.isPending || hasTwitchCredentialValidationError}
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
                                disabled={saveMutation.isPending || hasTwitchCredentialValidationError}
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
            <DeploymentSecurityDetailsModal
                open={showTrustDetailsModal}
                onClose={() => setShowTrustDetailsModal(false)}
            />
        </Container >
    );
};

export default SettingsPage;
