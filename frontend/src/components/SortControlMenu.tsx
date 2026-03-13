import { AccessTime, Shuffle, SortByAlpha, Visibility } from '@mui/icons-material';
import { ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface SortControlMenuProps {
    sortOption: string;
    sortAnchorEl: null | HTMLElement;
    onSortClose: (option?: string) => void;
}

const SortControlMenu: React.FC<SortControlMenuProps> = ({
    sortOption,
    sortAnchorEl,
    onSortClose
}) => {
    const { t } = useLanguage();

    return (
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
            <MenuItem onClick={() => onSortClose('videoDateDesc')} selected={sortOption === 'videoDateDesc'}>
                <ListItemIcon>
                    <AccessTime fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('videoDateDesc')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => onSortClose('videoDateAsc')} selected={sortOption === 'videoDateAsc'}>
                <ListItemIcon>
                    <AccessTime fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('videoDateAsc')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => onSortClose('random')} selected={sortOption === 'random'}>
                <ListItemIcon>
                    <Shuffle fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('random')}</ListItemText>
            </MenuItem>
        </Menu>
    );
};

export default SortControlMenu;
