import { Help, Logout, Settings, VideoLibrary } from '@mui/icons-material';
import {
    alpha,
    Divider,
    Fade,
    Menu,
    MenuItem,
    useMediaQuery,
    useTheme
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSettings } from '../../hooks/useSettings';

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
    const { logout } = useAuth();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const { data: settingsData } = useSettings();

    const loginEnabled = settingsData?.loginEnabled || false;

    const handleLogout = () => {
        onClose();
        logout();
        navigate('/');
    };

    return (
        <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={onClose}
            disableScrollLock
            slotProps={{
                paper: {
                    elevation: 0,
                    sx: {
                        overflow: 'visible',
                        filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
                        mt: 1.5,
                        width: 320,
                        bgcolor: !isMobile ? alpha(theme.palette.background.paper, 0.7) : 'background.paper',
                        backdropFilter: !isMobile ? 'blur(10px)' : 'none',
                        '&:before': {
                            content: '""',
                            display: 'block',
                            position: 'absolute',
                            top: 0,
                            right: 14,
                            width: 10,
                            height: 10,
                            bgcolor: !isMobile ? alpha(theme.palette.background.paper, 0.7) : 'background.paper',
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
            <MenuItem onClick={() => { onClose(); navigate('/settings'); }}>
                <Settings sx={{ mr: 2 }} /> {t('settings')}
            </MenuItem>
            <MenuItem onClick={() => { onClose(); navigate('/instruction'); }}>
                <Help sx={{ mr: 2 }} /> {t('instruction')}
            </MenuItem>
            {loginEnabled && <Divider />}
            {loginEnabled && (
                <MenuItem onClick={handleLogout}>
                    <Logout sx={{ mr: 2 }} /> {t('logout')}
                </MenuItem>
            )}
        </Menu>
    );
};

export default ManageMenu;
