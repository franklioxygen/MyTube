import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Collection } from '../../types';
import CollectionModal from '../CollectionModal';

// Mock language context
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('CollectionModal', () => {
    const mockCollections: Collection[] = [
        { id: '1', name: 'Collection 1', videos: [], createdAt: new Date().toISOString() },
        { id: '2', name: 'Collection 2', videos: [], createdAt: new Date().toISOString() },
    ];

    const defaultProps = {
        open: true,
        onClose: vi.fn(),
        collections: mockCollections,
        onAddToCollection: vi.fn(),
        onCreateCollection: vi.fn(),
        videoCollections: [],
    };

    it('should render when open', () => {
        render(<CollectionModal {...defaultProps} />);
        expect(screen.getByText('addToCollection')).toBeInTheDocument();
    });

    it('should render existing collections dropdown', async () => {
        const user = userEvent.setup();
        render(<CollectionModal {...defaultProps} />);

        // Check if "Add to existing collection" section is present
        expect(screen.getByText('addToExistingCollection')).toBeInTheDocument();

        // Open select
        const select = screen.getByRole('combobox');
        await user.click(select);

        // Check options
        expect(screen.getByText('Collection 1')).toBeInTheDocument();
        expect(screen.getByText('Collection 2')).toBeInTheDocument();
    });

    it('should call onAddToCollection when add button is clicked', async () => {
        const user = userEvent.setup();
        render(<CollectionModal {...defaultProps} />);

        // Select collection 1
        await user.click(screen.getByRole('combobox'));
        await user.click(screen.getByText('Collection 1'));

        // Click Add
        await user.click(screen.getByRole('button', { name: 'add' }));

        expect(defaultProps.onAddToCollection).toHaveBeenCalledWith('1');
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should call onCreateCollection when create button is clicked', async () => {
        const user = userEvent.setup();
        render(<CollectionModal {...defaultProps} />);

        // Type new name
        const input = screen.getByLabelText('collectionName');
        await user.type(input, 'New Collection');

        // Click Create
        await user.click(screen.getByRole('button', { name: 'create' }));

        expect(defaultProps.onCreateCollection).toHaveBeenCalledWith('New Collection');
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should show info alert if video is already in a collection', () => {
        const props = {
            ...defaultProps,
            videoCollections: [mockCollections[0]], // Video is in Collection 1
            onRemoveFromCollection: vi.fn(),
        };
        render(<CollectionModal {...props} />);

        expect(screen.getByText('currentlyIn')).toBeInTheDocument();
        expect(screen.getByText('Collection 1')).toBeInTheDocument();
        expect(screen.getByText('remove')).toBeInTheDocument();
    });

    it('should call onRemoveFromCollection when remove button is clicked', async () => {
        const props = {
            ...defaultProps,
            videoCollections: [mockCollections[0]],
            onRemoveFromCollection: vi.fn(),
        };
        const user = userEvent.setup();
        render(<CollectionModal {...props} />);

        await user.click(screen.getByText('remove'));

        expect(props.onRemoveFromCollection).toHaveBeenCalled();
        expect(props.onClose).toHaveBeenCalled();
    });
});
