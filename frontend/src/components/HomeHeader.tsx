import { Checklist, Collections as CollectionsIcon, Delete as DeleteIcon, GridView, History, Sort, Star, ViewSidebar } from '@mui/icons-material';
import { Box, Button, ButtonGroup, IconButton, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import React, { Suspense, useLayoutEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { ViewMode } from '../hooks/useViewMode';
import type { TranslationKey } from '../utils/translations';

const SortControlMenu = lazyWithRetry(
    () => import('./SortControlMenu'),
    'sort-control-menu',
);

const HEADER_CONTROL_HEIGHT = 40;

// The measured full row determines whether every label fits, including the
// current translation, filters, sidebar toggle, and selection controls.
const headerLabelSx = {
    display: 'none',
    '[data-header-labels="expanded"] &': { display: 'block' },
};
const headerIconSx = {
    mr: 0,
    '[data-header-labels="expanded"] &': { mr: 1 },
};
const viewModeButtonSx = {
    height: '100%',
    width: 40,
    minWidth: 40,
    px: 1,
    '[data-header-labels="expanded"] &': {
        width: 'auto',
        minWidth: 'auto',
        px: 2,
    },
};

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

// The active heading shares a row with icon controls on mobile. The
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
    onSelectionToggle?: () => void;
    selectionActive?: boolean;
    actionsDisabled?: boolean;
    selectedTagsCount: number;
    onDeleteFilteredClick: () => void;
    onClearTagFilter?: () => void;
    sortOption: string;
    sortAnchorEl: HTMLElement | null;
    onSortClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    onSortClose: (option?: string) => void;
}

export const HomeHeader: React.FC<HomeHeaderProps> = ({
    viewMode,
    onViewModeChange,
    onSidebarToggle,
    onSelectionToggle,
    selectionActive = false,
    actionsDisabled = false,
    selectedTagsCount,
    onDeleteFilteredClick,
    onClearTagFilter,
    sortOption,
    sortAnchorEl,
    onSortClick,
    onSortClose
}) => {
    const { t } = useLanguage();
    const isFavorite = viewMode === 'favorite';
    const viewModeLabel = getViewModeLabel(viewMode, t);
    const mobileViewModeLabel = getMobileViewModeLabel(viewMode, t);
    const rowRef = useRef<HTMLDivElement>(null);
    const hasClearTagFilter = Boolean(onClearTagFilter);

    useLayoutEffect(() => {
        const row = rowRef.current;
        if (!row) return;
        let disposed = false;
        const measure = () => {
            if (disposed) return;
            // Measure the full row without wrapping, then restore the fitting
            // mode synchronously so the measurement is never painted.
            row.dataset.headerLabels = 'expanded';
            row.dataset.measuring = 'true';
            const fits = row.scrollWidth <= row.clientWidth;
            row.dataset.headerLabels = fits ? 'expanded' : 'compact';
            delete row.dataset.measuring;
        };
        measure();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        observer?.observe(row);
        window.addEventListener('resize', measure);
        document.fonts?.addEventListener('loadingdone', measure);
        void document.fonts?.ready.then(measure);
        return () => {
            disposed = true;
            observer?.disconnect();
            window.removeEventListener('resize', measure);
            document.fonts?.removeEventListener('loadingdone', measure);
        };
    }, [t, viewMode, selectedTagsCount, hasClearTagFilter]);

    return (
        <Box sx={{ mb: 3, px: { xs: 2, sm: 0 } }}>
            <Box ref={rowRef} data-header-labels="compact" sx={{
                display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: { xs: 1, sm: 2 },
                '&[data-measuring="true"]': {
                    flexWrap: 'nowrap',
                    '& > *': { flexShrink: 0, maxWidth: 'none' },
                    '& > [data-header-controls]': { flexWrap: 'nowrap' },
                },
            }}>
                <Typography
                    variant="h5"
                    fontWeight="bold"
                    sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, md: 2 }, flex: '1 0 auto', minWidth: 0, maxWidth: '100%' }}
                >
                    <Button
                        onClick={onSidebarToggle}
                        variant="outlined"
                        sx={{
                            minWidth: 'auto',
                            p: 1,
                            flexShrink: 0,
                            display: { xs: 'none', md: 'inline-flex' },
                            color: 'text.secondary',
                            borderColor: 'text.secondary',
                        }}
                    >
                        <ViewSidebar sx={{ transform: 'rotate(180deg)' }} />
                    </Button>
                    {selectedTagsCount > 0 && viewMode !== 'favorite' && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                            {onClearTagFilter && (
                                <Button
                                    size="small"
                                    onClick={onClearTagFilter}
                                    sx={{
                                        textTransform: 'none',
                                        fontWeight: 600,
                                        minWidth: 0,
                                        px: { xs: 0.5, sm: 1 },
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {t('filteredByTags', { count: selectedTagsCount })} — {t('clear')}
                                </Button>
                            )}
                            <Tooltip title={t('deleteAllFilteredVideos')}>
                                <IconButton
                                    color="error"
                                    onClick={onDeleteFilteredClick}
                                    size="small"
                                >
                                    <DeleteIcon />
                                </IconButton>
                            </Tooltip>
                        </Box>
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
                <Box data-header-controls sx={{ display: 'flex', flexWrap: 'wrap', flexShrink: 0, maxWidth: '100%', rowGap: 1, justifyContent: 'flex-end' }}>
                    <ToggleButtonGroup
                        value={viewMode}
                        exclusive
                        onChange={(_, newMode) => newMode && onViewModeChange(newMode)}
                        size="small"
                        sx={{ height: HEADER_CONTROL_HEIGHT }}
                    >
                        <ToggleButton value="all-videos" aria-label={t('allVideos')} sx={viewModeButtonSx}>
                            <GridView fontSize="small" sx={headerIconSx} />
                            <Box component="span" sx={headerLabelSx}>
                                {t('allVideos')}
                            </Box>
                        </ToggleButton>
                        <ToggleButton value="collections" aria-label={t('collections')} sx={viewModeButtonSx}>
                            <CollectionsIcon fontSize="small" sx={headerIconSx} />
                            <Box component="span" sx={headerLabelSx}>
                                {t('collections')}
                            </Box>
                        </ToggleButton>
                        <ToggleButton value="history" aria-label={t('history')} sx={viewModeButtonSx}>
                            <History fontSize="small" sx={headerIconSx} />
                            <Box component="span" sx={headerLabelSx}>
                                {t('history')}
                            </Box>
                        </ToggleButton>
                        <ToggleButton value="favorite" aria-label={t('favorite')} sx={viewModeButtonSx}>
                            <Star fontSize="small" sx={headerIconSx} />
                            <Box component="span" sx={headerLabelSx}>
                                {t('favorite')}
                            </Box>
                        </ToggleButton>
                    </ToggleButtonGroup>
                    <Box
                        sx={{
                            display: 'flex',
                            flexShrink: 0,
                            ml: 2,
                        }}
                    >
                        <ButtonGroup
                            variant="outlined"
                            size="small"
                            sx={{
                                height: HEADER_CONTROL_HEIGHT,
                                '& .MuiButton-root': {
                                    height: '100%',
                                    minWidth: 'auto',
                                    px: 1,
                                    whiteSpace: 'nowrap',
                                    '&:not(.Mui-disabled)': {
                                        color: 'text.secondary',
                                        borderColor: 'text.secondary',
                                    },
                                },
                            }}
                        >
                            <Button
                                onClick={onSelectionToggle}
                                disabled={actionsDisabled || !onSelectionToggle}
                                title={t('bulkSelectVideos')}
                                aria-label={t('bulkSelectVideos')}
                                aria-pressed={selectionActive}
                                sx={{ bgcolor: selectionActive ? 'action.selected' : undefined }}
                            >
                                <Checklist fontSize="small" sx={headerIconSx} />
                                <Box component="span" sx={headerLabelSx}>
                                    {t('select')}
                                </Box>
                            </Button>
                            <Button
                                onClick={onSortClick}
                                aria-label={t('sort')}
                                disabled={actionsDisabled || isFavorite}
                            >
                                <Sort fontSize="small" sx={headerIconSx} />
                                <Box component="span" sx={headerLabelSx}>
                                    {t('sort')}
                                </Box>
                            </Button>
                        </ButtonGroup>
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
        </Box>
    );
};
