import { Collections as CollectionsIcon, Delete as DeleteIcon, GridView, History, Sort, ViewSidebar } from '@mui/icons-material';
import { Box, Button, IconButton, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import React, { Suspense, lazy } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { ViewMode } from '../hooks/useViewMode';

const SortControlMenu = lazy(() => import('./SortControlMenu'));

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

    return (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, px: { xs: 2, sm: 0 } }}>
            <Typography variant="h5" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
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
                {selectedTagsCount > 0 && (
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
                <Box component="span" sx={{ display: { xs: 'block', md: 'none' } }}>
                    {{
                        'collections': t('collections'),
                        'all-videos': t('allVideos'),
                        'history': t('history')
                    }[viewMode]}
                </Box>
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
                <ToggleButtonGroup
                    value={viewMode}
                    exclusive
                    onChange={(_, newMode) => newMode && onViewModeChange(newMode)}
                    size="small"
                >
                    <ToggleButton value="all-videos" sx={{ px: { xs: 2, md: 2 } }}>
                        <GridView fontSize="small" sx={{ mr: { xs: 0, md: 1 } }} />
                        <Box component="span" sx={{ display: { xs: 'none', md: 'block' } }}>
                            {t('allVideos')}
                        </Box>
                    </ToggleButton>
                    <ToggleButton value="collections" sx={{ px: { xs: 2, md: 2 } }}>
                        <CollectionsIcon fontSize="small" sx={{ mr: { xs: 0, md: 1 } }} />
                        <Box component="span" sx={{ display: { xs: 'none', md: 'block' } }}>
                            {t('collections')}
                        </Box>
                    </ToggleButton>
                    <ToggleButton value="history" sx={{ px: { xs: 2, md: 2 } }}>
                        <History fontSize="small" sx={{ mr: { xs: 0, md: 1 } }} />
                        <Box component="span" sx={{ display: { xs: 'none', md: 'block' } }}>
                            {t('history')}
                        </Box>
                    </ToggleButton>
                </ToggleButtonGroup>

                <Box sx={{ display: 'flex' }}>
                    <Button
                        variant="outlined"
                        onClick={onSortClick}
                        size="small"
                        sx={{
                            minWidth: 'auto',
                            px: { xs: 1, md: 2 },
                            height: '100%',
                            color: 'text.secondary',
                            borderColor: 'text.secondary',
                        }}
                    >
                        <Sort fontSize="small" sx={{ mr: { xs: 0, md: 1 } }} />
                        <Box component="span" sx={{ display: { xs: 'none', md: 'block' } }}>
                            {t('sort')}
                        </Box>
                    </Button>
                    {sortAnchorEl && (
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
