import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VideoKebabMenuButtons from '../VideoInfo/VideoKebabMenuButtons';

vi.mock('../VideoInfo/VideoKebabMenu', () => ({
    default: ({ kebabMenuAnchor, onClose, onDelete, video }: any) => (
        <div data-testid="mock-kebab-menu">
            <span data-testid="anchor-tag">{kebabMenuAnchor.tagName}</span>
            <span data-testid="delete-enabled">{String(Boolean(onDelete))}</span>
            <span data-testid="video-visibility">{String(video?.visibility ?? '')}</span>
            <button onClick={onClose}>close-menu</button>
        </div>
    )
}));

describe('VideoKebabMenuButtons', () => {
    const baseProps = {
        onPlayWith: vi.fn(),
        onShare: vi.fn(),
        onAddToCollection: vi.fn(),
        onDelete: vi.fn(),
        onToggleVisibility: vi.fn(),
        onAddTag: vi.fn(),
        video: { visibility: 1 },
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('opens the kebab menu and passes the anchor and props through', async () => {
        render(<VideoKebabMenuButtons {...baseProps} />);

        fireEvent.click(screen.getByRole('button', { name: /more actions/i }));

        expect(await screen.findByTestId('mock-kebab-menu')).toBeInTheDocument();
        expect(screen.getByTestId('anchor-tag')).toHaveTextContent('BUTTON');
        expect(screen.getByTestId('delete-enabled')).toHaveTextContent('true');
        expect(screen.getByTestId('video-visibility')).toHaveTextContent('1');

        fireEvent.click(screen.getByText('close-menu'));

        await waitFor(() => {
            expect(screen.queryByTestId('mock-kebab-menu')).not.toBeInTheDocument();
        });
    });

    it('closes the open menu when the window scrolls', async () => {
        render(<VideoKebabMenuButtons {...baseProps} />);

        fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
        expect(await screen.findByTestId('mock-kebab-menu')).toBeInTheDocument();

        act(() => {
            window.dispatchEvent(new Event('scroll'));
        });

        await waitFor(() => {
            expect(screen.queryByTestId('mock-kebab-menu')).not.toBeInTheDocument();
        });
    });
});
