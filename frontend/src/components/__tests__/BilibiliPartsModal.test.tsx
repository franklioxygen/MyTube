import { createTheme, ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BilibiliPartsModal from '../BilibiliPartsModal';

// Mock contexts
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, options?: any) => {
            if (options && options.count) {
                return `${key}_${options.count}`;
            }
            return key;
        },
    }),
}));

describe('BilibiliPartsModal', () => {
    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        videosNumber: 10,
        videoTitle: 'Test Video',
        onDownloadAll: vi.fn(),
        onDownloadCurrent: vi.fn(),
        isLoading: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderModal = (props = {}) => {
        const theme = createTheme();
        render(
            <ThemeProvider theme={theme}>
                <BilibiliPartsModal {...defaultProps} {...props} />
            </ThemeProvider>
        );
    };

    it('renders playlist specific text when type is playlist', () => {
        renderModal({ type: 'playlist' });

        // Header text: should use 'playlistDetected' key
        expect(screen.getByText('playlistDetected')).toBeInTheDocument();

        // Description text: should use 'playlistHasVideos' key with count
        expect(screen.getByText('playlistHasVideos_10')).toBeInTheDocument();

        // Download all text description: should use 'downloadPlaylistAndCreateCollection' key
        expect(screen.getByText('downloadPlaylistAndCreateCollection')).toBeInTheDocument();

        // Helper text for collection name input: should use 'allVideosAddedToCollection' key
        // TextField helper text sometimes can be tricky to find by exact text if it's broken up, but getByText usually works.
        // There might be multiple instances if I'm not careful, but here it should be unique or just exist.
        expect(screen.getByText('allVideosAddedToCollection')).toBeInTheDocument();
    });

    it('renders default text when type is parts', () => {
        renderModal({ type: 'parts' });

        expect(screen.getByText('multiPartVideoDetected')).toBeInTheDocument();
        expect(screen.getByText('videoHasParts_10')).toBeInTheDocument();
        expect(screen.getByText('wouldYouLikeToDownloadAllParts')).toBeInTheDocument();
        expect(screen.getByText('allPartsAddedToCollection')).toBeInTheDocument();
    });
});
