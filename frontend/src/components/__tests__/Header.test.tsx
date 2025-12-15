import { createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Header from '../Header';

// Mock contexts
const mockToggleTheme = vi.fn();
vi.mock('../../contexts/ThemeContext', () => ({
    useThemeContext: () => ({
        mode: 'light',
        toggleTheme: mockToggleTheme,
    }),
}));

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string) => key,
    }),
}));

const mockHandleTagToggle = vi.fn();
vi.mock('../../contexts/VideoContext', () => ({
    useVideo: () => ({
        availableTags: [],
        selectedTags: [],
        handleTagToggle: mockHandleTagToggle,
    }),
}));

vi.mock('../../contexts/CollectionContext', () => ({
    useCollection: () => ({
        collections: [],
    }),
}));

// Mock child components to avoid context dependency issues
vi.mock('../AuthorsList', () => ({ default: () => <div data-testid="authors-list" /> }));
vi.mock('../Collections', () => ({ default: () => <div data-testid="collections-list" /> }));
vi.mock('../TagsList', () => ({ default: () => <div data-testid="tags-list" /> }));

// Mock axios for settings fetch in useEffect
vi.mock('axios', () => ({
    default: {
        get: vi.fn().mockResolvedValue({ data: { websiteName: 'TestTube' } }),
    },
}));

describe('Header', () => {
    const defaultProps = {
        onSubmit: vi.fn(),
        onSearch: vi.fn(),
        activeDownloads: [],
        queuedDownloads: [],
    };

    const renderHeader = (props = {}) => {
        const theme = createTheme();
        return render(
            <ThemeProvider theme={theme}>
                <BrowserRouter>
                    <Header {...defaultProps} {...props} />
                </BrowserRouter>
            </ThemeProvider>
        );
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders with logo and title', async () => {
        renderHeader();
        // The title is fetched async, might need wait
        expect(await screen.findByText('TestTube')).toBeInTheDocument();
        expect(screen.getByAltText('MyTube Logo')).toBeInTheDocument();
    });

    it('handles search input change and submission', () => {
        const onSubmit = vi.fn().mockResolvedValue({ success: true });
        renderHeader({ onSubmit });

        const input = screen.getByPlaceholderText('enterUrlOrSearchTerm');
        fireEvent.change(input, { target: { value: 'https://youtube.com/watch?v=123' } });

        const submitButton = screen.getAllByRole('button', { name: '' }).find(btn => btn.querySelector('svg[data-testid="SearchIcon"]'));
        // Or find by type="submit"
        // MUI TextField slotProps endAdornment button type="submit"

        // Let's use fireEvent.submit on the form
        // The form is a Box component="form"
        // We can find the input and submit passing key enter or form submit

        fireEvent.submit(input.closest('form')!);

        expect(onSubmit).toHaveBeenCalledWith('https://youtube.com/watch?v=123');
    });

    it('toggles theme when button is clicked', () => {
        renderHeader();

        const themeButton = screen.getAllByRole('button').find(btn => btn.querySelector('svg[data-testid="Brightness4Icon"]'));
        fireEvent.click(themeButton!);

        expect(mockToggleTheme).toHaveBeenCalled();
    });

    it('displays error when submitting empty input', () => {
        renderHeader();

        const input = screen.getByPlaceholderText('enterUrlOrSearchTerm');
        fireEvent.submit(input.closest('form')!);

        expect(screen.getByText('pleaseEnterUrlOrSearchTerm')).toBeInTheDocument();
    });
});
