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

    it('toggles matching suggestions in search', async () => {
        const user = userEvent.setup();
        const onSearchAutoTagsChange = vi.fn();
        render(
            <TagsSettings
                tags={defaultTags}
                onTagsChange={mockOnTagsChange}
                searchAutoTags={false}
                onSearchAutoTagsChange={onSearchAutoTagsChange}
            />
        );

        const toggle = screen.getByRole('switch', { name: 'searchAutoTags' });
        expect(toggle).not.toBeChecked();
        await user.click(toggle);
        expect(onSearchAutoTagsChange).toHaveBeenCalledWith(true);
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

    describe('tag aliases', () => {
        const renderAliases = (tagAliases: Record<string, string> = { song: 'Music' }) => {
            const onTagAliasesChange = vi.fn();
            const onTagAliasInvalid = vi.fn();
            render(
                <TagsSettings
                    tags={['Music', 'Live']}
                    onTagsChange={mockOnTagsChange}
                    tagAliases={tagAliases}
                    onTagAliasesChange={onTagAliasesChange}
                    onTagAliasInvalid={onTagAliasInvalid}
                />
            );
            const addAlias = within(document.getElementById('tagAliases-setting') as HTMLElement)
                .getByRole('button', { name: 'add' });
            return { onTagAliasesChange, onTagAliasInvalid, addAlias };
        };

        it('lists aliases and removes one', async () => {
            const user = userEvent.setup();
            const { onTagAliasesChange } = renderAliases({ song: 'Music', tune: 'Music' });

            const chip = screen.getByText('song → Music').closest('.MuiChip-root') as HTMLElement;
            await user.click(within(chip).getByTestId('CancelIcon'));

            expect(onTagAliasesChange).toHaveBeenCalledWith({ tune: 'Music' });
        });

        it('adds an alias with a cleaned, lowercased name', async () => {
            const user = userEvent.setup();
            const { onTagAliasesChange, addAlias } = renderAliases();

            await user.type(screen.getByLabelText('tagAlias'), ' #Live Show ');
            await user.type(screen.getByLabelText('tagAliasTarget'), 'Live');
            await user.click(addAlias);

            expect(onTagAliasesChange).toHaveBeenCalledWith({ song: 'Music', 'live show': 'Live' });
        });

        it.each([
            ['its own name', 'Music', 'music'],
            ['a target that is an alias', 'audio', 'song'],
            ['a name that is already a target', 'music', 'Live'],
        ])('rejects an alias pointing to %s', async (_, alias, target) => {
            const user = userEvent.setup();
            const { onTagAliasesChange, onTagAliasInvalid, addAlias } = renderAliases();

            await user.type(screen.getByLabelText('tagAlias'), alias);
            await user.type(screen.getByLabelText('tagAliasTarget'), target);
            await user.click(addAlias);

            expect(onTagAliasesChange).not.toHaveBeenCalled();
            expect(onTagAliasInvalid).toHaveBeenCalledTimes(1);
        });
    });
});
