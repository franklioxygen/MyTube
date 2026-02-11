import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewMode } from '../../hooks/useViewMode';
import { Collection, Video } from '../../types';
import { VideoGrid } from '../VideoGrid';

// Mock components
vi.mock('../VideoCard', () => ({
    default: ({ video }: any) => <div data-testid={`video-card-${video.id}`}>{video.title}</div>
}));

vi.mock('../CollectionCard', () => ({
    default: ({ collection }: any) => <div data-testid={`collection-card-${collection.id}`}>{collection.name}</div>
}));

// Mock react-virtuoso
vi.mock('react-virtuoso', () => ({
    VirtuosoGrid: ({ data, itemContent, components }: any) => {
        const ListComponent = components?.List || 'div';
        const ItemComponent = components?.Item || 'div';
        return (
        <div data-testid="virtuoso-grid">
            <ListComponent data-testid="virtuoso-list" style={{}}>
                {data.map((item: any, index: number) => (
                    <ItemComponent
                        key={item.id || index}
                        data-testid={`virtuoso-item-${index}`}
                        style={{}}
                    >
                        {itemContent(index, item)}
                    </ItemComponent>
                ))}
            </ListComponent>
        </div>
        );
    }
}));

describe('VideoGrid', () => {
    const mockVideos: Video[] = [
        { id: '1', title: 'Video 1' } as Video,
        { id: '2', title: 'Video 2' } as Video,
    ];

    const mockCollections: Collection[] = [
        { id: 'c1', name: 'Collection 1', videos: ['1'] } as Collection
    ];

    const defaultProps = {
        videos: mockVideos,
        sortedVideos: mockVideos,
        displayedVideos: mockVideos,
        collections: mockCollections,
        viewMode: 'all-videos' as ViewMode,
        infiniteScroll: false,
        gridProps: { xs: 12, sm: 6, lg: 4, xl: 3 },
        onDeleteVideo: vi.fn(),
    };

    it('should render correct number of video cards in non-virtualized mode', () => {
        render(<VideoGrid {...defaultProps} />);

        expect(screen.getByTestId('video-card-1')).toBeInTheDocument();
        expect(screen.getByTestId('video-card-2')).toBeInTheDocument();
    });

    it('should render virtuoso grid when infiniteScroll is true', () => {
        render(<VideoGrid {...defaultProps} infiniteScroll={true} />);

        expect(screen.getByTestId('virtuoso-grid')).toBeInTheDocument();
        expect(screen.getByTestId('video-card-1')).toBeInTheDocument();
    });

    it('should render collection cards in collections mode', () => {
        // In collections mode, video 1 should be grouped into collection c1
        render(<VideoGrid {...defaultProps} viewMode="collections" />);

        expect(screen.getByTestId('collection-card-c1')).toBeInTheDocument();
        // Video 2 is not in a collection, so it should render as video card if the logic allows it.
        // Based on code: "Fall back ... render VideoCard"
        expect(screen.getByTestId('video-card-2')).toBeInTheDocument();
    });

    it('should render collection cards in virtualized collections mode', () => {
        render(<VideoGrid {...defaultProps} viewMode="collections" infiniteScroll={true} />);

        expect(screen.getByTestId('virtuoso-grid')).toBeInTheDocument();
        expect(screen.getByTestId('collection-card-c1')).toBeInTheDocument();
    });

    it('should ignore duplicate first-video collections in grouping map', () => {
        const duplicatedCollections: Collection[] = [
            { id: 'c1', name: 'Collection 1', videos: ['1'] } as Collection,
            { id: 'c2', name: 'Collection 2', videos: ['1'] } as Collection,
        ];

        render(
            <VideoGrid
                {...defaultProps}
                viewMode="collections"
                infiniteScroll={true}
                collections={duplicatedCollections}
            />
        );

        expect(screen.getByTestId('collection-card-c1')).toBeInTheDocument();
        expect(screen.queryByTestId('collection-card-c2')).not.toBeInTheDocument();
    });
});
