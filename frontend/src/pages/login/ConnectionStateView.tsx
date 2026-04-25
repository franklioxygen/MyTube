import { ErrorOutline } from '@mui/icons-material';
import {
    Alert,
    Avatar,
    Button,
    CircularProgress,
    Typography,
} from '@mui/material';
import type { TranslateFn } from '../../utils/translateOrFallback';

type ConnectionState = 'loading' | 'error';

interface ConnectionStateViewProps {
    state: ConnectionState;
    onRetry: () => void;
    t: TranslateFn;
}

export const ConnectionStateView: React.FC<ConnectionStateViewProps> = ({
    state,
    onRetry,
    t,
}) => {
    if (state === 'loading') {
        return (
            <>
                <CircularProgress sx={{ mb: 2 }} />
                <Typography variant="body1" color="text.secondary">
                    {t('checkingConnection') || 'Checking connection...'}
                </Typography>
            </>
        );
    }

    return (
        <>
            <Avatar sx={{ m: 1, bgcolor: 'error.main', width: 56, height: 56 }}>
                <ErrorOutline fontSize="large" />
            </Avatar>
            <Typography component="h1" variant="h5" sx={{ mt: 2, mb: 1 }}>
                {t('connectionError') || 'Connection Error'}
            </Typography>
            <Alert severity="error" sx={{ mt: 2, mb: 2, width: '100%' }}>
                {t('backendConnectionFailed') || 'Unable to connect to the server. Please check if the backend is running and port is open, then try again.'}
            </Alert>
            <Button
                variant="contained"
                onClick={onRetry}
                sx={{ mt: 2 }}
            >
                {t('retry') || 'Retry'}
            </Button>
        </>
    );
};
