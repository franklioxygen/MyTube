import { CloudUpload, CreateNewFolder } from '@mui/icons-material';
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
import { useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { api } from '../utils/apiClient';

interface UploadModalProps {
    open: boolean;
    onClose: () => void;
    onUploadSuccess: (summary: UploadBatchSummary) => void;
}

interface UploadPayload {
    files: File[];
    title: string;
    author: string;
}

interface UploadBatchSummary {
    total: number;
    uploaded: number;
    duplicates: number;
    failed: number;
}

interface UploadBatchResponse {
    results: Array<{
        originalName: string;
        status: 'uploaded' | 'duplicate' | 'failed';
        message: string;
    }>;
    summary: UploadBatchSummary;
}

type UploadableFile = File & {
    webkitRelativePath?: string;
};

type DirectoryInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
    directory?: string;
    webkitdirectory?: string;
};

const SUPPORTED_VIDEO_EXTENSIONS = new Set([
    '.mp4',
    '.webm',
    '.mkv',
    '.avi',
    '.mov',
    '.m4v',
    '.flv',
    '.3gp',
]);

const VIDEO_INPUT_ACCEPT = 'video/*,.mp4,.webm,.mkv,.avi,.mov,.m4v,.flv,.3gp';
const MAX_BATCH_UPLOAD_FILES = 100;
const MAX_BATCH_UPLOAD_TOTAL_SIZE_BYTES = 100 * 1024 * 1024 * 1024;
const MAX_BATCH_UPLOAD_TOTAL_SIZE_GB = 100;

const getFileExtension = (filename: string) => {
    const dotIndex = filename.lastIndexOf('.');
    return dotIndex === -1 ? '' : filename.slice(dotIndex).toLowerCase();
};

const getDefaultTitle = (file: File) => file.name.replace(/\.[^/.]+$/, '');
const getDisplayName = (file: UploadableFile) => file.webkitRelativePath || file.name;

