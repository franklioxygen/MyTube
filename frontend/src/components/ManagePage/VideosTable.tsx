import {
    Check,
    Close,
    Delete,
    Edit,
    Refresh,
    Search,
    VideoLibrary
} from '@mui/icons-material';
import {
    Alert,
    Box,
    CircularProgress,
    IconButton,
    InputAdornment,
    Pagination,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TableSortLabel,
    TextField,
    Tooltip,
    Typography,
    useMediaQuery
} from '@mui/material';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { useCloudStorageUrl } from '../../hooks/useCloudStorageUrl';
import { Video } from '../../types';
import { formatDuration, formatSize } from '../../utils/formatUtils';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

// Component for thumbnail with cloud storage support
const ThumbnailImage: React.FC<{ video: Video }> = ({ video }) => {
    // Only load thumbnail from cloud if the video itself is in cloud storage
    const isVideoInCloud = video.videoPath?.startsWith('cloud:') ?? false;
    const thumbnailPathForCloud = isVideoInCloud ? video.thumbnailPath : null;
    const thumbnailUrl = useCloudStorageUrl(thumbnailPathForCloud, 'thumbnail');
    const localThumbnailUrl = !isVideoInCloud && video.thumbnailPath 
        ? `${BACKEND_URL || 'http://localhost:5551'}${video.thumbnailPath}` 
        : undefined;
    const src = thumbnailUrl || localThumbnailUrl || video.thumbnailUrl || 'https://via.placeholder.com/120x90?text=No+Thumbnail';
    
    return (
        <Box
            component="img"
            src={src}
            alt={video.title}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 1 }}
        />
    );
};

interface VideosTableProps {
    displayedVideos: Video[];
    totalVideosCount: number;
    totalSize: number;
    searchTerm: string;
    onSearchChange: (value: string) => void;
    orderBy: keyof Video | 'fileSize';
    order: 'asc' | 'desc';
    onSort: (property: keyof Video | 'fileSize') => void;
    page: number;
    totalPages: number;
    onPageChange: (event: React.ChangeEvent<unknown>, value: number) => void;
    onDeleteClick: (id: string) => void;
    deletingId: string | null;
    onRefreshThumbnail: (id: string) => void;
    refreshingId: string | null;
    onUpdateVideo: (id: string, data: Partial<Video>) => Promise<any>;
}

