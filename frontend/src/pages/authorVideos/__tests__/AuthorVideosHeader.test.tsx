import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AuthorVideosHeader from '../AuthorVideosHeader';

vi.mock('../../../components/FavoriteToggle', () => ({ default: () => null }));
vi.mock('../../../components/SortControl', () => ({ default: () => <div data-testid="sort-control" /> }));

const props = {
    authorDisplayName: 'Carol',
    unknownAuthorLabel: 'Unknown',
    avatarUrl: null,
    videoCountLabel: '1 video',
    hasVideos: true,
    canManageVideos: true,
    isBusy: false,
    addTagsLabel: 'addTags',
    createCollectionTooltip: 'createCollection',
    deleteAuthorLabel: 'deleteAuthor',
    sortOption: 'dateDesc',
    sortAnchorEl: null,
    onSortClick: vi.fn(),
    onSortClose: vi.fn(),
    onToggleSidebar: vi.fn(),
    onOpenTagsModal: vi.fn(),
    onOpenCreateCollectionModal: vi.fn(),
    onOpenDeleteModal: vi.fn(),
    isFavorite: false,
    onToggleFavorite: vi.fn(),
    favoriteLabel: 'favorite',
    unfavoriteLabel: 'unfavorite',
    favoriteDisabled: false,
};

const actionLabels = ['add tags to author', 'create collection from author', 'delete author'];

describe('AuthorVideosHeader', () => {
    it('offers tag, collection and delete actions when the author has videos here', () => {
        render(<AuthorVideosHeader {...props} />);
        for (const label of actionLabels) expect(screen.getByLabelText(label)).toBeInTheDocument();
        expect(screen.getByTestId('sort-control')).toBeInTheDocument();
    });

    it('keeps sorting but drops those actions for an author with only remote videos', () => {
        render(<AuthorVideosHeader {...props} canManageVideos={false} />);
        for (const label of actionLabels) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
        expect(screen.getByTestId('sort-control')).toBeInTheDocument();
    });
});
