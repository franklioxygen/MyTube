import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

    const renderTable = (props: Partial<typeof defaultProps> = {}) =>
        render(
            <MemoryRouter>
                <CollectionsTable {...defaultProps} {...props} />
            </MemoryRouter>
        );

    it('should render table with collections', () => {
        renderTable();
        expect(screen.getByText('Collection 1')).toBeInTheDocument();
        expect(screen.getByText('10 MB')).toBeInTheDocument();
    });

    it('should render empty state if no collections', () => {
        renderTable({ totalCollectionsCount: 0, displayedCollections: [] });
        expect(screen.getByText('noCollections')).toBeInTheDocument();
    });

    it('should call onDelete when delete button is clicked', () => {
        renderTable();
        // Use getAllByRole to find icon buttons, then filter or use label if available
        // The delete button has tooltip title 'deleteCollection' which becomes aria-label or accessible name
        fireEvent.click(screen.getByLabelText('deleteCollection'));

        expect(defaultProps.onDelete).toHaveBeenCalledWith(mockCollections[0]);
    });

    it('should not show actions column in visitor mode', () => {
        mockUseAuth.mockReturnValue({ userRole: 'visitor' });
        renderTable();
        expect(screen.queryByText('actions')).not.toBeInTheDocument();
        // Reset mock
        mockUseAuth.mockReturnValue({ userRole: 'admin' });
    });

    it('should render pagination if totalPages > 1', () => {
        renderTable();
        expect(screen.getByRole('navigation')).toBeInTheDocument();
    });

    // Edit tests
    it('should show input field when edit button is clicked', () => {
        renderTable();

        const editButton = screen.getByLabelText('edit collection');
        fireEvent.click(editButton);

        expect(screen.getByRole('textbox')).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toHaveValue('Collection 1');
    });

    it('should call onUpdate when save is clicked', async () => {
        renderTable();

        const editButton = screen.getByLabelText('edit collection');
        fireEvent.click(editButton);

        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'New Name' } });

        const saveButton = screen.getByLabelText('save collection name');
        fireEvent.click(saveButton);

        expect(defaultProps.onUpdate).toHaveBeenCalledWith('1', 'New Name');
    });

    it('should link collection name to its collection page', () => {
        renderTable();
        const link = screen.getByRole('link', { name: 'Collection 1' });
        expect(link).toHaveAttribute('href', '/collection/1');
    });
});
