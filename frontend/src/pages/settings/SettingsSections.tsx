import { FindInPage } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Grid,
    Tab,
    Tabs,
    Typography,
} from '@mui/material';
import TextField from '@mui/material/TextField';
import CollapsibleSection from '../../components/CollapsibleSection';
import AdvancedSettings from '../../components/Settings/AdvancedSettings';
import BasicSettings from '../../components/Settings/BasicSettings';
import CloudDriveSettings from '../../components/Settings/CloudDriveSettings';
import CloudflareSettings from '../../components/Settings/CloudflareSettings';
import CookieSettings from '../../components/Settings/CookieSettings';
import DatabaseSettings from '../../components/Settings/DatabaseSettings';
import DownloadSettings from '../../components/Settings/DownloadSettings';
import HookSettings from '../../components/Settings/HookSettings';
import InterfaceDisplaySettings from '../../components/Settings/InterfaceDisplaySettings';
import RssFeedSettings from '../../components/Settings/RssFeedSettings';
import SecuritySettings from '../../components/Settings/SecuritySettings';
import TagsSettings from '../../components/Settings/TagsSettings';
import TwitchSettings from '../../components/Settings/TwitchSettings';
import VideoDefaultSettings from '../../components/Settings/VideoDefaultSettings';
import YtDlpSettings from '../../components/Settings/YtDlpSettings';
import { AdminTrustLevel, Settings } from '../../types';
import type { TranslateFn } from '../../utils/translateOrFallback';

type MessageSetter = (message: { text: string; type: 'success' | 'error' | 'warning' | 'info' }) => void;

interface TmdbCredentialTestResult {
    type: 'success' | 'error';
    message: string;
}

interface SettingsSectionsProps {
    activeDownloadsCount: number;
    adminTrustLevel: AdminTrustLevel | undefined;
    canUseContainerAdminFeatures: boolean;
    canUseHostAdminFeatures: boolean;
    currentTab: number;
    debugMode: boolean;
    deploymentSecurity: Settings['deploymentSecurity'];
    deploymentSecurityDetailsTitle: string;
    isDesktop: boolean;
    isSaving: boolean;
    isVisitor: boolean;
    lastBackupInfo: unknown;
    onCleanupBackupDatabases: () => void;
    onCleanupTempFiles: () => void;
    onDeleteLegacy: () => void;
    onExportDatabase: () => void;
    onFormatFilenames: () => void;
    onImportDatabase: (file: File) => void;
    onMergeDatabase: (file: File) => void;
    onMigrate: () => void;
    onPreviewMergeDatabase: (file: File) => Promise<unknown>;
    onRestoreFromLastBackup: () => void;
    onScanMountDirectories: () => void;
    onSettingsChange: (field: keyof Settings, value: string | boolean | number) => void;
    onShowTrustDetails: () => void;
    onTagConflict: () => void;
    onTagsChange: (newTags: string[]) => void;
    onRenameTag: (oldTag: string, newTag: string) => void;
    renameTagPending: boolean;
    scanMountDirectoriesPending: boolean;
    setCurrentTab: (tab: number) => void;
    setDebugMode: (debugMode: boolean) => void;
    setMessage: MessageSetter;
    setTmdbCredentialTestResult: (result: TmdbCredentialTestResult | null) => void;
    settings: Settings;
    t: TranslateFn;
    testTmdbCredential: () => void;
    tmdbCredentialTesting: boolean;
    tmdbCredentialTestResult: TmdbCredentialTestResult | null;
    translateOrFallback: (key: Parameters<TranslateFn>[0], fallback: string) => string;
}

