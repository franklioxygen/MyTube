import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DatabaseSettings from '../DatabaseSettings';

// Mock language context
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('DatabaseSettings', () => {
    const defaultMergePreviewSummary = {
        videos: { merged: 1, skipped: 2 },
        collections: { merged: 3, skipped: 4 },
        collectionLinks: { merged: 5, skipped: 6 },
        subscriptions: { merged: 7, skipped: 8 },
        downloadHistory: { merged: 9, skipped: 10 },
        videoDownloads: { merged: 11, skipped: 12 },
        tags: { merged: 13, skipped: 14 },
    };

    const defaultProps = {
        onMigrate: vi.fn(),
        onDeleteLegacy: vi.fn(),
        onFormatFilenames: vi.fn(),
        onExportDatabase: vi.fn(),
        onImportDatabase: vi.fn(),
        onPreviewMergeDatabase: vi.fn().mockResolvedValue(defaultMergePreviewSummary),
        onMergeDatabase: vi.fn(),
        onCleanupBackupDatabases: vi.fn(),
        onRestoreFromLastBackup: vi.fn(),
        isSaving: false,
        lastBackupInfo: { exists: true, timestamp: '2023-01-01-00-00-00' } as any,
        moveSubtitlesToVideoFolder: false,
        onMoveSubtitlesToVideoFolderChange: vi.fn(),
        moveThumbnailsToVideoFolder: false,
        onMoveThumbnailsToVideoFolderChange: vi.fn(),
        saveAuthorFilesToCollection: false,
        onSaveAuthorFilesToCollectionChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render all sections and buttons', () => {
        render(<DatabaseSettings {...defaultProps} />);

        expect(screen.getByText('migrateDataButton')).toBeInTheDocument();
        expect(screen.getByText('formatLegacyFilenamesButton')).toBeInTheDocument();
        expect(screen.getByText('deleteLegacyDataButton')).toBeInTheDocument();
        expect(screen.getByText('exportDatabase')).toBeInTheDocument();
        expect(screen.getByText('importDatabase')).toBeInTheDocument();
        expect(screen.getByText('mergeDatabase')).toBeInTheDocument();
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

    it('should handle merge flow', async () => {
        const user = userEvent.setup();
        render(<DatabaseSettings {...defaultProps} />);

        await user.click(screen.getByText('mergeDatabase'));
        expect(screen.getByText('mergeDatabaseWarning')).toBeInTheDocument();

        const file = new File(['db'], 'merge.db', { type: 'application/octet-stream' });
        const inputs = document.querySelectorAll('input[type="file"]');
        const mergeInput = inputs[inputs.length - 1] as HTMLInputElement;
        await user.upload(mergeInput, file);
        await waitFor(() => {
            expect(defaultProps.onPreviewMergeDatabase).toHaveBeenCalledWith(file);
        });
        expect(screen.getByText('mergeDatabasePreviewResults')).toBeInTheDocument();

        const buttons = screen.getAllByRole('button', { name: 'mergeDatabase' });
        await user.click(buttons[buttons.length - 1]);

        expect(defaultProps.onMergeDatabase).toHaveBeenCalledWith(file);
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

    it('should toggle thumbnail and author file switches', async () => {
        const user = userEvent.setup();
        render(<DatabaseSettings {...defaultProps} />);

        const thumbnailSwitch = screen.getByLabelText(/moveThumbnailsToVideoFolderOff/i);
        await user.click(thumbnailSwitch);
        expect(defaultProps.onMoveThumbnailsToVideoFolderChange).toHaveBeenCalledWith(true);

        const authorSwitch = screen.getByLabelText(/saveAuthorFilesToCollectionOff/i);
        await user.click(authorSwitch);
        expect(defaultProps.onSaveAuthorFilesToCollectionChange).toHaveBeenCalledWith(true);
    });

    it('should clear the selected import file when a non-db file is chosen', async () => {
        const user = userEvent.setup();
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });
        render(<DatabaseSettings {...defaultProps} />);

        await user.click(screen.getByText('importDatabase'));
        const validFile = new File(['db'], 'valid.db', { type: 'application/octet-stream' });
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        await user.upload(input, validFile);

        const invalidFile = new File(['bad'], 'bad.txt', { type: 'text/plain' });
        fireEvent.change(input, { target: { files: [invalidFile] } });

        expect(alertSpy).toHaveBeenCalledWith('onlyDbFilesAllowed');
        expect(screen.getByText('selectDatabaseFile')).toBeInTheDocument();
        const buttons = screen.getAllByRole('button', { name: 'importDatabase' });
        expect(buttons[buttons.length - 1]).toBeDisabled();
        alertSpy.mockRestore();
    });

    it('should clear the selected merge file when a non-db file is chosen', async () => {
        const user = userEvent.setup();
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });
        render(<DatabaseSettings {...defaultProps} />);

        await user.click(screen.getByText('mergeDatabase'));
        const validFile = new File(['db'], 'valid-merge.db', { type: 'application/octet-stream' });
        const inputs = document.querySelectorAll('input[type="file"]');
        const mergeInput = inputs[inputs.length - 1] as HTMLInputElement;
        await user.upload(mergeInput, validFile);
        await waitFor(() => {
            expect(defaultProps.onPreviewMergeDatabase).toHaveBeenCalledWith(validFile);
        });

        const invalidFile = new File(['bad'], 'bad.txt', { type: 'text/plain' });
        fireEvent.change(mergeInput, { target: { files: [invalidFile] } });

        expect(alertSpy).toHaveBeenCalledWith('onlyDbFilesAllowed');
        expect(screen.getByText('selectDatabaseFile')).toBeInTheDocument();
        const buttons = screen.getAllByRole('button', { name: 'mergeDatabase' });
        expect(buttons[buttons.length - 1]).toBeDisabled();
        alertSpy.mockRestore();
    });

    it('should open, close and confirm restore modal', async () => {
        const user = userEvent.setup();
        render(<DatabaseSettings {...defaultProps} />);

        await user.click(screen.getByText('restoreFromLastBackup'));
        expect(screen.getByText('restoreFromLastBackupWarning')).toBeInTheDocument();

        const closeButton = screen.getByLabelText('close');
        await user.click(closeButton);
        await waitFor(() => {
            expect(screen.queryByText('restoreFromLastBackupWarning')).not.toBeInTheDocument();
        });

        await user.click(screen.getByText('restoreFromLastBackup'));
        const restoreButtons = screen.getAllByRole('button', { name: 'restoreFromLastBackup' });
        await user.click(restoreButtons[restoreButtons.length - 1]);
        expect(defaultProps.onRestoreFromLastBackup).toHaveBeenCalled();
    });

    it('should show raw backup timestamp when format is invalid', async () => {
        const user = userEvent.setup();
        render(
            <DatabaseSettings
                {...defaultProps}
                lastBackupInfo={{ exists: true, timestamp: 'invalid-format' }}
            />
        );

        await user.click(screen.getByText('restoreFromLastBackup'));
        expect(screen.getByText(/invalid-format/)).toBeInTheDocument();
    });
});
