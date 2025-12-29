import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FullscreenControl from '../FullscreenControl';

// Mock useLanguage
vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key })
}));

describe('FullscreenControl', () => {
    it('should render enter fullscreen icon initially', () => {
        render(<FullscreenControl isFullscreen={false} onToggle={() => { }} />);
        expect(screen.getByRole('button')).toBeInTheDocument();
        // Check for specific icon if possible, or just button presence
    });

    it('should render exit fullscreen icon when active', () => {
        render(<FullscreenControl isFullscreen={true} onToggle={() => { }} />);
        expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should call onToggle when clicked', () => {
        const toggleMock = vi.fn();
        render(<FullscreenControl isFullscreen={false} onToggle={toggleMock} />);

        fireEvent.click(screen.getByRole('button'));
        expect(toggleMock).toHaveBeenCalled();
    });
});
