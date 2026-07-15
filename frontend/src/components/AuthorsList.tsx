import { ExpandLess, ExpandMore, GridView } from '@mui/icons-material';
import {
    Avatar,
    Collapse,
    IconButton,
    List,
    ListItemButton,
    ListItemText,
    Paper,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useCloudStorageUrl } from '../hooks/useCloudStorageUrl';
import { Video } from '../types';
import { authorAvatarFallbackSx } from '../utils/authorAvatarStyles';

interface AuthorsListProps {
    videos: Video[];
    onItemClick?: () => void;
}

interface AuthorListItemProps {
    author: string;
    avatarPath?: string | null;
    onItemClick?: () => void;
}

// Memoized component to prevent unnecessary re-renders
const AuthorListItem: React.FC<AuthorListItemProps> = React.memo(({ author, avatarPath, onItemClick }) => {
    const avatarUrl = useCloudStorageUrl(avatarPath, 'thumbnail');

    return (
        <ListItemButton
            component={Link}
            to={`/author/${encodeURIComponent(author)}`}
            onClick={onItemClick}
            sx={{ pl: 2, borderRadius: 1, minWidth: 0 }}
        >
            <Avatar
                src={avatarUrl || undefined}
                sx={[authorAvatarFallbackSx, {
                    width: 24,
                    height: 24,
                    mr: 1,
                    flexShrink: 0,
                    fontSize: '0.75rem'
                }]}
            >
                {author ? author.charAt(0).toUpperCase() : 'A'}
            </Avatar>
            <ListItemText
                primary={author}
                sx={{ minWidth: 0 }}
                primaryTypographyProps={{
                    variant: 'body2',
                    noWrap: true
                }}
            />
        </ListItemButton>
    );
}, (prevProps, nextProps) => {
    // Custom comparison function for React.memo
    // Only re-render if author or avatarPath changes
    return prevProps.author === nextProps.author &&
           prevProps.avatarPath === nextProps.avatarPath &&
           prevProps.onItemClick === nextProps.onItemClick;
});

AuthorListItem.displayName = 'AuthorListItem';

const TOP_AUTHORS_LIMIT = 20;

const AuthorsList: React.FC<AuthorsListProps> = ({ videos, onItemClick }) => {
    const { t } = useLanguage();
    const [isOpen, setIsOpen] = useState<boolean>(true);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    // Count videos per author, then show only the most prolific authors.
    // "Show all" (and the full /authors page) only matters when the list is
    // actually truncated.
    const { topAuthors, hasMore } = useMemo(() => {
        if (!videos || videos.length === 0) {
            return { topAuthors: [] as string[], hasMore: false };
        }

        const counts = new Map<string, number>();
        videos.forEach(video => {
            if (video.author) {
                counts.set(video.author, (counts.get(video.author) ?? 0) + 1);
            }
        });

        const sorted = [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([author]) => author);

        return {
            topAuthors: sorted.slice(0, TOP_AUTHORS_LIMIT),
            hasMore: sorted.length > TOP_AUTHORS_LIMIT,
        };
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

    if (!topAuthors.length) {
        return null;
    }

    return (
        <Paper elevation={0} sx={{ bgcolor: 'transparent' }}>
            <ListItemButton onClick={() => setIsOpen(!isOpen)} sx={{ borderRadius: 1, minWidth: 0 }}>
                <Typography variant="h6" component="div" noWrap sx={{ flexGrow: 1, minWidth: 0, fontWeight: 600 }}>
                    {t('authors')}
                </Typography>
                <IconButton
                    component={Link}
                    to="/authors"
                    size="small"
                    aria-label={t('all')}
                    title={t('all')}
                    onClick={(e) => {
                        e.stopPropagation();
                        onItemClick?.();
                    }}
                    sx={{ mr: 1 }}
                >
                    <GridView fontSize="small" />
                </IconButton>
                {isOpen ? <ExpandLess /> : <ExpandMore />}
            </ListItemButton>
            <Collapse in={isOpen} timeout="auto" unmountOnExit>
                <List component="div" disablePadding>
                    {topAuthors.map(author => (
                        <AuthorListItem
                            key={author}
                            author={author}
                            avatarPath={authorAvatarMap.get(author)}
                            onItemClick={onItemClick}
                        />
                    ))}
                    {hasMore && (
                        <ListItemButton
                            component={Link}
                            to="/authors"
                            onClick={onItemClick}
                            sx={{ pl: 2, borderRadius: 1 }}
                        >
                            <ListItemText
                                primary={t('showAll')}
                                primaryTypographyProps={{
                                    variant: 'body2',
                                    color: 'primary',
                                    fontWeight: 600,
                                }}
                            />
                        </ListItemButton>
                    )}
                </List>
            </Collapse>
        </Paper>
    );
};

export default AuthorsList;
