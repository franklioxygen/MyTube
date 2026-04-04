import { CloudUpload } from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Typography
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface UploadThumbnailModalProps {
    open: boolean;
    onClose: () => void;
    onUpload: (file: File) => Promise<void>;
}

const UploadThumbnailModal: React.FC<UploadThumbnailModalProps> = ({ open, onClose, onUpload }) => {
    const { t } = useLanguage();
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setSelectedFile(file);
        setPreviewUrl(URL.createObjectURL(file));
        setError(null);
    };

    const handleClose = () => {
        if (isUploading) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setSelectedFile(null);
        setPreviewUrl(null);
        setError(null);
        onClose();
    };

    const handleUpload = async () => {
        if (!selectedFile) return;
        setIsUploading(true);
        setError(null);
        try {
            await onUpload(selectedFile);
            // success — clean up and close
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setSelectedFile(null);
            setPreviewUrl(null);
            onClose();
        } catch (err: any) {
            const msg = err?.response?.data?.error || err?.message || 'Upload failed';
            setError(msg);
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle>{t('uploadThumbnail') || 'Upload Thumbnail'}</DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, mt: 1 }}>
                    {previewUrl ? (
                        <Box
                            component="img"
                            src={previewUrl}
                            alt="preview"
                            sx={{ maxWidth: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
                        />
                    ) : (
                        <Box
                            sx={{
                                width: '100%',
                                height: 180,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '2px dashed',
                                borderColor: 'divider',
                                borderRadius: 1,
                                cursor: 'pointer',
                                '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' }
                            }}
                            onClick={() => inputRef.current?.click()}
                        >
                            <CloudUpload sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
                            <Typography variant="body2" color="text.secondary">
                                {t('clickToSelectImage') || 'Click to select an image'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                JPG, PNG, WebP, GIF, AVIF — max 10 MB
                            </Typography>
                        </Box>
                    )}

                    <Button
                        variant="outlined"
                        size="small"
                        onClick={() => inputRef.current?.click()}
                        disabled={isUploading}
                    >
                        {selectedFile ? (t('changeImage') || 'Change Image') : (t('selectImage') || 'Select Image')}
                    </Button>

                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={handleFileChange}
                    />
                </Box>
            </DialogContent>
            {error && (
                <Box sx={{ px: 3, pb: 1 }}>
                    <Alert severity="error" onClose={() => { setError(null); }}>{error}</Alert>
                </Box>
            )}
            <DialogActions>
                <Button onClick={handleClose} disabled={isUploading}>
                    {t('cancel')}
                </Button>
                <Button
                    variant="contained"
                    onClick={() => { void handleUpload(); }}
                    disabled={!selectedFile || isUploading}
                    startIcon={isUploading ? <CircularProgress size={16} color="inherit" /> : <CloudUpload />}
                >
                    {isUploading ? (t('uploading') || 'Uploading...') : (t('upload') || 'Upload')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default UploadThumbnailModal;