const UploadModal: React.FC<UploadModalProps> = ({ open, onClose, onUploadSuccess }) => {
    const { t } = useLanguage();
    const [files, setFiles] = useState<File[]>([]);
    const [title, setTitle] = useState<string>('');
    const [author, setAuthor] = useState<string>('Admin');
    const [progress, setProgress] = useState<number>(0);
    const [error, setError] = useState<string>('');
    const [skippedFilesCount, setSkippedFilesCount] = useState<number>(0);
    const filesInputRef = useRef<HTMLInputElement | null>(null);
    const folderInputRef = useRef<HTMLInputElement | null>(null);

    const getOptionalText = (key: keyof typeof import('../utils/locales/en').en, fallback: string, replacements?: Record<string, string | number>) => {
        const translated = t(key, replacements);
        if (translated !== key) {
            return translated;
        }

        if (!replacements) {
            return fallback;
        }

        return Object.entries(replacements).reduce((text, [placeholder, value]) => {
            const placeholderPattern = `{${placeholder}}`;
            const valueStr = String(value);
            return text.split(placeholderPattern).join(valueStr);
        }, fallback);
    };

    const isSupportedVideoFile = (file: File) => SUPPORTED_VIDEO_EXTENSIONS.has(getFileExtension(file.name));

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = Array.from(event.target.files || []) as UploadableFile[];
        const validFiles = selectedFiles.filter(isSupportedVideoFile);
        const skippedCount = selectedFiles.length - validFiles.length;
        const totalValidBytes = validFiles.reduce((sum, file) => sum + file.size, 0);

        if (validFiles.length > MAX_BATCH_UPLOAD_FILES) {
            setFiles([]);
            setTitle('');
            setSkippedFilesCount(skippedCount);
            setProgress(0);
            setError(getOptionalText(
                'tooManyFilesSelected',
                'You can upload up to {count} files at a time. Please reduce your selection and try again.',
                { count: MAX_BATCH_UPLOAD_FILES }
            ));
            event.target.value = '';
            return;
        }

        if (totalValidBytes > MAX_BATCH_UPLOAD_TOTAL_SIZE_BYTES) {
            setFiles([]);
            setTitle('');
            setSkippedFilesCount(skippedCount);
            setProgress(0);
            setError(getOptionalText(
                'totalUploadSizeExceeded',
                'Selected files exceed the {size} GB total upload limit. Please reduce your selection and try again.',
                { size: MAX_BATCH_UPLOAD_TOTAL_SIZE_GB }
            ));
            event.target.value = '';
            return;
        }

        setFiles(validFiles);
        setSkippedFilesCount(skippedCount);
        setProgress(0);

        if (validFiles.length === 1) {
            if (!title) {
                setTitle(getDefaultTitle(validFiles[0]));
            }
        } else if (validFiles.length > 1) {
            setTitle('');
        }

        if (validFiles.length === 0 && selectedFiles.length > 0) {
            setError(getOptionalText('noSupportedVideosFound', 'No supported video files were found in your selection'));
        } else {
            setError('');
        }

        event.target.value = '';
    };

    const uploadMutation = useMutation({
        mutationFn: async ({ files: selectedFiles, title: selectedTitle, author: selectedAuthor }: UploadPayload) => {
            const formData = new FormData();

            for (const file of selectedFiles as UploadableFile[]) {
                formData.append('videos', file);
                formData.append('relativePaths', getDisplayName(file));
            }

            if (selectedFiles.length === 1 && selectedTitle.trim()) {
                formData.append('title', selectedTitle.trim());
            }
            formData.append('author', selectedAuthor.trim() || 'Admin');

            const response = await api.post<{ data?: UploadBatchResponse }>('/upload/batch', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
                timeout: 0,
                onUploadProgress: (progressEvent) => {
                    const percentCompleted = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
                    setProgress(percentCompleted);
                },
            });

            return response.data?.data as UploadBatchResponse;
        },
        onSuccess: (result) => {
            setProgress(100);
            onUploadSuccess(result.summary);
            handleClose();
        },
        onError: (err: any) => {
            console.error('Upload failed:', err);
            setError(err.response?.data?.error || t('failedToUpload'));
        }
    });

    const handleUpload = () => {
        if (files.length === 0) {
            setError(t('pleaseSelectVideo'));
            return;
        }

        setError('');
        setProgress(0);

        uploadMutation.mutate({
            files,
            title,
            author,
        });
    };

    const handleClose = () => {
        setFiles([]);
        setTitle('');
        setAuthor('Admin');
        setError('');
        setProgress(0);
        setSkippedFilesCount(0);
        if (filesInputRef.current) {
            filesInputRef.current.value = '';
        }
        if (folderInputRef.current) {
            folderInputRef.current.value = '';
        }
        onClose();
    };

    const fileSelectLabel = files.length === 1
        ? getDisplayName(files[0] as UploadableFile)
        : t('selectVideoFile');

    const uploadProgressLabel = `${t('uploading')} ${progress}%`;
    const uploadLimitHint = getOptionalText(
        'uploadFileLimitHint',
        'Upload up to {count} files and {size} GB total at a time. Folder uploads count each video and file size toward these limits.',
        { count: MAX_BATCH_UPLOAD_FILES, size: MAX_BATCH_UPLOAD_TOTAL_SIZE_GB }
    );

    const directoryInputProps: DirectoryInputProps = {
        type: 'file',
        hidden: true,
        multiple: true,
        accept: VIDEO_INPUT_ACCEPT,
        onChange: handleFileChange,
        directory: '',
        webkitdirectory: '',
    };

    return (
        <Dialog open={open} onClose={!uploadMutation.isPending ? handleClose : undefined} maxWidth="sm" fullWidth>
            <DialogTitle>{t('uploadVideo')}</DialogTitle>
            <DialogContent>
                <Stack spacing={3} sx={{ mt: 1 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <Button
                            variant="outlined"
                            component="label"
                            startIcon={<CloudUpload />}
                            fullWidth
                            sx={{ height: 100, borderStyle: 'dashed' }}
                        >
                            {fileSelectLabel}
                            <input
                                ref={filesInputRef}
                                type="file"
                                hidden
                                accept={VIDEO_INPUT_ACCEPT}
                                multiple
                                onChange={handleFileChange}
                            />
                        </Button>

                        <Button
                            variant="outlined"
                            component="label"
                            startIcon={<CreateNewFolder />}
                            fullWidth
                            sx={{ height: 100, borderStyle: 'dashed' }}
                        >
                            {getOptionalText('selectVideoFolder', 'Select Folder')}
                            <input
                                ref={folderInputRef}
                                {...directoryInputProps}
                            />
                        </Button>
                    </Stack>

                    <Typography color="text.secondary" variant="body2">
                        {uploadLimitHint}
                    </Typography>

                    {files.length > 1 && (
                        <Box
                            sx={{
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 1,
                                px: 2,
                                py: 1.5,
                                maxHeight: 160,
                                overflowY: 'auto',
                            }}
                        >
                            {(files as UploadableFile[]).map((selectedFile) => (
                                <Typography key={`${getDisplayName(selectedFile)}-${selectedFile.size}-${selectedFile.lastModified}`} variant="body2" noWrap>
                                    {getDisplayName(selectedFile)}
                                </Typography>
                            ))}
                        </Box>
                    )}

                    {skippedFilesCount > 0 && (
                        <Typography color="warning.main" variant="body2">
                            {getOptionalText('unsupportedFilesSkipped', 'Skipped {count} unsupported files', { count: skippedFilesCount })}
                        </Typography>
                    )}

                    <TextField
                        label={t('title')}
                        fullWidth
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        disabled={uploadMutation.isPending || files.length > 1}
                        helperText={files.length > 1
                            ? getOptionalText('multipleUploadUsesFilename', 'Multiple uploads use each filename as the title')
                            : undefined}
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
                                {uploadProgressLabel}
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
                    disabled={files.length === 0 || uploadMutation.isPending}
                >
                    {uploadMutation.isPending ? <CircularProgress size={24} /> : t('upload')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default UploadModal;
