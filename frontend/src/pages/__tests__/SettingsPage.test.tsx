import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '../SettingsPage';

let mockIsDesktop = false;
let mockIsSticky = false;
let mockUserRole = 'admin';
let mockSettingsData: any = {};
let saveIsPending = false;
let saveShouldError = false;
let scanIsPending = false;

const mockSetLanguage = vi.fn();
const mockSetPreference = vi.fn();
const mockApiPost = vi.fn();

const mockSaveMutate = vi.fn();
const mockMigrateMutate = vi.fn();
const mockCleanupMutate = vi.fn();
const mockDeleteLegacyMutate = vi.fn();
const mockFormatFilenamesMutate = vi.fn();
const mockExportDatabaseMutate = vi.fn();
const mockImportDatabaseMutate = vi.fn();
const mockPreviewMergeDatabaseMutateAsync = vi.fn();
const mockMergeDatabaseMutate = vi.fn();
const mockCleanupBackupDatabasesMutate = vi.fn();
const mockRestoreFromLastBackupMutate = vi.fn();
const mockRenameTagMutate = vi.fn();

const mockSetShowDeleteLegacyModal = vi.fn();
const mockSetShowFormatConfirmModal = vi.fn();
const mockSetShowMigrateConfirmModal = vi.fn();
const mockSetShowCleanupTempFilesModal = vi.fn();
const mockSetInfoModal = vi.fn();

let modalState = {
  showDeleteLegacyModal: false,
  showFormatConfirmModal: false,
  showMigrateConfirmModal: false,
  showCleanupTempFilesModal: false,
  infoModal: { isOpen: false, title: '', message: '', type: 'info' as 'info' | 'error' },
};

vi.mock('@mui/material', async () => {
  const actual = await vi.importActual<any>('@mui/material');
  return {
    ...actual,
    useMediaQuery: () => mockIsDesktop,
  };
});

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: any) => ({
    isPending: scanIsPending,
    mutate: (variables: any) => {
      Promise.resolve()
        .then(() => options.mutationFn(variables))
        .then((data) => options.onSuccess?.(data))
        .catch((error) => options.onError?.(error));
    },
  }),
}));

vi.mock('../../utils/apiClient', () => ({
  api: {
    post: (...args: any[]) => mockApiPost(...args),
  },
}));

vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => ({ data: mockSettingsData, isFetching: false }),
}));

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    setLanguage: mockSetLanguage,
  }),
}));

vi.mock('../../contexts/ThemeContext', () => ({
  useThemeContext: () => ({
    setPreference: mockSetPreference,
  }),
}));

vi.mock('../../contexts/DownloadContext', () => ({
  useDownload: () => ({
    activeDownloads: ['a', 'b'],
  }),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    userRole: mockUserRole,
  }),
}));

vi.mock('../../hooks/useSettingsModals', () => ({
  useSettingsModals: () => ({
    showDeleteLegacyModal: modalState.showDeleteLegacyModal,
    setShowDeleteLegacyModal: mockSetShowDeleteLegacyModal,
    showFormatConfirmModal: modalState.showFormatConfirmModal,
    setShowFormatConfirmModal: mockSetShowFormatConfirmModal,
    showMigrateConfirmModal: modalState.showMigrateConfirmModal,
    setShowMigrateConfirmModal: mockSetShowMigrateConfirmModal,
    showCleanupTempFilesModal: modalState.showCleanupTempFilesModal,
    setShowCleanupTempFilesModal: mockSetShowCleanupTempFilesModal,
    infoModal: modalState.infoModal,
    setInfoModal: mockSetInfoModal,
  }),
}));

