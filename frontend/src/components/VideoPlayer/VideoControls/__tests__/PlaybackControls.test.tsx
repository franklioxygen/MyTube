import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlaybackControls from '../PlaybackControls';

// Mock dependencies
vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, replacements?: Record<string, string | number>) =>
            replacements
                ? `${key}:${Object.values(replacements).join(':')}`
                : key,
    }),
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
        seekIntervals: {
            shortSeconds: 15,
            mediumSeconds: 120,
            longSeconds: 900,
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render all seek buttons', () => {
        render(<PlaybackControls {...defaultProps} />);

        // Three backward and three forward seek buttons.
        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(6);
    });

    it('should render SpeedControl', () => {
        render(<PlaybackControls {...defaultProps} />);
        expect(screen.getByTestId('SpeedControl')).toBeInTheDocument();
    });

    it('should call onSeek with all configured signed values', () => {
        render(<PlaybackControls {...defaultProps} />);

        screen.getAllByRole('button').forEach((button) => fireEvent.click(button));

        expect(defaultProps.onSeek.mock.calls.map(([seconds]) => seconds)).toEqual([
            -900,
            -120,
            -15,
            15,
            120,
            900,
        ]);
    });

    it('does not render interval values in the control bar', () => {
        render(<PlaybackControls {...defaultProps} />);

        expect(screen.queryByText('15s')).not.toBeInTheDocument();
        expect(screen.queryByText('2m')).not.toBeInTheDocument();
        expect(screen.queryByText('15m')).not.toBeInTheDocument();
    });

    it('provides translated direction and duration accessible names', () => {
        render(<PlaybackControls {...defaultProps} />);

        expect(
            screen.getByRole('button', {
                name: 'seekBackwardBy:seekDurationMinutes:15',
            })
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', {
                name: 'seekForwardBy:seekDurationSeconds:15',
            })
        ).toBeInTheDocument();
    });
});
