import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UpNextSidebar from '../UpNextSidebar';

// Mock dependencies
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

// Mock mocks
vi.mock('../../VideoCard', () => ({
    default: ({ video, onClick }: any) => (
        <div data-testid={`video-card-${video.id}`} onClick={() => onClick(video)}>
            {video.title}
        </div>
    )
}));

vi.mock('../../../contexts/AuthContext', () => ({
    useAuth: () => ({ userRole: 'admin' })
}));

vi.mock('../../../hooks/useCloudStorageUrl', () => ({
    useCloudStorageUrl: () => 'mock-url'
}));

// Mock formatUtils
vi.mock('../../../utils/formatUtils', () => ({
    formatDate: () => '2023-01-01',
    formatDuration: () => '10:00'
}));

describe('UpNextSidebar', () => {
    const mockOnVideoClick = vi.fn();
    const mockOnAutoPlayNextChange = vi.fn();
    const mockOnAddToCollection = vi.fn();

    const videos = [
        { id: '1', title: 'Video 1', author: 'Author 1', date: '2023-01-01', duration: 'PT10M' },
        { id: '2', title: 'Video 2', author: 'Author 2', date: '2023-01-01', duration: 'PT10M' },
    ] as any[];

    const defaultProps = {
        relatedVideos: videos,
        autoPlayNext: false,
        onAutoPlayNextChange: mockOnAutoPlayNextChange,
        onVideoClick: mockOnVideoClick,
        onAddToCollection: mockOnAddToCollection,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render header', () => {
        render(<UpNextSidebar {...defaultProps} />);
        expect(screen.getByText('upNext')).toBeInTheDocument();
    });

    it('should render list of videos', () => {
        render(<UpNextSidebar {...defaultProps} />);

        expect(screen.getByText('Video 1')).toBeInTheDocument();
        expect(screen.getByText('Video 2')).toBeInTheDocument();
    });

    it('should handle video selection', async () => {
        const user = userEvent.setup();
        render(<UpNextSidebar {...defaultProps} />);

        // The real component renders Card which is clickable. 
        // We are rendering the real component, so we click the card text or card itself.
        // We mocked VideoCard? No, UpNextSidebar doesn't use VideoCard component!
        // It uses internal `SidebarThumbnail` component and MUI `Card`.
        // So the `VideoCard` mock at top of file was useless and misleading. 
        // UpNextSidebar implements its own item rendering.

        await user.click(screen.getByText('Video 1'));
        expect(mockOnVideoClick).toHaveBeenCalledWith('1');
    });
});
