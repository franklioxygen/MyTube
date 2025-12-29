import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CommentsSection from '../CommentsSection';

// Mock language context
vi.mock('../../../contexts/LanguageContext', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('CommentsSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const defaultProps = {
        comments: [],
        loading: false,
        showComments: true,
        onToggleComments: vi.fn(),
    };

    it('should render comments header', () => {
        render(<CommentsSection {...defaultProps} />);
        expect(screen.getByText('latestComments')).toBeInTheDocument();
    });

    it('should render list of comments', () => {
        const comments = [
            { id: '1', author: 'User 1', content: 'Comment 1', date: '2023-01-01', avatar: 'avatar1.png' },
            { id: '2', author: 'User 2', content: 'Comment 2', date: '2023-01-02', avatar: 'avatar2.png' },
        ];
        render(<CommentsSection {...defaultProps} comments={comments} />);

        expect(screen.getByText('User 1')).toBeInTheDocument();
        expect(screen.getByText('Comment 1')).toBeInTheDocument();
        expect(screen.getByText('User 2')).toBeInTheDocument();
        expect(screen.getByText('Comment 2')).toBeInTheDocument();
    });

    it('should render empty state message if no comments', () => {
        render(<CommentsSection {...defaultProps} comments={[]} />);
        expect(screen.getByText('noComments')).toBeInTheDocument();
    });
});
