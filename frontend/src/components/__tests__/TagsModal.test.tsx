
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TagsModal from '../TagsModal';

// Mock contexts
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => {
            const translations: Record<string, string> = {
                selectTags: 'Select Tags',
                newTag: 'New Tag',
                add: 'Add',
                tags: 'Tags',
                noTagsAvailable: 'No tags available',
                cancel: 'Cancel',
                save: 'Save',
                saving: 'Saving...',
                failedToSaveTags: 'Failed to save tags'
            };
            return translations[key] || key;
        },
    }),
}));

const mockShowSnackbar = vi.fn();
vi.mock('../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({
        showSnackbar: mockShowSnackbar,
    }),
}));

const mockSaveMutation = {
    mutateAsync: vi.fn(),
};

vi.mock('../../hooks/useSettingsMutations', () => ({
    useSettingsMutations: () => ({
        saveMutation: mockSaveMutation,
    }),
}));

const mockSettings = {
    tags: ['Tag1', 'Tag2', 'Tag3'],
};

vi.mock('../../hooks/useSettings', () => ({
    useSettings: () => ({
        data: mockSettings,
    }),
}));

describe('TagsModal', () => {
    const mockOnClose = vi.fn();
    const mockOnSave = vi.fn();
    const defaultAvailableTags = ['Tag1', 'Tag2', 'Tag3'];
    const defaultVideoTags = ['Tag1'];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderComponent = (open: boolean = true) => {
        const theme = createTheme();
        return render(
            <ThemeProvider theme={theme}>
                <TagsModal
                    open={open}
                    onClose={mockOnClose}
                    videoTags={defaultVideoTags}
                    availableTags={defaultAvailableTags}
                    onSave={mockOnSave}
                />
            </ThemeProvider>
        );
    };

    it('renders correctly when open', () => {
        renderComponent();
        expect(screen.getByText('Select Tags')).toBeInTheDocument();
        expect(screen.getByLabelText('New Tag')).toBeInTheDocument();
        expect(screen.getByText('Tag1')).toBeInTheDocument();
        expect(screen.getByText('Tag2')).toBeInTheDocument();
        expect(screen.getByText('Tag3')).toBeInTheDocument();
        expect(screen.getByText('Save')).toBeInTheDocument();
    });

    it('does not render when closed', () => {
        renderComponent(false);
        expect(screen.queryByText('Select Tags')).not.toBeInTheDocument();
    });

    it('toggles tag selection', async () => {
        renderComponent();

        // Tag2 is initially unselected. Click to select.
        const tag2 = screen.getByText('Tag2');
        fireEvent.click(tag2);

        // We can't easily check internal state, but we can check visual cues if we knew the styles,
        // or check the save action result.
        // For now, let's verify via the save action.
        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            expect(mockOnSave).toHaveBeenCalledWith(['Tag1', 'Tag2']);
        });
    });

    it('adds a new tag', async () => {
        renderComponent();

        const input = screen.getByLabelText('New Tag');
        fireEvent.change(input, { target: { value: 'NewTag' } });
        fireEvent.click(screen.getByText('Add'));

        expect(screen.getByText('NewTag')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Save'));
        await waitFor(() => {
            expect(mockOnSave).toHaveBeenCalledWith(['Tag1', 'NewTag']);
        });
    });

    it('updates global settings when adding a new tag that is not available globally', async () => {
        renderComponent();

        // 'NewGlobalTag' is not in mockSettings (existingGlobalTag1, existingGlobalTag2)
        // nor in defaultAvailableTags (Tag1, Tag2, Tag3)
        const input = screen.getByLabelText('New Tag');
        fireEvent.change(input, { target: { value: 'NewGlobalTag' } });
        fireEvent.click(screen.getByText('Add'));

        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            // It should try to save the new global settings
            expect(mockSaveMutation.mutateAsync).toHaveBeenCalled();

            // Verify the argument to mutateAsync contains the new tag merged with existing ones
            // existing: existingGlobalTag1, existingGlobalTag2
            // new: NewGlobalTag
            const callArg = mockSaveMutation.mutateAsync.mock.calls[0][0];
            expect(callArg.tags).toContain('NewGlobalTag');
            expect(callArg.tags).toContain('Tag1');
        });

        expect(mockOnSave).toHaveBeenCalled();
    });

    it('calls onClose when Cancel is clicked', () => {
        renderComponent();
        fireEvent.click(screen.getByText('Cancel'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('handles save error gracefully', async () => {
        mockOnSave.mockRejectedValueOnce(new Error('Save failed'));
        renderComponent();

        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            expect(mockShowSnackbar).toHaveBeenCalledWith('Save failed', 'error');
        });

        // setSaving should be false (button re-enabled) - checking text is back to 'Save'
        expect(screen.getByText('Save')).toBeInTheDocument();
    });
});
