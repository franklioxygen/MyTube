import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FileOrganizationSettings from '../FileOrganizationSettings';

// Mock language context
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('FileOrganizationSettings', () => {
    const defaultProps = {
        onFormatFilenames: vi.fn(),
        onCleanupAuthorCollections: vi.fn(),
        isSaving: false,
        moveSubtitlesToVideoFolder: false,
        onMoveSubtitlesToVideoFolderChange: vi.fn(),
        moveThumbnailsToVideoFolder: false,
        onMoveThumbnailsToVideoFolderChange: vi.fn(),
        authorOrganizationMode: 'root' as const,
        onAuthorOrganizationModeChange: vi.fn(),
        downloadFilenameMode: 'legacy' as const,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render all sections and buttons', () => {
        render(<FileOrganizationSettings {...defaultProps} />);

        expect(screen.getByText('moveSubtitlesToVideoFolder')).toBeInTheDocument();
        expect(screen.getByText('moveThumbnailsToVideoFolder')).toBeInTheDocument();
        expect(screen.getByText('authorOrganizationModeRecommendation')).toBeInTheDocument();
        expect(screen.getByText('formatLegacyFilenamesButton')).toBeInTheDocument();
    });

    it('should call onFormatFilenames when clicked', async () => {
        const user = userEvent.setup();
        render(<FileOrganizationSettings {...defaultProps} />);

        await user.click(screen.getByText('formatLegacyFilenamesButton'));
        expect(defaultProps.onFormatFilenames).toHaveBeenCalled();
    });

    it('should render switches for moving files', async () => {
        const user = userEvent.setup();
        render(<FileOrganizationSettings {...defaultProps} />);

        const subtitleSwitch = screen.getByLabelText(/moveSubtitlesToVideoFolderOff/i);
        await user.click(subtitleSwitch);
        expect(defaultProps.onMoveSubtitlesToVideoFolderChange).toHaveBeenCalledWith(true);
    });

    it('should toggle thumbnail switch and author organization mode', async () => {
        const user = userEvent.setup();
        render(<FileOrganizationSettings {...defaultProps} />);

        const thumbnailSwitch = screen.getByLabelText(/moveThumbnailsToVideoFolderOff/i);
        await user.click(thumbnailSwitch);
        expect(defaultProps.onMoveThumbnailsToVideoFolderChange).toHaveBeenCalledWith(true);

        await user.click(
            screen.getByRole('radio', { name: /authorOrganizationModeAuthorFolderOnly/i })
        );
        expect(defaultProps.onAuthorOrganizationModeChange).toHaveBeenCalledWith('author_folder_only');
    });

    it('should show template note for template naming mode', () => {
        render(
            <FileOrganizationSettings
                {...defaultProps}
                downloadFilenameMode="template"
            />
        );

        expect(screen.getByText('authorOrganizationModeTemplateNote')).toBeInTheDocument();
    });

    it('should show author collection cleanup action in folder-only mode', async () => {
        const user = userEvent.setup();
        render(
            <FileOrganizationSettings
                {...defaultProps}
                authorOrganizationMode="author_folder_only"
            />
        );

        expect(screen.getByText('cleanupAuthorCollections')).toBeInTheDocument();
        expect(screen.getByText('cleanupAuthorCollectionsDescription')).toBeInTheDocument();
        await user.click(screen.getByText('cleanupAuthorCollectionsButton'));
        expect(defaultProps.onCleanupAuthorCollections).toHaveBeenCalled();
    });

    it('should disable every control while a save is in flight', () => {
        render(<FileOrganizationSettings {...defaultProps} isSaving />);

        expect(screen.getByLabelText(/moveSubtitlesToVideoFolderOff/i)).toBeDisabled();
        expect(screen.getByLabelText(/moveThumbnailsToVideoFolderOff/i)).toBeDisabled();
        expect(screen.getByText('formatLegacyFilenamesButton').closest('button')).toBeDisabled();
    });
});
