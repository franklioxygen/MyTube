import { Sort } from '@mui/icons-material';
import { Box, Button, SxProps, Theme } from '@mui/material';
import React, { Suspense, lazy } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

const SortControlMenu = lazy(() => import('./SortControlMenu'));

interface SortControlProps {
    sortOption: string;
    sortAnchorEl: null | HTMLElement;
    onSortClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    onSortClose: (option?: string) => void;
    sx?: SxProps<Theme>;
}

const SortControl: React.FC<SortControlProps> = ({
    sortOption,
    sortAnchorEl,
    onSortClick,
    onSortClose,
    sx
}) => {
    const { t } = useLanguage();

    return (
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
                    ...sx
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
    );
};

export default SortControl;
