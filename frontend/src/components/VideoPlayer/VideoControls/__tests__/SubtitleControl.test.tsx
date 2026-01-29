import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SubtitleControl from '../SubtitleControl';

// Correct mock path (4 levels deep)
vi.mock('../../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key })
}));

describe('SubtitleControl', () => {
    // Props suitable for the component
    const defaultProps = {
        subtitles: [
            { language: 'en', filename: 'sub.en.vtt', path: '/subs/sub.en.vtt' },
            { language: 'es', filename: 'sub.es.vtt', path: '/subs/sub.es.vtt' }
        ],
        subtitlesEnabled: false,
        subtitleMenuAnchor: null,
        onSubtitleClick: vi.fn(),
        onCloseMenu: vi.fn(),
        onSelectSubtitle: vi.fn(),
        showOnMobile: false
    };

    it('should render subtitle button when subtitles exist', () => {
        render(<SubtitleControl {...defaultProps} />);
        expect(screen.getByRole('button')).toBeInTheDocument();
        // Check for icon (using testid or implied presence)
        // Since we don't have icon testids handy in source without checking imports, using getByRole is safe.
    });

    it('should not render anything if no subtitles', () => {
        render(<SubtitleControl {...defaultProps} subtitles={[]} />);
        const button = screen.queryByRole('button');
        expect(button).not.toBeInTheDocument();
    });

    it('should call onSubtitleClick when clicked', () => {
        render(<SubtitleControl {...defaultProps} />);
        const button = screen.getByRole('button');
        fireEvent.click(button);
        expect(defaultProps.onSubtitleClick).toHaveBeenCalled();
    });

    it('should render menu when anchor is provided', () => {
        // Create a dummy anchor
        const anchor = document.createElement('div');
        render(<SubtitleControl {...defaultProps} subtitleMenuAnchor={anchor} />);

        // Menu should be open, verify items
        // MUI Menu renders into a portal, so queryByText for items
        expect(screen.getByText('English')).toBeInTheDocument();
        expect(screen.getByText('Spanish')).toBeInTheDocument();
    });

    it('should call onSelectSubtitle when item clicked', () => {
        const anchor = document.createElement('div');
        render(<SubtitleControl {...defaultProps} subtitleMenuAnchor={anchor} />);

        const enOption = screen.getByText('English');
        fireEvent.click(enOption);
        expect(defaultProps.onSelectSubtitle).toHaveBeenCalledWith(0);
    });
});
