import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlaybackControls from '../PlaybackControls';

// Mock dependencies
vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

// Isolate PlaybackControls from SpeedControl internals
vi.mock('../SpeedControl', () => ({
    default: () => <div data-testid="SpeedControl" />,
}));

describe('PlaybackControls', () => {
    const defaultProps = {
        isPlaying: false,
        onPlayPause: vi.fn(),
        onSeek: vi.fn(),
        playbackRate: 1,
        onPlaybackRateChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render all seek buttons', () => {
        render(<PlaybackControls {...defaultProps} />);

        // -10m, -1m, -10s, +10s, +1m, +10m = 6 seek buttons
        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(6);
    });

    it('should render SpeedControl', () => {
        render(<PlaybackControls {...defaultProps} />);
        expect(screen.getByTestId('SpeedControl')).toBeInTheDocument();
    });

    it('should call onSeek with correct values', () => {
        render(<PlaybackControls {...defaultProps} />);

        // FastRewind (-1m = -60s)
        const rewindBtn = screen.getByTestId('FastRewindIcon').closest('button');
        fireEvent.click(rewindBtn!);
        expect(defaultProps.onSeek).toHaveBeenCalledWith(-60);

        // Forward10 (+10s)
        const fwd10Btn = screen.getByTestId('Forward10Icon').closest('button');
        fireEvent.click(fwd10Btn!);
        expect(defaultProps.onSeek).toHaveBeenCalledWith(10);
    });

    it('should call onSeek(-600) when -10m button is clicked', () => {
        render(<PlaybackControls {...defaultProps} />);
        const btn = screen.getByTestId('KeyboardDoubleArrowLeftIcon').closest('button');
        fireEvent.click(btn!);
        expect(defaultProps.onSeek).toHaveBeenCalledWith(-600);
    });

    it('should call onSeek(600) when +10m button is clicked', () => {
        render(<PlaybackControls {...defaultProps} />);
        const btn = screen.getByTestId('KeyboardDoubleArrowRightIcon').closest('button');
        fireEvent.click(btn!);
        expect(defaultProps.onSeek).toHaveBeenCalledWith(600);
    });
});
