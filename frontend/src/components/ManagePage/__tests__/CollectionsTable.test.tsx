import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Collection } from '../../../types';
import CollectionsTable from '../CollectionsTable'; // Import from local directory

// Mock contexts
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../contexts/VisitorModeContext', () => ({
    useVisitorMode: () => ({ visitorMode: false }),
}));

// We need to support mocking the return value of useVisitorMode for specific tests
const mockUseVisitorMode = vi.fn(() => ({ visitorMode: false }));
vi.mock('../../../contexts/VisitorModeContext', () => ({
    useVisitorMode: () => mockUseVisitorMode(),
}));


describe('CollectionsTable', () => {
    const mockCollections: Collection[] = [
        { id: '1', name: 'Collection 1', videos: ['v1'], createdAt: '2023-01-01' },
    ];

    const defaultProps = {
        displayedCollections: mockCollections,
        totalCollectionsCount: 1,
        onDelete: vi.fn(),
        page: 1,
        totalPages: 2,
        onPageChange: vi.fn(),
        getCollectionSize: () => '10 MB',
    };

    it('should render table with collections', () => {
        render(<CollectionsTable {...defaultProps} />);
        expect(screen.getByText('Collection 1')).toBeInTheDocument();
        expect(screen.getByText('10 MB')).toBeInTheDocument();
    });

    it('should render empty state if no collections', () => {
        render(<CollectionsTable {...defaultProps} totalCollectionsCount={0} displayedCollections={[]} />);
        expect(screen.getByText('noCollections')).toBeInTheDocument();
    });

    it('should call onDelete when delete button is clicked', () => {
        render(<CollectionsTable {...defaultProps} />);
        screen.getAllByRole('button');
        // Filter for the delete icon button if possible, but here we likely only have delete buttons in rows + pagination
        // Actually pagination buttons are also buttons.
        // The delete button has a Delete icon.
        // Let's try to find by label if tooltip is present
        // Tooltip title is 'deleteCollection' (mocked t returns key)
        fireEvent.click(screen.getByLabelText('deleteCollection'));

        expect(defaultProps.onDelete).toHaveBeenCalledWith(mockCollections[0]);
    });

    it('should not show actions column in visitor mode', () => {
        mockUseVisitorMode.mockReturnValue({ visitorMode: true });
        render(<CollectionsTable {...defaultProps} />);
        expect(screen.queryByText('actions')).not.toBeInTheDocument();
        // Reset mock
        mockUseVisitorMode.mockReturnValue({ visitorMode: false });
    });

    it('should render pagination if totalPages > 1', () => {
        render(<CollectionsTable {...defaultProps} />);
        expect(screen.getByRole('navigation')).toBeInTheDocument(); // Pagination uses nav
    });
});
