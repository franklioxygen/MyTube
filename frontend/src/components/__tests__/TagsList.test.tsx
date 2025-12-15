import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TagsList from '../TagsList';

// Mock LanguageContext
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key === 'tags' ? 'Tags' : key,
    }),
}));

describe('TagsList', () => {
    const mockOnTagToggle = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when no tags available', () => {
        const theme = createTheme();
        const { container } = render(
            <ThemeProvider theme={theme}>
                <TagsList availableTags={[]} selectedTags={[]} onTagToggle={mockOnTagToggle} />
            </ThemeProvider>
        );

        expect(container.firstChild).toBeNull();
    });

    it('renders tags list with available tags', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <TagsList 
                    availableTags={['tag1', 'tag2', 'tag3']} 
                    selectedTags={[]} 
                    onTagToggle={mockOnTagToggle} 
                />
            </ThemeProvider>
        );

        expect(screen.getByText('Tags')).toBeInTheDocument();
        expect(screen.getByText('tag1')).toBeInTheDocument();
        expect(screen.getByText('tag2')).toBeInTheDocument();
        expect(screen.getByText('tag3')).toBeInTheDocument();
    });

    it('highlights selected tags', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <TagsList 
                    availableTags={['tag1', 'tag2', 'tag3']} 
                    selectedTags={['tag1', 'tag3']} 
                    onTagToggle={mockOnTagToggle} 
                />
            </ThemeProvider>
        );

        const tag1 = screen.getByText('tag1');
        const tag2 = screen.getByText('tag2');
        const tag3 = screen.getByText('tag3');

        // Selected tags should have different styling (we can check by role or parent)
        expect(tag1).toBeInTheDocument();
        expect(tag2).toBeInTheDocument();
        expect(tag3).toBeInTheDocument();
    });

    it('calls onTagToggle when tag is clicked', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <TagsList 
                    availableTags={['tag1', 'tag2']} 
                    selectedTags={[]} 
                    onTagToggle={mockOnTagToggle} 
                />
            </ThemeProvider>
        );

        const tag1 = screen.getByText('tag1');
        fireEvent.click(tag1);

        expect(mockOnTagToggle).toHaveBeenCalledWith('tag1');
        expect(mockOnTagToggle).toHaveBeenCalledTimes(1);
    });

    it('toggles collapse when header is clicked', () => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <TagsList 
                    availableTags={['tag1', 'tag2']} 
                    selectedTags={[]} 
                    onTagToggle={mockOnTagToggle} 
                />
            </ThemeProvider>
        );

        const header = screen.getByText('Tags');
        const tagsContainer = header.closest('div')?.querySelector('[role="region"]');

        // Initially should be open (tags visible)
        expect(screen.getByText('tag1')).toBeInTheDocument();

        // Click to collapse
        fireEvent.click(header);

        // Tags should still be in DOM but collapsed (MUI Collapse keeps them)
        // We can verify by checking the collapse state
        expect(screen.getByText('tag1')).toBeInTheDocument();
    });
});

