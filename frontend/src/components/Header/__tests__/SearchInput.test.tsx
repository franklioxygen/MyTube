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
        onResetSearch: vi.fn(),
        onSubmit: vi.fn((e) => e.preventDefault()),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockUserRole = 'admin';
        mockIsMobile = false;
        vi.mocked(mockT).mockImplementation((key) => key);
        document.execCommand = vi.fn();
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

    it('should not submit the form when the paste button is clicked', async () => {
        render(<SearchInput {...defaultProps} />);

        fireEvent.click(screen.getAllByRole('button')[0]);

        await waitFor(() => {
            expect(defaultProps.setVideoUrl).toHaveBeenCalledWith('https://example.com/video');
        });
        expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    });

    it('should fall back to execCommand paste when clipboard API is unavailable', async () => {
        Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true,
            value: undefined
        });
        vi.mocked(document.execCommand).mockImplementation((commandId: string) => {
            if (commandId !== 'paste') {
                return false;
            }
            const activeElement = document.activeElement as HTMLTextAreaElement | null;
            if (activeElement) {
                activeElement.value = 'https://fallback.example/video';
            }
            return true;
        });

        render(<SearchInput {...defaultProps} />);

        fireEvent.click(screen.getAllByRole('button')[0]);

        await waitFor(() => {
            expect(document.execCommand).toHaveBeenCalledWith('paste');
            expect(defaultProps.setVideoUrl).toHaveBeenCalledWith('https://fallback.example/video');
        });
    });

    it('should log an error when clipboard paste fails', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: vi.fn().mockRejectedValue(new Error('clipboard blocked'))
            }
        });
        vi.mocked(document.execCommand).mockReturnValue(false);

        render(<SearchInput {...defaultProps} />);

        fireEvent.click(screen.getAllByRole('button')[0]);

        await waitFor(() => {
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Failed to paste from clipboard:',
                expect.objectContaining({ message: 'Clipboard paste is unavailable' })
            );
        });

        consoleErrorSpy.mockRestore();
    });

    it('should fall back to execCommand paste when clipboard API rejects', async () => {
        const pasteError = new Error('clipboard blocked');
        Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: vi.fn().mockRejectedValue(pasteError)
            }
        });
        vi.mocked(document.execCommand).mockImplementation((commandId: string) => {
            if (commandId !== 'paste') {
                return false;
            }
            const activeElement = document.activeElement as HTMLInputElement | null;
            if (activeElement) {
                activeElement.value = 'https://rejected.example/video';
            }
            return true;
        });

        render(<SearchInput {...defaultProps} />);

        fireEvent.click(screen.getAllByRole('button')[0]);

        await waitFor(() => {
            expect(window.navigator.clipboard.readText).toHaveBeenCalled();
            expect(document.execCommand).toHaveBeenCalledWith('paste');
            expect(defaultProps.setVideoUrl).toHaveBeenCalledWith('https://rejected.example/video');
        });
    });

    it('should hide paste button on mobile', () => {
        mockIsMobile = true;

        render(<SearchInput {...defaultProps} />);

        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('renders a single clear button that clears the input and resets active search', () => {
        render(<SearchInput {...defaultProps} isSearchMode={true} videoUrl="cats" />);

        // Desktop layout: [paste] [clear] [submit] — only one clear button now.
        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(3);
        fireEvent.click(buttons[1]);

        expect(defaultProps.setVideoUrl).toHaveBeenCalledWith('');
        expect(defaultProps.onResetSearch).toHaveBeenCalled();
    });

    it('clears only the input (not the global search) when not in search mode', () => {
        render(<SearchInput {...defaultProps} isSearchMode={false} videoUrl="https://example.com" />);

        fireEvent.click(screen.getAllByRole('button')[1]);

        expect(defaultProps.setVideoUrl).toHaveBeenCalledWith('');
        expect(defaultProps.onResetSearch).not.toHaveBeenCalled();
    });
});
