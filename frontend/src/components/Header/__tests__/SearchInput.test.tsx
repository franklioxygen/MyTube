import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SearchInput from '../SearchInput';

// Mock dependencies
const mockT = vi.fn((key) => key);
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: mockT }),
}));

let mockUserRole = 'admin';
vi.mock('../../../contexts/AuthContext', () => ({
    useAuth: () => ({ userRole: mockUserRole }),
}));

// Mock useMediaQuery
let mockIsMobile = false;
vi.mock('@mui/material', async () => {
    const actual = await vi.importActual('@mui/material');
    return {
        ...actual,
        useMediaQuery: () => mockIsMobile,
    };
});


describe('SearchInput', () => {
    const defaultProps = {
        videoUrl: '',
        setVideoUrl: vi.fn(),
        isSubmitting: false,
        error: '',
        isSearchMode: false,
        searchTerm: '',
        onResetSearch: vi.fn(),
        onSubmit: vi.fn((e) => e.preventDefault()),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockUserRole = 'admin';
        mockIsMobile = false;
        vi.mocked(mockT).mockImplementation((key) => key);
        Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: vi.fn().mockResolvedValue('https://example.com/video')
            }
        });
    });

    it('should render input field', () => {
        render(<SearchInput {...defaultProps} />);
        expect(screen.getByPlaceholderText('enterUrlOrSearchTerm')).toBeInTheDocument();
    });

    it('should render visitor placeholder in visitor mode', () => {
        mockUserRole = 'visitor';

        render(<SearchInput {...defaultProps} />);

        expect(screen.getByPlaceholderText('enterSearchTerm')).toBeInTheDocument();
    });

    it('should display error message when error prop is provided', () => {
        render(<SearchInput {...defaultProps} error="Invalid URL" />);
        expect(screen.getByText('Invalid URL')).toBeInTheDocument();
    });

    it('should call setVideoUrl on input change', () => {
        render(<SearchInput {...defaultProps} />);
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'test' } });
        expect(defaultProps.setVideoUrl).toHaveBeenCalledWith('test');
    });

    it('should call onSubmit when form is submitted', () => {
        render(<SearchInput {...defaultProps} />);
        const input = screen.getByRole('textbox');
        fireEvent.submit(input);
        expect(defaultProps.onSubmit).toHaveBeenCalled();
    });

    it('should display circular progress when isSubmitting is true', () => {
        render(<SearchInput {...defaultProps} isSubmitting={true} />);
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should paste clipboard content on desktop', async () => {
        render(<SearchInput {...defaultProps} />);

        fireEvent.click(screen.getAllByRole('button')[0]);

        await waitFor(() => {
            expect(window.navigator.clipboard.readText).toHaveBeenCalled();
            expect(defaultProps.setVideoUrl).toHaveBeenCalledWith('https://example.com/video');
        });
    });

    it('should log an error when clipboard paste fails', async () => {
        const pasteError = new Error('clipboard blocked');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: vi.fn().mockRejectedValue(pasteError)
            }
        });

        render(<SearchInput {...defaultProps} />);

        fireEvent.click(screen.getAllByRole('button')[0]);

        await waitFor(() => {
            expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to paste from clipboard:', pasteError);
        });

        consoleErrorSpy.mockRestore();
    });

    it('should hide paste button on mobile', () => {
        mockIsMobile = true;

        render(<SearchInput {...defaultProps} />);

        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('should call onResetSearch when reset search button is clicked', () => {
        render(<SearchInput {...defaultProps} isSearchMode={true} searchTerm="cats" videoUrl="cats" />);

        fireEvent.click(screen.getAllByRole('button')[1]);

        expect(defaultProps.onResetSearch).toHaveBeenCalled();
        expect(defaultProps.setVideoUrl).not.toHaveBeenCalled();
    });

    it('should clear the input when clear button is clicked', () => {
        render(<SearchInput {...defaultProps} isSearchMode={true} searchTerm="cats" videoUrl="cats" />);

        fireEvent.click(screen.getAllByRole('button')[2]);

        expect(defaultProps.setVideoUrl).toHaveBeenCalledWith('');
    });
});
