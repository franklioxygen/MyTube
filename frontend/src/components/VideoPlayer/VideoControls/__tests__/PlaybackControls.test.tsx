import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlaybackControls from '../PlaybackControls';

// Mock dependencies
vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('PlaybackControls', () => {
    const defaultProps = {
        isPlaying: false,
        onPlayPause: vi.fn(),
        onSeek: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render all seek buttons', () => {
        render(<PlaybackControls {...defaultProps} />);

        // We expect 5 or 6 buttons depending on config?
        // Code has: -10m, -1m, -10s, +10s, +1m, +10m = 6 buttons
        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(6);
    });

    it('should call onSeek with correct values', () => {
        render(<PlaybackControls {...defaultProps} />);

        // We can find buttons by icon test id usually, or by tooltip title if we hover?
        // Tooltip title requires hover to be visible in DOM usually, unless we mock Tooltip.
        // Let's assume icons.

        // FastRewind (-1m = -60s)
        const rewindBtn = screen.getByTestId('FastRewindIcon').closest('button');
        fireEvent.click(rewindBtn!);
        expect(defaultProps.onSeek).toHaveBeenCalledWith(-60);

        // Forward10 (+10s)
        const fwd10Btn = screen.getByTestId('Forward10Icon').closest('button');
        fireEvent.click(fwd10Btn!);
        expect(defaultProps.onSeek).toHaveBeenCalledWith(10);
    });
});
