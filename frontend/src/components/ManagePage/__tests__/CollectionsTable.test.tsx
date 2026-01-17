import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Collection } from '../../../types';
import CollectionsTable from '../CollectionsTable'; // Import from local directory

// Mock contexts
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

// We need to support mocking the return value of useAuth for specific tests
const mockUseAuth = vi.fn(() => ({ userRole: 'admin' }));
vi.mock('../../../contexts/AuthContext', () => ({
    useAuth: () => mockUseAuth(),
}));

vi.mock('../../../contexts/SnackbarContext', () => ({
    useSnackbar: () => ({ showSnackbar: vi.fn() }),
}));


describe('CollectionsTable', () => {
    const mockCollections: Collection[] = [
        { id: '1', name: 'Collection 1', videos: ['v1'], createdAt: '2023-01-01' },
    ];

    const defaultProps = {
        displayedCollections: mockCollections,
        totalCollectionsCount: 1,
        onDelete: vi.fn(),
        onUpdate: vi.fn(),
        page: 1,
        totalPages: 2,
        onPageChange: vi.fn(),
        getCollectionSize: () => '10 MB',
        orderBy: 'name' as const,
        order: 'asc' as const,
        onSort: vi.fn(),
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
        // Use getAllByRole to find icon buttons, then filter or use label if available
        // The delete button has tooltip title 'deleteCollection' which becomes aria-label or accessible name
        fireEvent.click(screen.getByLabelText('deleteCollection'));

        expect(defaultProps.onDelete).toHaveBeenCalledWith(mockCollections[0]);
    });

    it('should not show actions column in visitor mode', () => {
        mockUseAuth.mockReturnValue({ userRole: 'visitor' });
        render(<CollectionsTable {...defaultProps} />);
        expect(screen.queryByText('actions')).not.toBeInTheDocument();
        // Reset mock
        mockUseAuth.mockReturnValue({ userRole: 'admin' });
    });

    it('should render pagination if totalPages > 1', () => {
        render(<CollectionsTable {...defaultProps} />);
        expect(screen.getByRole('navigation')).toBeInTheDocument();
    });

    // Edit tests
    it('should show input field when edit button is clicked', () => {
        render(<CollectionsTable {...defaultProps} />);

        const editButton = screen.getByLabelText('edit collection');
        fireEvent.click(editButton);

        expect(screen.getByRole('textbox')).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toHaveValue('Collection 1');
    });

    it('should call onUpdate when save is clicked', async () => {
        render(<CollectionsTable {...defaultProps} />);

        const editButton = screen.getByLabelText('edit collection');
        fireEvent.click(editButton);

        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'New Name' } });

        const saveButton = screen.getByLabelText('save collection name');
        fireEvent.click(saveButton);

        expect(defaultProps.onUpdate).toHaveBeenCalledWith('1', 'New Name');
    });
});
