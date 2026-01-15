import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '../SettingsPage';

// Mock all external hooks and components
const mockSettingsData = { data: {} };
vi.mock('@tanstack/react-query', () => ({
    useQuery: vi.fn(() => ({
        ...mockSettingsData,
        refetch: vi.fn(),
    })),
    useMutation: vi.fn(() => ({
        isPending: false,
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        reset: vi.fn(),
    })),
    useQueryClient: vi.fn(() => ({
        invalidateQueries: vi.fn(),
    })),
}));

vi.mock('../../hooks/useSettings', () => ({
    useSettings: vi.fn(() => ({
        ...mockSettingsData,
        refetch: vi.fn(),
    })),
}));

vi.mock('../../contexts/LanguageContext', () => {
    return {
        useLanguage: () => ({
            t: (key: string) => key,
            setLanguage: vi.fn(),
        }),
    };
});

vi.mock('../../contexts/DownloadContext', () => ({
    useDownload: vi.fn(() => ({
        activeDownloads: [],
    })),
}));

vi.mock('../../contexts/AuthContext', () => ({
    useAuth: vi.fn(() => ({
        userRole: 'admin',
    })),
}));

// Mock Hooks
vi.mock('../../hooks/useSettingsModals', () => ({
    useSettingsModals: vi.fn(() => ({
        showDeleteLegacyModal: false,
        setShowDeleteLegacyModal: vi.fn(),
        showFormatConfirmModal: false,
        setShowFormatConfirmModal: vi.fn(),
        showMigrateConfirmModal: false,
        setShowMigrateConfirmModal: vi.fn(),
        showCleanupTempFilesModal: false,
        setShowCleanupTempFilesModal: vi.fn(),
        infoModal: { isOpen: false, title: '', message: '', type: 'info' },
        setInfoModal: vi.fn(),
    })),
}));

vi.mock('../../hooks/useSettingsMutations', () => ({
    useSettingsMutations: vi.fn(() => ({
        saveMutation: { isPending: false, mutate: vi.fn() },
        migrateMutation: { isPending: false, mutate: vi.fn() },
        cleanupMutation: { isPending: false, mutate: vi.fn() },
        deleteLegacyMutation: { isPending: false, mutate: vi.fn() },
        formatFilenamesMutation: { isPending: false, mutate: vi.fn() },
        exportDatabaseMutation: { isPending: false, mutate: vi.fn() },
        importDatabaseMutation: { isPending: false, mutate: vi.fn() },
        cleanupBackupDatabasesMutation: { isPending: false, mutate: vi.fn() },
        restoreFromLastBackupMutation: { isPending: false, mutate: vi.fn() },
        lastBackupInfo: null,
        isSaving: false,
    })),
}));

vi.mock('../../hooks/useStickyButton', () => ({
    useStickyButton: vi.fn(() => false),
}));

// Mock Child Components to simplify testing
vi.mock('../../components/Settings/BasicSettings', () => ({
    default: () => <div data-testid="basic-settings">BasicSettings</div>,
}));

vi.mock('../../components/Settings/InterfaceDisplaySettings', () => ({
    default: () => <div data-testid="interface-display-settings">InterfaceDisplaySettings</div>,
}));

vi.mock('../../components/Settings/CloudflareSettings', () => ({
    default: () => <div data-testid="cloudflare-settings">CloudflareSettings</div>,
}));

vi.mock('../../components/Settings/CookieSettings', () => ({
    default: () => <div data-testid="cookie-settings">CookieSettings</div>,
}));

vi.mock('../../components/Settings/SecuritySettings', () => ({
    default: () => <div data-testid="security-settings">SecuritySettings</div>,
}));

vi.mock('../../components/Settings/VideoDefaultSettings', () => ({
    default: () => <div data-testid="video-default-settings">VideoDefaultSettings</div>,
}));

vi.mock('../../components/Settings/TagsSettings', () => ({
    default: () => <div data-testid="tags-settings">TagsSettings</div>,
}));

vi.mock('../../components/Settings/DownloadSettings', () => ({
    default: () => <div data-testid="download-settings">DownloadSettings</div>,
}));

vi.mock('../../components/Settings/CloudDriveSettings', () => ({
    default: () => <div data-testid="cloud-drive-settings">CloudDriveSettings</div>,
}));

vi.mock('../../components/Settings/DatabaseSettings', () => ({
    default: () => <div data-testid="database-settings">DatabaseSettings</div>,
}));

vi.mock('../../components/Settings/YtDlpSettings', () => ({
    default: () => <div data-testid="ytdlp-settings">YtDlpSettings</div>,
}));

vi.mock('../../components/Settings/AdvancedSettings', () => ({
    default: () => <div data-testid="advanced-settings">AdvancedSettings</div>,
}));

vi.mock('../../components/Settings/HookSettings', () => ({
    default: () => <div data-testid="hook-settings">HookSettings</div>,
}));

vi.mock('../../components/ConfirmationModal', () => ({
    default: ({ isOpen, title }: any) => (
        isOpen ? <div data-testid="confirmation-modal">{title}</div> : null
    ),
}));

// Mock axios
vi.mock('axios');

describe('SettingsPage', () => {
    // Reset mocks before each test
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the page title', () => {
        render(
            <MemoryRouter>
                <SettingsPage />
            </MemoryRouter>
        );
        expect(screen.getByText('settings')).toBeInTheDocument();
    });

    it('renders all settings sections', async () => {
        render(
            <MemoryRouter>
                <SettingsPage />
            </MemoryRouter>
        );

        expect(screen.getByTestId('basic-settings')).toBeInTheDocument();
        expect(screen.getByTestId('interface-display-settings')).toBeInTheDocument();
        expect(screen.getByTestId('cloudflare-settings')).toBeInTheDocument();
        // Since userRole is mocked to 'admin', these should be visible
        expect(screen.getByTestId('cookie-settings')).toBeInTheDocument();
        expect(screen.getByTestId('security-settings')).toBeInTheDocument();
        expect(screen.getByTestId('video-default-settings')).toBeInTheDocument();
        expect(screen.getByTestId('tags-settings')).toBeInTheDocument();
        expect(screen.getByTestId('download-settings')).toBeInTheDocument();
        expect(screen.getByTestId('cloud-drive-settings')).toBeInTheDocument();
        expect(screen.getByTestId('database-settings')).toBeInTheDocument();
        expect(screen.getByTestId('ytdlp-settings')).toBeInTheDocument();
        expect(screen.getByTestId('advanced-settings')).toBeInTheDocument();
        expect(screen.getByTestId('hook-settings')).toBeInTheDocument();
    });

    it('renders save button', () => {
        render(
            <MemoryRouter>
                <SettingsPage />
            </MemoryRouter>
        );
        // There are two save buttons (one sticky, one normal), so getAllByText
        const saveButtons = screen.getAllByText('save');
        expect(saveButtons.length).toBeGreaterThan(0);
    });

});
