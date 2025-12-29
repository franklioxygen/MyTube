import { ExpandLess, ExpandMore, Folder } from '@mui/icons-material';
import {
    Chip,
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
import { Collection } from '../types';

interface CollectionsProps {
    collections: Collection[];
    onItemClick?: () => void;
}

const Collections: React.FC<CollectionsProps> = ({ collections, onItemClick }) => {
    const { t } = useLanguage();
    const [isOpen, setIsOpen] = useState<boolean>(true);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

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
                {isOpen ? <ExpandLess /> : <ExpandMore />}
            </ListItemButton>
            <Collapse in={isOpen} timeout="auto" unmountOnExit>
                <List component="div" disablePadding>
                    {collections.map(collection => (
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
                </List>
            </Collapse>
        </Paper>
    );
};

export default Collections;
