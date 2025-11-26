import {
    Add,
    CalendarToday,
    Check,
    Close,
    Delete,
    Download,
    Edit,
    Folder,
    Link as LinkIcon,
    LocalOffer,
    VideoLibrary
} from '@mui/icons-material';
import {
    Alert,
    Autocomplete,
    Avatar,
    Box,
    Button,
    Chip,
    Divider,
    Rating,
    Stack,
    TextField,
    Tooltip,
    Typography,
    useTheme
} from '@mui/material';
import React, { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Collection, Video } from '../../types';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

interface VideoInfoProps {
    video: Video;
    onTitleSave: (newTitle: string) => Promise<void>;
    onRatingChange: (newRating: number) => Promise<void>;
    onAuthorClick: () => void;
    onAddToCollection: () => void;
    onDelete: () => void;
    isDeleting: boolean;
    deleteError: string | null;
    videoCollections: Collection[];
    onCollectionClick: (id: string) => void;
    availableTags: string[];
    onTagsUpdate: (tags: string[]) => Promise<void>;
}

const VideoInfo: React.FC<VideoInfoProps> = ({
    video,
    onTitleSave,
    onRatingChange,
    onAuthorClick,
    onAddToCollection,
    onDelete,
    isDeleting,
    deleteError,
    videoCollections,
    onCollectionClick,
    availableTags,
    onTagsUpdate
}) => {
    const theme = useTheme();
    const { t } = useLanguage();


    const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
    const [editedTitle, setEditedTitle] = useState<string>('');

    const handleStartEditingTitle = () => {
        setEditedTitle(video.title);
        setIsEditingTitle(true);
    };

    const handleCancelEditingTitle = () => {
        setIsEditingTitle(false);
        setEditedTitle('');
    };

    const handleSaveTitle = async () => {
        if (!editedTitle.trim()) return;
        await onTitleSave(editedTitle);
        setIsEditingTitle(false);
    };

    const handleRatingChangeInternal = (_: React.SyntheticEvent, newValue: number | null) => {
        if (newValue) {
            onRatingChange(newValue);
        }
    };

    // Format the date (assuming format YYYYMMDD from youtube-dl)
    const formatDate = (dateString?: string) => {
        if (!dateString || dateString.length !== 8) {
            return 'Unknown date';
        }

        const year = dateString.substring(0, 4);
        const month = dateString.substring(4, 6);
        const day = dateString.substring(6, 8);

        return `${year}-${month}-${day}`;
    };

    return (
        <Box sx={{ mt: 2 }}>
            {isEditingTitle ? (
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
                    <TextField
                        fullWidth
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        variant="outlined"
                        size="small"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                handleSaveTitle();
                            }
                        }}
                    />
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={handleSaveTitle}
                        sx={{ minWidth: 'auto', p: 0.5 }}
                    >
                        <Check />
                    </Button>
                    <Button
                        variant="outlined"
                        color="secondary"
                        onClick={handleCancelEditingTitle}
                        sx={{ minWidth: 'auto', p: 0.5 }}
                    >
                        <Close />
                    </Button>
                </Box>
            ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h5" component="h1" fontWeight="bold" sx={{ mr: 1 }}>
                        {video.title}
                    </Typography>
                    <Tooltip title={t('editTitle')}>
                        <Button
                            size="small"
                            onClick={handleStartEditingTitle}
                            sx={{ minWidth: 'auto', p: 0.5, color: 'text.secondary' }}
                        >
                            <Edit fontSize="small" />
                        </Button>
                    </Tooltip>
                </Box>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Rating
                    value={video.rating || 0}
                    onChange={handleRatingChangeInternal}
                />
                <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                    {video.rating ? `(${video.rating})` : t('rateThisVideo')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                    {video.viewCount || 0} {t('views')}
                </Typography>
            </Box>

            <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                spacing={2}
                sx={{ mb: 2 }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Avatar sx={{ bgcolor: 'primary.main', mr: 2 }}>
                        {video.author ? video.author.charAt(0).toUpperCase() : 'A'}
                    </Avatar>
                    <Box>
                        <Typography
                            variant="subtitle1"
                            fontWeight="bold"
                            onClick={onAuthorClick}
                            sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                        >
                            {video.author}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {formatDate(video.date)}
                        </Typography>
                    </Box>
                </Box>

                <Stack direction="row" spacing={1}>
                    <Button
                        variant="outlined"
                        startIcon={<Add />}
                        onClick={onAddToCollection}
                    >
                        {t('addToCollection')}
                    </Button>
                    <Button
                        variant="outlined"
                        color="error"
                        startIcon={<Delete />}
                        onClick={onDelete}
                        disabled={isDeleting}
                    >
                        {isDeleting ? t('deleting') : t('delete')}
                    </Button>
                </Stack>
            </Stack>


            {deleteError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {deleteError}
                </Alert>
            )}

            <Divider sx={{ my: 2 }} />

            <Box sx={{ bgcolor: 'background.paper', p: 2, borderRadius: 2 }}>
                <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap">
                    {video.sourceUrl && (
                        <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                            <a href={video.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: theme.palette.primary.main, textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
                                <LinkIcon fontSize="small" sx={{ mr: 0.5 }} />
                                <strong>{t('originalLink')}</strong>
                            </a>
                        </Typography>
                    )}
                    {video.videoPath && (
                        <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                            <a href={`${BACKEND_URL}${video.videoPath}`} download style={{ color: theme.palette.primary.main, textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
                                <Download fontSize="small" sx={{ mr: 0.5 }} />
                                <strong>{t('download')}</strong>
                            </a>
                        </Typography>
                    )}
                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                        <VideoLibrary fontSize="small" sx={{ mr: 0.5 }} />
                        <strong>{t('source')}</strong> {video.source === 'bilibili' ? 'Bilibili' : (video.source === 'local' ? 'Local Upload' : 'YouTube')}
                    </Typography>
                    {video.addedAt && (
                        <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                            <CalendarToday fontSize="small" sx={{ mr: 0.5 }} />
                            <strong>{t('addedDate')}</strong> {new Date(video.addedAt).toLocaleDateString()}
                        </Typography>
                    )}
                </Stack>



                {videoCollections.length > 0 && (
                    <Box sx={{ mt: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>{t('collections')}:</Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap">
                            {videoCollections.map(c => (
                                <Chip
                                    key={c.id}
                                    icon={<Folder />}
                                    label={c.name}
                                    onClick={() => onCollectionClick(c.id)}
                                    color="secondary"
                                    variant="outlined"
                                    clickable
                                    sx={{ mb: 1 }}
                                />
                            ))}
                        </Stack>
                    </Box>
                )}
            </Box>

            {/* Tags Section */}
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
                <LocalOffer color="action" fontSize="small" />
                <Autocomplete
                    multiple
                    options={availableTags}
                    value={video.tags || []}
                    isOptionEqualToValue={(option, value) => option === value}
                    onChange={(_, newValue) => onTagsUpdate(newValue)}
                    slotProps={{
                        chip: { variant: 'outlined', size: 'small' }
                    }}
                    renderInput={(params) => (
                        <TextField
                            {...params}
                            variant="standard"
                            placeholder={!video.tags || video.tags.length === 0 ? (t('tags') || 'Tags') : ''}
                            sx={{ minWidth: 200 }}
                            slotProps={{
                                input: { ...params.InputProps, disableUnderline: true }
                            }}
                        />
                    )}
                    sx={{ flexGrow: 1 }}
                />
            </Box>
        </Box>
    );
};

export default VideoInfo;
