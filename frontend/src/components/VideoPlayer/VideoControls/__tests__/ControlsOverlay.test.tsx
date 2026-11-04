import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ControlsOverlay from '../ControlsOverlay';

const viewport = vi.hoisted(() => ({ mobile: false }));

// Mock dependencies
vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('@mui/material', async () => {
    const actual = await vi.importActual('@mui/material');
    return {
        ...actual,
        useMediaQuery: (query: string) => query.includes('max-width') && viewport.mobile,
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
    default: ({ danmakuControl }: { danmakuControl?: React.ReactNode }) => <div data-testid="PlaybackControls">{danmakuControl}</div>,
}));
vi.mock('../LiveTranslationControlButton', () => ({
    default: () => <button>Live translation</button>,
}));
vi.mock('../SpeedControl', () => ({
    default: () => <div data-testid="SpeedControl" />,
}));

describe('ControlsOverlay', () => {
    const defaultProps: ComponentProps<typeof ControlsOverlay> = {
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
        selectedSubtitleIndices: [],
        isLooping: false,
        subtitleMenuAnchor: null,
        playbackRate: 1,
        seekIntervals: {
            shortSeconds: 10,
            mediumSeconds: 60,
            longSeconds: 600,
        },
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
        onPlaybackRateChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        viewport.mobile = false;
    });

    it('should render all controls when visible', () => {
        render(<ControlsOverlay {...defaultProps} />);

        expect(screen.getByTestId('ProgressBar')).toBeInTheDocument();
        expect(screen.getByTestId('VolumeControl')).toBeInTheDocument();
        expect(screen.getByTestId('PlaybackControls')).toBeInTheDocument();
        expect(screen.getByTestId('PlayArrowIcon').closest('button')).toBeInTheDocument();
    });

    it('mounts one danmaku control in the desktop playback row', () => {
        render(<ControlsOverlay {...defaultProps} danmakuControl={<button>Danmaku</button>} />);
        expect(screen.getAllByRole('button', { name: 'Danmaku' })).toHaveLength(1);
        expect(screen.getByTestId('PlaybackControls')).toContainElement(screen.getByRole('button', { name: 'Danmaku' }));
    });

    it('places the mobile danmaku control immediately before live translation', () => {
        viewport.mobile = true;
        render(<ControlsOverlay {...defaultProps} danmakuControl={<button>Danmaku</button>} />);
        const button = screen.getByRole('button', { name: 'Danmaku' });
        expect(button.nextElementSibling).toBe(screen.getByRole('button', { name: 'Live translation' }));
        expect(screen.getByTestId('PlaybackControls')).not.toContainElement(button);
    });

    it('omits danmaku in audio mode', () => {
        viewport.mobile = true;
        render(<ControlsOverlay {...defaultProps} isAudio danmakuControl={<button>Danmaku</button>} />);
        expect(screen.queryByRole('button', { name: 'Danmaku' })).not.toBeInTheDocument();
    });

    it('should render SpeedControl in the mobile row', () => {
        render(<ControlsOverlay {...defaultProps} />);
        expect(screen.getByTestId('SpeedControl')).toBeInTheDocument();
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
