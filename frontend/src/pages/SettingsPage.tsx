
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
import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import CollapsibleSection from '../components/CollapsibleSection';
import ConfirmationModal from '../components/ConfirmationModal';
import AdvancedSettings from '../components/Settings/AdvancedSettings';
import BasicSettings from '../components/Settings/BasicSettings';
import CloudDriveSettings from '../components/Settings/CloudDriveSettings';
import CloudflareSettings from '../components/Settings/CloudflareSettings';
import CookieSettings from '../components/Settings/CookieSettings';
import DatabaseSettings from '../components/Settings/DatabaseSettings';
import DeploymentSecurityDetailsModal from '../components/Settings/DeploymentSecurityDetailsModal';
import DeploymentSecuritySummary from '../components/Settings/DeploymentSecuritySummary';
import DownloadSettings from '../components/Settings/DownloadSettings';
import FileOrganizationSettings from '../components/Settings/FileOrganizationSettings';
import HookSettings from '../components/Settings/HookSettings';
import InterfaceDisplaySettings from '../components/Settings/InterfaceDisplaySettings';
import MountDirectoriesSettings from '../components/Settings/MountDirectoriesSettings';
import RssFeedSettings from '../components/Settings/RssFeedSettings';
import SecuritySettings from '../components/Settings/SecuritySettings';
import StatisticsSettings from '../components/Settings/StatisticsSettings';
import TagsSettings from '../components/Settings/TagsSettings';
import TmdbApiKeySettings from '../components/Settings/TmdbApiKeySettings';
import TwitchSettings from '../components/Settings/TwitchSettings';
import VideoDefaultSettings from '../components/Settings/VideoDefaultSettings';
import LiveTranslationSettings from '../components/Settings/LiveTranslationSettings';
import YtDlpSettings from '../components/Settings/YtDlpSettings';
import YtDlpVersionSettings from '../components/Settings/YtDlpVersionSettings';
import { SETTINGS_SECTION_MAX_WIDTH } from '../components/Settings/settingsLayout';
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
import { resolveAuthorOrganizationMode } from '../utils/authorOrganizationMode';
import ConsoleManager from '../utils/consoleManager';
import { SNACKBAR_AUTO_HIDE_DURATION } from '../utils/constants';
import { getTwitchCredentialValidationCode } from '../utils/twitch';
import { createTranslateOrFallback } from '../utils/translateOrFallback';
import { Language } from '../utils/translations';
import { runMutationAsync } from '../utils/mutationUtils';
import {
    DEFAULT_PLAYER_SEEK_INTERVALS,
    arePlayerSeekIntervalsOrdered,
    isValidPlayerSeekSeconds,
} from '../utils/playerSeekIntervals';

function isAutoDeleteSettingValid(settings: Settings): boolean {
    if (!settings.autoDeleteEnabled) {
        return true;
    }
    const days = settings.autoDeleteIntervalDays;
    return (
        typeof days === 'number' &&
        Number.isInteger(days) &&
        days >= 1 &&
        days <= 3650
    );
}

function arePersistedSeekIntervalsValid(settings: Settings): boolean {
    const shortSeconds =
        settings.playerSeekShortSeconds ?? DEFAULT_PLAYER_SEEK_INTERVALS.shortSeconds;
    const mediumSeconds =
        settings.playerSeekMediumSeconds ?? DEFAULT_PLAYER_SEEK_INTERVALS.mediumSeconds;
    const longSeconds =
        settings.playerSeekLongSeconds ?? DEFAULT_PLAYER_SEEK_INTERVALS.longSeconds;

    return (
        isValidPlayerSeekSeconds(shortSeconds) &&
        isValidPlayerSeekSeconds(mediumSeconds) &&
        isValidPlayerSeekSeconds(longSeconds) &&
        arePlayerSeekIntervalsOrdered({
            shortSeconds,
            mediumSeconds,
            longSeconds,
        })
    );
}

