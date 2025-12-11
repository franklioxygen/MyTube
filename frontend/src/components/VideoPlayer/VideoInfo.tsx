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
    PlayArrow,
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
    ListItemText,
    Menu,
    MenuItem,
    Rating,
    Stack,
    TextField,
    Tooltip,
    Typography,
    useTheme
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
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
    const { showSnackbar } = useSnackbar();

    const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
    const [editedTitle, setEditedTitle] = useState<string>('');
    const [isTitleExpanded, setIsTitleExpanded] = useState(false);
    const [showExpandButton, setShowExpandButton] = useState(false);
    const titleRef = useRef<HTMLHeadingElement>(null);

    const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
    const [showDescriptionExpandButton, setShowDescriptionExpandButton] = useState(false);

    const descriptionRef = useRef<HTMLParagraphElement>(null);

    const [playerMenuAnchor, setPlayerMenuAnchor] = useState<null | HTMLElement>(null);

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

    useEffect(() => {
        const checkDescriptionOverflow = () => {
            const element = descriptionRef.current;
            if (element && !isDescriptionExpanded) {
                setShowDescriptionExpandButton(element.scrollHeight > element.clientHeight);
            }
        };

        checkDescriptionOverflow();
        window.addEventListener('resize', checkDescriptionOverflow);
        return () => window.removeEventListener('resize', checkDescriptionOverflow);
    }, [video.description, isDescriptionExpanded]);

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
            const url = window.location.href;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                try {
                    await navigator.clipboard.writeText(url);
                    showSnackbar(t('linkCopied'), 'success');
                } catch (error) {
                    console.error('Error copying to clipboard:', error);
                    showSnackbar(t('copyFailed'), 'error');
                }
            } else {
                // Fallback for secure context requirement or unsupported browsers
                const textArea = document.createElement("textarea");
                textArea.value = url;
                textArea.style.position = "fixed";  // Avoid scrolling to bottom
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                try {
                    const successful = document.execCommand('copy');
                    if (successful) {
                        showSnackbar(t('linkCopied'), 'success');
                    } else {
                        showSnackbar(t('copyFailed'), 'error');
                    }
                } catch (err) {
                    console.error('Fallback: Unable to copy', err);
                    showSnackbar(t('copyFailed'), 'error');
                }

                document.body.removeChild(textArea);
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

    const handleOpenPlayerMenu = (event: React.MouseEvent<HTMLElement>) => {
        setPlayerMenuAnchor(event.currentTarget);
    };

    const handleClosePlayerMenu = () => {
        setPlayerMenuAnchor(null);
    };

    const handlePlayInPlayer = (scheme: string) => {
        const videoUrl = `${BACKEND_URL}${video.videoPath || video.sourceUrl}`;
        let url = '';

        switch (scheme) {
            case 'iina':
                url = `iina://weblink?url=${videoUrl}`;
                break;
            case 'vlc':
                url = `vlc://${videoUrl}`;
                break;
            case 'potplayer':
                url = `potplayer://${videoUrl}`;
                break;
            case 'mpv':
                url = `mpv://${videoUrl}`;
                break;
            case 'infuse':
                url = `infuse://x-callback-url/play?url=${videoUrl}`;
                break;
        }

        if (url) {
            window.location.href = url;
        }
        handleClosePlayerMenu();
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
                    {video.rating ? `` : t('rateThisVideo')}
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
                    <Tooltip title={t('openInExternalPlayer')}>
                        <Button
                            variant="outlined"
                            color="inherit"
                            onClick={handleOpenPlayerMenu}
                            sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                        >
                            <PlayArrow />
                        </Button>
                    </Tooltip>
                    <Menu
                        anchorEl={playerMenuAnchor}
                        open={Boolean(playerMenuAnchor)}
                        onClose={handleClosePlayerMenu}
                    >
                        <MenuItem disabled>
                            <Typography variant="caption" color="text.secondary">
                                {t('playWith')}
                            </Typography>
                        </MenuItem>
                        <Divider />
                        <MenuItem onClick={() => handlePlayInPlayer('iina')}>
                            <ListItemText>IINA</ListItemText>
                        </MenuItem>
                        <MenuItem onClick={() => handlePlayInPlayer('vlc')}>
                            <ListItemText>VLC</ListItemText>
                        </MenuItem>
                        <MenuItem onClick={() => handlePlayInPlayer('potplayer')}>
                            <ListItemText>PotPlayer</ListItemText>
                        </MenuItem>
                        <MenuItem onClick={() => handlePlayInPlayer('mpv')}>
                            <ListItemText>MPV</ListItemText>
                        </MenuItem>
                        <MenuItem onClick={() => handlePlayInPlayer('infuse')}>
                            <ListItemText>Infuse</ListItemText>
                        </MenuItem>
                    </Menu>
                    <Tooltip title={t('share')}>
                        <Button
                            variant="outlined"
                            color="inherit"
                            onClick={handleShare}
                            sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                        >
                            <Share />
                        </Button>
                    </Tooltip>
                    <Tooltip title={t('addToCollection')}>
                        <Button
                            variant="outlined"
                            color="inherit"
                            onClick={() => onAddToCollection()}
                            sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'primary.main', borderColor: 'primary.main' } }}
                        >
                            <Add />
                        </Button>
                    </Tooltip>
                    <Tooltip title={t('delete')}>
                        <Button
                            variant="outlined"
                            color="inherit"
                            onClick={onDelete}
                            disabled={isDeleting}
                            sx={{ minWidth: 'auto', p: 1, color: 'text.secondary', borderColor: 'text.secondary', '&:hover': { color: 'error.main', borderColor: 'error.main' } }}
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

            {video.description && (
                <Box sx={{ mt: 2 }}>
                    <Typography
                        ref={descriptionRef}
                        variant="body2"
                        color="text.primary"
                        sx={{
                            whiteSpace: 'pre-wrap',
                            display: '-webkit-box',
                            overflow: 'hidden',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: isDescriptionExpanded ? 'unset' : 3,
                        }}
                    >
                        {video.description}
                    </Typography>
                    {showDescriptionExpandButton && (
                        <Button
                            size="small"
                            onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                            startIcon={isDescriptionExpanded ? <ExpandLess /> : <ExpandMore />}
                            sx={{ mt: 0.5, p: 0, minWidth: 'auto', textTransform: 'none' }}
                        >
                            {isDescriptionExpanded ? t('collapse') : t('expand')}
                        </Button>
                    )}
                </Box>
            )}

            <Divider sx={{ my: 2 }} />

            <Box sx={{ bgcolor: 'background.paper', p: 2, borderRadius: 2 }}>
                <Box sx={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 3, rowGap: 1 }}>
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
                    {videoCollections.length > 0 && (
                        <Box sx={{ display: 'inline', alignItems: 'center' }}>
                            {videoCollections.map((c, index) => (
                                <React.Fragment key={c.id}>
                                    <span
                                        onClick={() => onCollectionClick(c.id)}
                                        style={{
                                            cursor: 'pointer',
                                            color: theme.palette.primary.main,
                                            fontWeight: 'bold',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            verticalAlign: 'bottom'
                                        }}
                                    >
                                        <Folder fontSize="small" sx={{ mr: 0.5 }} />
                                        {c.name}
                                    </span>
                                    {index < videoCollections.length - 1 ? <span style={{ marginRight: '4px' }}>, </span> : ''}
                                </React.Fragment>
                            ))}
                        </Box>
                    )}
                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                        <VideoLibrary fontSize="small" sx={{ mr: 0.5 }} />
                        {video.source ? video.source.charAt(0).toUpperCase() + video.source.slice(1) : 'Unknown'}
                    </Typography>
                    {video.addedAt && (
                        <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                            <CalendarToday fontSize="small" sx={{ mr: 0.5 }} />
                            {new Date(video.addedAt).toISOString().split('T')[0]}
                        </Typography>
                    )}
                </Box>




            </Box>
        </Box>
    );
};

export default VideoInfo;
