import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SpeedControl from '../SpeedControl';

vi.mock('@mui/material', async () => {
    const actual = await vi.importActual('@mui/material');
    return { ...actual, useMediaQuery: () => false };
});

describe('SpeedControl', () => {
    const defaultProps = {
        playbackRate: 1,
        onPlaybackRateChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── rendering ──────────────────────────────────────────────────────────────

    it('renders the speed button', () => {
        render(<SpeedControl {...defaultProps} />);
        expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('displays the current playback rate on the button', () => {
        render(<SpeedControl {...defaultProps} />);
        expect(screen.getByText('1x')).toBeInTheDocument();
    });

    it('displays a non-default playback rate on the button', () => {
        render(<SpeedControl {...defaultProps} playbackRate={1.5} />);
        expect(screen.getByText('1.5x')).toBeInTheDocument();
    });

    it('applies primary color when playback rate is not 1', () => {
        render(<SpeedControl {...defaultProps} playbackRate={2} />);
        expect(screen.getByRole('button')).toHaveClass('MuiIconButton-colorPrimary');
    });

    it('does not apply primary color when playback rate is 1', () => {
        render(<SpeedControl {...defaultProps} playbackRate={1} />);
        expect(screen.getByRole('button')).not.toHaveClass('MuiIconButton-colorPrimary');
    });

    // ── menu open ──────────────────────────────────────────────────────────────

    it('opens the speed menu when the button is clicked', () => {
        render(<SpeedControl {...defaultProps} />);
        fireEvent.click(screen.getByRole('button'));
        // '0.5x' only appears in the menu (the button shows '1x')
        expect(screen.getByText('0.5x')).toBeInTheDocument();
    });

    it('shows all 7 speed options in the menu', () => {
        render(<SpeedControl {...defaultProps} />);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getAllByRole('menuitem')).toHaveLength(7);
    });

    it('renders speed options 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x and 3x', () => {
        render(<SpeedControl {...defaultProps} />);
        fireEvent.click(screen.getByRole('button'));
        for (const label of ['0.5x', '0.75x', '1.25x', '1.5x', '2x', '3x']) {
            expect(screen.getByText(label)).toBeInTheDocument();
        }
    });

    it('marks the currently active speed as selected in the menu', () => {
        render(<SpeedControl {...defaultProps} playbackRate={1.5} />);
        fireEvent.click(screen.getByRole('button'));
        // MUI MenuItem selected prop adds the Mui-selected CSS class
        const selectedItem = screen.getByRole('menuitem', { name: '1.5x' });
        expect(selectedItem).toHaveClass('Mui-selected');
    });

    // ── selection ──────────────────────────────────────────────────────────────

    it('calls onPlaybackRateChange with the selected rate', () => {
        render(<SpeedControl {...defaultProps} />);
        fireEvent.click(screen.getByRole('button'));
        fireEvent.click(screen.getByText('1.5x'));
        expect(defaultProps.onPlaybackRateChange).toHaveBeenCalledWith(1.5);
    });

    it('calls onPlaybackRateChange with 0.5 when 0.5x is selected', () => {
        render(<SpeedControl {...defaultProps} />);
        fireEvent.click(screen.getByRole('button'));
        fireEvent.click(screen.getByText('0.5x'));
        expect(defaultProps.onPlaybackRateChange).toHaveBeenCalledWith(0.5);
    });

    it('calls onPlaybackRateChange with 2 when 2x is selected', () => {
        render(<SpeedControl {...defaultProps} />);
        fireEvent.click(screen.getByRole('button'));
        fireEvent.click(screen.getByText('2x'));
        expect(defaultProps.onPlaybackRateChange).toHaveBeenCalledWith(2);
    });

    it('closes the menu after a speed is selected', () => {
        render(<SpeedControl {...defaultProps} />);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText('0.5x')).toBeInTheDocument();
        fireEvent.click(screen.getByText('2x'));
        expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });

    it('calls onPlaybackRateChange exactly once per selection', () => {
        render(<SpeedControl {...defaultProps} />);
        fireEvent.click(screen.getByRole('button'));
        fireEvent.click(screen.getByText('1.25x'));
        expect(defaultProps.onPlaybackRateChange).toHaveBeenCalledTimes(1);
    });
});