vi.mock('../../hooks/useSettingsMutations', () => ({
  useSettingsMutations: () => ({
    saveMutation: {
      isPending: saveIsPending,
      mutate: (payload: any, options?: any) => {
        mockSaveMutate(payload, options);
        if (!options) return;
        if (saveShouldError) {
          options.onError?.({ response: { data: { message: 'save failed' } } });
        } else {
          options.onSuccess?.();
        }
      },
    },
    migrateMutation: { isPending: false, mutate: (...args: any[]) => mockMigrateMutate(...args) },
    cleanupMutation: { isPending: false, mutate: (...args: any[]) => mockCleanupMutate(...args) },
    deleteLegacyMutation: { isPending: false, mutate: (...args: any[]) => mockDeleteLegacyMutate(...args) },
    formatFilenamesMutation: { isPending: false, mutate: (...args: any[]) => mockFormatFilenamesMutate(...args) },
    exportDatabaseMutation: { isPending: false, mutate: (...args: any[]) => mockExportDatabaseMutate(...args) },
    importDatabaseMutation: { isPending: false, mutate: (...args: any[]) => mockImportDatabaseMutate(...args) },
    previewMergeDatabaseMutation: {
      isPending: false,
      mutateAsync: (...args: any[]) => mockPreviewMergeDatabaseMutateAsync(...args),
    },
    mergeDatabaseMutation: { isPending: false, mutate: (...args: any[]) => mockMergeDatabaseMutate(...args) },
    cleanupBackupDatabasesMutation: { isPending: false, mutate: (...args: any[]) => mockCleanupBackupDatabasesMutate(...args) },
    restoreFromLastBackupMutation: { isPending: false, mutate: (...args: any[]) => mockRestoreFromLastBackupMutate(...args) },
    renameTagMutation: { isPending: false, mutate: (...args: any[]) => mockRenameTagMutate(...args) },
    lastBackupInfo: null,
    isSaving: false,
  }),
}));

vi.mock('../../hooks/useStickyButton', () => ({
  useStickyButton: () => mockIsSticky,
}));

vi.mock('../../components/CollapsibleSection', () => ({
  default: ({ title, children }: any) => (
    <div data-testid={`section-${title}`}>
      <h3>{title}</h3>
      {children}
    </div>
  ),
}));

vi.mock('../../components/Settings/BasicSettings', () => ({
  default: ({ onChange }: any) => (
    <div data-testid="basic-settings">
      <button onClick={() => onChange('language', 'zh')}>basic-change-language</button>
      <button onClick={() => onChange('theme', 'dark')}>basic-change-theme</button>
    </div>
  ),
}));

vi.mock('../../components/Settings/InterfaceDisplaySettings', () => ({
  default: ({ onChange }: any) => (
    <div data-testid="interface-display-settings">
      <button onClick={() => onChange('itemsPerPage', 24)}>interface-change</button>
    </div>
  ),
}));

vi.mock('../../components/Settings/SecuritySettings', () => ({
  default: ({ onChange }: any) => (
    <div data-testid="security-settings">
      <button onClick={() => onChange('loginEnabled', true)}>security-change</button>
    </div>
  ),
}));

vi.mock('../../components/Settings/CookieSettings', () => ({
  default: ({ onSuccess, onError }: any) => (
    <div data-testid="cookie-settings">
      <button onClick={() => onSuccess('cookie-success')}>cookie-success</button>
      <button onClick={() => onError('cookie-error')}>cookie-error</button>
    </div>
  ),
}));

vi.mock('../../components/Settings/CloudflareSettings', () => ({
  default: ({ onChange }: any) => (
    <div data-testid="cloudflare-settings">
      <button onClick={() => onChange('allowedHosts', 'a.com')}>cloudflare-change</button>
    </div>
  ),
}));

vi.mock('../../components/Settings/VideoDefaultSettings', () => ({
  default: ({ onChange }: any) => (
    <div data-testid="video-default-settings">
      <button onClick={() => onChange('defaultAutoPlay', true)}>video-default-change</button>
    </div>
  ),
}));

vi.mock('../../components/Settings/DownloadSettings', () => ({
  default: ({ onChange, onCleanup }: any) => (
    <div data-testid="download-settings">
      <button onClick={() => onChange('maxConcurrentDownloads', 5)}>download-change</button>
      <button onClick={onCleanup}>download-cleanup</button>
    </div>
  ),
}));

vi.mock('../../components/Settings/CloudDriveSettings', () => ({
  default: ({ onChange }: any) => (
    <div data-testid="cloud-drive-settings">
      <button onClick={() => onChange('cloudDriveEnabled', true)}>cloud-drive-change</button>
    </div>
  ),
}));

vi.mock('../../components/Settings/YtDlpSettings', () => ({
  default: ({ onChange, onProxyOnlyYoutubeChange }: any) => (
    <div data-testid="ytdlp-settings">
      <button onClick={() => onChange('best')}>ytdlp-change</button>
      <button onClick={() => onProxyOnlyYoutubeChange(true)}>proxy-youtube-change</button>
    </div>
  ),
}));

