import { ExpandLess, ExpandMore, LocalOffer } from '@mui/icons-material';
import {
    Box,
    Chip,
    Collapse,
    ListItemButton,
    Paper,
    Typography,
    useMediaQuery,
    useTheme
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface TagsListProps {
    availableTags: string[];
    selectedTags: string[];
    onTagToggle: (tag: string) => void;
}

const TagsList: React.FC<TagsListProps> = ({ availableTags, selectedTags, onTagToggle }) => {
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

    if (!availableTags || availableTags.length === 0) {
        return null;
    }

    return (
        <Paper elevation={0} sx={{ bgcolor: 'transparent' }}>
            <ListItemButton onClick={() => setIsOpen(!isOpen)} sx={{ borderRadius: 1, mb: 1 }}>
                <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 600 }}>
                    {t('tags') || 'Tags'}
                </Typography>
                {isOpen ? <ExpandLess /> : <ExpandMore />}
            </ListItemButton>
            <Collapse in={isOpen} timeout="auto" unmountOnExit>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, px: 2, pb: 2 }}>
                    {availableTags.map(tag => {
                        const isSelected = selectedTags.includes(tag);
                        return (
                            <Chip
                                key={tag}
                                label={tag}
                                onClick={() => onTagToggle(tag)}
                                color={isSelected ? "primary" : "default"}
                                variant={isSelected ? "filled" : "outlined"}
                                icon={isSelected ? <LocalOffer sx={{ fontSize: '1rem !important' }} /> : undefined}
                                sx={{
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    '&:hover': {
                                        bgcolor: isSelected ? 'primary.dark' : 'action.hover'
                                    }
                                }}
                            />
                        );
                    })}
                </Box>
            </Collapse>
        </Paper>
    );
};

export default TagsList;
