import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection } from '../../types';
import CollectionModal from '../CollectionModal';

vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({
        t: (key: string, replacements?: Record<string, string | number>) => {
            if (replacements) {
                return Object.entries(replacements).reduce(
                    (text, [placeholder, value]) =>
                        text.replaceAll(`{${placeholder}}`, String(value)),
                    key
                );
            }
            return key;
        },
    }),
}));

describe('CollectionModal', () => {
    const mockCollections: Collection[] = [
        { id: '1', name: 'Collection 1', videos: [], createdAt: new Date().toISOString() },
        { id: '2', name: 'Collection 2', videos: [], createdAt: new Date().toISOString() },
        { id: '3', name: 'Alpha Collection', videos: [], createdAt: new Date().toISOString() },
    ];

    const defaultProps = {
        open: true,
        onClose: vi.fn(),
        collections: mockCollections,
        onAddToCollection: vi.fn().mockResolvedValue(undefined),
        onCreateCollection: vi.fn().mockResolvedValue(undefined),
        videoCollections: [],
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render when open', () => {
        render(<CollectionModal {...defaultProps} />);
        expect(screen.getByText('addToCollection')).toBeInTheDocument();
    });

    it('should render a single combobox input instead of two separate inputs', () => {
        render(<CollectionModal {...defaultProps} />);
        expect(screen.getAllByRole('combobox')).toHaveLength(1);
        expect(screen.queryByText('addToExistingCollection')).not.toBeInTheDocument();
        expect(screen.queryByText('createNewCollection')).not.toBeInTheDocument();
    });

    it('should show the full alphabetical list when the input is empty', async () => {
        const user = userEvent.setup();
        render(<CollectionModal {...defaultProps} />);

        await user.click(screen.getByRole('combobox'));

        const options = screen.getAllByRole('option');
        expect(options.map((o) => o.textContent)).toEqual([
            'Alpha Collection',
            'Collection 1',
            'Collection 2',
        ]);
    });

    it('should filter collections case-insensitively as the user types', async () => {
        const user = userEvent.setup();
        render(<CollectionModal {...defaultProps} />);

        const combobox = screen.getByRole('combobox');
        await user.click(combobox);
        await user.type(combobox, 'collection 1');

        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(1);
        expect(options[0]).toHaveTextContent('Collection 1');
    });

    it('should call onAddToCollection when an existing collection is selected and Add is clicked', async () => {
        const user = userEvent.setup();
        render(<CollectionModal {...defaultProps} />);

        await user.click(screen.getByRole('combobox'));
        await user.click(screen.getByText('Collection 1'));
        await user.click(screen.getByRole('button', { name: 'add' }));

        expect(defaultProps.onAddToCollection).toHaveBeenCalledWith('1');
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should show no create entry and enable Add for an exact case-insensitive match', async () => {
        const user = userEvent.setup();
        render(<CollectionModal {...defaultProps} />);

        const combobox = screen.getByRole('combobox');
        await user.type(combobox, 'collection 1');
        await user.click(combobox);

        expect(screen.queryByText(/createNewCollectionLabel/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'add' })).toBeEnabled();
    });

    it('should call onCreateCollection when a new name is typed and Create is clicked', async () => {
        const user = userEvent.setup();
        render(<CollectionModal {...defaultProps} />);

        const combobox = screen.getByRole('combobox');
        await user.type(combobox, 'New Collection');
        await user.click(screen.getByRole('button', { name: 'create' }));

        expect(defaultProps.onCreateCollection).toHaveBeenCalledWith('New Collection');
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should submit the edited text instead of a stale selected collection', async () => {
        const user = userEvent.setup();
        render(<CollectionModal {...defaultProps} />);

        const combobox = screen.getByRole('combobox');
        await user.click(combobox);
        await user.click(screen.getByText('Collection 1'));
        await user.clear(combobox);
        await user.type(combobox, 'Fresh Collection');
        await user.click(screen.getByRole('button', { name: 'create' }));

        expect(defaultProps.onCreateCollection).toHaveBeenCalledWith('Fresh Collection');
        expect(defaultProps.onAddToCollection).not.toHaveBeenCalled();
    });

    it('should show a create entry at the top for non-matching input', async () => {
        const user = userEvent.setup();
        render(<CollectionModal {...defaultProps} />);

        const combobox = screen.getByRole('combobox');
        await user.type(combobox, 'Brand New');
        await user.click(combobox);

        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveTextContent('createNewCollectionLabel');
    });

    it('should show info alert if video is already in a collection', () => {
        const props = {
            ...defaultProps,
            videoCollections: [mockCollections[0]],
            onRemoveFromCollection: vi.fn().mockResolvedValue(undefined),
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
            onRemoveFromCollection: vi.fn().mockResolvedValue(undefined),
        };
        const user = userEvent.setup();
        render(<CollectionModal {...props} />);

        await user.click(screen.getByText('remove'));

        expect(props.onRemoveFromCollection).toHaveBeenCalledWith('1');
        expect(props.onClose).toHaveBeenCalled();
    });

    it('should disable collections the video already belongs to', async () => {
        const user = userEvent.setup();
        render(
            <CollectionModal
                {...defaultProps}
                videoCollections={[mockCollections[0], mockCollections[1]]}
            />
        );

        await user.click(screen.getByRole('combobox'));

        const options = screen.getAllByRole('option');
        const collection1Option = options.find((o) => o.textContent?.includes('Collection 1'));
        const collection2Option = options.find((o) => o.textContent?.includes('Collection 2'));

        expect(collection1Option).toHaveAttribute('aria-disabled', 'true');
        expect(collection2Option).toHaveAttribute('aria-disabled', 'true');
    });

    it('should keep the modal open when onAddToCollection rejects', async () => {
        const onAddToCollection = vi.fn().mockRejectedValue(new Error('fail'));
        const onClose = vi.fn();
        const user = userEvent.setup();

        render(
            <CollectionModal
                {...defaultProps}
                onAddToCollection={onAddToCollection}
                onClose={onClose}
            />
        );

        await user.click(screen.getByRole('combobox'));
        await user.click(screen.getByText('Collection 1'));
        await user.click(screen.getByRole('button', { name: 'add' }));

        await waitFor(() => {
            expect(onAddToCollection).toHaveBeenCalled();
        });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('should keep the modal open when onCreateCollection rejects', async () => {
        const onCreateCollection = vi.fn().mockRejectedValue(new Error('fail'));
        const onClose = vi.fn();
        const user = userEvent.setup();

        render(
            <CollectionModal
                {...defaultProps}
                onCreateCollection={onCreateCollection}
                onClose={onClose}
            />
        );

        const combobox = screen.getByRole('combobox');
        await user.type(combobox, 'New Collection');
        await user.click(screen.getByRole('button', { name: 'create' }));

        await waitFor(() => {
            expect(onCreateCollection).toHaveBeenCalled();
        });
        expect(onClose).not.toHaveBeenCalled();
    });
});
