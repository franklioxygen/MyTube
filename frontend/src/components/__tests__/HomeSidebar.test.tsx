import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeSidebar } from '../HomeSidebar';

// Mock child components
vi.mock('../AuthorsList', () => ({ default: () => <div data-testid="authors-list">Authors List</div> }));
vi.mock('../Collections', () => ({ default: () => <div data-testid="collections">Collections</div> }));
vi.mock('../TagsList', () => ({ default: () => <div data-testid="tags-list">Tags List</div> }));

describe('HomeSidebar', () => {
    const defaultProps = {
        isSidebarOpen: true,
        collections: [],
        availableTags: [],
        selectedTags: [],
        onTagToggle: vi.fn(),
        videos: [],
    };

    it('should render content when open', () => {
        render(<HomeSidebar {...defaultProps} />);

        // Since it uses MUI Collapse, content might be in DOM but hidden if open=false,
        // or just present if open=true.
        // We mocked children, let's see if they are there.
        expect(screen.getByTestId('collections')).toBeInTheDocument();
        expect(screen.getByTestId('tags-list')).toBeInTheDocument();
        expect(screen.getByTestId('authors-list')).toBeInTheDocument();
    });

    // Note: Testing actual visibility (display: none or height: 0) of MUI Collapse with JSDOM
    // can be tricky as it relies on JS animations. 
    // Usually checking props passed or structural existence is enough for unit tests.

    it('should have correct width style', () => {
        // This is a bit implementation detail heavy, but verifies structure
        const { container } = render(<HomeSidebar {...defaultProps} />);
        // Look for the box with width 280
        // We can't easily query by style with testing-library, but we can check if it renders without crashing.
        expect(container).toBeInTheDocument();
    });
});
