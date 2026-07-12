import { ExpandLess, ExpandMore, GridView, LocalOffer } from '@mui/icons-material';
import {
    Box,
    Chip,
    Collapse,
    IconButton,
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
import { normalizeTagKey, sortTagsByUsage } from '../utils/tagUtils';

const TOP_TAGS_LIMIT = 20;

interface TagsListProps {
    availableTags: string[];
    selectedTags: string[];
    onTagToggle: (tag: string) => void;
    onItemClick?: () => void;
    /** When provided, sidebar tags are ranked by explicit video.tags usage. */
    videos?: Array<{ tags?: string[] }>;
    /**
     * Home / mobile menu: cap at top N and link to global /tags.
     * Author / collection sidebars: show every page-local tag, no global link.
     */
    linkToAllTags?: boolean;
}

const TagsList: React.FC<TagsListProps> = ({
    availableTags,
    selectedTags,
    onTagToggle,
    onItemClick,
    videos,
    linkToAllTags = false,
}) => {
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

    const { displayTags, hasMore } = useMemo(() => {
        if (!availableTags || availableTags.length === 0) {
            return { displayTags: [] as string[], hasMore: false };
        }

        const ordered = videos
            ? sortTagsByUsage(availableTags, videos)
            : [...availableTags];

        if (!linkToAllTags) {
            return { displayTags: ordered, hasMore: false };
        }

        const top = ordered.slice(0, TOP_TAGS_LIMIT);
        const topKeys = new Set(top.map(normalizeTagKey));
        const catalogByKey = new Map(
            availableTags.map((tag) => [normalizeTagKey(tag), tag])
        );
        // Keep selected tags visible even when they fall outside the top N.
        // Match case-insensitively so thumbnail-selected casing still maps to catalog.
        const selectedOutsideTop: string[] = [];
        const seenKeys = new Set(topKeys);
        for (const tag of selectedTags) {
            const canonical = catalogByKey.get(normalizeTagKey(tag));
            if (!canonical) continue;
            const key = normalizeTagKey(canonical);
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            selectedOutsideTop.push(canonical);
        }

        return {
            displayTags: [...top, ...selectedOutsideTop],
            hasMore: ordered.length > TOP_TAGS_LIMIT,
        };
    }, [availableTags, linkToAllTags, videos, selectedTags]);

    const selectedTagKeys = useMemo(
        () => new Set(selectedTags.map(normalizeTagKey)),
        [selectedTags]
    );
    if (displayTags.length === 0) {
        return null;
    }

    return (
        <Paper elevation={0} sx={{ bgcolor: 'transparent' }}>
            <ListItemButton onClick={() => setIsOpen(!isOpen)} sx={{ borderRadius: 1, mb: 1 }}>
                <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 600 }}>
                    {t('tags') || 'Tags'}
                </Typography>
                {linkToAllTags && (
                    <IconButton
                        component={Link}
                        to="/tags"
                        size="small"
                        aria-label={t('allTags')}
                        title={t('allTags')}
                        onClick={(e) => {
                            e.stopPropagation();
                            onItemClick?.();
                        }}
                        sx={{ mr: 1 }}
                    >
                        <GridView fontSize="small" />
                    </IconButton>
                )}
                {isOpen ? <ExpandLess /> : <ExpandMore />}
            </ListItemButton>
            <Collapse in={isOpen} timeout="auto" unmountOnExit>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, px: 2, pb: 2 }}>
                    {displayTags.map(tag => {
                        const isSelected = selectedTagKeys.has(normalizeTagKey(tag));
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
                                    transition: 'background-color 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s',
                                    '&:hover': {
                                        bgcolor: isSelected ? 'primary.dark' : 'action.hover'
                                    }
                                }}
                            />
                        );
                    })}
                </Box>
                {linkToAllTags && hasMore && (
                    <ListItemButton
                        component={Link}
                        to="/tags"
                        onClick={onItemClick}
                        sx={{ pl: 2, borderRadius: 1, mb: 1 }}
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
            </Collapse>
        </Paper>
    );
};

export default TagsList;
