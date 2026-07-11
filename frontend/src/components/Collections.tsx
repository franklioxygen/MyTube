import { ExpandLess, ExpandMore, Folder, GridView } from '@mui/icons-material';
import {
    Chip,
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
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { Collection } from '../types';

interface CollectionsProps {
    collections: Collection[];
    onItemClick?: () => void;
}

const TOP_COLLECTIONS_LIMIT = 20;

const Collections: React.FC<CollectionsProps> = ({ collections, onItemClick }) => {
    const { t } = useLanguage();
    const [isOpen, setIsOpen] = useState<boolean>(true);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const sidebarCollections = useMemo(() => {
        if (!collections) {
            return [] as Collection[];
        }

        const sortedCollections = [...collections].sort((a, b) =>
            (b.videos?.length ?? 0) - (a.videos?.length ?? 0) ||
            a.name.localeCompare(b.name)
        );
        const topCollections = sortedCollections.slice(0, TOP_COLLECTIONS_LIMIT);
        const topCollectionIds = new Set(topCollections.map(collection => collection.id));
        const firstVideoIdCounts = new Map<string, number>();
        for (const collection of collections) {
            const firstVideoId = collection.videos?.[0];
            if (firstVideoId) {
                firstVideoIdCounts.set(firstVideoId, (firstVideoIdCounts.get(firstVideoId) ?? 0) + 1);
            }
        }
        const omittedDirectLinkCollections = sortedCollections.filter(collection => {
            if (topCollectionIds.has(collection.id)) {
                return false;
            }

            if ((collection.videos?.length ?? 0) === 0) {
                return true;
            }

            const firstVideoId = collection.videos?.[0];
            return firstVideoId ? (firstVideoIdCounts.get(firstVideoId) ?? 0) > 1 : false;
        });

        return [...topCollections, ...omittedDirectLinkCollections];
    }, [collections]);

    // Auto-collapse on mobile by default
    useEffect(() => {
        if (isMobile) {
            setIsOpen(false);
        } else {
            setIsOpen(true);
        }
    }, [isMobile]);

    if (!collections || collections.length === 0) {
        return null;
    }

    return (
        <Paper elevation={0} sx={{ bgcolor: 'transparent' }}>
            <ListItemButton onClick={() => setIsOpen(!isOpen)} sx={{ borderRadius: 1 }}>
                <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 600 }}>
                    {t('collections')}
                </Typography>
                <IconButton
                    component={Link}
                    to="/collections"
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
                    {sidebarCollections.map(collection => (
                        <ListItemButton
                            key={collection.id}
                            component={Link}
                            to={`/collection/${collection.id}`}
                            onClick={onItemClick}
                            sx={{ pl: 2, borderRadius: 1 }}
                        >
                            <Folder fontSize="small" sx={{ mr: 1, color: 'secondary.main' }} />
                            <ListItemText
                                primary={collection.name}
                                slotProps={{
                                    primary: {
                                        variant: 'body2',
                                        noWrap: true
                                    }
                                }}
                            />
                            <Chip
                                label={`${Math.floor(collection.videos?.length || 0)}`}
                                size="small"
                                variant="outlined"
                                sx={{
                                    height: 20,
                                    minWidth: 20,
                                    ml: 1,
                                    flexShrink: 0,
                                    '& .MuiChip-label': {
                                        padding: '0 6px',
                                        fontSize: '0.75rem'
                                    }
                                }}
                            />
                        </ListItemButton>
                    ))}
                    {collections.length > TOP_COLLECTIONS_LIMIT && (
                        <ListItemButton
                            component={Link}
                            to="/collections"
                            onClick={onItemClick}
                            sx={{ pl: 2, borderRadius: 1 }}
                        >
                            <ListItemText
                                primary={t('showAll')}
                                slotProps={{
                                    primary: {
                                        variant: 'body2',
                                        color: 'primary',
                                        fontWeight: 600
                                    }
                                }}
                            />
                        </ListItemButton>
                    )}
                </List>
            </Collapse>
        </Paper>
    );
};

export default Collections;
