import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProgressBar from '../ProgressBar';

describe('ProgressBar', () => {
    const defaultProps = {
        currentTime: 65, // 1:05
        duration: 125,   // 2:05
        onProgressChange: vi.fn(),
        onProgressChangeCommitted: vi.fn(),
        onProgressMouseDown: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should format and display time correctly', () => {
        render(<ProgressBar {...defaultProps} />);

        expect(screen.getByText('1:05')).toBeInTheDocument();
        expect(screen.getByText('2:05')).toBeInTheDocument();
    });

    it('should format hours correctly', () => {
        render(<ProgressBar {...defaultProps} currentTime={3665} duration={7200} />);
        // 3665 = 1h 1m 5s => 1:01:05
        // 7200 = 2h 0m 0s => 2:00:00

        expect(screen.getByText('1:01:05')).toBeInTheDocument();
        expect(screen.getByText('2:00:00')).toBeInTheDocument();
    });

    it('should handle zero duration gracefully', () => {
        render(<ProgressBar {...defaultProps} duration={0} />);
        expect(screen.getByText('0:00')).toBeInTheDocument(); // Duration text
        const sliderThumb = screen.getByRole('slider');
        // MUI Slider disabled class is usually on the root element
        // The role='slider' is on the thumb.
        // We find the root by looking up.
        // Or we can check if the thumb has aria-disabled="true" which standard accessibility requires.
        // But MUI might put it on the input.
        // Let's check for Mui-disabled class on the root.
        // Note: usage of implementation details (class names) is discouraged but sometimes necessary for complex components.
        const sliderRoot = sliderThumb.closest('.MuiSlider-root');
        expect(sliderRoot).toHaveClass('Mui-disabled');
    });

    it('should call onProgressChange when slider changes', () => {
        render(<ProgressBar {...defaultProps} />);

        const sliderInput = screen.getByRole('slider').querySelector('input');
        if (sliderInput) {
            fireEvent.change(sliderInput, { target: { value: 50 } });
            // The Slider component from MUI usually passes the value directly.
            // But verify calls.
            expect(defaultProps.onProgressChange).toHaveBeenCalled();
        }
    });

    it('should call onProgressMouseDown', () => {
        render(<ProgressBar {...defaultProps} />);

        const slider = screen.getByRole('slider');
        fireEvent.mouseDown(slider);
        expect(defaultProps.onProgressMouseDown).toHaveBeenCalled();
    });
});