vi.mock('../../components/Settings/TagsSettings', () => ({
  default: ({ onTagsChange, onRenameTag, onTagConflict }: any) => (
    <div data-testid="tags-settings">
      <button onClick={() => onTagsChange(['a', 'b'])}>tags-change</button>
      <button onClick={() => onRenameTag('old', 'new')}>tags-rename-valid</button>
      <button onClick={() => onRenameTag('same', 'same')}>tags-rename-same</button>
      <button onClick={onTagConflict}>tags-conflict</button>
    </div>
  ),
}));

vi.mock('../../components/Settings/DatabaseSettings', () => ({
  default: ({
    onMigrate,
    onDeleteLegacy,
    onFormatFilenames,
    onExportDatabase,
    onImportDatabase,
    onPreviewMergeDatabase,
    onMergeDatabase,
    onCleanupBackupDatabases,
    onRestoreFromLastBackup,
    onMoveSubtitlesToVideoFolderChange,
    onMoveThumbnailsToVideoFolderChange,
    onSaveAuthorFilesToCollectionChange,
  }: any) => (
    <div data-testid="database-settings">
      <button onClick={onMigrate}>open-migrate-modal</button>
      <button onClick={onDeleteLegacy}>open-delete-legacy-modal</button>
      <button onClick={onFormatFilenames}>open-format-modal</button>
      <button onClick={onExportDatabase}>export-db</button>
      <button onClick={() => onImportDatabase(new File(['db'], 'db.zip'))}>import-db</button>
      <button onClick={() => onPreviewMergeDatabase(new File(['db'], 'merge-preview.db'))}>preview-merge-db</button>
      <button onClick={() => onMergeDatabase(new File(['db'], 'merge.db'))}>merge-db</button>
      <button onClick={onCleanupBackupDatabases}>cleanup-backups</button>
      <button onClick={onRestoreFromLastBackup}>restore-last-backup</button>
      <button onClick={() => onMoveSubtitlesToVideoFolderChange(true)}>move-subtitles</button>
      <button onClick={() => onMoveThumbnailsToVideoFolderChange(true)}>move-thumbnails</button>
      <button onClick={() => onSaveAuthorFilesToCollectionChange(true)}>save-author-files</button>
    </div>
  ),
}));

vi.mock('../../components/Settings/AdvancedSettings', () => ({
  default: ({ onDebugModeChange, onChange }: any) => (
    <div data-testid="advanced-settings">
      <button onClick={() => onDebugModeChange(true)}>debug-change</button>
      <button onClick={() => onChange('telegramEnabled', true)}>telegram-change</button>
    </div>
  ),
}));

vi.mock('../../components/Settings/HookSettings', () => ({
  default: ({ onChange }: any) => (
    <div data-testid="hook-settings">
      <button onClick={() => onChange('hooks', { postDownload: 'echo ok' })}>hook-change</button>
    </div>
  ),
}));

vi.mock('../../components/ConfirmationModal', () => ({
  default: ({ isOpen, title, onClose, onConfirm }: any) =>
    isOpen ? (
      <div data-testid={`confirmation-${title}`}>
        <button onClick={onClose}>{`close-${title}`}</button>
        <button onClick={onConfirm}>{`confirm-${title}`}</button>
      </div>
    ) : null,
}));

