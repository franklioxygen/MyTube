import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    TextField,
} from '@mui/material';
import React from 'react';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useSnackbar } from '../../../contexts/SnackbarContext';
import { copyTextToClipboard } from '../../../utils/clipboard';
import DialogHeader from '../../DialogHeader';

interface CredentialRevealDialogProps {
    /** The secret to show; the dialog is open while it is set. */
    credential: string | null;
    onClose: () => void;
}

/** Shows a newly issued access key once; it is never retrievable again. */
const CredentialRevealDialog: React.FC<CredentialRevealDialogProps> = ({ credential, onClose }) => {
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();

    const handleCopy = async () => {
        if (!credential) return;
        // A blocked clipboard must say so: the key is shown only this once.
        const copied = await copyTextToClipboard(credential).catch(() => false);
        showSnackbar(
            t(copied ? 'federationCredentialCopied' : 'federationCopyFailed'),
            copied ? 'success' : 'error'
        );
    };

    return (
        <Dialog open={credential !== null} onClose={onClose} fullWidth maxWidth="sm">
            <DialogHeader title={t('federationCredentialTitle')} onClose={onClose} closeLabel={t('close')} />
            <DialogContent>
                <Alert severity="warning" sx={{ mb: 2 }}>
                    {t('federationCredentialWarning')}
                </Alert>
                <TextField
                    value={credential ?? ''}
                    fullWidth
                    multiline
                    slotProps={{
                        input: { readOnly: true, sx: { fontFamily: 'monospace', wordBreak: 'break-all' } },
                        htmlInput: { 'aria-label': t('federationPeerCredential') },
                    }}
                />
            </DialogContent>
            <DialogActions>
                <Button startIcon={<ContentCopyIcon />} onClick={() => void handleCopy()}>
                    {t('federationCopy')}
                </Button>
                <Button variant="contained" onClick={onClose}>
                    {t('close')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default CredentialRevealDialog;
