import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VolumeControl from '../VolumeControl';

// Mock language context if needed? VolumeControl doesn't seem to use it based on code, 
// wait, it uses Tooltip which needs theme, but not language?
// Checking code: No useLanguage. But uses Tooltip.

describe('VolumeControl', () => {
    const defaultProps = {
        volume: 1,
        showVolumeSlider: false,
        volumeSliderRef: { current: null } as any,
        onVolumeChange: vi.fn(),
        onVolumeClick: vi.fn(),
        onMouseEnter: vi.fn(),
        onMouseLeave: vi.fn(),
        onSliderMouseEnter: vi.fn(),
        onSliderMouseLeave: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render volume button', () => {
        render(<VolumeControl {...defaultProps} />);
        expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should render volume up icon when volume is high', () => {
        render(<VolumeControl {...defaultProps} volume={1} />);
        expect(screen.getByTestId('VolumeUpIcon')).toBeInTheDocument();
    });

    it('should render volume down icon when volume is low', () => {
        render(<VolumeControl {...defaultProps} volume={0.3} />);
        expect(screen.getByTestId('VolumeDownIcon')).toBeInTheDocument();
    });

    it('should render volume off icon when muted', () => {
        render(<VolumeControl {...defaultProps} volume={0} />);
        expect(screen.getByTestId('VolumeOffIcon')).toBeInTheDocument();
    });

    it('should show slider when showVolumeSlider is true', () => {
        render(<VolumeControl {...defaultProps} showVolumeSlider={true} />);
        expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    it('should not show slider when showVolumeSlider is false', () => {
        render(<VolumeControl {...defaultProps} showVolumeSlider={false} />);
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    });

    it('should call onVolumeClick when button is clicked', () => {
        render(<VolumeControl {...defaultProps} />);
        fireEvent.click(screen.getByRole('button'));
        expect(defaultProps.onVolumeClick).toHaveBeenCalled();
    });

    it('should trigger mouse events', () => {
        const { container } = render(<VolumeControl {...defaultProps} />);
        // The root box listens to mouse enter/leave
        const root = container.firstChild as HTMLElement;

        fireEvent.mouseEnter(root);
        expect(defaultProps.onMouseEnter).toHaveBeenCalled();

        fireEvent.mouseLeave(root);
        expect(defaultProps.onMouseLeave).toHaveBeenCalled();
    });
});