const VideosTable: React.FC<VideosTableProps> = ({
    displayedVideos,
    totalVideosCount,
    totalSize,
    searchTerm,
    onSearchChange,
    orderBy,
    order,
    onSort,
    page,
    totalPages,
    onPageChange,
    onDeleteClick,
    deletingId,
    onRefreshThumbnail,
    refreshingId,
    onUpdateVideo
}) => {
    const { t } = useLanguage();
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    // Local editing state
    const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState<string>('');
    const [isSavingTitle, setIsSavingTitle] = useState<boolean>(false);

    const handleEditClick = (video: Video) => {
        setEditingVideoId(video.id);
        setEditTitle(video.title);
    };

    const handleCancelEdit = () => {
        setEditingVideoId(null);
        setEditTitle('');
    };

    const handleSaveTitle = async (id: string) => {
        if (!editTitle.trim()) return;

        setIsSavingTitle(true);
        await onUpdateVideo(id, { title: editTitle });
        setIsSavingTitle(false);
        setEditingVideoId(null);
        setEditTitle('');
    };


    return (
        <Box>
            {/* Videos List */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center' }}>
                    <VideoLibrary sx={{ mr: 1, color: 'primary.main' }} />
                    {t('videos')} ({totalVideosCount}) - {formatSize(totalSize)}
                </Typography>
                <TextField
                    placeholder="Search videos..."
                    size="small"
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    slotProps={{
                        input: {
                            startAdornment: (
                                <InputAdornment position="start">
                                    <Search />
                                </InputAdornment>
                            ),
                        }
                    }}
                    sx={{ width: 300 }}
                />
            </Box>

            {displayedVideos.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>{t('thumbnail')}</TableCell>
                                <TableCell>
                                    <TableSortLabel
                                        active={orderBy === 'title'}
                                        direction={orderBy === 'title' ? order : 'asc'}
                                        onClick={() => onSort('title')}
                                    >
                                        {t('title')}
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell>
                                    <TableSortLabel
                                        active={orderBy === 'author'}
                                        direction={orderBy === 'author' ? order : 'asc'}
                                        onClick={() => onSort('author')}
                                    >
                                        {t('author')}
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell>
                                    <TableSortLabel
                                        active={orderBy === 'fileSize'}
                                        direction={orderBy === 'fileSize' ? order : 'asc'}
                                        onClick={() => onSort('fileSize')}
                                    >
                                        {t('size')}
                                    </TableSortLabel>
                                </TableCell>
                                {!isVisitor && <TableCell align="right">{t('actions')}</TableCell>}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {displayedVideos.map(video => (
                                <TableRow key={video.id} hover>
                                    <TableCell sx={{ width: 140 }}>
                                        <Box sx={{ position: 'relative', width: 120, height: 68 }}>
                                            <Link to={`/video/${video.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                                                <ThumbnailImage video={video} />
                                            </Link>
                                            {!isVisitor && (
                                                <Tooltip title={t('refreshThumbnail') || "Refresh Thumbnail"} disableHoverListener={isTouch}>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => onRefreshThumbnail(video.id)}
                                                        disabled={refreshingId === video.id}
                                                        sx={{
                                                            position: 'absolute',
                                                            top: 0,
                                                            right: 0,
                                                            bgcolor: 'rgba(0,0,0,0.5)',
                                                            color: 'white',
                                                            '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
                                                            p: 0.5,
                                                            width: 24,
                                                            height: 24
                                                        }}
                                                    >
                                                        {refreshingId === video.id ? <CircularProgress size={14} color="inherit" /> : <Refresh sx={{ fontSize: 16 }} />}
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                        </Box>
                                        <Typography variant="caption" display="block" sx={{ mt: 0.5, color: 'text.secondary', textAlign: 'center' }}>
                                            {formatDuration(video.duration)}
                                        </Typography>
                                    </TableCell>
                                    <TableCell sx={{ fontWeight: 500, maxWidth: 400 }}>
                                        {editingVideoId === video.id ? (
                                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                                <TextField
                                                    value={editTitle}
                                                    onChange={(e) => setEditTitle(e.target.value)}
                                                    size="small"
                                                    fullWidth
                                                    autoFocus
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleSaveTitle(video.id);
                                                        if (e.key === 'Escape') handleCancelEdit();
                                                    }}
                                                />
                                                <IconButton
                                                    size="small"
                                                    color="primary"
                                                    onClick={() => handleSaveTitle(video.id)}
                                                    disabled={isSavingTitle}
                                                >
                                                    {isSavingTitle ? <CircularProgress size={20} /> : <Check />}
                                                </IconButton>
                                                <IconButton
                                                    size="small"
                                                    color="error"
                                                    onClick={handleCancelEdit}
                                                    disabled={isSavingTitle}
                                                >
                                                    <Close />
                                                </IconButton>
                                            </Box>
                                        ) : (
                                            <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
                                                {!isVisitor && (
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => handleEditClick(video)}
                                                        sx={{ mr: 1, mt: -0.5, opacity: 0.6, '&:hover': { opacity: 1 } }}
                                                    >
                                                        <Edit fontSize="small" />
                                                    </IconButton>
                                                )}
                                                <Typography
                                                    variant="body2"
                                                    sx={{
                                                        display: '-webkit-box',
                                                        WebkitLineClamp: 2,
                                                        WebkitBoxOrient: 'vertical',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        lineHeight: 1.4
                                                    }}
                                                >
                                                    {video.title}
                                                </Typography>
                                            </Box>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Link
                                            to={`/author/${encodeURIComponent(video.author)}`}
                                            style={{ textDecoration: 'none', color: 'inherit' }}
                                        >
                                            <Typography
                                                variant="body2"
                                                sx={{
                                                    '&:hover': { textDecoration: 'underline', color: 'primary.main' }
                                                }}
                                            >
                                                {video.author}
                                            </Typography>
                                        </Link>
                                    </TableCell>
                                    <TableCell>{formatSize(video.fileSize)}</TableCell>
                                    {!isVisitor && (
                                        <TableCell align="right">
                                            <Tooltip title={t('deleteVideo')} disableHoverListener={isTouch}>
                                                <IconButton
                                                    color="error"
                                                    onClick={() => onDeleteClick(video.id)}
                                                    disabled={deletingId === video.id}
                                                >
                                                    {deletingId === video.id ? <CircularProgress size={24} /> : <Delete />}
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    )}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            ) : (
                <Alert severity="info" variant="outlined">{t('noVideosFoundMatching')}</Alert>
            )}

            {totalPages > 1 && (
                <Box sx={{ mt: 2, mb: 4, display: 'flex', justifyContent: 'center' }}>
                    <Pagination
                        count={totalPages}
                        page={page}
                        onChange={onPageChange}
                        color="primary"
                        showFirstButton
                        showLastButton
                    />
                </Box>
            )}
        </Box>
    );
};

export default VideosTable;
