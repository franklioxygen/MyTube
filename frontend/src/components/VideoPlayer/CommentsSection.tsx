import {
    Avatar,
    Box,
    Button,
    CircularProgress,
    Stack,
    Typography
} from '@mui/material';
import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Comment } from '../../types';

interface CommentsSectionProps {
    comments: Comment[];
    loading: boolean;
    showComments: boolean;
    onToggleComments: () => void;
}

const CommentsSection: React.FC<CommentsSectionProps> = ({
    comments,
    loading,
    showComments,
    onToggleComments
}) => {
    const { t } = useLanguage();

    return (
        <Box sx={{ mt: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" fontWeight="bold">
                    {t('latestComments')}
                </Typography>
                <Button
                    variant="outlined"
                    onClick={onToggleComments}
                    size="small"
                >
                    {showComments ? "Hide Comments" : "Show Comments"}
                </Button>
            </Box>

            {showComments && (
                <>
                    {loading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                            <CircularProgress size={24} />
                        </Box>
                    ) : comments.length > 0 ? (
                        <Stack spacing={2}>
                            {comments.map((comment) => (
                                <Box key={comment.id} sx={{ display: 'flex', gap: 2 }}>
                                    <Avatar src={comment.avatar} alt={comment.author}>
                                        {comment.author.charAt(0).toUpperCase()}
                                    </Avatar>
                                    <Box sx={{ flex: 1 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                            <Typography variant="subtitle2" fontWeight="bold">
                                                {comment.author}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {comment.date}
                                            </Typography>
                                        </Box>
                                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                                            {comment.content}
                                        </Typography>
                                    </Box>
                                </Box>
                            ))}
                        </Stack>
                    ) : (
                        <Typography variant="body2" color="text.secondary">
                            {t('noComments')}
                        </Typography>
                    )}
                </>
            )}
        </Box>
    );
};

export default CommentsSection;
