import { CloudUpload } from '@mui/icons-material';
import {
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    LinearProgress,
    Stack,
    TextField,
    Typography
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { api } from '../utils/apiClient';

interface UploadModalProps {
    open: boolean;
    onClose: () => void;
    onUploadSuccess: () => void;
}

const UploadModal: React.FC<UploadModalProps> = ({ open, onClose, onUploadSuccess }) => {
    const { t } = useLanguage();
    const [file, setFile] = useState<File | null>(null);
    const [title, setTitle] = useState<string>('');
    const [author, setAuthor] = useState<string>('Admin');
    const [progress, setProgress] = useState<number>(0);
    const [error, setError] = useState<string>('');

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            setFile(event.target.files[0]);
            // Auto-fill title with filename if empty
            if (!title) {
                setTitle(event.target.files[0].name.replace(/\.[^/.]+$/, ""));
            }
        }
    };

    const uploadMutation = useMutation({
        mutationFn: async (formData: FormData) => {
            await api.post('/upload', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
                onUploadProgress: (progressEvent) => {
                    const percentCompleted = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
                    setProgress(percentCompleted);
                },
            });
        },
        onSuccess: () => {
            onUploadSuccess();
            handleClose();
        },
        onError: (err: any) => {
            console.error('Upload failed:', err);
            setError(err.response?.data?.error || t('failedToUpload'));
        }
    });

    const handleUpload = () => {
        if (!file) {
            setError(t('pleaseSelectVideo'));
            return;
        }

        setError('');
        setProgress(0);

        const formData = new FormData();
        formData.append('video', file);
        formData.append('title', title);
        formData.append('author', author);

        uploadMutation.mutate(formData);
    };

    const handleClose = () => {
        setFile(null);
        setTitle('');
        setAuthor('Admin');
        setError('');
        setProgress(0);
        onClose();
    };

    return (
        <Dialog open={open} onClose={!uploadMutation.isPending ? handleClose : undefined} maxWidth="sm" fullWidth>
            <DialogTitle>{t('uploadVideo')}</DialogTitle>
            <DialogContent>
                <Stack spacing={3} sx={{ mt: 1 }}>
                    <Button
                        variant="outlined"
                        component="label"
                        startIcon={<CloudUpload />}
                        fullWidth
                        sx={{ height: 100, borderStyle: 'dashed' }}
                    >
                        {file ? file.name : t('selectVideoFile')}
                        <input
                            type="file"
                            hidden
                            accept="video/*"
                            onChange={handleFileChange}
                        />
                    </Button>

                    <TextField
                        label={t('title')}
                        fullWidth
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        disabled={uploadMutation.isPending}
                    />

                    <TextField
                        label={t('author')}
                        fullWidth
                        value={author}
                        onChange={(e) => setAuthor(e.target.value)}
                        disabled={uploadMutation.isPending}
                    />

                    {error && (
                        <Typography color="error" variant="body2">
                            {error}
                        </Typography>
                    )}

                    {uploadMutation.isPending && (
                        <Box sx={{ width: '100%' }}>
                            <LinearProgress variant="determinate" value={progress} />
                            <Typography variant="caption" color="text.secondary" align="center" display="block" sx={{ mt: 1 }}>
                                {t('uploading')} {progress}%
                            </Typography>
                        </Box>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} disabled={uploadMutation.isPending}>{t('cancel')}</Button>
                <Button
                    onClick={handleUpload}
                    variant="contained"
                    disabled={!file || uploadMutation.isPending}
                >
                    {uploadMutation.isPending ? <CircularProgress size={24} /> : t('upload')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default UploadModal;
