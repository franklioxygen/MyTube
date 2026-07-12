import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText
} from '@mui/material';
import React, { useState } from 'react';
import DialogHeader from './DialogHeader';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDanger?: boolean;
    showCancel?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    isDanger = false,
    showCancel = true
}) => {
    const [confirming, setConfirming] = useState(false);

    const handleClose = () => {
        if (!confirming) {
            onClose();
        }
    };

    const handleConfirm = async () => {
        setConfirming(true);
        try {
            await onConfirm();
            onClose();
        } catch {
            // Keep the modal open on failure so the user can retry.
        } finally {
            setConfirming(false);
        }
    };

    return (
        <Dialog
            open={isOpen}
            onClose={handleClose}
            disableEscapeKeyDown={confirming}
            aria-labelledby="alert-dialog-title"
            aria-describedby="alert-dialog-description"
            slotProps={{
                paper: {
                    sx: {
                        borderRadius: 2,
                        minWidth: 300,
                        maxWidth: 500,
                        backgroundImage: 'none'
                    }
                }
            }}
        >
            <DialogHeader
                id="alert-dialog-title"
                title={title}
                onClose={handleClose}
                closeDisabled={confirming}
            />
            <DialogContent dividers>
                <DialogContentText id="alert-dialog-description" sx={{ whiteSpace: 'pre-wrap' }}>
                    {message}
                </DialogContentText>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                {showCancel && (
                    <Button onClick={handleClose} color="inherit" variant="text" disabled={confirming}>
                        {cancelText}
                    </Button>
                )}
                <Button
                    onClick={handleConfirm}
                    color={isDanger ? 'error' : 'primary'}
                    variant="outlined"
                    loading={confirming}
                    loadingPosition="start"
                    autoFocus
                >
                    {confirmText}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ConfirmationModal;
