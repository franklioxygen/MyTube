import { Download } from '@mui/icons-material';
import {
    Box,
    CircularProgress,
    Fade,
    Menu,
    MenuItem,
    Typography
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import { DownloadInfo } from './types';

interface DownloadsMenuProps {
    anchorEl: HTMLElement | null;
    onClose: () => void;
    activeDownloads: DownloadInfo[];
    queuedDownloads: DownloadInfo[];
}

const DownloadsMenu: React.FC<DownloadsMenuProps> = ({
    anchorEl,
    onClose,
    activeDownloads,
    queuedDownloads
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
                            maxHeight: '50vh',
                            overflowY: 'auto',
                            '& .MuiAvatar-root': {
                                width: 32,
                                height: 32,
                                ml: -0.5,
                                mr: 1,
                            },
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
                <MenuItem onClick={() => { onClose(); navigate('/downloads'); }}>
                    <Download sx={{ mr: 2 }} /> {t('manageDownloads') || 'Manage Downloads'}
                </MenuItem>

                {activeDownloads.map((download) => (
                    <MenuItem key={download.id} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, py: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                            <CircularProgress
                                variant={download.progress ? "determinate" : "indeterminate"}
                                value={download.progress || 0}
                                size={20}
                                sx={{ mr: 2, flexShrink: 0 }}
                            />
                            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                                <Typography variant="body2" noWrap sx={{ fontWeight: 'bold' }}>
                                    {download.filename || download.title}
                                </Typography>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                                    <Typography variant="caption" color="text.secondary">
                                        {download.progress ? `${download.progress.toFixed(1)}%` : t('downloading')}
                                    </Typography>
                                    {download.totalSize && (
                                        <Typography variant="caption" color="text.secondary">
                                            {download.totalSize}
                                        </Typography>
                                    )}
                                </Box>
                                {download.speed && (
                                    <Typography variant="caption" color="text.secondary" display="block">
                                        {download.speed}
                                    </Typography>
                                )}
                            </Box>
                        </Box>
                    </MenuItem>
                ))}

                {queuedDownloads.length > 0 && [
                    <Box key="queued-header" sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}>
                        <Typography variant="caption" color="text.secondary" fontWeight="bold">
                            {t('queued')} ({queuedDownloads.length})
                        </Typography>
                    </Box>,
                    ...queuedDownloads.map((download) => (
                        <MenuItem key={download.id} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, py: 1.5, opacity: 0.7 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                                <CircularProgress
                                    variant="indeterminate"
                                    size={16}
                                    sx={{ mr: 2, flexShrink: 0, color: 'text.disabled' }}
                                />
                                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                                    <Typography variant="body2" noWrap>
                                        {download.title}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {t('waitingInQueue')}
                                    </Typography>
                                </Box>
                            </Box>
                        </MenuItem>
                    ))
                ]}
            </Menu>
    );
};

export default DownloadsMenu;

