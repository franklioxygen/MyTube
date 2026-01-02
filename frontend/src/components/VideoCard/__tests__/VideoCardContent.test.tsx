import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoCardContent } from '../VideoCardContent';

// Mock dependencies
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../utils/formatUtils', () => ({
    formatDate: () => '2023-01-01',
    formatRelativeDownloadTime: () => '2023-01-01',
}));


describe('VideoCardContent', () => {
    const mockOnAuthorClick = vi.fn();
    const defaultVideo = {
        id: '1',
        title: 'Test Video Title',
        author: 'Test Author',
        viewCount: 100,
    } as any;

    const defaultCollectionInfo = {
        isFirstInAnyCollection: false,
        firstInCollectionNames: [],
        videoCollections: [],
        firstCollectionId: null,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render video details correctly', () => {
        render(
            <VideoCardContent
                video={defaultVideo}
                collectionInfo={defaultCollectionInfo}
                onAuthorClick={mockOnAuthorClick}
            />
        );

        expect(screen.getByText('Test Video Title')).toBeInTheDocument();
        expect(screen.getByText('Test Author')).toBeInTheDocument();
        expect(screen.getByText('2023-01-01')).toBeInTheDocument();
        expect(screen.getByText('100 views')).toBeInTheDocument();
    });

    it('should handle author click', async () => {
        const user = userEvent.setup();
        render(
            <VideoCardContent
                video={defaultVideo}
                collectionInfo={defaultCollectionInfo}
                onAuthorClick={mockOnAuthorClick}
            />
        );

        await user.click(screen.getByText('Test Author'));
        expect(mockOnAuthorClick).toHaveBeenCalled();
    });

    it('should render collection info if first in collection', () => {
        const collectionInfo = {
            isFirstInAnyCollection: true,
            firstInCollectionNames: ['My Playlist'],
            videoCollections: [],
            firstCollectionId: 'col1',
        };

        render(
            <VideoCardContent
                video={defaultVideo}
                collectionInfo={collectionInfo}
                onAuthorClick={mockOnAuthorClick}
            />
        );

        expect(screen.getByText('My Playlist')).toBeInTheDocument();
        expect(screen.queryByText('Test Video Title')).not.toBeInTheDocument();
    });

    it('should render multiple collections info', () => {
        const collectionInfo = {
            isFirstInAnyCollection: true,
            firstInCollectionNames: ['My Playlist', 'Favorites'],
            videoCollections: [],
            firstCollectionId: 'col1',
        };

        render(
            <VideoCardContent
                video={defaultVideo}
                collectionInfo={collectionInfo}
                onAuthorClick={mockOnAuthorClick}
            />
        );

        expect(screen.getByText('My Playlist')).toBeInTheDocument();
        expect(screen.getByText('+1')).toBeInTheDocument();
    });
});
