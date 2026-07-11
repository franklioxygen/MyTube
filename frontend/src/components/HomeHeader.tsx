import { Collections as CollectionsIcon, Delete as DeleteIcon, GridView, History, Sort, Star, ViewSidebar } from '@mui/icons-material';
import { Box, Button, IconButton, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import React, { Suspense } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { ViewMode } from '../hooks/useViewMode';
import type { TranslationKey } from '../utils/translations';

const SortControlMenu = lazyWithRetry(
    () => import('./SortControlMenu'),
    'sort-control-menu',
);

const getViewModeLabel = (
    viewMode: ViewMode,
    t: (key: TranslationKey) => string
): string => {
    switch (viewMode) {
        case 'collections':
            return t('collections');
        case 'history':
            return t('history');
        case 'favorite':
            return t('favorite');
        case 'all-videos':
        default:
            return t('allVideos');
    }
};

// The active heading shares a row with five icon controls on mobile. The
// shorter label keeps translated copy from wrapping into the controls while
// the controls themselves still convey that this is the "all" view.
const getMobileViewModeLabel = (
    viewMode: ViewMode,
    t: (key: TranslationKey) => string
): string => viewMode === 'all-videos' ? t('videos') : getViewModeLabel(viewMode, t);

interface HomeHeaderProps {
    viewMode: ViewMode;
    onViewModeChange: (mode: ViewMode) => void;
    onSidebarToggle: () => void;
    selectedTagsCount: number;
    onDeleteFilteredClick: () => void;
    sortOption: string;
    sortAnchorEl: HTMLElement | null;
    onSortClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    onSortClose: (option?: string) => void;
}

export const HomeHeader: React.FC<HomeHeaderProps> = ({
    viewMode,
    onViewModeChange,
    onSidebarToggle,
    selectedTagsCount,
    onDeleteFilteredClick,
    sortOption,
    sortAnchorEl,
    onSortClick,
    onSortClose
}) => {
    const { t } = useLanguage();
    const isFavorite = viewMode === 'favorite';
    const viewModeLabel = getViewModeLabel(viewMode, t);
    const mobileViewModeLabel = getMobileViewModeLabel(viewMode, t);

    return (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: { xs: 1, sm: 2 }, mb: 3, px: { xs: 2, sm: 0 } }}>
            <Typography
                variant="h5"
                fontWeight="bold"
                sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: '1 1 auto', minWidth: 0 }}
            >
                <Button
                    onClick={onSidebarToggle}
                    variant="outlined"
                    sx={{
                        minWidth: 'auto',
                        p: 1,
                        display: { xs: 'none', md: 'inline-flex' },
                        color: 'text.secondary',
                        borderColor: 'text.secondary',
                    }}
                >
                    <ViewSidebar sx={{ transform: 'rotate(180deg)' }} />
                </Button>
                {selectedTagsCount > 0 && viewMode !== 'favorite' && (
                    <Tooltip title={t('deleteAllFilteredVideos')}>
                        <IconButton
                            color="error"
                            onClick={onDeleteFilteredClick}
                            size="small"
                            sx={{ ml: 1 }}
                        >
                            <DeleteIcon />
                        </IconButton>
                    </Tooltip>
                )}
                <Box
                    component="span"
                    aria-label={viewModeLabel}
                    title={viewModeLabel}
                    sx={{
                        display: { xs: 'block', md: 'none' },
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {mobileViewModeLabel}
                </Box>
            </Typography>
            <Box sx={{ display: 'flex', flexShrink: 0 }}>
                <ToggleButtonGroup
                    value={viewMode}
                    exclusive
                    onChange={(_, newMode) => newMode && onViewModeChange(newMode)}
                    size="small"
                >
                    <ToggleButton value="all-videos" aria-label={t('allVideos')} sx={{ width: { xs: 50, md: 'auto' }, minWidth: { xs: 50, md: 'auto' }, px: { xs: 1, md: 2 } }}>
                        <GridView fontSize="small" sx={{ mr: { xs: 0, md: 1 } }} />
                        <Box component="span" sx={{ display: { xs: 'none', md: 'block' } }}>
                            {t('allVideos')}
                        </Box>
                    </ToggleButton>
                    <ToggleButton value="collections" aria-label={t('collections')} sx={{ width: { xs: 50, md: 'auto' }, minWidth: { xs: 50, md: 'auto' }, px: { xs: 1, md: 2 } }}>
                        <CollectionsIcon fontSize="small" sx={{ mr: { xs: 0, md: 1 } }} />
                        <Box component="span" sx={{ display: { xs: 'none', md: 'block' } }}>
                            {t('collections')}
                        </Box>
                    </ToggleButton>
                    <ToggleButton value="history" aria-label={t('history')} sx={{ width: { xs: 50, md: 'auto' }, minWidth: { xs: 50, md: 'auto' }, px: { xs: 1, md: 2 } }}>
                        <History fontSize="small" sx={{ mr: { xs: 0, md: 1 } }} />
                        <Box component="span" sx={{ display: { xs: 'none', md: 'block' } }}>
                            {t('history')}
                        </Box>
                    </ToggleButton>
                    <ToggleButton value="favorite" aria-label={t('favorite')} sx={{ width: { xs: 50, md: 'auto' }, minWidth: { xs: 50, md: 'auto' }, px: { xs: 1, md: 2 } }}>
                        <Star fontSize="small" sx={{ mr: { xs: 0, md: 1 } }} />
                        <Box component="span" sx={{ display: { xs: 'none', md: 'block' } }}>
                            {t('favorite')}
                        </Box>
                    </ToggleButton>
                </ToggleButtonGroup>

                {/* Kept mounted so it can slide out to the right (rather than
                    vanish) when the Favorite tab hides sorting. */}
                <Box
                    aria-hidden={isFavorite}
                    sx={{
                        display: 'flex',
                        overflow: 'hidden',
                        transition: 'max-width 0.3s ease, opacity 0.3s ease, transform 0.3s ease, margin-left 0.3s ease',
                        maxWidth: isFavorite ? 0 : 160,
                        ml: isFavorite ? 0 : 2,
                        opacity: isFavorite ? 0 : 1,
                        transform: isFavorite ? 'translateX(24px)' : 'translateX(0)',
                        pointerEvents: isFavorite ? 'none' : 'auto',
                    }}
                >
                    <Button
                        variant="outlined"
                        onClick={onSortClick}
                        size="small"
                        tabIndex={isFavorite ? -1 : undefined}
                        sx={{
                            minWidth: 'auto',
                            px: { xs: 1, md: 2 },
                            height: '100%',
                            color: 'text.secondary',
                            borderColor: 'text.secondary',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        <Sort fontSize="small" sx={{ mr: { xs: 0, md: 1 } }} />
                        <Box component="span" sx={{ display: { xs: 'none', md: 'block' } }}>
                            {t('sort')}
                        </Box>
                    </Button>
                    {sortAnchorEl && !isFavorite && (
                        <Suspense fallback={null}>
                            <SortControlMenu
                                sortOption={sortOption}
                                sortAnchorEl={sortAnchorEl}
                                onSortClose={onSortClose}
                            />
                        </Suspense>
                    )}
                </Box>
            </Box>
        </Box>
    );
};
