import { Help, Settings, Subscriptions, VideoLibrary } from '@mui/icons-material';
import {
    Fade,
    Menu,
    MenuItem
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';

interface ManageMenuProps {
    anchorEl: HTMLElement | null;
    onClose: () => void;
}

const ManageMenu: React.FC<ManageMenuProps> = ({
    anchorEl,
    onClose
}) => {
    const navigate = useNavigate();
    const { t } = useLanguage();

    return (
        <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={onClose}
                slotProps={{
                    paper: {
                        elevation: 0,
                        sx: {
                            overflow: 'visible',
                            filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
                            mt: 1.5,
                            width: 320,
                            '&:before': {
                                content: '""',
                                display: 'block',
                                position: 'absolute',
                                top: 0,
                                right: 14,
                                width: 10,
                                height: 10,
                                bgcolor: 'background.paper',
                                transform: 'translateY(-50%) rotate(45deg)',
                                zIndex: 0,
                            },
                        },
                    }
                }}
                transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
                slots={{ transition: Fade }}
            >
                <MenuItem onClick={() => { onClose(); navigate('/manage'); }}>
                    <VideoLibrary sx={{ mr: 2 }} /> {t('manageContent')}
                </MenuItem>
                <MenuItem onClick={() => { onClose(); navigate('/subscriptions'); }}>
                    <Subscriptions sx={{ mr: 2 }} /> {t('subscriptions')}
                </MenuItem>
                <MenuItem onClick={() => { onClose(); navigate('/settings'); }}>
                    <Settings sx={{ mr: 2 }} /> {t('settings')}
                </MenuItem>
                <MenuItem onClick={() => { onClose(); navigate('/instruction'); }}>
                    <Help sx={{ mr: 2 }} /> {t('instruction')}
                </MenuItem>
            </Menu>
    );
};

export default ManageMenu;

