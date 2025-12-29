import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SortControl from '../SortControl';

// Mock language context
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('SortControl', () => {
    const defaultProps = {
        sortOption: 'dateDesc',
        sortAnchorEl: null,
        onSortClick: vi.fn(),
        onSortClose: vi.fn(),
    };

    it('should render sort button', () => {
        render(<SortControl {...defaultProps} />);
        expect(screen.getByText('sort')).toBeInTheDocument();
    });

    it('should call onSortClick when button is clicked', () => {
        render(<SortControl {...defaultProps} />);
        fireEvent.click(screen.getByRole('button'));
        expect(defaultProps.onSortClick).toHaveBeenCalled();
    });

    it('should render menu when sortAnchorEl is provided', () => {
        // We need a dummy element for anchor
        const dummyElement = document.createElement('button');
        render(<SortControl {...defaultProps} sortAnchorEl={dummyElement} />);

        expect(screen.getByText('dateDesc')).toBeInTheDocument();
        expect(screen.getByText('dateAsc')).toBeInTheDocument();
        expect(screen.getByText('viewsDesc')).toBeInTheDocument();
    });

    it('should call onSortClose with option when menu item is clicked', () => {
        const dummyElement = document.createElement('button');
        render(<SortControl {...defaultProps} sortAnchorEl={dummyElement} />);

        fireEvent.click(screen.getByText('dateAsc'));
        expect(defaultProps.onSortClose).toHaveBeenCalledWith('dateAsc');
    });

    it('should call onSortClose without option when menu backdrop is clicked', () => {
        // Material UI Menu uses a backdrop for closing.
        // Testing this usually involves clicking the backdrop which is outside the menu
        // In RTL, we can simulate 'Escape' key on the menu or click usage of onClose prop directly.
        // But standard way for onClose usually:
        const dummyElement = document.createElement('button');
        render(<SortControl {...defaultProps} sortAnchorEl={dummyElement} />);

        // Pressing escape should close it
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape', code: 'Escape' });
        expect(defaultProps.onSortClose).toHaveBeenCalledWith();
    });
});
