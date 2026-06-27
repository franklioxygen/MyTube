import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    Typography
} from '@mui/material';
import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import DialogHeader from './DialogHeader';

interface ChannelSubscribeChoiceModalProps {
    open: boolean;
    onClose: () => void;
    onChooseVideos: () => void;
    onChoosePlaylists: () => void;
}

const ChannelSubscribeChoiceModal: React.FC<ChannelSubscribeChoiceModalProps> = ({
    open,
    onClose,
    onChooseVideos,
    onChoosePlaylists
}) => {
    const { t } = useLanguage();

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
            <DialogHeader title={t('subscribeToChannel') || 'Subscribe to Channel'} onClose={onClose} closeLabel={t('close')} />
            <DialogContent dividers>
                <DialogContentText sx={{ mb: 3, color: 'text.primary' }}>
                    {t('subscribeChannelChoiceMessage') || 'How would you like to subscribe to this channel?'}
                </DialogContentText>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('subscribeChannelChoiceDescription') || 'Choose to subscribe to all videos or all playlists from this channel.'}
                </Typography>
            </DialogContent>
            <DialogActions sx={{ p: 2, gap: 1, flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'flex-end' }}>
                <Button onClick={onClose} color="inherit" variant="outlined" sx={{ width: { xs: '100%', sm: 'auto' } }}>
                    {t('cancel')}
                </Button>
                <Button
                    onClick={() => {
                        onChoosePlaylists();
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