const SETTINGS_TAB_KEYS = [
    'interface',
    'playback',
    'downloads',
    'library',
    'security',
    'integrations',
] as const;

type SettingsTabKey = (typeof SETTINGS_TAB_KEYS)[number];

const DEFAULT_SETTINGS_TAB: SettingsTabKey = 'interface';

// The URL used to carry the tab's raw array position (`?tab=3`), so every
// regrouping silently repointed existing links - two in-app links were already
// aiming at the wrong tab (and one at an index that no longer existed) by the
// time this moved to stable keys. Old numeric links still resolve, to the tab
// that now owns most of what that index used to show.
const LEGACY_SETTINGS_TAB_INDEXES: Record<string, SettingsTabKey> = {
    '0': 'interface',
    '1': 'security',
    '2': 'downloads',
    '3': 'library',
    '4': 'library',
    '5': 'integrations',
};

function isSettingsTabKey(value: string): value is SettingsTabKey {
    return (SETTINGS_TAB_KEYS as readonly string[]).includes(value);
}

function getInitialSettingsTab(search: string): SettingsTabKey {
    const tabParam = new URLSearchParams(search).get('tab');
    if (!tabParam) {
        return DEFAULT_SETTINGS_TAB;
    }
    if (isSettingsTabKey(tabParam)) {
        return tabParam;
    }
    return LEGACY_SETTINGS_TAB_INDEXES[tabParam] ?? DEFAULT_SETTINGS_TAB;
}

interface SettingsTabState {
    urlKey: string;
    tab: SettingsTabKey;
}