const renderPage = (path = '/settings') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsPage />
    </MemoryRouter>
  );

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    mockIsDesktop = false;
    mockIsSticky = false;
    mockUserRole = 'admin';
    mockSettingsData = {};
    saveIsPending = false;
    saveShouldError = false;
    scanIsPending = false;

    modalState = {
      showDeleteLegacyModal: false,
      showFormatConfirmModal: false,
      showMigrateConfirmModal: false,
      showCleanupTempFilesModal: false,
      infoModal: { isOpen: false, title: '', message: '', type: 'info' },
    };

    mockApiPost.mockImplementation((url: string) => {
      if (url === '/settings/tmdb/test') {
        return Promise.resolve({
          data: {
            success: true,
            authType: 'apiKey',
            messageKey: 'tmdbCredentialValidApiKey',
          },
        });
      }

      return Promise.resolve({ data: { addedCount: 2, deletedCount: 1 } });
    });
    mockPreviewMergeDatabaseMutateAsync.mockResolvedValue({
      videos: { merged: 1, skipped: 0 },
      collections: { merged: 0, skipped: 0 },
      collectionLinks: { merged: 0, skipped: 0 },
      subscriptions: { merged: 0, skipped: 0 },
      downloadHistory: { merged: 0, skipped: 0 },
      videoDownloads: { merged: 0, skipped: 0 },
      tags: { merged: 0, skipped: 0 },
    });

    document.body.innerHTML = '';
  });

  it('renders visitor desktop view with only basic tab and no non-basic content', async () => {
    mockIsDesktop = true;
    mockUserRole = 'visitor';

    renderPage('/settings?tab=2');

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toHaveTextContent('basicSettings');
    expect(screen.queryByTestId('interface-display-settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('security-settings')).not.toBeInTheDocument();
  });

  it('applies tab query and hash scrolling/highlight behavior', async () => {
    mockIsDesktop = true;
    vi.useFakeTimers();

    const target = document.createElement('div');
    target.id = 'focus-target';
    target.style.backgroundColor = '';
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);

    renderPage('/settings?tab=3#focus-target');

    vi.advanceTimersByTime(500);

    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(target.style.backgroundColor).toBe('rgba(255, 235, 59, 0.3)');
    expect(screen.getByTestId('video-default-settings')).toBeInTheDocument();

    vi.advanceTimersByTime(2000);
    expect(target.style.backgroundColor).toBe('');
  });

  it('switches desktop tabs and renders each tab content', () => {
    mockIsDesktop = true;

    renderPage('/settings');

    expect(screen.getByTestId('basic-settings')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'interfaceDisplay' }));
    expect(screen.getByTestId('interface-display-settings')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'securityAccess' }));
    expect(screen.getByTestId('security-settings')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'videoPlayback' }));
    expect(screen.getByTestId('video-default-settings')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'downloadStorage' }));
    expect(screen.getByTestId('download-settings')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'contentManagement' }));
    expect(screen.getByTestId('tags-settings')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'dataManagement' }));
    expect(screen.getByTestId('database-settings')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'advanced' }));
    expect(screen.getByTestId('advanced-settings')).toBeInTheDocument();
  });

  it('updates settings through child callbacks and triggers glow animation', async () => {
    vi.useFakeTimers();
    mockSettingsData = {
      deploymentSecurity: {
        adminTrustLevel: 'container',
        adminTrustedWithContainer: true,
        adminTrustedWithHost: false,
        source: 'env',
      },
    };
    renderPage('/settings');

    fireEvent.click(screen.getByText('basic-change-language'));
    fireEvent.click(screen.getByText('basic-change-theme'));
    fireEvent.click(screen.getByText('interface-change'));
    fireEvent.click(screen.getByText('security-change'));
    fireEvent.click(screen.getByText('cloudflare-change'));
    fireEvent.click(screen.getByText('video-default-change'));
    fireEvent.click(screen.getByText('download-change'));
    fireEvent.click(screen.getByText('cloud-drive-change'));
    fireEvent.click(screen.getByText('ytdlp-change'));
    fireEvent.click(screen.getByText('proxy-youtube-change'));
    fireEvent.click(screen.getByText('tags-change'));
    fireEvent.click(screen.getByText('debug-change'));
    fireEvent.click(screen.getByText('telegram-change'));
    fireEvent.click(screen.getByText('hook-change'));

    expect(mockSetLanguage).toHaveBeenCalledWith('zh');
    expect(mockSetPreference).toHaveBeenCalledWith('dark');

    const saveButton = screen.getAllByRole('button', { name: 'save' })[0];

    vi.advanceTimersByTime(20);
    fireEvent.animationEnd(saveButton);
  });

  it('runs save action when not pending and blocks when pending', async () => {
    renderPage('/settings');
    fireEvent.click(screen.getAllByRole('button', { name: 'save' })[0]);
    expect(mockSaveMutate).toHaveBeenCalled();

    saveIsPending = true;
    renderPage('/settings');

    const savingButton = screen.getByRole('button', { name: 'saving' });
    expect(savingButton).toBeDisabled();
  });

  it('renders Twitch credential fields and includes them in the save payload', async () => {
    renderPage('/settings');

    expect(screen.getByText('twitchSubscriptionDescription')).toBeInTheDocument();
    expect(screen.getByText('twitchClientHelpLink')).toBeInTheDocument();

    fireEvent.click(screen.getByText('twitchClientHelpLink'));

    expect(screen.getByText('twitchClientHelpTitle')).toBeInTheDocument();
    expect(screen.getByText('twitchClientHelpStep1')).toBeInTheDocument();
    expect(screen.getByText('twitchDeveloperConsole')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('twitchClientId'), {
      target: { value: 'client-id' },
    });
    fireEvent.change(screen.getByLabelText('twitchClientSecret'), {
      target: { value: 'client-secret' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'save' })[0]);

    expect(mockSaveMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        twitchClientId: 'client-id',
        twitchClientSecret: 'client-secret',
      }),
      undefined
    );
  });

  it('disables save when Twitch credentials are incomplete or invalid', () => {
    renderPage('/settings');

    const saveButton = screen.getAllByRole('button', { name: 'save' })[0];
    expect(saveButton).not.toBeDisabled();

    fireEvent.change(screen.getByLabelText('twitchClientId'), {
      target: { value: 'bad' },
    });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('twitchClientId'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('twitchClientSecret'), {
      target: { value: 'client-secret' },
    });
    expect(saveButton).toBeDisabled();
  });

  it('shows mount directory empty message when scan is triggered with no directories', async () => {
    mockSettingsData = {
      mountDirectories: '',
      deploymentSecurity: {
        adminTrustLevel: 'host',
        adminTrustedWithContainer: true,
        adminTrustedWithHost: true,
        source: 'env',
      },
    };
    renderPage('/settings');

    fireEvent.click(screen.getByRole('button', { name: 'scanFiles' }));

    expect(await screen.findByText('mountDirectoriesEmptyError')).toBeInTheDocument();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('scans mount directories and saves settings on successful scan', async () => {
    mockSettingsData = {
      mountDirectories: '/a\n/b',
      deploymentSecurity: {
        adminTrustLevel: 'host',
        adminTrustedWithContainer: true,
        adminTrustedWithHost: true,
        source: 'env',
      },
    };
    renderPage('/settings');

    fireEvent.click(screen.getByRole('button', { name: 'scanFiles' }));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        '/scan-mount-directories',
        { directories: ['/a', '/b'] },
        { timeout: 0 }
      );
    });

    expect(mockSaveMutate).toHaveBeenCalled();
    expect(await screen.findByText('scanMountDirectoriesSuccess settingsSaved')).toBeInTheDocument();
  });

  it('shows warning snackbar when scan succeeds but saving settings fails', async () => {
    mockSettingsData = {
      mountDirectories: '/tmp/videos',
      deploymentSecurity: {
        adminTrustLevel: 'host',
        adminTrustedWithContainer: true,
        adminTrustedWithHost: true,
        source: 'env',
      },
    };
    saveShouldError = true;

    renderPage('/settings');

    fireEvent.click(screen.getByRole('button', { name: 'scanFiles' }));

    expect(await screen.findByText('scanMountDirectoriesSuccess Warning: save failed')).toBeInTheDocument();
  });

  it('shows error snackbar when scan request fails', async () => {
    mockSettingsData = {
      mountDirectories: '/tmp/videos',
      deploymentSecurity: {
        adminTrustLevel: 'host',
        adminTrustedWithContainer: true,
        adminTrustedWithHost: true,
        source: 'env',
      },
    };
    mockApiPost.mockRejectedValueOnce({ response: { data: { details: 'scan failed details' } } });

    renderPage('/settings');

    fireEvent.click(screen.getByRole('button', { name: 'scanFiles' }));

    expect(await screen.findByText('scanFilesFailed: scan failed details')).toBeInTheDocument();
  });

  it('tests TMDB credentials successfully from the content management tab', async () => {
    mockIsDesktop = true;
    mockSettingsData = {
      tmdbApiKey: 'tmdb-key',
    };

    renderPage('/settings');

    fireEvent.click(screen.getByRole('tab', { name: 'contentManagement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test Credential' }));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/settings/tmdb/test', {
        tmdbApiKey: 'tmdb-key',
      });
    });

    expect(await screen.findByText('TMDB API key is valid.')).toBeInTheDocument();
  });

  it('shows TMDB credential test errors inline', async () => {
    mockIsDesktop = true;
    mockSettingsData = {
      tmdbApiKey: 'bad-key',
    };
    mockApiPost.mockImplementation((url: string) => {
      if (url === '/settings/tmdb/test') {
        return Promise.reject({
          response: {
            data: {
              errorKey: 'tmdbCredentialInvalid',
              error: 'Invalid API key: You must be granted a valid key.',
            },
          },
        });
      }

      return Promise.resolve({ data: { addedCount: 2, deletedCount: 1 } });
    });

    renderPage('/settings');

    fireEvent.click(screen.getByRole('tab', { name: 'contentManagement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test Credential' }));

    expect(
      await screen.findByText(
        'TMDB credential is invalid. Check whether it is a valid API key or Read Access Token.'
      )
    ).toBeInTheDocument();
  });

  it('does not render raw TMDB server error text for unknown errors', async () => {
    mockIsDesktop = true;
    mockSettingsData = {
      tmdbApiKey: 'bad-key',
    };
    mockApiPost.mockImplementation((url: string) => {
      if (url === '/settings/tmdb/test') {
        return Promise.reject({
          response: {
            data: {
              error: 'Sensitive backend failure details',
            },
          },
        });
      }

      return Promise.resolve({ data: { addedCount: 2, deletedCount: 1 } });
    });

    renderPage('/settings');

    fireEvent.click(screen.getByRole('tab', { name: 'contentManagement' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test Credential' }));

    expect(await screen.findByText('Failed to test TMDB credential.')).toBeInTheDocument();
    expect(screen.queryByText('Sensitive backend failure details')).not.toBeInTheDocument();
  });

  it('hides mount directory controls unless deployment trust is host', () => {
    renderPage('/settings');

    expect(screen.queryByRole('button', { name: 'scanFiles' })).not.toBeInTheDocument();
    expect(screen.getByText('Mount directories require host-level admin trust.')).toBeInTheDocument();
  });

  it('hides container-only features in application trust mode', () => {
    mockSettingsData = {
      deploymentSecurity: {
        adminTrustLevel: 'application',
        adminTrustedWithContainer: false,
        adminTrustedWithHost: false,
        source: 'env',
      },
    };

    renderPage('/settings');

    expect(screen.queryByTestId('ytdlp-settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hook-settings')).not.toBeInTheDocument();
    expect(screen.getByText('Raw yt-dlp configuration is disabled by deployment security policy in application trust mode.')).toBeInTheDocument();
    expect(screen.getByText('Task hooks are disabled by deployment security policy in application trust mode.')).toBeInTheDocument();
  });

  it('opens deployment security details modal', () => {
    mockSettingsData = {
      deploymentSecurity: {
        adminTrustLevel: 'container',
        adminTrustedWithContainer: true,
        adminTrustedWithHost: false,
        source: 'env',
      },
    };

    renderPage('/settings');

    fireEvent.click(screen.getByRole('button', { name: 'Deployment Security Details' }));

    expect(screen.getByText('Deployment Security Details')).toBeInTheDocument();
    expect(screen.getByText('Capability / Feature')).toBeInTheDocument();
    expect(screen.getByText('Task hooks upload/delete/execute')).toBeInTheDocument();
    expect(screen.getByText('Scan files from configured mount directories')).toBeInTheDocument();
    expect(screen.getByText('How to configure')).toBeInTheDocument();
    expect(screen.getByText('Docker / Docker Compose')).toBeInTheDocument();
    expect(screen.getByText('Local source run')).toBeInTheDocument();
    expect(screen.getByText('MYTUBE_ADMIN_TRUST_LEVEL=application npm run dev')).toBeInTheDocument();
  });

  it('fails closed for container-only features until deployment security is loaded', () => {
    mockSettingsData = {};

    renderPage('/settings');

    expect(screen.queryByTestId('ytdlp-settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hook-settings')).not.toBeInTheDocument();
    expect(screen.getByText('Deployment security policy is loading. Restricted features remain hidden until the policy is available.')).toBeInTheDocument();
  });

  it('triggers data management callbacks and modal openers', async () => {
    renderPage('/settings');

    fireEvent.click(screen.getByText('open-migrate-modal'));
    fireEvent.click(screen.getByText('open-delete-legacy-modal'));
    fireEvent.click(screen.getByText('open-format-modal'));
    fireEvent.click(screen.getByText('export-db'));
    fireEvent.click(screen.getByText('import-db'));
    fireEvent.click(screen.getByText('preview-merge-db'));
    fireEvent.click(screen.getByText('merge-db'));
    fireEvent.click(screen.getByText('cleanup-backups'));
    fireEvent.click(screen.getByText('restore-last-backup'));
    fireEvent.click(screen.getByText('move-subtitles'));
    fireEvent.click(screen.getByText('move-thumbnails'));
    fireEvent.click(screen.getByText('save-author-files'));
    fireEvent.click(screen.getByText('tags-rename-same'));
    fireEvent.click(screen.getByText('tags-rename-valid'));
    fireEvent.click(screen.getByText('tags-conflict'));
    fireEvent.click(screen.getByText('cookie-success'));
    fireEvent.click(screen.getByText('cookie-error'));
    fireEvent.click(screen.getByText('download-cleanup'));

    expect(mockSetShowMigrateConfirmModal).toHaveBeenCalledWith(true);
    expect(mockSetShowDeleteLegacyModal).toHaveBeenCalledWith(true);
    expect(mockSetShowFormatConfirmModal).toHaveBeenCalledWith(true);
    expect(mockExportDatabaseMutate).toHaveBeenCalled();
    expect(mockImportDatabaseMutate).toHaveBeenCalled();
    expect(mockPreviewMergeDatabaseMutateAsync).toHaveBeenCalled();
    expect(mockMergeDatabaseMutate).toHaveBeenCalled();
    expect(mockCleanupBackupDatabasesMutate).toHaveBeenCalled();
    expect(mockRestoreFromLastBackupMutate).toHaveBeenCalled();
    expect(mockRenameTagMutate).toHaveBeenCalledTimes(1);
    expect(mockSetShowCleanupTempFilesModal).toHaveBeenCalledWith(true);
  });

  it('handles sticky save button and confirmation modal confirm/close actions', async () => {
    mockIsSticky = true;
    modalState = {
      showDeleteLegacyModal: true,
      showFormatConfirmModal: true,
      showMigrateConfirmModal: true,
      showCleanupTempFilesModal: true,
      infoModal: { isOpen: true, title: 'info-title', message: 'info-message', type: 'error' },
    };

    renderPage('/settings');

    expect(screen.getByTestId('confirmation-removeLegacyDataConfirmTitle')).toBeInTheDocument();
    expect(screen.getByTestId('confirmation-migrateDataButton')).toBeInTheDocument();
    expect(screen.getByTestId('confirmation-formatLegacyFilenamesButton')).toBeInTheDocument();
    expect(screen.getByTestId('confirmation-cleanupTempFilesConfirmTitle')).toBeInTheDocument();
    expect(screen.getByTestId('confirmation-info-title')).toBeInTheDocument();

    fireEvent.click(screen.getByText('confirm-removeLegacyDataConfirmTitle'));
    fireEvent.click(screen.getByText('confirm-migrateDataButton'));
    fireEvent.click(screen.getByText('confirm-formatLegacyFilenamesButton'));
    fireEvent.click(screen.getByText('confirm-cleanupTempFilesConfirmTitle'));
    fireEvent.click(screen.getByText('close-info-title'));
    fireEvent.click(screen.getByText('confirm-info-title'));

    expect(mockDeleteLegacyMutate).toHaveBeenCalled();
    expect(mockMigrateMutate).toHaveBeenCalled();
    expect(mockFormatFilenamesMutate).toHaveBeenCalled();
    expect(mockCleanupMutate).toHaveBeenCalled();
    expect(mockSetShowDeleteLegacyModal).toHaveBeenCalledWith(false);
    expect(mockSetShowMigrateConfirmModal).toHaveBeenCalledWith(false);
    expect(mockSetShowFormatConfirmModal).toHaveBeenCalledWith(false);
    expect(mockSetShowCleanupTempFilesModal).toHaveBeenCalledWith(false);
    expect(mockSetInfoModal).toHaveBeenCalled();

    const stickySaveButton = screen.getByRole('button', { name: 'save' });
    fireEvent.animationEnd(stickySaveButton);
  });
});
