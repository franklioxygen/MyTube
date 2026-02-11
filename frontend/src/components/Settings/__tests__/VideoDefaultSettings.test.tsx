import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VideoDefaultSettings from '../VideoDefaultSettings';

// Mock language context
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('VideoDefaultSettings', () => {
    const mockOnChange = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render autoPlay switch', () => {
        render(<VideoDefaultSettings settings={{ defaultAutoPlay: false } as any} onChange={mockOnChange} />);

        expect(screen.getByText('autoPlay')).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'autoPlay' })).not.toBeChecked();
    });

    it('should toggle autoPlay switch', async () => {
        const user = userEvent.setup();
        render(<VideoDefaultSettings settings={{ defaultAutoPlay: false } as any} onChange={mockOnChange} />);

        await user.click(screen.getByLabelText('autoPlay'));

        expect(mockOnChange).toHaveBeenCalledWith('defaultAutoPlay', true);
    });

    it('should render playFromBeginning switch', () => {
        render(<VideoDefaultSettings settings={{ playFromBeginning: false } as any} onChange={mockOnChange} />);

        expect(screen.getByText('playFromBeginning')).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'playFromBeginning' })).not.toBeChecked();
    });

    it('should toggle playFromBeginning switch', async () => {
        const user = userEvent.setup();
        render(<VideoDefaultSettings settings={{ playFromBeginning: false } as any} onChange={mockOnChange} />);

        await user.click(screen.getByLabelText('playFromBeginning'));

        expect(mockOnChange).toHaveBeenCalledWith('playFromBeginning', true);
    });

    it('should toggle pauseOnFocusLoss switch', async () => {
        const user = userEvent.setup();
        render(<VideoDefaultSettings settings={{ pauseOnFocusLoss: false } as any} onChange={mockOnChange} />);

        await user.click(screen.getByLabelText('pauseOnFocusLoss'));

        expect(mockOnChange).toHaveBeenCalledWith('pauseOnFocusLoss', true);
    });
});
