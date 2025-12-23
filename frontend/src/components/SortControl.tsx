import { AccessTime, Shuffle, Sort, SortByAlpha, Visibility } from '@mui/icons-material';
import { Box, Button, ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface SortControlProps {
    sortOption: string;
    sortAnchorEl: null | HTMLElement;
    onSortClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    onSortClose: (option?: string) => void;
}

const SortControl: React.FC<SortControlProps> = ({
    sortOption,
    sortAnchorEl,
    onSortClick,
    onSortClose
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
                    borderColor: 'text.secondary'
                }}
            >
                <Sort fontSize="small" sx={{ mr: { xs: 0, md: 1 } }} />
                <Box component="span" sx={{ display: { xs: 'none', md: 'block' } }}>
                    {t('sort')}
                </Box>
            </Button>
            <Menu
                anchorEl={sortAnchorEl}
                open={Boolean(sortAnchorEl)}
                onClose={() => onSortClose()}
            >
                <MenuItem onClick={() => onSortClose('dateDesc')} selected={sortOption === 'dateDesc'}>
                    <ListItemIcon>
                        <AccessTime fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>{t('dateDesc')}</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => onSortClose('dateAsc')} selected={sortOption === 'dateAsc'}>
                    <ListItemIcon>
                        <AccessTime fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>{t('dateAsc')}</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => onSortClose('viewsDesc')} selected={sortOption === 'viewsDesc'}>
                    <ListItemIcon>
                        <Visibility fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>{t('viewsDesc')}</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => onSortClose('viewsAsc')} selected={sortOption === 'viewsAsc'}>
                    <ListItemIcon>
                        <Visibility fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>{t('viewsAsc')}</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => onSortClose('nameAsc')} selected={sortOption === 'nameAsc'}>
                    <ListItemIcon>
                        <SortByAlpha fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>{t('nameAsc')}</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => onSortClose('random')} selected={sortOption === 'random'}>
                    <ListItemIcon>
                        <Shuffle fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>{t('random')}</ListItemText>
                </MenuItem>
            </Menu>
        </Box>
    );
};

export default SortControl;
