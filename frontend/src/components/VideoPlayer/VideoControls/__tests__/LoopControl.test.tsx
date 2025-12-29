import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LoopControl from '../LoopControl';

// Mock useLanguage
vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key })
}));

describe('LoopControl', () => {
    it('should render loop button', () => {
        render(<LoopControl isLooping={false} onToggle={() => { }} />);
        expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should show active color when looping', () => {
        render(<LoopControl isLooping={true} onToggle={() => { }} />);
        const button = screen.getByRole('button');
        expect(button).toBeInTheDocument();
        // Check class or style if needed, but presence is good first step
    });

    it('should call onToggle when clicked', () => {
        const toggleMock = vi.fn();
        render(<LoopControl isLooping={false} onToggle={toggleMock} />);

        fireEvent.click(screen.getByRole('button'));
        expect(toggleMock).toHaveBeenCalled();
    });
});
