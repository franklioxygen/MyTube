import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Collection } from '../../types';
import Collections from '../Collections';

// Mock language context
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

// Mock theme and media query
vi.mock('@mui/material', async () => {
    const actual = await vi.importActual('@mui/material');
    return {
        ...actual,
        useTheme: () => ({
            breakpoints: {
                down: () => 'down-md',
            },
        }),
        useMediaQuery: (query: string) => query === 'down-md' ? false : false, // Default to desktop
    };
});

describe('Collections', () => {
    const mockCollections: Collection[] = [
        { id: '1', name: 'Collection 1', videos: [], createdAt: '' },
        { id: '2', name: 'Collection 2', videos: ['v1', 'v2'], createdAt: '' },
    ];

    const defaultProps = {
        collections: mockCollections,
        onItemClick: vi.fn(),
    };

    it('should render nothing if collections is empty', () => {
        const { container } = render(<Collections collections={[]} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('should render collections list', () => {
        render(
            <MemoryRouter>
                <Collections {...defaultProps} />
            </MemoryRouter>
        );
        expect(screen.getByText('collections')).toBeInTheDocument();
        expect(screen.getByText('Collection 1')).toBeInTheDocument();
        expect(screen.getByText('Collection 2')).toBeInTheDocument();
    });

    it('should show number of videos in chips', () => {
        render(
            <MemoryRouter>
                <Collections {...defaultProps} />
            </MemoryRouter>
        );
        expect(screen.getByText('0')).toBeInTheDocument(); // Collection 1 has 0
        expect(screen.getByText('2')).toBeInTheDocument(); // Collection 2 has 2
    });

    it('should toggle collapse on header click', async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter>
                <Collections {...defaultProps} />
            </MemoryRouter>
        );

        // Initially open (desktop default mock)
        expect(screen.getByText('Collection 1')).toBeVisible();

        // Click header to collapse
        const header = screen.getByText('collections');
        await user.click(header);

        // Should be collapsed (content not visible or removed from DOM depending on implementation)
        // MUI Collapse usually keeps it in DOM but hidden, or unmountOnExit
        // The component uses unmountOnExit, so it should be gone
        await waitFor(() => {
            expect(screen.queryByText('Collection 1')).not.toBeInTheDocument();
        });

        // Click again to expand
        await user.click(header);
        expect(screen.getByText('Collection 1')).toBeInTheDocument();
    });

    it('should call onItemClick when a collection is clicked', async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter>
                <Collections {...defaultProps} />
            </MemoryRouter>
        );

        await user.click(screen.getByText('Collection 1'));
        expect(defaultProps.onItemClick).toHaveBeenCalled();
    });
});

import { waitFor } from '@testing-library/react'; // Import waitFor separately
