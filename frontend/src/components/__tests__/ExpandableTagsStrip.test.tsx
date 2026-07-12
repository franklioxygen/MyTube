import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExpandableTagsStrip from '../ExpandableTagsStrip';

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

const theme = createTheme();

const renderStrip = (
    props: Partial<React.ComponentProps<typeof ExpandableTagsStrip>> & {
        measureOverflow?: (el: HTMLElement) => boolean;
    } = {}
) => {
    const onTagToggle = props.onTagToggle ?? vi.fn();
    render(
        <ThemeProvider theme={theme}>
            <ExpandableTagsStrip
                tags={props.tags ?? ['a', 'b', 'c']}
                selectedTags={props.selectedTags ?? []}
                onTagToggle={onTagToggle}
                measureOverflow={props.measureOverflow}
                maxCollapsedLines={props.maxCollapsedLines}
            />
        </ThemeProvider>
    );
    return { onTagToggle };
};

describe('ExpandableTagsStrip', () => {
    it('renders nothing when there are no tags', () => {
        const { container } = render(
            <ThemeProvider theme={theme}>
                <ExpandableTagsStrip tags={[]} selectedTags={[]} onTagToggle={vi.fn()} />
            </ThemeProvider>
        );
        expect(container.firstChild).toBeNull();
    });

    it('hides expand control when measureOverflow reports no overflow', () => {
        renderStrip({ measureOverflow: () => false });
        expect(screen.queryByRole('button', { name: 'showMoreTags' })).not.toBeInTheDocument();
        expect(screen.getByText('a')).toBeInTheDocument();
    });

    it('shows expand control when measureOverflow reports overflow', () => {
        renderStrip({ measureOverflow: () => true });
        expect(screen.getByRole('button', { name: 'showMoreTags' })).toBeInTheDocument();
    });

    it('expands and collapses via the control', () => {
        renderStrip({ measureOverflow: () => true });
        const toggle = screen.getByRole('button', { name: 'showMoreTags' });
        fireEvent.click(toggle);
        expect(screen.getByRole('button', { name: 'showLessTags' })).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'showLessTags' }));
        expect(screen.getByRole('button', { name: 'showMoreTags' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('calls onTagToggle when a chip is clicked', () => {
        const { onTagToggle } = renderStrip({ measureOverflow: () => false });
        fireEvent.click(screen.getByText('b'));
        expect(onTagToggle).toHaveBeenCalledWith('b');
    });

    it('highlights selected tags case-insensitively', () => {
        renderStrip({
            tags: ['Music', 'Tech'],
            selectedTags: ['music'],
            measureOverflow: () => false,
        });
        expect(screen.getByText('Music').closest('.MuiChip-root')).toHaveClass('MuiChip-colorPrimary');
        expect(screen.getByText('Tech').closest('.MuiChip-root')).not.toHaveClass('MuiChip-colorPrimary');
    });
});
