import {
    Check,
    Close,
    CloudDownload,
    CloudUpload,
    Delete,
    Edit,
    Refresh,
    Replay,
    Search,
    VideoLibrary
} from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    Checkbox,
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
import React, { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../contexts/AuthContext';
import { useDownload } from '../../contexts/DownloadContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useVideo } from '../../contexts/VideoContext';
import { usePaginationSwipeNavigation } from '../../hooks/usePaginationSwipeNavigation';
import { useThumbnailCandidates } from '../../hooks/useThumbnailCandidates';
import { Video } from '../../types';
import type { TranslationKey } from '../../utils/translations';
import { formatDuration, formatSize } from '../../utils/formatUtils';
import VideoBatchToolbar from '../VideoBatchToolbar';
import { useVideoSelection } from '../../hooks/useVideoSelection';
import ConfirmationModal from '../ConfirmationModal';
import UploadThumbnailModal from '../UploadThumbnailModal';

import { neutral, overlay } from '../../theme/colors';
import { handleThumbnailError } from '../../utils/thumbnailPlaceholder';
import { useVideoReDownload } from './hooks/useVideoReDownload';

const thumbnailActionButtonSx = {
    bgcolor: overlay.black50,
    color: neutral.white,
    '&:hover': { bgcolor: overlay.black70 },
    '&.Mui-disabled': {
        bgcolor: overlay.black50,
        color: neutral.white,
        opacity: 1,
    },
    p: 0.5,
    width: 24,
    height: 24
} as const;

// Component for thumbnail with cloud storage support
const ThumbnailImage: React.FC<{ video: Video; cacheBust?: number }> = ({ video, cacheBust }) => {
    const { src, candidates } = useThumbnailCandidates(video, cacheBust);

    return (
        <Box
            component="img"
            src={src}
            alt={video.title}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 1 }}
            onError={(e) => handleThumbnailError(e.currentTarget, candidates)}
        />
    );
};

interface VideosTableProps {
    displayedVideos: Video[];
    allVideos?: Video[];
    orderedVideos?: Video[];
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
    onRedownloadThumbnail: (id: string) => void;
    onUploadThumbnail: (id: string, file: File) => Promise<any>;
    refreshingId: string | null;
    redownloadingThumbnailIds: Record<string, boolean>;
    thumbnailCacheBustById: Record<string, number | undefined>;
    onRefreshFileSizes: () => void;
    isRefreshingFileSizes: boolean;
    onUpdateVideo: (id: string, data: Partial<Video>) => Promise<any>;
}

