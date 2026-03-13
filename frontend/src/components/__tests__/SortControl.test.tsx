import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SortControl from '../SortControl';

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('SortControl', () => {
    const sortOptions = [
        'dateDesc',
        'dateAsc',
        'viewsDesc',
        'viewsAsc',
        'nameAsc',
        'videoDateDesc',
        'videoDateAsc',
        'random',
    ] as const;

    const renderControl = (sortOption: string, sortAnchorEl: HTMLElement | null = null) => {
        const onSortClick = vi.fn();
        const onSortClose = vi.fn();

        render(
            <SortControl
                sortOption={sortOption}
                sortAnchorEl={sortAnchorEl}
                onSortClick={onSortClick}
                onSortClose={onSortClose}
            />
        );

        return { onSortClick, onSortClose };
    };

    it('should render sort button', () => {
        renderControl('dateDesc');
        expect(screen.getByText('sort')).toBeInTheDocument();
    });

    it('should call onSortClick when button is clicked', () => {
        const { onSortClick } = renderControl('dateDesc');
        fireEvent.click(screen.getByRole('button'));
        expect(onSortClick).toHaveBeenCalled();
    });

    it('should call onSortClose without option when menu is closed', async () => {
        const dummyElement = document.createElement('button');
        const { onSortClose } = renderControl('dateDesc', dummyElement);

        fireEvent.keyDown(await screen.findByRole('menu'), { key: 'Escape', code: 'Escape' });
        expect(onSortClose).toHaveBeenCalledWith();
    });

    it.each(sortOptions)('should mark %s as selected and call onSortClose on click', async (option) => {
        const dummyElement = document.createElement('button');
        const { onSortClose } = renderControl(option, dummyElement);

        const menuItem = await screen.findByRole('menuitem', { name: option });
        expect(menuItem).toHaveClass('Mui-selected');

        fireEvent.click(menuItem);
        expect(onSortClose).toHaveBeenCalledWith(option);
    });
});
