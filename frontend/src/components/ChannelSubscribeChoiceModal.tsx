import { Close } from '@mui/icons-material';
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    IconButton,
    TextField,
    Typography
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface ChannelSubscribeChoiceModalProps {
    open: boolean;
    onClose: () => void;
    onChooseVideos: () => void;
    onChoosePlaylists: (interval: number) => void;
}

const ChannelSubscribeChoiceModal: React.FC<ChannelSubscribeChoiceModalProps> = ({
    open,
    onClose,
    onChooseVideos,
    onChoosePlaylists
}) => {
    const { t } = useLanguage();
    const [interval, setInterval] = useState<number>(60);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            slotProps={{
                paper: {
                    sx: { borderRadius: 2 }
                }
            }}
        >
            <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                    {t('subscribeToChannel') || 'Subscribe to Channel'}
                </Typography>
                <IconButton
                    aria-label="close"
                    onClick={onClose}
                    sx={{
                        color: (theme) => theme.palette.grey[500],
                    }}
                >
                    <Close />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                <DialogContentText sx={{ mb: 3, color: 'text.primary' }}>
                    {t('subscribeChannelChoiceMessage') || 'How would you like to subscribe to this channel?'}
                </DialogContentText>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('subscribeChannelChoiceDescription') || 'Choose to subscribe to all videos or all playlists from this channel.'}
                </Typography>
                <TextField
                    autoFocus
                    margin="dense"
                    id="interval"
                    label={t('checkIntervalMinutes') || "Check Interval (minutes)"}
                    type="number"
                    fullWidth
                    variant="outlined"
                    value={interval}
                    onChange={(e) => setInterval(Number(e.target.value))}
                    inputProps={{ min: 1 }}
                    sx={{ mb: 2 }}
                />
            </DialogContent>
            <DialogActions sx={{ p: 2, gap: 1, flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'flex-end' }}>
                <Button onClick={onClose} color="inherit" variant="outlined" sx={{ width: { xs: '100%', sm: 'auto' } }}>
                    {t('cancel')}
                </Button>
                <Button
                    onClick={() => {
                        onChoosePlaylists(interval);
                        onClose();
                    }}
                    variant="contained"
                    color="primary"
                    sx={{ width: { xs: '100%', sm: 'auto' } }}
                >
                    {t('subscribeAllPlaylists') || 'Subscribe All Playlists'}
                </Button>
                <Button
                    onClick={() => {
                        onChooseVideos();
                        onClose();
                    }}
                    variant="contained"
                    color="primary"
                    sx={{ width: { xs: '100%', sm: 'auto' } }}
                >
                    {t('subscribeAllVideos') || 'Subscribe All Videos'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ChannelSubscribeChoiceModal;
