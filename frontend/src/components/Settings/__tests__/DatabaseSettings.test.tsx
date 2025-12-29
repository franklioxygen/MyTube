import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DatabaseSettings from '../DatabaseSettings';

// Mock language context
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('DatabaseSettings', () => {
    const defaultProps = {
        onMigrate: vi.fn(),
        onDeleteLegacy: vi.fn(),
        onFormatFilenames: vi.fn(),
        onExportDatabase: vi.fn(),
        onImportDatabase: vi.fn(),
        onCleanupBackupDatabases: vi.fn(),
        onRestoreFromLastBackup: vi.fn(),
        isSaving: false,
        lastBackupInfo: { exists: true, timestamp: '2023-01-01-00-00-00' } as any,
        moveSubtitlesToVideoFolder: false,
        onMoveSubtitlesToVideoFolderChange: vi.fn(),
        moveThumbnailsToVideoFolder: false,
        onMoveThumbnailsToVideoFolderChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render all sections and buttons', () => {
        render(<DatabaseSettings {...defaultProps} />);

        expect(screen.getByText('database')).toBeInTheDocument();
        expect(screen.getByText('migrateDataButton')).toBeInTheDocument();
        expect(screen.getByText('formatLegacyFilenamesButton')).toBeInTheDocument();
        expect(screen.getByText('deleteLegacyDataButton')).toBeInTheDocument();
        expect(screen.getByText('exportDatabase')).toBeInTheDocument();
        expect(screen.getByText('importDatabase')).toBeInTheDocument();
        expect(screen.getByText('restoreFromLastBackup')).toBeInTheDocument();
        expect(screen.getByText('cleanupBackupDatabases')).toBeInTheDocument();
    });

    it('should call onMigrate when clicked', async () => {
        const user = userEvent.setup();
        render(<DatabaseSettings {...defaultProps} />);

        await user.click(screen.getByText('migrateDataButton'));
        expect(defaultProps.onMigrate).toHaveBeenCalled();
    });

    it('should handle import flow', async () => {
        const user = userEvent.setup();
        render(<DatabaseSettings {...defaultProps} />);

        // Open modal
        await user.click(screen.getByText('importDatabase'));

        // Find modal title
        expect(screen.getAllByText('importDatabase').length).toBeGreaterThan(1); // Title + Button

        // Mock File Upload
        const file = new File(['db'], 'test.db', { type: 'application/octet-stream' });
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        if (input) {
            await user.upload(input, file);
        }

        // Confirm
        // The confirm button in dialog is "importDatabase"
        // We need to target the specific button in dialog actions
        const buttons = screen.getAllByRole('button', { name: 'importDatabase' });
        // The one in dialog actions should be the last one usually, or enabled
        const dialogButton = buttons[buttons.length - 1];
        await user.click(dialogButton);

        expect(defaultProps.onImportDatabase).toHaveBeenCalledWith(file);
    });

    it('should call onCleanupBackupDatabases when confirmed', async () => {
        const user = userEvent.setup();
        render(<DatabaseSettings {...defaultProps} />);

        // Open modal
        await user.click(screen.getByText('cleanupBackupDatabases'));

        // Confirm
        const confirmBtn = screen.getAllByRole('button', { name: 'cleanupBackupDatabases' }).pop();
        if (confirmBtn) await user.click(confirmBtn);

        expect(defaultProps.onCleanupBackupDatabases).toHaveBeenCalled();
    });

    it('should render switches for moving files', async () => {
        const user = userEvent.setup();
        render(<DatabaseSettings {...defaultProps} />);

        // Check labels
        expect(screen.getByText('moveSubtitlesToVideoFolder')).toBeInTheDocument();
        expect(screen.getByText('moveThumbnailsToVideoFolder')).toBeInTheDocument();

        // Toggle switches
        const subtitleSwitch = screen.getByLabelText(/moveSubtitlesToVideoFolderOff/i);
        await user.click(subtitleSwitch);
        expect(defaultProps.onMoveSubtitlesToVideoFolderChange).toHaveBeenCalledWith(true);
    });
});
