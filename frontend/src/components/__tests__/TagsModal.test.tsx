
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
                failedToSaveTags: 'Failed to save tags',
                tagConflictCaseInsensitive: 'Tag conflict (case-insensitive)',
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
let capturedMutationHandlers: any;

vi.mock('../../hooks/useSettingsMutations', () => ({
    useSettingsMutations: (handlers: any) => {
        capturedMutationHandlers = handlers;
        return {
        saveMutation: mockSaveMutation,
        };
    },
}));

let mockSettings: any = {
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
        capturedMutationHandlers = undefined;
        mockSettings = { tags: ['Tag1', 'Tag2', 'Tag3'] };
    });

    const renderComponent = ({
        open = true,
        videoTags = defaultVideoTags,
        availableTags = defaultAvailableTags,
    }: {
        open?: boolean;
        videoTags?: string[];
        availableTags?: string[];
    } = {}) => {
        const theme = createTheme();
        return render(
            <ThemeProvider theme={theme}>
                <TagsModal
                    open={open}
                    onClose={mockOnClose}
                    videoTags={videoTags}
                    availableTags={availableTags}
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
        renderComponent({ open: false });
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

    it('adds a tag when Enter is pressed', async () => {
        renderComponent();

        const input = screen.getByLabelText('New Tag');
        fireEvent.change(input, { target: { value: 'FromEnter' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(screen.getByText('FromEnter')).toBeInTheDocument();
    });

    it('removes an already selected tag when clicked again', async () => {
        renderComponent();

        fireEvent.click(screen.getByText('Tag1'));
        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            expect(mockOnSave).toHaveBeenCalledWith([]);
        });
    });

    it('clears input and skips when exact duplicate tag is added', () => {
        renderComponent();

        const input = screen.getByLabelText('New Tag') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Tag1' } });
        fireEvent.click(screen.getByText('Add'));

        expect(input.value).toBe('');
        expect(mockShowSnackbar).not.toHaveBeenCalled();
    });

    it('shows error for case-insensitive duplicate in selected tags', () => {
        renderComponent();

        const input = screen.getByLabelText('New Tag');
        fireEvent.change(input, { target: { value: 'tag1' } });
        fireEvent.click(screen.getByText('Add'));

        expect(mockShowSnackbar).toHaveBeenCalledWith('Tag conflict (case-insensitive)', 'error');
    });

    it('shows error for case-insensitive duplicate in global tags', () => {
        renderComponent({ videoTags: [], availableTags: ['Tag1'] });

        const input = screen.getByLabelText('New Tag');
        fireEvent.change(input, { target: { value: 'tag1' } });
        fireEvent.click(screen.getByText('Add'));

        expect(mockShowSnackbar).toHaveBeenCalledWith('Tag conflict (case-insensitive)', 'error');
    });

    it('uses availableTags fallback when global settings tags are invalid', async () => {
        mockSettings = { tags: 'not-an-array' };
        renderComponent({ videoTags: [], availableTags: ['TagA'] });

        expect(screen.getByText('TagA')).toBeInTheDocument();
    });

    it('updates global settings when adding a new tag that is not available globally', async () => {
        renderComponent();

        const input = screen.getByLabelText('New Tag');
        fireEvent.change(input, { target: { value: 'NewGlobalTag' } });
        fireEvent.click(screen.getByText('Add'));

        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            expect(mockSaveMutation.mutateAsync).toHaveBeenCalled();
            const callArg = mockSaveMutation.mutateAsync.mock.calls[0][0];
            expect(callArg.tags).toContain('NewGlobalTag');
            expect(callArg.tags).toContain('Tag1');
        });

        expect(mockOnSave).toHaveBeenCalled();
    });

    it('wires settings mutation message callback to snackbar', () => {
        renderComponent();

        capturedMutationHandlers.setMessage({ text: 'Updated', type: 'success' });

        expect(mockShowSnackbar).toHaveBeenCalledWith('Updated', 'success');
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
