import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VideoKebabMenu from '../VideoInfo/VideoKebabMenu';

let mockUserRole = 'admin';

const mockT = vi.fn((key: string) => key);

vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: mockT }),
}));

vi.mock('../../../contexts/AuthContext', () => ({
    useAuth: () => ({ userRole: mockUserRole }),
}));

describe('VideoKebabMenu', () => {
    const anchor = document.createElement('button');
    const onClose = vi.fn();
    const onPlayWith = vi.fn();
    const onShare = vi.fn();
    const onAddToCollection = vi.fn();
    const onDelete = vi.fn();
    const onToggleVisibility = vi.fn();
    const onAddTag = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockUserRole = 'admin';
        document.body.appendChild(anchor);
    });

    it('renders admin actions and wires callbacks through close handlers', () => {
        render(
            <VideoKebabMenu
                kebabMenuAnchor={anchor}
                onClose={onClose}
                onPlayWith={onPlayWith}
                onShare={onShare}
                onAddToCollection={onAddToCollection}
                onDelete={onDelete}
                onToggleVisibility={onToggleVisibility}
                onAddTag={onAddTag}
                video={{ visibility: 1 }}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'playWith' }));
        expect(onPlayWith).toHaveBeenCalledWith(anchor);

        fireEvent.click(screen.getByRole('button', { name: 'share' }));
        expect(onShare).toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'hideVideo' }));
        expect(onToggleVisibility).toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'addToCollection' }));
        expect(onAddToCollection).toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'delete' }));
        expect(onDelete).toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'addTag' }));
        expect(onAddTag).toHaveBeenCalled();

        expect(onClose).toHaveBeenCalledTimes(6);
    });

    it('shows the show-video action for hidden videos and disables delete while deleting', () => {
        render(
            <VideoKebabMenu
                kebabMenuAnchor={anchor}
                onClose={onClose}
                onPlayWith={onPlayWith}
                onShare={onShare}
                onAddToCollection={onAddToCollection}
                onDelete={onDelete}
                isDeleting={true}
                onToggleVisibility={onToggleVisibility}
                video={{ visibility: 0 }}
            />
        );

        expect(screen.getByRole('button', { name: 'showVideo' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'delete' })).toBeDisabled();
    });

    it('hides admin-only actions for visitors', () => {
        mockUserRole = 'visitor';

        render(
            <VideoKebabMenu
                kebabMenuAnchor={anchor}
                onClose={onClose}
                onPlayWith={onPlayWith}
                onShare={onShare}
                onAddToCollection={onAddToCollection}
                onDelete={onDelete}
                onToggleVisibility={onToggleVisibility}
                onAddTag={onAddTag}
                video={{ visibility: 1 }}
            />
        );

        expect(screen.getByRole('button', { name: 'playWith' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'share' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'hideVideo' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'addToCollection' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'delete' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'addTag' })).not.toBeInTheDocument();
    });
});
