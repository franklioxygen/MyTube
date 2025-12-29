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
});
