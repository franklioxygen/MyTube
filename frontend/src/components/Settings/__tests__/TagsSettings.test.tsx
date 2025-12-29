import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TagsSettings from '../TagsSettings';

// Mock language context
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('TagsSettings', () => {
    const mockOnTagsChange = vi.fn();
    const defaultTags = ['React', 'TypeScript'];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render existing tags', () => {
        render(<TagsSettings tags={defaultTags} onTagsChange={mockOnTagsChange} />);

        expect(screen.getByText('React')).toBeInTheDocument();
        expect(screen.getByText('TypeScript')).toBeInTheDocument();
        expect(screen.getByLabelText('newTag')).toBeInTheDocument();
    });

    it('should add new tag via button', async () => {
        const user = userEvent.setup();
        render(<TagsSettings tags={defaultTags} onTagsChange={mockOnTagsChange} />);

        await user.type(screen.getByLabelText('newTag'), 'Vitest');
        await user.click(screen.getByText('add'));

        expect(mockOnTagsChange).toHaveBeenCalledWith([...defaultTags, 'Vitest']);
    });

    it('should add new tag via Enter key', async () => {
        const user = userEvent.setup();
        render(<TagsSettings tags={defaultTags} onTagsChange={mockOnTagsChange} />);

        await user.type(screen.getByLabelText('newTag'), 'Jest{Enter}');

        expect(mockOnTagsChange).toHaveBeenCalledWith([...defaultTags, 'Jest']);
    });

    it('should delete tag', async () => {
        const user = userEvent.setup();
        render(<TagsSettings tags={defaultTags} onTagsChange={mockOnTagsChange} />);

        // Find the delete button within the specific chip
        // MUI Chip delete icon usually implies userEvent on the chip or delete icon
        const chip = screen.getByText('React').closest('.MuiChip-root');
        if (chip) {
            const deleteIcon = within(chip as HTMLElement).getByTestId('CancelIcon');
            // Note: in default view_file output, we saw onDelete prop on Chip. 
            // MUI renders CancelIcon by default for onDelete. 
            // We can click the delete icon.
            await user.click(deleteIcon);
        }

        expect(mockOnTagsChange).toHaveBeenCalledWith(['TypeScript']);
    });

    it('should prevent duplicate tags', async () => {
        const user = userEvent.setup();
        render(<TagsSettings tags={defaultTags} onTagsChange={mockOnTagsChange} />);

        await user.type(screen.getByLabelText('newTag'), 'React');
        await user.click(screen.getByText('add'));

        expect(mockOnTagsChange).not.toHaveBeenCalled();
    });
});
