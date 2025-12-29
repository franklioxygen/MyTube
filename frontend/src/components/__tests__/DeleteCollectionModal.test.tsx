import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DeleteCollectionModal from '../DeleteCollectionModal';

// Mock language context
vi.mock('../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('DeleteCollectionModal', () => {
    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        onDeleteCollectionOnly: vi.fn(),
        onDeleteCollectionAndVideos: vi.fn(),
        collectionName: 'My Collection',
        videoCount: 0,
    };

    it('should render when open', () => {
        render(<DeleteCollectionModal {...defaultProps} />);
        expect(screen.getByText('deleteCollectionTitle')).toBeInTheDocument();
        expect(screen.getByText(/My Collection/)).toBeInTheDocument();
    });

    it('should show video count message', () => {
        render(<DeleteCollectionModal {...defaultProps} videoCount={5} />);
        expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should call onClose when cancel is clicked', async () => {
        const user = userEvent.setup();
        render(<DeleteCollectionModal {...defaultProps} />);
        await user.click(screen.getByText('cancel'));
        expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('should call onDeleteCollectionOnly when corresponding button is clicked', async () => {
        const user = userEvent.setup();
        render(<DeleteCollectionModal {...defaultProps} />);
        const btn = screen.getByText('deleteCollectionOnly');
        await user.click(btn);
        expect(defaultProps.onDeleteCollectionOnly).toHaveBeenCalled();
    });

    it('should call onDeleteCollectionAndVideos when corresponding button is clicked', async () => {
        const user = userEvent.setup();
        render(<DeleteCollectionModal {...defaultProps} videoCount={5} />);
        const btn = screen.getByText('deleteCollectionAndVideos');
        await user.click(btn);
        expect(defaultProps.onDeleteCollectionAndVideos).toHaveBeenCalled();
    });

    it('should NOT render deleteCollectionAndVideos button if videoCount is 0', () => {
        render(<DeleteCollectionModal {...defaultProps} videoCount={0} />);
        expect(screen.queryByText('deleteCollectionAndVideos')).not.toBeInTheDocument();
    });
});
