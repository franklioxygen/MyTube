import { Close, Visibility, VisibilityOff } from '@mui/icons-material';
import {
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    IconButton,
    InputAdornment,
    TextField,
    Typography
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface PasswordModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (password: string) => void;
    title?: string;
    message?: string;
    error?: string;
    isLoading?: boolean;
}

const PasswordModal: React.FC<PasswordModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    error,
    isLoading = false
}) => {
    const { t } = useLanguage();
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    // Reset state when modal opens
    React.useEffect(() => {
        if (isOpen) {
            setPassword('');
            setShowPassword(false);
        }
    }, [isOpen]);

    const handleConfirm = (e?: React.FormEvent) => {
        e?.preventDefault();
        onConfirm(password);
    };

    const handleClose = () => {
        setPassword('');
        setShowPassword(false);
        onClose();
    };

    return (
        <Dialog
            open={isOpen}
            onClose={handleClose}
            aria-labelledby="password-dialog-title"
            aria-describedby="password-dialog-description"
            slotProps={{
                paper: {
                    sx: {
                        borderRadius: 2,
                        minWidth: 300,
                        maxWidth: 400,
                        backgroundImage: 'none'
                    }
                }
            }}
        >
            <DialogTitle id="password-dialog-title" sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                    {title || t('enterPassword')}
                </Typography>
                <IconButton
                    aria-label={t('close')}
                    onClick={handleClose}
                    sx={{
                        color: (theme) => theme.palette.grey[500],
                    }}
                    disabled={isLoading}
                >
                    <Close />
                </IconButton>
            </DialogTitle>
            <form onSubmit={handleConfirm}>
                <DialogContent dividers>
                    {message && (
                        <DialogContentText id="password-dialog-description" sx={{ mb: 2 }}>
                            {message}
                        </DialogContentText>
                    )}
                    <TextField
                        autoFocus
                        margin="dense"
                        id="password"
                        label={t('password')}
                        type={showPassword ? 'text' : 'password'}
                        fullWidth
                        variant="outlined"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isLoading}
                        error={!!error}
                        helperText={error}
                        slotProps={{
                            input: {
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton
                                            aria-label={t('togglePasswordVisibility')}
                                            onClick={() => setShowPassword(!showPassword)}
                                            edge="end"
                                        >
                                            {showPassword ? <VisibilityOff /> : <Visibility />}
                                        </IconButton>
                                    </InputAdornment>
                                )
                            }
                        }}
                    />
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={handleClose} color="inherit" variant="text" disabled={isLoading}>
                        {t('cancel')}
                    </Button>
                    <Button
                        type="submit"
                        color="primary"
                        variant="contained"
                        disabled={isLoading || !password}
                        startIcon={isLoading ? <CircularProgress size={20} color="inherit" /> : null}
                    >
                        {isLoading ? t('verifying') : t('confirm')}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

export default PasswordModal;
