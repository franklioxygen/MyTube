
import {
    FindInPage
} from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    Container,
    CircularProgress,
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
import DeploymentSecurityDetailsModal from '../components/Settings/DeploymentSecurityDetailsModal';
import DownloadSettings from '../components/Settings/DownloadSettings';
import HookSettings from '../components/Settings/HookSettings';
import InterfaceDisplaySettings from '../components/Settings/InterfaceDisplaySettings';
import RssFeedSettings from '../components/Settings/RssFeedSettings';
import SecuritySettings from '../components/Settings/SecuritySettings';
import StatisticsSettings from '../components/Settings/StatisticsSettings';
import TagsSettings from '../components/Settings/TagsSettings';
import TwitchSettings from '../components/Settings/TwitchSettings';
import VideoDefaultSettings from '../components/Settings/VideoDefaultSettings';
import LiveTranslationSettings from '../components/Settings/LiveTranslationSettings';
import YtDlpSettings from '../components/Settings/YtDlpSettings';
import { useAuth } from '../contexts/AuthContext';
import { useDownload } from '../contexts/DownloadContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useThemeContext } from '../contexts/ThemeContext';
import { useSettings } from '../hooks/useSettings';
import { useSettingsModals } from '../hooks/useSettingsModals';
import { useSettingsMutations } from '../hooks/useSettingsMutations';
import { useStickyButton } from '../hooks/useStickyButton';
import { AdminTrustLevel, Settings } from '../types';
import { overlay } from '../theme/colors';
import { api, getApiErrorMessage } from '../utils/apiClient';
import { resolveAuthorOrganizationMode } from '../utils/authorOrganizationMode';
import ConsoleManager from '../utils/consoleManager';
import { SNACKBAR_AUTO_HIDE_DURATION } from '../utils/constants';
import { getTwitchCredentialValidationCode } from '../utils/twitch';
import { createTranslateOrFallback } from '../utils/translateOrFallback';
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
        apiKeyEnabled: false,
        apiKey: '',
        defaultAutoPlay: false,
        defaultAutoLoop: false,
        maxConcurrentDownloads: 3,
        autoRetryEnabled: false,
        autoRetryTimes: 3,
        autoRetryIntervalMinutes: 5,
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
        authorOrganizationMode: 'root',
        saveAuthorFilesToCollection: false,
        hooks: {},
        playSoundOnTaskComplete: '',
        mountDirectories: '',
        defaultSort: 'dateDesc',
        preferredAudioLanguage: '',
        twitchClientId: '',
        twitchClientSecret: '',
        telegramDownloadEnabled: false,
        mediaServerExportMode: 'off',
    });
    const { setPreference } = useThemeContext();
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null);
    const [tmdbCredentialTesting, setTmdbCredentialTesting] = useState(false);
    const [tmdbCredentialTestResult, setTmdbCredentialTestResult] = useState<{
        type: 'success' | 'error';
        message: string;
    } | null>(null);
    const [isGlowing, setIsGlowing] = useState(false);
    // Live translation Gemini API key is never fetched into `settings` (hidden in
    // responses). It only lives in this transient draft while the page is open.
    const [liveTranslationApiKeyDraft, setLiveTranslationApiKeyDraft] = useState('');
    const [clearLiveTranslationApiKeyRequested, setClearLiveTranslationApiKeyRequested] =
        useState(false);
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
    const renderDeploymentSecurityDetailsButton = (ariaLabel: string) => (
        <Button
            variant="text"
            size="small"
            onClick={() => setShowTrustDetailsModal(true)}
            aria-label={ariaLabel}
            sx={{ minWidth: 0, p: 0, ml: 0.5, verticalAlign: 'baseline', textTransform: 'none' }}
        >
            {translateOrFallback('deploymentSecurityDetails', 'Details')}
        </Button>
    );

    const triggerGlow = () => {
        setIsGlowing(false);
        setTimeout(() => setIsGlowing(true), 10);
    };

    // Modal states
    const modals = useSettingsModals();
    const {
        showCleanupAuthorCollectionsModal,
        setShowCleanupAuthorCollectionsModal,
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
                    element.style.backgroundColor = overlay.highlightYellow;
                    setTimeout(() => {
                        element.style.backgroundColor = originalBg;
                    }, 2000);
                }
            }, 500);
        }
    }, [location.search, location.hash]);

    const hasHydratedSettings = useRef(false);
    useEffect(() => {
        if (!settingsData) return;
        if (!hasHydratedSettings.current) {
            // Initial load: populate the whole form from server truth.
            const newSettings = {
                ...settingsData,
                tags: settingsData.tags || [],
                mountDirectories: settingsData.mountDirectories || '',
                autoRetryEnabled: settingsData.autoRetryEnabled ?? false,
                autoRetryTimes: settingsData.autoRetryTimes ?? 3,
                autoRetryIntervalMinutes: settingsData.autoRetryIntervalMinutes ?? 5,
                authorOrganizationMode: resolveAuthorOrganizationMode(settingsData),
            };
            setSettings(newSettings);
            hasHydratedSettings.current = true;
            return;
        }
        // After hydration the form is user-owned. The only field that legitimately
        // changes externally (player-added tags, Tags Management, tag rename) is
        // `tags`, so sync just that and leave the user's unsaved edits to other
        // fields intact.
        setSettings(prev => ({ ...prev, tags: settingsData.tags || [] }));
    }, [settingsData]);

    // Settings mutations
    const mutations = useSettingsMutations({ setMessage, setInfoModal });
    const {
        saveMutation,
        migrateMutation,
        cleanupMutation,
        cleanupAuthorCollectionsMutation,
        deleteLegacyMutation,
        formatFilenamesMutation,
        exportDatabaseMutation,
        importDatabaseMutation,
        previewMergeDatabaseMutation,
        mergeDatabaseMutation,
        cleanupBackupDatabasesMutation,
        restoreFromLastBackupMutation,
        renameTagMutation,
        updateTagsMutation,
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
        if (saveMutation.isPending || hasTwitchCredentialValidationError) {
            return;
        }

        // Construct a secret-safe payload for the Gemini live translation key:
        // - omit it when the draft is empty and no clear was requested
        //   (so unrelated saves never wipe an existing stored key)
        // - include the trimmed draft only when replacing the key
        // - include "" only for an explicit clear-key action
        const settingsToSave: Settings = { ...settings };
        delete settingsToSave.liveTranslationApiKey;
        const apiKeyDraft = liveTranslationApiKeyDraft.trim();
        if (clearLiveTranslationApiKeyRequested) {
            settingsToSave.liveTranslationApiKey = '';
        } else if (apiKeyDraft.length > 0) {
            settingsToSave.liveTranslationApiKey = apiKeyDraft;
        }

        saveMutation.mutate(settingsToSave, {
            onSuccess: () => {
                // Drop the transient draft/clear state and rely on the refetched
                // liveTranslationApiKeyConfigured flag.
                setLiveTranslationApiKeyDraft('');
                setClearLiveTranslationApiKeyRequested(false);
            },
        });
    };

    const handleTagsChange = (newTags: string[]) => {
        // Reflect the change locally for snappy UI, then persist immediately so
        // tags added/removed in Tags Management survive a reload without needing
        // the global Save button.
        setSettings(prev => ({ ...prev, tags: newTags }));
        updateTagsMutation.mutate(newTags);
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

    // Content renderers for each section (used by both desktop and mobile views)
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

    const renderBasicSettingsContent = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <BasicSettings
                language={settings.language}
                theme={settings.theme}
                showThemeButton={settings.showThemeButton}
                websiteName={settings.websiteName}
                onChange={(field, value) => handleChange(field as keyof Settings, value)}
            />
            {!isVisitor && renderInterfaceDisplayContent()}
            {!isVisitor && renderVideoPlaybackContent()}
        </Box>
    );

    const renderDeploymentSecuritySummary = () => {
        const renderDetailsLink = () => renderDeploymentSecurityDetailsButton(deploymentSecurityDetailsTitle);

        if (!deploymentSecurity || !adminTrustLevel) {
            return (
                <Alert severity="info">
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                        {translateOrFallback('deploymentSecurityTitle', 'Deployment Security Model')}
                    </Typography>
                    <Typography variant="body2">
                        {translateOrFallback(
                            'deploymentSecurityLoading',
                            'Deployment security policy is loading. Restricted features remain hidden until the policy is available.'
                        )}
                        {renderDetailsLink()}
                    </Typography>
                </Alert>
            );
        }

        const levelLabels: Record<AdminTrustLevel, string> = {
            application: translateOrFallback('adminTrustLevelApplication', 'Application'),
            container: translateOrFallback('adminTrustLevelContainer', 'Container'),
            host: translateOrFallback('adminTrustLevelHost', 'Host'),
        };
        const levelDescriptions: Record<AdminTrustLevel, string> = {
            application: translateOrFallback(
                'adminTrustLevelApplicationDescription',
                'Admin is trusted at the application layer only.'
            ),
            container: translateOrFallback(
                'adminTrustLevelContainerDescription',
                'Admin is trusted with backend/container-process-level actions.'
            ),
            host: translateOrFallback(
                'adminTrustLevelHostDescription',
                'Admin is trusted with host-scoped administrative actions.'
            ),
        };

        return (
            <Alert severity={adminTrustLevel === 'application' ? 'success' : 'info'}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    {translateOrFallback('deploymentSecurityTitle', 'Deployment Security Model')}
                </Typography>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {translateOrFallback('adminTrustLevelLabel', 'Admin Trust Level')}: {levelLabels[adminTrustLevel]}
                </Typography>
                <Typography variant="body2">
                    {levelDescriptions[adminTrustLevel]}
                    {renderDetailsLink()}
                </Typography>
            </Alert>
        );
    };

    const renderSecurityAccessContent = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {renderDeploymentSecuritySummary()}
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
            <RssFeedSettings />
        </Box>
    );

    const renderVideoPlaybackContent = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <VideoDefaultSettings
                settings={settings}
                onChange={handleChange}
            />
            <LiveTranslationSettings
                settings={settings}
                apiKeyConfigured={settings.liveTranslationApiKeyConfigured === true}
                apiKeyDraft={liveTranslationApiKeyDraft}
                clearApiKeyRequested={clearLiveTranslationApiKeyRequested}
                onChange={(field, value) => handleChange(field as keyof Settings, value)}
                onApiKeyDraftChange={(value) => {
                    setLiveTranslationApiKeyDraft(value);
                    if (clearLiveTranslationApiKeyRequested && value.length > 0) {
                        setClearLiveTranslationApiKeyRequested(false);
                    }
                    triggerGlow();
                }}
                onClearApiKey={() => {
                    setClearLiveTranslationApiKeyRequested(true);
                    setLiveTranslationApiKeyDraft('');
                    setSettings(prev => ({ ...prev, liveTranslationEnabled: false }));
                    triggerGlow();
                }}
            />
        </Box>
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
                {canUseContainerAdminFeatures ? (
                    <YtDlpSettings
                        config={settings.ytDlpConfig || ''}
                        proxyOnlyYoutube={settings.proxyOnlyYoutube || false}
                        onChange={(config) => handleChange('ytDlpConfig', config)}
                        onProxyOnlyYoutubeChange={(checked) => handleChange('proxyOnlyYoutube', checked)}
                    />
                ) : (
                    <Alert severity="info">
                        {translateOrFallback(
                            'ytDlpConfigurationPolicyNotice',
                            'Raw yt-dlp configuration is disabled by deployment security policy in application trust mode.'
                        )}
                        {renderDeploymentSecurityDetailsButton(
                            `${deploymentSecurityDetailsTitle}: ${translateOrFallback('ytDlpConfiguration', 'yt-dlp Configuration')}`
                        )}
                    </Alert>
                )}
            </Box>
            <Box>
                <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
                    {t('twitchSubscriptions') || 'Twitch Subscriptions'}
                </Typography>
                <TwitchSettings
                    twitchClientId={settings.twitchClientId}
                    twitchClientSecret={settings.twitchClientSecret}
                    onChange={(field, value) => handleChange(field as keyof Settings, value)}
                />
            </Box>
        </Box>
    );

    const renderMountDirectories = () => (
        <Box sx={{ maxWidth: 400 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
                {t('mountDirectories')}
            </Typography>
            {canUseHostAdminFeatures ? (
                <>
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
                </>
            ) : (
                <Alert severity="info">
                    {translateOrFallback(
                        'mountDirectoriesPolicyNotice',
                        'Mount directories require host-level admin trust.'
                    )}
                    {renderDeploymentSecurityDetailsButton(
                        `${deploymentSecurityDetailsTitle}: ${translateOrFallback('mountDirectories', 'Mount Directories')}`
                    )}
                </Alert>
            )}
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
            <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                <Button
                    variant="outlined"
                    startIcon={tmdbCredentialTesting ? <CircularProgress size={16} /> : <FindInPage />}
                    onClick={handleTestTMDBCredential}
                    disabled={!settings.tmdbApiKey?.trim() || tmdbCredentialTesting}
                >
                    {tmdbCredentialTesting
                        ? translateOrFallback('testing', 'Testing...')
                        : translateOrFallback('testTmdbCredential', 'Test Credential')}
                </Button>
            </Box>
            {tmdbCredentialTestResult && (
                <Alert
                    severity={tmdbCredentialTestResult.type === 'success' ? 'success' : 'error'}
                    onClose={() => setTmdbCredentialTestResult(null)}
                    sx={{ mt: 2 }}
                >
                    {tmdbCredentialTestResult.message}
                </Alert>
            )}
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
            onCleanupAuthorCollections={() => setShowCleanupAuthorCollectionsModal(true)}
            onExportDatabase={handleExportDatabase}
            onImportDatabase={handleImportDatabase}
            onPreviewMergeDatabase={handlePreviewMergeDatabase}
            onMergeDatabase={handleMergeDatabase}
            onCleanupBackupDatabases={handleCleanupBackupDatabases}
            onRestoreFromLastBackup={handleRestoreFromLastBackup}
            isSaving={isSaving}
            lastBackupInfo={lastBackupInfo}
            moveSubtitlesToVideoFolder={settings.moveSubtitlesToVideoFolder || false}
            onMoveSubtitlesToVideoFolderChange={(checked) => handleChange('moveSubtitlesToVideoFolder', checked)}
            moveThumbnailsToVideoFolder={settings.moveThumbnailsToVideoFolder || false}
            onMoveThumbnailsToVideoFolderChange={(checked) => handleChange('moveThumbnailsToVideoFolder', checked)}
            authorOrganizationMode={settings.authorOrganizationMode || 'root'}
            onAuthorOrganizationModeChange={(mode) => handleChange('authorOrganizationMode', mode)}
            downloadFilenameMode={settings.downloadFilenameMode}
        />
    );

    const renderAdvancedContent = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <AdvancedSettings
                debugMode={debugMode}
                onDebugModeChange={setDebugMode}
                telegramEnabled={settings.telegramEnabled}
                telegramBotToken={settings.telegramBotToken}
                telegramChatId={settings.telegramChatId}
                telegramDownloadEnabled={settings.telegramDownloadEnabled}
                telegramNotifyOnSuccess={settings.telegramNotifyOnSuccess}
                telegramNotifyOnFail={settings.telegramNotifyOnFail}
                onChange={handleChange}
            />
            <StatisticsSettings settings={settings} onChange={handleChange} />
            {canUseContainerAdminFeatures ? (
                <HookSettings
                    settings={settings}
                    onChange={handleChange}
                />
            ) : (
                <Alert severity="info">
                    {translateOrFallback(
                        'taskHooksPolicyNotice',
                        'Task hooks are disabled by deployment security policy in application trust mode.'
                    )}
                    {renderDeploymentSecurityDetailsButton(
                        `${deploymentSecurityDetailsTitle}: ${translateOrFallback('taskHooks', 'Task Hooks')}`
                    )}
                </Alert>
            )}
        </Box>
    );

    // Helper function to render settings sections for mobile view
    const renderSettingsSections = () => (
        <>
            {/* 1. Basic Settings (includes Interface & Display, Video Playback) */}
            <Grid size={12}>
                <CollapsibleSection title={t('basicSettings')} defaultExpanded={true}>
                    {renderBasicSettingsContent()}
                </CollapsibleSection>
            </Grid>

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
            { label: t('securityAccess'), index: 1 },
            { label: t('downloadStorage'), index: 2 },
            { label: t('contentManagement'), index: 3 },
            { label: t('dataManagement'), index: 4 },
            { label: t('advanced'), index: 5 }
        ] : [])
    ];

    const renderDesktopTabContent = () => {
        if (currentTab === 0) return renderBasicSettingsContent();
        if (isVisitor) return null;

        switch (currentTab) {
            case 1:
                return renderSecurityAccessContent();
            case 2:
                return renderDownloadStorageContent();
            case 3:
                return renderContentManagementContent();
            case 4:
                return renderDataManagementContent();
            case 5:
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
                            sx={{
                                minHeight: 48,
                                '& .MuiTab-root': {
                                    minWidth: 'auto',
                                    px: 1.5,
                                    fontSize: '0.8125rem',
                                    textTransform: 'none',
                                },
                            }}
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
                isOpen={showCleanupAuthorCollectionsModal}
                onClose={() => setShowCleanupAuthorCollectionsModal(false)}
                onConfirm={() => {
                    setShowCleanupAuthorCollectionsModal(false);
                    cleanupAuthorCollectionsMutation.mutate();
                }}
                title={t('cleanupAuthorCollectionsConfirmTitle')}
                message={t('cleanupAuthorCollectionsConfirmMessage')}
                confirmText={t('confirm')}
                cancelText={t('cancel')}
            />
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
