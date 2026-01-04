import { Brightness4, Brightness7, Download, Settings } from '@mui/icons-material';
import { Badge, Box, IconButton, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import { useLanguage } from '../../contexts/LanguageContext';
import { useThemeContext } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import DownloadsMenu from './DownloadsMenu';
import ManageMenu from './ManageMenu';
import { DownloadInfo } from './types';

interface ActionButtonsProps {
    activeDownloads: DownloadInfo[];
    queuedDownloads: DownloadInfo[];
    downloadsAnchorEl: HTMLElement | null;
    manageAnchorEl: HTMLElement | null;
    onDownloadsClick: (event: React.MouseEvent<HTMLElement>) => void;
    onDownloadsClose: () => void;
    onManageClick: (event: React.MouseEvent<HTMLElement>) => void;
    onManageClose: () => void;
    hasActiveSubscriptions?: boolean;
}

const ActionButtons: React.FC<ActionButtonsProps> = ({
    activeDownloads,
    queuedDownloads,
    downloadsAnchorEl,
    manageAnchorEl,
    onDownloadsClick,
    onDownloadsClose,
    onManageClick,
    onManageClose,
    hasActiveSubscriptions = false
}) => {
    const { mode: currentThemeMode, toggleTheme } = useThemeContext();
    const { t } = useLanguage();
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {!isVisitor && (
                <>
                    <IconButton color="inherit" onClick={onDownloadsClick}>
                        <Badge badgeContent={activeDownloads.length + queuedDownloads.length} color="secondary">
                            <Download />
                        </Badge>
                    </IconButton>
                    <DownloadsMenu
                        anchorEl={downloadsAnchorEl}
                        onClose={onDownloadsClose}
                        activeDownloads={activeDownloads}
                        queuedDownloads={queuedDownloads}
                        hasActiveSubscriptions={hasActiveSubscriptions}
                    />
                </>
            )}
            
            <IconButton onClick={toggleTheme} color="inherit">
                {currentThemeMode === 'dark' ? <Brightness7 /> : <Brightness4 />}
            </IconButton>

            {!isMobile && (
                <Tooltip title={t('manage')} disableHoverListener={isTouch}>
                    <IconButton
                        color="inherit"
                        onClick={onManageClick}
                    >
                        <Settings />
                    </IconButton>
                </Tooltip>
            )}
            <ManageMenu
                anchorEl={manageAnchorEl}
                onClose={onManageClose}
                hasActiveSubscriptions={hasActiveSubscriptions}
            />
        </Box>
    );
};

export default ActionButtons;

