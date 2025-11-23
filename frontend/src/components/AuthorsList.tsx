import { ExpandLess, ExpandMore, Person } from '@mui/icons-material';
import {
    Collapse,
    List,
    ListItemButton,
    ListItemText,
    Paper,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
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

    // Auto-collapse on mobile by default
    useEffect(() => {
        if (isMobile) {
            setIsOpen(false);
        } else {
            setIsOpen(true);
        }
    }, [isMobile]);

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
                        <ListItemButton
                            key={author}
                            component={Link}
                            to={`/author/${encodeURIComponent(author)}`}
                            onClick={onItemClick}
                            sx={{ pl: 2, borderRadius: 1 }}
                        >
                            <Person fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
                            <ListItemText
                                primary={author}
                                primaryTypographyProps={{
                                    variant: 'body2',
                                    noWrap: true
                                }}
                            />
                        </ListItemButton>
                    ))}
                </List>
            </Collapse>
        </Paper>
    );
};

export default AuthorsList;