function getSettingsTabUrlKey(search: string, hash: string): string {
    return `${search}\0${hash}`;
}

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
        showAudioDownloadButton: true,
        playerSeekShortSeconds: 10,
        playerSeekMediumSeconds: 60,
        playerSeekLongSeconds: 600,
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
        ytDlpProxyBypassHosts: '',
        moveSubtitlesToVideoFolder: false,
        moveThumbnailsToVideoFolder: false,
        authorOrganizationMode: 'root',
        saveAuthorFilesToCollection: false,
        hooks: {},
        playSoundOnTaskComplete: '',
        mountDirectories: '',
        defaultSort: 'dateDesc',
        preferredAudioLanguage: '',
        audioFormat: 'm4a',
        twitchClientId: '',
        twitchClientSecret: '',
        telegramDownloadEnabled: false,
        mediaServerExportMode: 'off',
    });
    const { setPreference } = useThemeContext();
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null);
    const [isGlowing, setIsGlowing] = useState(false);
    // Live translation Gemini API key is never fetched into `settings` (hidden in
    // responses). It only lives in this transient draft while the page is open.
    const [liveTranslationApiKeyDraft, setLiveTranslationApiKeyDraft] = useState('');
    const [clearLiveTranslationApiKeyRequested, setClearLiveTranslationApiKeyRequested] =
        useState(false);
    const settingsTabUrlKey = getSettingsTabUrlKey(location.search, location.hash);
    const [currentTabState, setCurrentTabState] = useState<SettingsTabState>(() => ({
        urlKey: settingsTabUrlKey,
        tab: getInitialSettingsTab(location.search),
    }));
    const [seekIntervalsValid, setSeekIntervalsValid] = useState(true);
    const [autoDeleteValid, setAutoDeleteValid] = useState(true);
    const [showTrustDetailsModal, setShowTrustDetailsModal] = useState(false);
    const twitchCredentialValidationCode = getTwitchCredentialValidationCode(
        settings.twitchClientId,
        settings.twitchClientSecret,
    );
    const hasTwitchCredentialValidationError = twitchCredentialValidationCode !== null;
    const translateOrFallback = createTranslateOrFallback(t);
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
    // Tail of the in-flight tag-save chain; keeps immediate tag PATCHes ordered.
    const tagSaveChain = useRef<Promise<unknown>>(Promise.resolve());
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
        // After hydration the form is user-owned, so we must not clobber unsaved
        // edits. But the server is authoritative for response-only/derived fields
        // (which aren't editable drafts) and for the immediately-persisted tag
        // list, so sync just those from each refetch and leave everything else as
        // the user left it.
        setSettings(prev => ({
            ...prev,
            tags: settingsData.tags || [],
            isPasswordSet: settingsData.isPasswordSet,
            isVisitorPasswordSet: settingsData.isVisitorPasswordSet,
            deploymentSecurity: settingsData.deploymentSecurity,
            liveTranslationApiKeyConfigured: settingsData.liveTranslationApiKeyConfigured,
        }));
    }, [settingsData]);

    // Settings mutations
    const mutations = useSettingsMutations({ setMessage, setInfoModal });
    const {
        saveMutation,
        migrateMutation,
        cleanupMutation,
        cleanupAuthorCollectionsMutation,
        deleteLegacyMutation,
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
        if (
            saveMutation.isPending ||
            hasTwitchCredentialValidationError ||
            !seekIntervalsValid ||
            !autoDeleteValid
        ) {
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
        // Serialize saves: chaining each PATCH after the previous one prevents a
        // slow earlier request from settling after a newer one and persisting a
        // stale tag list (which the settings sync would then copy back into state).
        tagSaveChain.current = tagSaveChain.current
            .catch(() => undefined)
            .then(() => updateTagsMutation.mutateAsync(newTags))
            .catch(() => undefined);
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

    // Content renderers for each tab (used by both desktop tabs and mobile
    // collapsible sections, so the two layouts can never drift apart).
    const renderInterfaceContent = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <BasicSettings
                language={settings.language}
                theme={settings.theme}
                showThemeButton={settings.showThemeButton}
                showAudioDownloadButton={settings.showAudioDownloadButton}
                websiteName={settings.websiteName}
                onChange={(field, value) => handleChange(field as keyof Settings, value)}
            />
            {!isVisitor && (
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
            )}
        </Box>
    );

    const renderPlaybackContent = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <VideoDefaultSettings
                settings={settings}
                onChange={handleChange}
                onSeekIntervalsValidityChange={setSeekIntervalsValid}
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

    const renderDownloadsContent = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
                <Typography variant="h6" gutterBottom>{t('downloadSettings')}</Typography>
                <DownloadSettings
                    settings={settings}
                    onChange={handleChange}
                    activeDownloadsCount={activeDownloads.length}
                    onCleanup={() => setShowCleanupTempFilesModal(true)}
                    isSaving={isSaving}
                    onAutoDeleteValidityChange={setAutoDeleteValid}
                />
            </Box>
            <Box>
                <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>{t('fileOrganization')}</Typography>
                <FileOrganizationSettings
                    onCleanupAuthorCollections={() => setShowCleanupAuthorCollectionsModal(true)}
                    isSaving={isSaving}
                    moveSubtitlesToVideoFolder={settings.moveSubtitlesToVideoFolder || false}
                    onMoveSubtitlesToVideoFolderChange={(checked) => handleChange('moveSubtitlesToVideoFolder', checked)}
                    moveThumbnailsToVideoFolder={settings.moveThumbnailsToVideoFolder || false}
                    onMoveThumbnailsToVideoFolderChange={(checked) => handleChange('moveThumbnailsToVideoFolder', checked)}
                    authorOrganizationMode={settings.authorOrganizationMode || 'root'}
                    onAuthorOrganizationModeChange={(mode) => handleChange('authorOrganizationMode', mode)}
                    downloadFilenameMode={settings.downloadFilenameMode}
                />
            </Box>
            <Box>
                <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>{t('ytDlpConfiguration') || 'yt-dlp Configuration'}</Typography>
                <YtDlpVersionSettings canUpdate={canUseContainerAdminFeatures} />
                {canUseContainerAdminFeatures ? (
                    <YtDlpSettings
                        config={settings.ytDlpConfig || ''}
                        proxyOnlyYoutube={settings.proxyOnlyYoutube || false}
                        proxyBypassHosts={settings.ytDlpProxyBypassHosts || ''}
                        onChange={(config) => handleChange('ytDlpConfig', config)}
                        onProxyOnlyYoutubeChange={(checked) => handleChange('proxyOnlyYoutube', checked)}
                        onProxyBypassHostsChange={(hosts) => handleChange('ytDlpProxyBypassHosts', hosts)}
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
        </Box>
    );

    const renderLibraryContent = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <MountDirectoriesSettings
                mountDirectories={settings.mountDirectories || ''}
                onChange={handleChange}
                canUseHostAdminFeatures={canUseHostAdminFeatures}
                settings={settings}
                setSettings={setSettings}
                saveMutation={saveMutation}
                onShowDetails={() => setShowTrustDetailsModal(true)}
                detailsButtonAriaLabel={`${deploymentSecurityDetailsTitle}: ${translateOrFallback('mountDirectories', 'Mount Directories')}`}
                setMessage={setMessage}
            />
            <Box>
                <Typography variant="h6" gutterBottom>{t('cloudDriveSettings')}</Typography>
                <CloudDriveSettings
                    settings={settings}
                    onChange={handleChange}
                />
            </Box>
            <TagsSettings
                tags={Array.isArray(settings.tags) ? settings.tags : []}
                onTagsChange={handleTagsChange}
                onRenameTag={handleRenameTag}
                onTagConflict={() => setMessage({ text: t('tagConflictCaseInsensitive'), type: 'error' })}
                isRenaming={renameTagMutation.isPending}
            />
            <DatabaseSettings
                onMigrate={() => setShowMigrateConfirmModal(true)}
                onDeleteLegacy={() => setShowDeleteLegacyModal(true)}
                onExportDatabase={handleExportDatabase}
                onImportDatabase={handleImportDatabase}
                onPreviewMergeDatabase={handlePreviewMergeDatabase}
                onMergeDatabase={handleMergeDatabase}
                onCleanupBackupDatabases={handleCleanupBackupDatabases}
                onRestoreFromLastBackup={handleRestoreFromLastBackup}
                isSaving={isSaving}
                lastBackupInfo={lastBackupInfo}
            />
        </Box>
    );

    const renderSecurityContent = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <DeploymentSecuritySummary
                deploymentSecurity={deploymentSecurity}
                onShowDetails={() => setShowTrustDetailsModal(true)}
                detailsButtonAriaLabel={deploymentSecurityDetailsTitle}
            />
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
            {/* Statistics collection is a privacy decision (visitor tracking,
                raw search text, retention), so it lives with the other
                access/privacy controls rather than under Advanced. */}
            <StatisticsSettings settings={settings} onChange={handleChange} />
        </Box>
    );

    const renderIntegrationsContent = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <RssFeedSettings />
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
            <TmdbApiKeySettings
                tmdbApiKey={settings.tmdbApiKey || ''}
                onChange={handleChange}
            />
            <Box>
                <Typography variant="h6" gutterBottom>
                    {t('twitchSubscriptions') || 'Twitch Subscriptions'}
                </Typography>
                <TwitchSettings
                    twitchClientId={settings.twitchClientId}
                    twitchClientSecret={settings.twitchClientSecret}
                    onChange={(field, value) => handleChange(field as keyof Settings, value)}
                />
            </Box>
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

    // One source of truth for both layouts: the desktop tab strip maps over
    // this, and the mobile accordion renders the same list top to bottom.
    const tabs: { key: SettingsTabKey; label: string; render: () => React.ReactNode }[] = [
        { key: 'interface', label: t('interfaceDisplay'), render: renderInterfaceContent },
        ...(!isVisitor
            ? [
                { key: 'playback' as const, label: t('videoPlayback'), render: renderPlaybackContent },
                { key: 'downloads' as const, label: t('downloadsFiles'), render: renderDownloadsContent },
                { key: 'library' as const, label: t('libraryStorage'), render: renderLibraryContent },
                { key: 'security' as const, label: t('securityAccess'), render: renderSecurityContent },
                { key: 'integrations' as const, label: t('integrationsAdvanced'), render: renderIntegrationsContent },
            ]
            : []),
    ];
    const locationTab = getInitialSettingsTab(location.search);
    const selectedTab =
        currentTabState.urlKey === settingsTabUrlKey
            ? currentTabState.tab
            : locationTab;
    const currentTab = tabs.some((tabItem) => tabItem.key === selectedTab)
        ? selectedTab
        : DEFAULT_SETTINGS_TAB;

    const renderDesktopTabContent = () =>
        tabs.find((tabItem) => tabItem.key === currentTab)?.render() ?? null;

    // Mobile: the same tabs as stacked collapsible sections.
    const renderSettingsSections = () => (
        <>
            {tabs.map((tabItem, index) => (
                <Grid size={12} key={tabItem.key}>
                    <CollapsibleSection title={tabItem.label} defaultExpanded={index === 0}>
                        <Box sx={{ maxWidth: SETTINGS_SECTION_MAX_WIDTH }}>
                            {tabItem.render()}
                        </Box>
                    </CollapsibleSection>
                </Grid>
            ))}
        </>
    );

    const handleDesktopTabChange = (_event: React.SyntheticEvent, newValue: SettingsTabKey) => {
        // Local invalid amount text is discarded when VideoDefaultSettings
        // unmounts. Reconcile the page-level save guard to the settings draft
        // that survives the tab switch, while preserving ordering errors.
        setSeekIntervalsValid(arePersistedSeekIntervalsValid(settings));
        setAutoDeleteValid(isAutoDeleteSettingValid(settings));
        setCurrentTabState({
            urlKey: settingsTabUrlKey,
            tab: newValue,
        });
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
                            onChange={handleDesktopTabChange}
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
                                <Tab key={tabItem.key} label={tabItem.label} value={tabItem.key} />
                            ))}
                        </Tabs>
                    </Box>
                    <Box sx={{ py: 3, px: 3, maxWidth: SETTINGS_SECTION_MAX_WIDTH }}>
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
                    disabled={hasTwitchCredentialValidationError || !seekIntervalsValid || !autoDeleteValid}
                    loading={saveMutation.isPending}
                    loadingPosition="start"
                    sx={{ visibility: isSticky ? 'hidden' : 'visible' }}
                    className={isGlowing ? 'button-glow-animation' : ''}
                    onAnimationEnd={() => setIsGlowing(false)}
                >
                    {t('save') || 'Save'}
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
                                disabled={hasTwitchCredentialValidationError || !seekIntervalsValid || !autoDeleteValid}
                                loading={saveMutation.isPending}
                                loadingPosition="start"
                                className={isGlowing ? 'button-glow-animation' : ''}
                                onAnimationEnd={() => setIsGlowing(false)}
                            >
                                {t('save') || 'Save'}
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
                onConfirm={async () => {
                    await runMutationAsync(cleanupAuthorCollectionsMutation, undefined);
                }}
                title={t('cleanupAuthorCollectionsConfirmTitle')}
                message={t('cleanupAuthorCollectionsConfirmMessage')}
                confirmText={t('confirm')}
                cancelText={t('cancel')}
            />
            <ConfirmationModal
                isOpen={showDeleteLegacyModal}
                onClose={() => setShowDeleteLegacyModal(false)}
                onConfirm={async () => {
                    await runMutationAsync(deleteLegacyMutation, undefined);
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
                    await runMutationAsync(migrateMutation, undefined);
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
                onConfirm={async () => {
                    await runMutationAsync(cleanupMutation, undefined);
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
