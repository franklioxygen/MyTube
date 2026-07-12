import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TagsList from '../TagsList';

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => {
            if (key === 'tags') return 'Tags';
            if (key === 'all') return 'All';
            if (key === 'allTags') return 'All Tags';
            if (key === 'showAll') return 'Show all';
            return key;
        },
    }),
}));

const theme = createTheme();

const renderTagsList = (props: {
    availableTags?: string[];
    selectedTags?: string[];
    onTagToggle?: (tag: string) => void;
    onItemClick?: () => void;
    videos?: Array<{ tags?: string[] }>;
    linkToAllTags?: boolean;
} = {}) => {
    const onTagToggle = props.onTagToggle ?? vi.fn();
    const onItemClick = props.onItemClick;
    render(
        <MemoryRouter>
            <ThemeProvider theme={theme}>
                <TagsList
                    availableTags={props.availableTags ?? ['tag1', 'tag2', 'tag3']}
                    selectedTags={props.selectedTags ?? []}
                    onTagToggle={onTagToggle}
                    onItemClick={onItemClick}
                    videos={props.videos}
                    linkToAllTags={props.linkToAllTags ?? true}
                />
            </ThemeProvider>
        </MemoryRouter>
    );
    return { onTagToggle, onItemClick };
};

describe('TagsList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when no tags available', () => {
        const { container } = render(
            <MemoryRouter>
                <ThemeProvider theme={theme}>
                    <TagsList availableTags={[]} selectedTags={[]} onTagToggle={vi.fn()} />
                </ThemeProvider>
            </MemoryRouter>
        );

        expect(container.firstChild).toBeNull();
    });

    it('renders tags list with available tags', () => {
        renderTagsList();
        expect(screen.getByText('Tags')).toBeInTheDocument();
        expect(screen.getByText('tag1')).toBeInTheDocument();
        expect(screen.getByText('tag2')).toBeInTheDocument();
        expect(screen.getByText('tag3')).toBeInTheDocument();
    });

    it('highlights selected tags', () => {
        renderTagsList({ selectedTags: ['tag1', 'tag3'] });
        expect(screen.getByText('tag1')).toBeInTheDocument();
        expect(screen.getByText('tag2')).toBeInTheDocument();
        expect(screen.getByText('tag3')).toBeInTheDocument();
    });

    it('calls onTagToggle when tag is clicked', () => {
        const { onTagToggle } = renderTagsList({ availableTags: ['tag1', 'tag2'] });
        fireEvent.click(screen.getByText('tag1'));
        expect(onTagToggle).toHaveBeenCalledWith('tag1');
        expect(onTagToggle).toHaveBeenCalledTimes(1);
    });

    it('links All icon to /tags without toggling collapse', () => {
        const onItemClick = vi.fn();
        renderTagsList({ onItemClick, linkToAllTags: true });
        const allLink = screen.getByRole('link', { name: 'All Tags' });
        expect(allLink).toHaveAttribute('href', '/tags');
        expect(screen.getByText('tag1')).toBeInTheDocument();
        fireEvent.click(allLink);
        expect(onItemClick).toHaveBeenCalledTimes(1);
        // Collapse was not toggled — tags remain visible
        expect(screen.getByText('tag1')).toBeInTheDocument();
    });

    it('toggles collapse when header is clicked', () => {
        renderTagsList({ availableTags: ['tag1', 'tag2'] });
        const header = screen.getByText('Tags');
        expect(screen.getByText('tag1')).toBeInTheDocument();
        fireEvent.click(header);
        expect(screen.getByText('tag1')).toBeInTheDocument();
    });

    it('shows at most 20 tags and a Show all link when catalog is larger', () => {
        const availableTags = Array.from({ length: 25 }, (_, i) => `tag${String(i).padStart(2, '0')}`);
        const videos = availableTags.map((tag) => ({ tags: [tag] }));
        renderTagsList({ availableTags, videos, linkToAllTags: true });

        const chips = screen.getAllByRole('button').filter((el) => el.className.includes('MuiChip-root'));
        expect(chips).toHaveLength(20);
        expect(screen.queryByText('tag24')).not.toBeInTheDocument();
        const showAll = screen.getByRole('link', { name: 'Show all' });
        expect(showAll).toHaveAttribute('href', '/tags');
    });

    it('orders by usage and keeps selected tags outside the top 20 visible', () => {
        const availableTags = Array.from({ length: 22 }, (_, i) => `tag${String(i).padStart(2, '0')}`);
        const videos = [
            ...Array.from({ length: 5 }, () => ({ tags: ['tag21'] })),
            ...Array.from({ length: 19 }, (_, i) => ({ tags: [`tag${String(i).padStart(2, '0')}`] })),
        ];
        renderTagsList({
            availableTags,
            videos,
            selectedTags: ['tag20'],
            linkToAllTags: true,
        });

        expect(screen.getByText('tag21')).toBeInTheDocument();
        expect(screen.getByText('tag20')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Show all' })).toBeInTheDocument();
    });

    it('keeps case-insensitive selected tags outside the top 20 using catalog casing', () => {
        const popularTags = Array.from({ length: 20 }, (_, i) => `tag${String(i).padStart(2, '0')}`);
        const availableTags = [...popularTags, 'Music'];
        const videos = [
            ...popularTags.flatMap((tag) => Array.from({ length: 3 }, () => ({ tags: [tag] }))),
            { tags: ['Music'] },
        ];
        renderTagsList({
            availableTags,
            videos,
            selectedTags: ['music'],
            linkToAllTags: true,
        });

        expect(screen.getByText('Music')).toBeInTheDocument();
        expect(screen.getByText('Music').closest('.MuiChip-root')).toHaveClass('MuiChip-colorPrimary');
    });

    it('hides Show all when 20 or fewer tags', () => {
        const availableTags = Array.from({ length: 20 }, (_, i) => `tag${String(i).padStart(2, '0')}`);
        renderTagsList({ availableTags, linkToAllTags: true });
        expect(screen.queryByRole('link', { name: 'Show all' })).not.toBeInTheDocument();
    });

    it('shows all page-local tags without global links when linkToAllTags is false', () => {
        const availableTags = Array.from({ length: 25 }, (_, i) => `tag${String(i).padStart(2, '0')}`);
        renderTagsList({ availableTags, linkToAllTags: false });

        const chips = screen.getAllByRole('button').filter((el) => el.className.includes('MuiChip-root'));
        expect(chips).toHaveLength(25);
        expect(screen.getByText('tag24')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'All Tags' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Show all' })).not.toBeInTheDocument();
    });
});
