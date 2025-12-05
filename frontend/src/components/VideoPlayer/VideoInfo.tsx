import {
    Add,
    CalendarToday,
    Check,
    Close,
    Delete,
    Download,
    Edit,
    ExpandLess,
    ExpandMore,
    Folder,
    Link as LinkIcon,
    LocalOffer,
    Share,
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
import React, { useEffect, useRef, useState } from 'react';
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
    const [isTitleExpanded, setIsTitleExpanded] = useState(false);
    const [showExpandButton, setShowExpandButton] = useState(false);
    const titleRef = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        const checkOverflow = () => {
            const element = titleRef.current;
            if (element && !isTitleExpanded) {
                setShowExpandButton(element.scrollHeight > element.clientHeight);
            }
        };

        checkOverflow();
        window.addEventListener('resize', checkOverflow);
        return () => window.removeEventListener('resize', checkOverflow);
    }, [video.title, isTitleExpanded]);

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

    const handleShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: video.title,
                    text: `Check out this video: ${video.title}`,
                    url: window.location.href,
                });
            } catch (error) {
                console.error('Error sharing:', error);
            }
        } else {
            try {
                await navigator.clipboard.writeText(window.location.href);
                // Optionally show a notification here
            } catch (error) {
                console.error('Error copying to clipboard:', error);
            }
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
                <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 1 }}>
                    <Typography
                        ref={titleRef}
                        variant="h5"
                        component="h1"
                        fontWeight="bold"
                        onClick={() => showExpandButton && setIsTitleExpanded(!isTitleExpanded)}
                        sx={{
                            mr: 1,
                            display: '-webkit-box',
                            overflow: 'hidden',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: isTitleExpanded ? 'unset' : 2,
                            wordBreak: 'break-word',
                            flex: 1,
                            cursor: showExpandButton ? 'pointer' : 'default'
                        }}
                    >
                        {video.title}
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        <Tooltip title={t('editTitle')}>
                            <Button
                                size="small"
                                onClick={handleStartEditingTitle}
                                sx={{ minWidth: 'auto', p: 0.5, color: 'text.secondary' }}
                            >
                                <Edit fontSize="small" />
                            </Button>
                        </Tooltip>
                        {showExpandButton && (
                            <Tooltip title={isTitleExpanded ? t('collapse') : t('expand')}>
                                <Button
                                    size="small"
                                    onClick={() => setIsTitleExpanded(!isTitleExpanded)}
                                    sx={{ minWidth: 'auto', p: 0.5, color: 'text.secondary' }}
                                >
                                    {isTitleExpanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                                </Button>
                            </Tooltip>
                        )}
                    </Box>
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
                        chip: { variant: 'outlined', size: 'small' },
                        listbox: {
                            sx: {
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 0.5,
                                p: 1
                            }
                        }
                    }}
                    renderOption={(props, option, { selected }) => {
                        const { key, ...otherProps } = props;
                        return (
                            <li key={key} {...otherProps} style={{ width: 'auto', padding: 0 }}>
                                <Chip
                                    label={option}
                                    size="small"
                                    variant={selected ? "filled" : "outlined"}
                                    color={selected ? "primary" : "default"}
                                    sx={{ pointerEvents: 'none' }}
                                />
                            </li>
                        );
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

            <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
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
                    <Tooltip title={t('share')}>
                        <Button
                            variant="outlined"
                            onClick={handleShare}
                            sx={{ minWidth: 'auto', p: 1 }}
                        >
                            <Share />
                        </Button>
                    </Tooltip>
                    <Tooltip title={t('addToCollection')}>
                        <Button
                            variant="outlined"
                            onClick={() => onAddToCollection()}
                            sx={{ minWidth: 'auto', p: 1 }}
                        >
                            <Add />
                        </Button>
                    </Tooltip>
                    <Tooltip title={t('delete')}>
                        <Button
                            variant="outlined"
                            color="error"
                            onClick={onDelete}
                            disabled={isDeleting}
                            sx={{ minWidth: 'auto', p: 1 }}
                        >
                            <Delete />
                        </Button>
                    </Tooltip>
                </Stack>
            </Stack>


            {deleteError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {deleteError}
                </Alert>
            )}

            <Divider sx={{ my: 2 }} />

            <Box sx={{ bgcolor: 'background.paper', p: 2, borderRadius: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 3 }} alignItems={{ xs: 'flex-start', sm: 'center' }} flexWrap="wrap">
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
                        <strong>{t('source')}</strong> {video.source ? video.source.charAt(0).toUpperCase() + video.source.slice(1) : 'Unknown'}
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
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Typography variant="subtitle2" sx={{ mr: 1 }}>{t('collections')}:</Typography>
                            {videoCollections.map(c => (
                                <Chip
                                    key={c.id}
                                    icon={<Folder />}
                                    label={c.name}
                                    onClick={() => onCollectionClick(c.id)}
                                    color="secondary"
                                    variant="outlined"
                                    clickable
                                    size="small"
                                    sx={{ my: 0.5 }}
                                />
                            ))}
                        </Stack>
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default VideoInfo;
