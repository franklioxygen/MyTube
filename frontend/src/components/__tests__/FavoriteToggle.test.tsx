import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FavoriteToggle from '../FavoriteToggle';

describe('FavoriteToggle', () => {
    it('renders an accessible pressed state and calls onToggle', () => {
        const onToggle = vi.fn();
        render(
            <FavoriteToggle
                active
                onToggle={onToggle}
                label="Favorite collection"
                activeLabel="Remove from favorites"
            />,
        );

        const button = screen.getByRole('button', { name: 'Remove from favorites' });
        expect(button).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(button);
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('renders the inactive state', () => {
        render(<FavoriteToggle active={false} onToggle={vi.fn()} label="Favorite author" />);

        const button = screen.getByRole('button', { name: 'Favorite author' });
        expect(button).toHaveAttribute('aria-pressed', 'false');
    });
});