export const SettingsSections: React.FC<SettingsSectionsProps> = ({
    activeDownloadsCount,
    adminTrustLevel,
    canUseContainerAdminFeatures,
    canUseHostAdminFeatures,
    currentTab,
    debugMode,
    deploymentSecurity,
    deploymentSecurityDetailsTitle,
    isDesktop,
    isSaving,
    isVisitor,
    lastBackupInfo,
    onCleanupBackupDatabases,
    onCleanupTempFiles,
    onDeleteLegacy,
    onExportDatabase,
    onFormatFilenames,
    onImportDatabase,
    onMergeDatabase,
    onMigrate,
    onPreviewMergeDatabase,
    onRestoreFromLastBackup,
    onScanMountDirectories,
    onSettingsChange,
    onShowTrustDetails,
    onTagConflict,
    onTagsChange,
    onRenameTag,
    renameTagPending,
    scanMountDirectoriesPending,
    setCurrentTab,
    setDebugMode,
    setMessage,
    setTmdbCredentialTestResult,
    settings,
    t,
    testTmdbCredential,
    tmdbCredentialTesting,
    tmdbCredentialTestResult,
    translateOrFallback,
}) => {
    const renderDeploymentSecurityDetailsButton = (ariaLabel: string) => (
        <Button
            variant="text"
            size="small"
            onClick={onShowTrustDetails}
            aria-label={ariaLabel}
            sx={{ minWidth: 0, p: 0, ml: 0.5, verticalAlign: 'baseline', textTransform: 'none' }}
        >
            {translateOrFallback('deploymentSecurityDetails', 'Details')}
        </Button>
    );

    const renderBasicSettingsContent = () => (
        <BasicSettings
            language={settings.language}
            theme={settings.theme}
            showThemeButton={settings.showThemeButton}
            websiteName={settings.websiteName}
            onChange={(field, value) => {
                onSettingsChange(field as keyof Settings, value);
            }}
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
            onChange={(field, value) => {
                onSettingsChange(field as keyof Settings, value);
            }}
        />
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

        const getAdminTrustLevelLabel = (level: AdminTrustLevel): string => {
            switch (level) {
                case 'application':
                    return translateOrFallback('adminTrustLevelApplication', 'Application');
                case 'container':
                    return translateOrFallback('adminTrustLevelContainer', 'Container');
                case 'host':
                    return translateOrFallback('adminTrustLevelHost', 'Host');
            }
        };
        const getAdminTrustLevelDescription = (level: AdminTrustLevel): string => {
            switch (level) {
                case 'application':
                    return translateOrFallback(
                        'adminTrustLevelApplicationDescription',
                        'Admin is trusted at the application layer only.'
                    );
                case 'container':
                    return translateOrFallback(
                        'adminTrustLevelContainerDescription',
                        'Admin is trusted with backend/container-process-level actions.'
                    );
                case 'host':
                    return translateOrFallback(
                        'adminTrustLevelHostDescription',
                        'Admin is trusted with host-scoped administrative actions.'
                    );
            }
        };

        return (
            <Alert severity={adminTrustLevel === 'application' ? 'success' : 'info'}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    {translateOrFallback('deploymentSecurityTitle', 'Deployment Security Model')}
                </Typography>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {translateOrFallback('adminTrustLevelLabel', 'Admin Trust Level')}: {getAdminTrustLevelLabel(adminTrustLevel)}
                </Typography>
                <Typography variant="body2">
                    {getAdminTrustLevelDescription(adminTrustLevel)}
                    {renderDetailsLink()}
                </Typography>
            </Alert>
        );
    };

    const renderSecurityAccessContent = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {renderDeploymentSecuritySummary()}
            <SecuritySettings settings={settings} onChange={onSettingsChange} />
            <CookieSettings
                onSuccess={(msg) => {
                    setMessage({ text: msg, type: 'success' });
                }}
                onError={(msg) => {
                    setMessage({ text: msg, type: 'error' });
                }}
            />
            <CloudflareSettings
                enabled={settings.cloudflaredTunnelEnabled}
                token={settings.cloudflaredToken}
                allowedHosts={settings.allowedHosts}
                onChange={(field, value) => {
                    onSettingsChange(field as keyof Settings, value);
                }}
            />
            <RssFeedSettings />
        </Box>
    );

    const renderVideoPlaybackContent = () => (
        <VideoDefaultSettings
            settings={settings}
            onChange={onSettingsChange}
        />
    );

    const renderDownloadStorageContent = () => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
                <Typography variant="h6" gutterBottom>{t('downloadSettings')}</Typography>
                <DownloadSettings
                    settings={settings}
                    onChange={onSettingsChange}
                    activeDownloadsCount={activeDownloadsCount}
                    onCleanup={onCleanupTempFiles}
                    isSaving={isSaving}
                />
            </Box>
            <Box>
                <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>{t('cloudDriveSettings')}</Typography>
                <CloudDriveSettings
                    settings={settings}
                    onChange={onSettingsChange}
                />
            </Box>
            <Box>
                <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>{t('ytDlpConfiguration') || 'yt-dlp Configuration'}</Typography>
                {canUseContainerAdminFeatures ? (
                    <YtDlpSettings
                        config={settings.ytDlpConfig || ''}
                        proxyOnlyYoutube={settings.proxyOnlyYoutube || false}
                        onChange={(config) => {
                            onSettingsChange('ytDlpConfig', config);
                        }}
                        onProxyOnlyYoutubeChange={(checked) => {
                            onSettingsChange('proxyOnlyYoutube', checked);
                        }}
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
                    onChange={(field, value) => {
                        onSettingsChange(field as keyof Settings, value);
                    }}
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
                        onChange={(e) => {
                            onSettingsChange('mountDirectories' as keyof Settings, e.target.value);
                        }}
                        placeholder={t('mountDirectoriesPlaceholder')}
                        helperText={t('mountDirectoriesHelper')}
                    />
                    <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                        <Button
                            variant="outlined"
                            startIcon={<FindInPage />}
                            onClick={onScanMountDirectories}
                            disabled={scanMountDirectoriesPending}
                        >
                            {scanMountDirectoriesPending ? (t('scanning') || 'Scanning...') : (t('scanFiles') || 'Scan Files')}
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
                onChange={(e) => {
                    onSettingsChange('tmdbApiKey' as keyof Settings, e.target.value);
                }}
                type="password"
                helperText={t('tmdbApiKeyHelper')}
                placeholder="Enter your TMDB API key"
            />
            <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                <Button
                    variant="outlined"
                    startIcon={tmdbCredentialTesting ? <CircularProgress size={16} /> : <FindInPage />}
                    onClick={testTmdbCredential}
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
                    onClose={() => {
                        setTmdbCredentialTestResult(null);
                    }}
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
                onTagsChange={onTagsChange}
                onRenameTag={onRenameTag}
                onTagConflict={onTagConflict}
                isRenaming={renameTagPending}
            />
            {renderMountDirectories()}
            {renderTmdbApiKey()}
        </Box>
    );

    const renderDataManagementContent = () => (
        <DatabaseSettings
            onMigrate={onMigrate}
            onDeleteLegacy={onDeleteLegacy}
            onFormatFilenames={onFormatFilenames}
            onExportDatabase={onExportDatabase}
            onImportDatabase={onImportDatabase}
            onPreviewMergeDatabase={onPreviewMergeDatabase}
            onMergeDatabase={onMergeDatabase}
            onCleanupBackupDatabases={onCleanupBackupDatabases}
            onRestoreFromLastBackup={onRestoreFromLastBackup}
            isSaving={isSaving}
            lastBackupInfo={lastBackupInfo}
            moveSubtitlesToVideoFolder={settings.moveSubtitlesToVideoFolder || false}
            onMoveSubtitlesToVideoFolderChange={(checked) => {
                onSettingsChange('moveSubtitlesToVideoFolder', checked);
            }}
            moveThumbnailsToVideoFolder={settings.moveThumbnailsToVideoFolder || false}
            onMoveThumbnailsToVideoFolderChange={(checked) => {
                onSettingsChange('moveThumbnailsToVideoFolder', checked);
            }}
            saveAuthorFilesToCollection={settings.saveAuthorFilesToCollection || false}
            onSaveAuthorFilesToCollectionChange={(checked) => {
                onSettingsChange('saveAuthorFilesToCollection', checked);
            }}
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
                telegramNotifyOnSuccess={settings.telegramNotifyOnSuccess}
                telegramNotifyOnFail={settings.telegramNotifyOnFail}
                onChange={onSettingsChange}
            />
            {canUseContainerAdminFeatures ? (
                <HookSettings
                    settings={settings}
                    onChange={onSettingsChange}
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

    const renderSettingsSections = () => (
        <>
            <Grid size={12}>
                <CollapsibleSection title={t('basicSettings')} defaultExpanded={true}>
                    {renderBasicSettingsContent()}
                </CollapsibleSection>
            </Grid>

            {!isVisitor && (
                <Grid size={12}>
                    <CollapsibleSection title={t('interfaceDisplay')} defaultExpanded={false}>
                        {renderInterfaceDisplayContent()}
                    </CollapsibleSection>
                </Grid>
            )}

            {!isVisitor && (
                <Grid size={12}>
                    <CollapsibleSection title={t('securityAccess')} defaultExpanded={false}>
                        {renderSecurityAccessContent()}
                    </CollapsibleSection>
                </Grid>
            )}

            {!isVisitor && (
                <>
                    <Grid size={12}>
                        <CollapsibleSection title={t('videoPlayback')} defaultExpanded={false}>
                            {renderVideoPlaybackContent()}
                        </CollapsibleSection>
                    </Grid>

                    <Grid size={12}>
                        <CollapsibleSection title={t('downloadStorage')} defaultExpanded={false}>
                            {renderDownloadStorageContent()}
                        </CollapsibleSection>
                    </Grid>

                    <Grid size={12}>
                        <CollapsibleSection title={t('contentManagement')} defaultExpanded={false}>
                            {renderContentManagementContent()}
                        </CollapsibleSection>
                    </Grid>

                    <Grid size={12}>
                        <CollapsibleSection title={t('dataManagement')} defaultExpanded={false}>
                            {renderDataManagementContent()}
                        </CollapsibleSection>
                    </Grid>

                    <Grid size={12}>
                        <CollapsibleSection title={t('advanced')} defaultExpanded={false}>
                            {renderAdvancedContent()}
                        </CollapsibleSection>
                    </Grid>
                </>
            )}
        </>
    );

    const tabs = [
        { label: t('basicSettings'), index: 0 },
        ...(!isVisitor ? [
            { label: t('interfaceDisplay'), index: 1 },
            { label: t('securityAccess'), index: 2 },
            { label: t('videoPlayback'), index: 3 },
            { label: t('downloadStorage'), index: 4 },
            { label: t('contentManagement'), index: 5 },
            { label: t('dataManagement'), index: 6 },
            { label: t('advanced'), index: 7 },
        ] : []),
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

    if (!isDesktop) {
        return (
            <Grid container spacing={2}>
                {renderSettingsSections()}
            </Grid>
        );
    }

    return (
        <Box sx={{ mx: -3 }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3, px: 3 }}>
                <Tabs
                    value={currentTab}
                    onChange={(_, newValue) => {
                        setCurrentTab(newValue);
                    }}
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
    );
};