const VideosTable: React.FC<VideosTableProps> = ({
    displayedVideos,
    allVideos = displayedVideos,
    orderedVideos = displayedVideos,
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
    onRedownloadThumbnail,
    onUploadThumbnail,
    refreshingId,
    redownloadingThumbnailIds,
    thumbnailCacheBustById,
    onRefreshFileSizes,
    isRefreshingFileSizes,
    onUpdateVideo
}) => {
    const { t } = useLanguage();
    const { userRole } = useAuth();
    const { deleteVideo } = useVideo();
    const { activeDownloads, queuedDownloads } = useDownload();
    const isVisitor = userRole === 'visitor';
    const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

    // Swiping the table sideways turns the page, matching the arrow keys on the
    // video grids. On a narrow screen the table scrolls horizontally instead and
    // the hook stands down, so the two gestures never fight.
    const goToPage = useCallback(
        (value: number) => onPageChange({} as React.ChangeEvent<unknown>, value),
        [onPageChange]
    );
    const tableContainerRef = useRef<HTMLDivElement>(null);
    const swipeHandlers = usePaginationSwipeNavigation({
        page,
        totalPages,
        onPageChange: goToPage,
        keepNativeHorizontalPan: true,
        surfaceRef: tableContainerRef
    });
    const getLabel = (key: string, fallback: string) => {
        // key is a known literal here; cast bridges the string param to TranslationKey.
        const translated = t(key as TranslationKey);
        return translated === key ? fallback : translated;
    };
    const refreshThumbnailLabel = getLabel('refreshThumbnail', 'Refresh Thumbnail');
    const uploadThumbnailLabel = getLabel('uploadThumbnail', 'Upload Thumbnail');
    const redownloadThumbnailLabel = getLabel('redownloadThumbnail', 'Re-download Thumbnail');
    const redownloadVideoLabel = getLabel('redownloadVideo', 'Re-download Video');
    const deleteVideoLabel = getLabel('deleteVideo', 'Delete Video');
    const editVideoLabel = getLabel('edit', 'Edit');

    // Bulk selection state
    const selection = useVideoSelection({
        scopeKey: JSON.stringify(['manage-videos', searchTerm]), videos: allVideos, alwaysOn: true,
    });
    const selectedVideoIds = [...selection.selectedIds];
    const currentPageSelected = displayedVideos.filter((video) => selection.selectedIds.has(video.id)).length;

    // Bulk action modals
    const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);

    // Local editing state
    const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState<string>('');
    const [isSavingTitle, setIsSavingTitle] = useState<boolean>(false);

    // Upload thumbnail state
    const [uploadThumbnailVideoId, setUploadThumbnailVideoId] = useState<string | null>(null);

    // Re-download hook
    const { handleReDownload, isReDownloading } = useVideoReDownload();

    // Helper function to check if a video is currently downloading
    const isVideoDownloading = (sourceUrl: string | undefined) => {
        if (!sourceUrl) return false;
        return [...activeDownloads, ...queuedDownloads].some(
            download => download.sourceUrl === sourceUrl
        );
    };

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
        try {
            await onUpdateVideo(id, { title: editTitle });
            setEditingVideoId(null);
            setEditTitle('');
        } finally {
            setIsSavingTitle(false);
        }
    };

    const handleSelectAll = () => selection.togglePage(displayedVideos.map((video) => video.id));
    const handleSelectOne = (_event: React.ChangeEvent<HTMLInputElement>, id: string) => selection.toggle(id);

    const handleBulkDelete = async () => {
        setIsBulkDeleting(true);
        try {
            await Promise.all(selectedVideoIds.map((id) => deleteVideo(id)));
            selection.clear();
            setIsBulkDeleteModalOpen(false);
        } catch (error) {
            console.error('Failed to delete videos', error);
            throw error;
        } finally {
            setIsBulkDeleting(false);
        }
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 2 }}>
                <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center' }}>
                    <VideoLibrary sx={{ mr: 1, color: 'primary.main' }} />
                    {t('videos')} ({totalVideosCount}) - {formatSize(totalSize)}
                </Typography>
                <TextField placeholder={t('searchVideos')} size="small" value={searchTerm}
                    disabled={selection.locked} onChange={(event) => onSearchChange(event.target.value)}
                    InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }} />
                {selection.canWrite && selectedVideoIds.length > 0 && <Button variant="outlined" color="error"
                    startIcon={<Delete />} disabled={selection.locked || isBulkDeleting}
                    onClick={() => setIsBulkDeleteModalOpen(true)}>{t('delete')}</Button>}
            </Box>
            <VideoBatchToolbar selection={selection} pageIds={displayedVideos.map((video) => video.id)}
                orderedIds={orderedVideos.map((video) => video.id)} alwaysOn />

            {displayedVideos.length > 0 ? (
                <TableContainer component={Paper} variant="outlined" ref={tableContainerRef} {...swipeHandlers}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                {!isVisitor && (
                                    <TableCell padding="checkbox">
                                        <Checkbox
                                            color="primary"
                                            indeterminate={currentPageSelected > 0 && currentPageSelected < displayedVideos.length}
                                            checked={displayedVideos.length > 0 && currentPageSelected === displayedVideos.length}
                                            disabled={selection.locked || isBulkDeleting}
                                            onChange={handleSelectAll}
                                            slotProps={{
                                                input: {
                                                    'aria-label': 'select all videos',
                                                },
                                            }}
                                        />
                                    </TableCell>
                                )}
                                <TableCell>{t('thumbnail')}</TableCell>
                                <TableCell>
                                    <TableSortLabel
                                        disabled={selection.locked}
                                        active={orderBy === 'title'}
                                        direction={orderBy === 'title' ? order : 'asc'}
                                        onClick={() => onSort('title')}
                                    >
                                        {t('title')}
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell>
                                    <TableSortLabel
                                        disabled={selection.locked}
                                        active={orderBy === 'author'}
                                        direction={orderBy === 'author' ? order : 'asc'}
                                        onClick={() => onSort('author')}
                                    >
                                        {t('author')}
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        {!isVisitor && (
                                            <Tooltip title={t('refresh') || 'Refresh'} disableHoverListener={isTouch}>
                                                <span>
                                                    <IconButton
                                                        size="small"
                                                        onClick={onRefreshFileSizes}
                                                        loading={isRefreshingFileSizes}
                                                        aria-label="Refresh all file sizes"
                                                    >
                                                        <Refresh sx={{ fontSize: 18 }} />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                        )}
                                        <TableSortLabel
                                        disabled={selection.locked}
                                            active={orderBy === 'fileSize'}
                                            direction={orderBy === 'fileSize' ? order : 'asc'}
                                            onClick={() => onSort('fileSize')}
                                        >
                                            {t('size')}
                                        </TableSortLabel>
                                    </Box>
                                </TableCell>
                                {!isVisitor && <TableCell align="right">{t('actions')}</TableCell>}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {displayedVideos.map(video => (
                                <TableRow key={video.id} hover selected={selectedVideoIds.includes(video.id)}>
                                    {!isVisitor && (
                                        <TableCell padding="checkbox">
                                            <Checkbox
                                                color="primary"
                                                checked={selectedVideoIds.includes(video.id)}
                                                disabled={selection.locked || isBulkDeleting}
                                                onChange={(event) => handleSelectOne(event, video.id)}
                                                slotProps={{
                                                    input: {
                                                        'aria-label': `select video ${video.title}`,
                                                    },
                                                }}
                                            />
                                        </TableCell>
                                    )}
                                    <TableCell sx={{ width: 140 }}>
                                        <Box sx={{ position: 'relative', width: 120, height: 68 }}>
                                            <Link to={`/video/${video.id}`} style={{ display: 'block', width: '100%', height: '100%' }}>
                                                <ThumbnailImage
                                                    video={video}
                                                    cacheBust={thumbnailCacheBustById[video.id]}
                                                />
                                            </Link>
                                            {!isVisitor && (
                                                <>
                                                    <Tooltip title={refreshThumbnailLabel} disableHoverListener={isTouch}>
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => onRefreshThumbnail(video.id)}
	                                                            aria-label={refreshThumbnailLabel}
	                                                            disabled={redownloadingThumbnailIds[video.id] === true}
	                                                            loading={refreshingId === video.id}
	                                                            sx={{
                                                                position: 'absolute',
                                                                top: 0,
                                                                right: 0,
                                                                ...thumbnailActionButtonSx
                                                            }}
                                                        >
	                                                            <Refresh sx={{ fontSize: 16 }} />
	                                                        </IconButton>
                                                    </Tooltip>
                                                    {video.sourceUrl && (
                                                        <Tooltip title={redownloadThumbnailLabel} disableHoverListener={isTouch}>
                                                            <IconButton
                                                                size="small"
                                                                onClick={() => onRedownloadThumbnail(video.id)}
	                                                                aria-label={redownloadThumbnailLabel}
	                                                                disabled={refreshingId === video.id}
	                                                                loading={redownloadingThumbnailIds[video.id] === true}
	                                                                sx={{
                                                                    position: 'absolute',
                                                                    top: 0,
                                                                    left: 0,
                                                                    ...thumbnailActionButtonSx
                                                                }}
                                                            >
	                                                                <CloudDownload sx={{ fontSize: 16 }} />
	                                                            </IconButton>
                                                        </Tooltip>
                                                    )}
                                                    <Tooltip title={uploadThumbnailLabel} disableHoverListener={isTouch}>
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => setUploadThumbnailVideoId(video.id)}
                                                            aria-label={uploadThumbnailLabel}
                                                            sx={{
                                                                position: 'absolute',
                                                                bottom: 0,
                                                                right: 0,
                                                                ...thumbnailActionButtonSx
                                                            }}
                                                        >
                                                            <CloudUpload sx={{ fontSize: 16 }} />
                                                        </IconButton>
                                                    </Tooltip>
                                                </>
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
	                                                    aria-label={t('save')}
	                                                    onClick={() => handleSaveTitle(video.id)}
	                                                    loading={isSavingTitle}
	                                                >
	                                                    <Check />
	                                                </IconButton>
                                                <IconButton
                                                    size="small"
                                                    color="error"
                                                    aria-label={t('cancel')}
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
                                                        aria-label={editVideoLabel}
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
	                                            {video.sourceUrl && (!isVideoDownloading(video.sourceUrl) || isReDownloading(video.sourceUrl)) && (
	                                                <Tooltip
                                                    title={redownloadVideoLabel}
                                                    disableHoverListener={isTouch}
                                                >
                                                    <IconButton
                                                        color="primary"
	                                                        aria-label={redownloadVideoLabel}
	                                                        onClick={() => { void handleReDownload(video); }}
	                                                        loading={isReDownloading(video.sourceUrl)}
	                                                    >
                                                        <Replay />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                            <Tooltip title={deleteVideoLabel} disableHoverListener={isTouch}>
                                                <IconButton
                                                    color="error"
                                                    aria-label={deleteVideoLabel}
	                                                    onClick={() => onDeleteClick(video.id)}
	                                                    loading={deletingId === video.id}
	                                                >
	                                                    <Delete />
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
                        disabled={selection.locked || isBulkDeleting}
                        color="primary"
                        showFirstButton
                        showLastButton
                    />
                </Box>
            )}

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

            <UploadThumbnailModal
                open={uploadThumbnailVideoId !== null}
                onClose={() => setUploadThumbnailVideoId(null)}
                onUpload={async (file) => {
                    if (uploadThumbnailVideoId) {
                        await onUploadThumbnail(uploadThumbnailVideoId, file);
                    }
                }}
            />
        </Box>
    );
};

export default VideosTable;
