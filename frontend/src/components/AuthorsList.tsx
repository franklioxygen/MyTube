import { ExpandLess, ExpandMore } from '@mui/icons-material';
import {
    Avatar,
    Collapse,
    List,
    ListItemButton,
    ListItemText,
    Paper,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useCloudStorageUrl } from '../hooks/useCloudStorageUrl';
import { Video } from '../types';

interface AuthorsListProps {
    videos: Video[];
    onItemClick?: () => void;
}

const AuthorsList: React.FC<AuthorsListProps> = ({ videos, onItemClick }) => {
    const { t } = useLanguage();
    const [isOpen, setIsOpen] = useState<boolean>(true);
    const [authors, setAuthors] = useState<string[]>([]);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    useEffect(() => {
        // Extract unique authors from videos
        if (videos && videos.length > 0) {
            const uniqueAuthors = [...new Set(videos.map(video => video.author))]
                .filter(author => author) // Filter out null/undefined authors
                .sort((a, b) => a.localeCompare(b)); // Sort alphabetically

            setAuthors(uniqueAuthors);
        } else {
            setAuthors([]);
        }
    }, [videos]);

    // Create a map of author to their avatar path (from first video with avatar)
    const authorAvatarMap = useMemo(() => {
        const map = new Map<string, string | null | undefined>();
        if (videos && videos.length > 0) {
            videos.forEach(video => {
                if (video.author && !map.has(video.author) && video.authorAvatarPath) {
                    map.set(video.author, video.authorAvatarPath);
                }
            });
        }
        return map;
    }, [videos]);

    // Auto-collapse on mobile by default
    useEffect(() => {
        if (isMobile) {
            setIsOpen(false);
        } else {
            setIsOpen(true);
        }
    }, [isMobile]);

    // Component for individual author item with avatar
    const AuthorListItem: React.FC<{
        author: string;
        avatarPath?: string | null;
        onItemClick?: () => void;
    }> = ({ author, avatarPath, onItemClick }) => {
        const avatarUrl = useCloudStorageUrl(avatarPath, 'thumbnail');

        return (
            <ListItemButton
                component={Link}
                to={`/author/${encodeURIComponent(author)}`}
                onClick={onItemClick}
                sx={{ pl: 2, borderRadius: 1 }}
            >
                <Avatar
                    src={avatarUrl || undefined}
                    sx={{
                        width: 24,
                        height: 24,
                        bgcolor: 'primary.main',
                        mr: 1,
                        fontSize: '0.75rem'
                    }}
                >
                    {author ? author.charAt(0).toUpperCase() : 'A'}
                </Avatar>
                <ListItemText
                    primary={author}
                    primaryTypographyProps={{
                        variant: 'body2',
                        noWrap: true
                    }}
                />
            </ListItemButton>
        );
    };

    if (!authors.length) {
        return null;
    }

    return (
        <Paper elevation={0} sx={{ bgcolor: 'transparent' }}>
            <ListItemButton onClick={() => setIsOpen(!isOpen)} sx={{ borderRadius: 1 }}>
                <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 600 }}>
                    {t('authors')}
                </Typography>
                {isOpen ? <ExpandLess /> : <ExpandMore />}
            </ListItemButton>
            <Collapse in={isOpen} timeout="auto" unmountOnExit>
                <List component="div" disablePadding>
                    {authors.map(author => (
                        <AuthorListItem
                            key={author}
                            author={author}
                            avatarPath={authorAvatarMap.get(author)}
                            onItemClick={onItemClick}
                        />
                    ))}
                </List>
            </Collapse>
        </Paper>
    );
};

export default AuthorsList;
