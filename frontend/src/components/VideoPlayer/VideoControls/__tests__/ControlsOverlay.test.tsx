import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ControlsOverlay from '../ControlsOverlay';

// Mock dependencies
vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('@mui/material', async () => {
    const actual = await vi.importActual('@mui/material');
    return {
        ...actual,
        useMediaQuery: () => false,
    };
});

// Mock child components to isolate ControlsOverlay testing
vi.mock('../ProgressBar', () => ({
    default: () => <div data-testid="ProgressBar" />,
}));
vi.mock('../VolumeControl', () => ({
    default: () => <div data-testid="VolumeControl" />,
}));
vi.mock('../SubtitleControl', () => ({
    default: ({ showOnMobile }: { showOnMobile?: boolean }) => (
        <div data-testid={`SubtitleControl-${showOnMobile ? 'mobile' : 'desktop'}`} />
    ),
}));
vi.mock('../FullscreenControl', () => ({
    default: () => <div data-testid="FullscreenControl" />,
}));
vi.mock('../LoopControl', () => ({
    default: () => <div data-testid="LoopControl" />,
}));
vi.mock('../PlaybackControls', () => ({
    default: () => <div data-testid="PlaybackControls" />,
}));

describe('ControlsOverlay', () => {
    const defaultProps = {
        isFullscreen: false,
        controlsVisible: true,
        isPlaying: false,
        currentTime: 0,
        duration: 100,
        isDragging: false,
        volume: 1,
        showVolumeSlider: false,
        volumeSliderRef: { current: null },
        subtitles: [],
        subtitlesEnabled: false,
        isLooping: false,
        subtitleMenuAnchor: null,
        onPlayPause: vi.fn(),
        onSeek: vi.fn(),
        onProgressChange: vi.fn(),
        onProgressChangeCommitted: vi.fn(),
        onProgressMouseDown: vi.fn(),
        onVolumeChange: vi.fn(),
        onVolumeClick: vi.fn(),
        onVolumeMouseEnter: vi.fn(),
        onVolumeMouseLeave: vi.fn(),
        onSliderMouseEnter: vi.fn(),
        onSliderMouseLeave: vi.fn(),
        onSubtitleClick: vi.fn(),
        onCloseSubtitleMenu: vi.fn(),
        onSelectSubtitle: vi.fn(),
        onToggleFullscreen: vi.fn(),
        onToggleLoop: vi.fn(),
        onControlsMouseEnter: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render all controls when visible', () => {
        render(<ControlsOverlay {...defaultProps} />);

        expect(screen.getByTestId('ProgressBar')).toBeInTheDocument();
        expect(screen.getByTestId('VolumeControl')).toBeInTheDocument();
        expect(screen.getByTestId('PlaybackControls')).toBeInTheDocument();
        expect(screen.getByRole('button')).toBeInTheDocument(); // Play/Pause button
    });

    it('should toggle play/pause icon', () => {
        const { rerender } = render(<ControlsOverlay {...defaultProps} isPlaying={false} />);
        expect(screen.getByTestId('PlayArrowIcon')).toBeInTheDocument();

        rerender(<ControlsOverlay {...defaultProps} isPlaying={true} />);
        expect(screen.getByTestId('PauseIcon')).toBeInTheDocument();
    });

    it('should call onPlayPause when play button is clicked', () => {
        render(<ControlsOverlay {...defaultProps} />);

        // Find the button wrapping the play icon
        const playBtn = screen.getByTestId('PlayArrowIcon').closest('button');
        fireEvent.click(playBtn!);

        expect(defaultProps.onPlayPause).toHaveBeenCalled();
    });

    it('should handle visibility styles correctly based on isFullscreen and controlsVisible', () => {
        // Not full screen, controls always visible (based on implementation logic visible in code)
        // Code: opacity: isFullscreen ? (controlsVisible ? 0.3 : 0) : 1
        // Wait, checking the logic:
        // opacity: isFullscreen ? (controlsVisible ? 0.3 : 0) : 1  <- This seems odd in the source code I read
        // Line 87: opacity: isFullscreen ? (controlsVisible ? 0.3 : 0) : 1
        // Wait, if fullscreen and visible, opacity is 0.3? That seems like a background dimming overlay maybe?
        // Let's check the container styles.

        const { container } = render(<ControlsOverlay {...defaultProps} isFullscreen={true} controlsVisible={false} />);
        // When fullscreen and not visible, it should be hidden
        const box = container.firstChild as HTMLElement;
        expect(box).toHaveStyle({ visibility: 'hidden', opacity: '0' });
    });

    it('should trigger onControlsMouseEnter', () => {
        const { container } = render(<ControlsOverlay {...defaultProps} />);

        fireEvent.mouseEnter(container.firstChild as HTMLElement);
        expect(defaultProps.onControlsMouseEnter).toHaveBeenCalled();
    });
});
