import {
    Check,
    Close,
    Delete,
    DriveFileMove,
    Edit,
    Refresh,
    Search,
    VideoLibrary
} from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    CircularProgress,
    IconButton,
    InputAdornment,
    Pagination,
    Paper,
    Stack,
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
import { useAuth } from '../../contexts/AuthContext';
import { useCollection } from '../../contexts/CollectionContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useVideo } from '../../contexts/VideoContext';
import { useCloudStorageUrl } from '../../hooks/useCloudStorageUrl';
import { Video } from '../../types';
import { formatDuration, formatSize } from '../../utils/formatUtils';
import CollectionModal from '../CollectionModal';
import ConfirmationModal from '../ConfirmationModal';

import { getBackendUrl } from '../../utils/apiUrl';

const BACKEND_URL = getBackendUrl();

// Component for thumbnail with cloud storage support
const ThumbnailImage: React.FC<{ video: Video }> = ({ video }) => {
    // Only load thumbnail from cloud if the video itself is in cloud storage
    const isVideoInCloud = video.videoPath?.startsWith('cloud:') ?? false;
    const thumbnailPathForCloud = isVideoInCloud ? video.thumbnailPath : null;
    const thumbnailUrl = useCloudStorageUrl(thumbnailPathForCloud, 'thumbnail');
    const localThumbnailUrl = !isVideoInCloud && video.thumbnailPath
        ? `${BACKEND_URL}${video.thumbnailPath}`
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
    const { collections, addToCollection, createCollection, fetchCollections } = useCollection();
    const { deleteVideo } = useVideo();
    const isVisitor = userRole === 'visitor';
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    // Bulk selection state
    const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);

    // Bulk action modals
    const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false);
    const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);

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



    const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.checked) {
            setSelectedVideoIds(displayedVideos.map((v) => v.id));
        } else {
            setSelectedVideoIds([]);
        }
    };

    const handleSelectOne = (event: React.ChangeEvent<HTMLInputElement>, id: string) => {
        if (event.target.checked) {
            setSelectedVideoIds((prev) => [...prev, id]);
        } else {
            setSelectedVideoIds((prev) => prev.filter((vId) => vId !== id));
        }
    };

    const handleBulkDelete = async () => {
        setIsBulkDeleting(true);
        try {
            await Promise.all(selectedVideoIds.map((id) => deleteVideo(id)));
            setSelectedVideoIds([]);
            setIsBulkDeleteModalOpen(false);
        } catch (error) {
            console.error('Failed to delete videos', error);
        } finally {
            setIsBulkDeleting(false);
        }
    };

    const handleBulkAddToCollection = async (collectionId: string) => {
        try {
            await Promise.all(selectedVideoIds.map((id) => addToCollection(collectionId, id)));
            await fetchCollections(); // Refresh collections to update counts/content if needed
            setSelectedVideoIds([]);
        } catch (error) {
            console.error('Failed to add videos to collection', error);
        }
    };

    const handleBulkCreateCollection = async (name: string) => {
        try {
            // Create collection with the first video
            if (selectedVideoIds.length === 0) return;

            const firstId = selectedVideoIds[0];
            const newCollection = await createCollection(name, firstId);

            if (newCollection && selectedVideoIds.length > 1) {
                // Add the rest
                const remainingIds = selectedVideoIds.slice(1);
                await Promise.all(remainingIds.map((id) => addToCollection(newCollection.id, id)));
            }

            await fetchCollections();
            setSelectedVideoIds([]);
        } catch (error) {
            console.error('Failed to create collection', error);
        }
    };

    return (
        <Box>
            {/* Videos List Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, height: 40 }}>
                {selectedVideoIds.length > 0 ? (
                    <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%' }}>
                        <Typography variant="subtitle1" fontWeight="bold" color="primary">
                            {selectedVideoIds.length} {t('selected') || 'Selected'}
                        </Typography>

                        <Box sx={{ flexGrow: 1 }} />

                        <Button
                            variant="outlined"
                            startIcon={<DriveFileMove />}
                            onClick={() => setIsCollectionModalOpen(true)}
                            size="small"
                        >
                            {t('moveCollection') || 'Move Collection'}
                        </Button>

                        <Button
                            variant="outlined"
                            color="error"
                            startIcon={<Delete />}
                            onClick={() => setIsBulkDeleteModalOpen(true)}
                            size="small"
                        >
                            {t('delete')}
                        </Button>
                    </Stack>
                ) : (
                    <>
                        <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center' }}>
                            <VideoLibrary sx={{ mr: 1, color: 'primary.main' }} />
                            {t('videos')} ({totalVideosCount}) - {formatSize(totalSize)}
                        </Typography>
                        <TextField
                            placeholder={t('searchVideos') || "Search videos..."}
                            size="small"
                            value={searchTerm}
                            onChange={(e) => onSearchChange(e.target.value)}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <Search />
                                    </InputAdornment>
                                ),
                            }}
                            sx={{ width: 300 }}
                        />
                    </>
                )}
            </Box>

            {displayedVideos.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell padding="checkbox">
                                    <Checkbox
                                        color="primary"
                                        indeterminate={selectedVideoIds.length > 0 && selectedVideoIds.length < displayedVideos.length}
                                        checked={displayedVideos.length > 0 && selectedVideoIds.length === displayedVideos.length}
                                        onChange={handleSelectAll}
                                        inputProps={{
                                            'aria-label': 'select all videos',
                                        }}
                                    />
                                </TableCell>
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
                                <TableRow key={video.id} hover selected={selectedVideoIds.includes(video.id)}>
                                    <TableCell padding="checkbox">
                                        <Checkbox
                                            color="primary"
                                            checked={selectedVideoIds.includes(video.id)}
                                            onChange={(event) => handleSelectOne(event, video.id)}
                                            inputProps={{
                                                'aria-label': `select video ${video.title}`,
                                            }}
                                        />
                                    </TableCell>
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

            <CollectionModal
                open={isCollectionModalOpen}
                onClose={() => setIsCollectionModalOpen(false)}
                collections={collections}
                onAddToCollection={handleBulkAddToCollection}
                onCreateCollection={handleBulkCreateCollection}
            />

            <ConfirmationModal
                isOpen={isBulkDeleteModalOpen}
                onClose={() => setIsBulkDeleteModalOpen(false)}
                onConfirm={handleBulkDelete}
                title={`${t('delete')} ${selectedVideoIds.length} ${t('videos')}`}
                message={t('confirmBulkDelete') || `Are you sure you want to delete these ${selectedVideoIds.length} videos? This action cannot be undone.`}
                confirmText={isBulkDeleting ? (t('deleting') || 'Deleting...') : (t('delete') || 'Delete')}
                cancelText={t('cancel')}
                isDanger={true}
            />
        </Box>
    );
};

export default VideosTable;
