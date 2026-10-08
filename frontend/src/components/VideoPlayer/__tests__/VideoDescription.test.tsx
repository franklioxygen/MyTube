import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VideoDescription from '../VideoInfo/VideoDescription';

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

const chapters = '0:00 - Peter Hoffmann\n1:55 - Grobi Merz\n40:14 - Wolfgang Josef Koch';

describe('VideoDescription', () => {
    it('jumps the player to a timestamp when it is clicked', () => {
        const onSeek = vi.fn();
        render(<VideoDescription description={chapters} duration="45:00" onSeek={onSeek} />);

        fireEvent.click(screen.getByRole('button', { name: '1:55' }));

        expect(onSeek).toHaveBeenCalledWith(115);
        // The text around the timestamps is still shown.
        expect(screen.getByText(/Grobi Merz/)).toBeInTheDocument();
    });

    it('leaves timestamps past the end of the video as text', () => {
        render(<VideoDescription description={chapters} duration={600} onSeek={vi.fn()} />);

        expect(screen.getByRole('button', { name: '1:55' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '40:14' })).not.toBeInTheDocument();
    });

    it('keeps timestamps out of the tab order while the description is clamped', () => {
        // jsdom has no layout, so report the description as overflowing.
        const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(120);
        const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60);
        try {
            render(<VideoDescription description={chapters} duration="45:00" onSeek={vi.fn()} />);

            expect(screen.getByRole('button', { name: '1:55' })).toHaveAttribute('tabindex', '-1');

            fireEvent.click(screen.getByRole('button', { name: 'expand' }));

            expect(screen.getByRole('button', { name: '1:55' })).not.toHaveAttribute('tabindex');
        } finally {
            scrollHeight.mockRestore();
            clientHeight.mockRestore();
        }
    });

    it('shows timestamps as plain text when there is no player to seek', () => {
        render(<VideoDescription description={chapters} />);

        expect(screen.queryByRole('button', { name: '1:55' })).not.toBeInTheDocument();
        expect(screen.getByText(/1:55 - Grobi Merz/)).toBeInTheDocument();
    });
});
