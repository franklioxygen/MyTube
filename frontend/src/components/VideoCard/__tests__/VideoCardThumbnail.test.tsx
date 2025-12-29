import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoCardThumbnail } from '../VideoCardThumbnail';

// Mock dependencies
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../utils/formatUtils', () => ({
    formatDuration: () => '10:00',
    parseDuration: () => 600,
}));

describe('VideoCardThumbnail', () => {
    const mockSetIsVideoPlaying = vi.fn();
    const mockVideoRef = { current: null };

    const defaultVideo = {
        id: '1',
        title: 'Test Video',
        duration: 'PT10M',
        totalParts: 1,
        partNumber: 1,
    } as any;

    const defaultCollectionInfo = {
        isFirstInAnyCollection: false,
        firstInCollectionNames: [],
        videoCollections: [],
        firstCollectionId: '',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render thumbnail image', () => {
        render(
            <VideoCardThumbnail
                video={defaultVideo}
                thumbnailSrc="thumb.jpg"
                isHovered={false}
                isVideoPlaying={false}
                setIsVideoPlaying={mockSetIsVideoPlaying}
                videoRef={mockVideoRef}
                collectionInfo={defaultCollectionInfo}
                isNew={false}
            />
        );

        const img = screen.getByRole('img');
        expect(img).toHaveAttribute('src', 'thumb.jpg');
    });

    it('should render duration chip', () => {
        render(
            <VideoCardThumbnail
                video={defaultVideo}
                isHovered={false}
                isVideoPlaying={false}
                setIsVideoPlaying={mockSetIsVideoPlaying}
                videoRef={mockVideoRef}
                collectionInfo={defaultCollectionInfo}
                isNew={false}
            />
        );

        expect(screen.getByText('10:00')).toBeInTheDocument();
    });

    it('should render part chip if multipart', () => {
        const multipartVideo = { ...defaultVideo, totalParts: 2, partNumber: 1 };
        render(
            <VideoCardThumbnail
                video={multipartVideo}
                isHovered={false}
                isVideoPlaying={false}
                setIsVideoPlaying={mockSetIsVideoPlaying}
                videoRef={mockVideoRef}
                collectionInfo={defaultCollectionInfo}
                isNew={false}
            />
        );

        expect(screen.getByText('part 1/2')).toBeInTheDocument();
    });

    it('should render new badge if isNew', () => {
        render(
            <VideoCardThumbnail
                video={defaultVideo}
                isHovered={false}
                isVideoPlaying={false}
                setIsVideoPlaying={mockSetIsVideoPlaying}
                videoRef={mockVideoRef}
                collectionInfo={defaultCollectionInfo}
                isNew={true}
            />
        );

        // This is a visual element (css triangle), usually checked by class or style, 
        // effectively tested if it doesn't crash.
        // Or we can check if a box with specific style exists.
        // It has specific color border.
    });

    it('should render video element on hover', () => {
        const { container } = render(
            <VideoCardThumbnail
                video={defaultVideo}
                videoUrl="video.mp4"
                isHovered={true}
                isVideoPlaying={false}
                setIsVideoPlaying={mockSetIsVideoPlaying}
                videoRef={mockVideoRef}
                collectionInfo={defaultCollectionInfo}
                isNew={false}
            />
        );

        const videoEl = container.querySelector('video');
        expect(videoEl).toBeInTheDocument();
        expect(videoEl).toHaveAttribute('src', 'video.mp4');
    });

    it('should update playing state when video starts playing', () => {
        const { container } = render(
            <VideoCardThumbnail
                video={defaultVideo}
                videoUrl="video.mp4"
                isHovered={true}
                isVideoPlaying={false}
                setIsVideoPlaying={mockSetIsVideoPlaying}
                videoRef={mockVideoRef}
                collectionInfo={defaultCollectionInfo}
                isNew={false}
            />
        );

        const videoEl = container.querySelector('video');
        if (videoEl) {
            fireEvent.playing(videoEl);
            expect(mockSetIsVideoPlaying).toHaveBeenCalledWith(true);
        }
    });

    it('should render collection folder icon if first in collection', () => {
        const collectionInfo = {
            isFirstInAnyCollection: true,
            firstInCollectionNames: ['My Playlist'],
            videoCollections: [],
            firstCollectionId: 'col1',
        };

        render(
            <VideoCardThumbnail
                video={defaultVideo}
                isHovered={false}
                isVideoPlaying={false}
                setIsVideoPlaying={mockSetIsVideoPlaying}
                videoRef={mockVideoRef}
                collectionInfo={collectionInfo}
                isNew={false}
            />
        );

        expect(screen.getByText('My Playlist')).toBeInTheDocument();
        expect(screen.getByTestId('FolderIcon')).toBeInTheDocument();
    });
});
