import {
    ArrowBack,
    Check,
    Close,
    Delete,
    Edit,
    Folder,
    Refresh,
    Search,
    VideoLibrary
} from '@mui/icons-material';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Container,
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
    TextField,
    Tooltip,
    Typography
} from '@mui/material';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import ConfirmationModal from '../components/ConfirmationModal';
import DeleteCollectionModal from '../components/DeleteCollectionModal';
import { useLanguage } from '../contexts/LanguageContext';
import { useVideo } from '../contexts/VideoContext';
import { Collection, Video } from '../types';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

interface ManagePageProps {
    videos: Video[];
    onDeleteVideo: (id: string) => Promise<any>;
    collections: Collection[];
    onDeleteCollection: (id: string, deleteVideos: boolean) => Promise<any>;
}

const ManagePage: React.FC<ManagePageProps> = ({ videos, onDeleteVideo, collections = [], onDeleteCollection }) => {
    const [searchTerm, setSearchTerm] = useState<string>('');
    const { t } = useLanguage();
    const { refreshThumbnail, updateVideo } = useVideo();
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [refreshingId, setRefreshingId] = useState<string | null>(null);
    const [collectionToDelete, setCollectionToDelete] = useState<Collection | null>(null);
    const [isDeletingCollection, setIsDeletingCollection] = useState<boolean>(false);
    const [videoToDelete, setVideoToDelete] = useState<string | null>(null);
    const [showVideoDeleteModal, setShowVideoDeleteModal] = useState<boolean>(false);

    // Editing state
    const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState<string>('');
    const [isSavingTitle, setIsSavingTitle] = useState<boolean>(false);

    // Pagination state
    const [collectionPage, setCollectionPage] = useState(1);
    const [videoPage, setVideoPage] = useState(1);
    const ITEMS_PER_PAGE = 10;

    const filteredVideos = videos.filter(video =>
        video.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        video.author.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Pagination logic
    const totalCollectionPages = Math.ceil(collections.length / ITEMS_PER_PAGE);
    const displayedCollections = collections.slice(
        (collectionPage - 1) * ITEMS_PER_PAGE,
        collectionPage * ITEMS_PER_PAGE
    );

    const totalVideoPages = Math.ceil(filteredVideos.length / ITEMS_PER_PAGE);
    const displayedVideos = filteredVideos.slice(
        (videoPage - 1) * ITEMS_PER_PAGE,
        videoPage * ITEMS_PER_PAGE
    );

    const handleCollectionPageChange = (_: React.ChangeEvent<unknown>, value: number) => {
        setCollectionPage(value);
    };

    const handleVideoPageChange = (_: React.ChangeEvent<unknown>, value: number) => {
        setVideoPage(value);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const confirmDeleteVideo = async () => {
        if (!videoToDelete) return;

        setDeletingId(videoToDelete);
        await onDeleteVideo(videoToDelete);
        setDeletingId(null);
        setVideoToDelete(null);
        setShowVideoDeleteModal(false); // Close the modal after deletion
    };

    const handleDelete = (id: string) => {
        setVideoToDelete(id);
        setShowVideoDeleteModal(true);
    };

    const confirmDeleteCollection = (collection: Collection) => {
        setCollectionToDelete(collection);
    };

    const handleCollectionDeleteOnly = async () => {
        if (!collectionToDelete) return;
        setIsDeletingCollection(true);
        await onDeleteCollection(collectionToDelete.id, false);
        setIsDeletingCollection(false);
        setCollectionToDelete(null);
    };

    const handleCollectionDeleteAll = async () => {
        if (!collectionToDelete) return;
        setIsDeletingCollection(true);
        await onDeleteCollection(collectionToDelete.id, true);
        setIsDeletingCollection(false);
        setCollectionToDelete(null);
    };

    const handleRefreshThumbnail = async (id: string) => {
        setRefreshingId(id);
        await refreshThumbnail(id);
        setRefreshingId(null);
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
        await updateVideo(id, { title: editTitle });
        setIsSavingTitle(false);
        setEditingVideoId(null);
        setEditTitle('');
    };

    const getThumbnailSrc = (video: Video) => {
        if (video.thumbnailPath) {
            return `${BACKEND_URL}${video.thumbnailPath}`;
        }
        return video.thumbnailUrl || 'https://via.placeholder.com/120x90?text=No+Thumbnail';
    };

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    {t('manageContent')}
                </Typography>
                <Button
                    component={Link}
                    to="/"
                    variant="outlined"
                    startIcon={<ArrowBack />}
                >
                    {t('backToHome')}
                </Button>
            </Box>

            <DeleteCollectionModal
                isOpen={!!collectionToDelete}
                onClose={() => !isDeletingCollection && setCollectionToDelete(null)}
                onDeleteCollectionOnly={handleCollectionDeleteOnly}
                onDeleteCollectionAndVideos={handleCollectionDeleteAll}
                collectionName={collectionToDelete?.name || ''}
                videoCount={collectionToDelete?.videos.length || 0}
            />

            <ConfirmationModal
                isOpen={showVideoDeleteModal}
                onClose={() => {
                    setShowVideoDeleteModal(false);
                    setVideoToDelete(null);
                }}
                onConfirm={confirmDeleteVideo}
                title={t('deleteVideo')}
                message={t('confirmDelete')}
                confirmText={t('delete')}
                cancelText={t('cancel')}
                isDanger={true}
            />

            <Box sx={{ mb: 6 }}>
                <Typography variant="h5" sx={{ mb: 2, display: 'flex', alignItems: 'center' }}>
                    <Folder sx={{ mr: 1, color: 'secondary.main' }} />
                    {t('collections')} ({collections.length})
                </Typography>

                {collections.length > 0 ? (
                    <TableContainer component={Paper} variant="outlined">
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>{t('name')}</TableCell>
                                    <TableCell>{t('videos')}</TableCell>
                                    <TableCell>{t('created')}</TableCell>
                                    <TableCell align="right">{t('actions')}</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {displayedCollections.map(collection => (
                                    <TableRow key={collection.id} hover>
                                        <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>
                                            {collection.name}
                                        </TableCell>
                                        <TableCell>{collection.videos.length} videos</TableCell>
                                        <TableCell>{new Date(collection.createdAt).toLocaleDateString()}</TableCell>
                                        <TableCell align="right">
                                            <Tooltip title={t('deleteCollection')}>
                                                <IconButton
                                                    color="error"
                                                    onClick={() => confirmDeleteCollection(collection)}
                                                    size="small"
                                                >
                                                    <Delete />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                ) : (
                    <Alert severity="info" variant="outlined">{t('noCollections')}</Alert>
                )}

                {totalCollectionPages > 1 && (
                    <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
                        <Pagination
                            count={totalCollectionPages}
                            page={collectionPage}
                            onChange={handleCollectionPageChange}
                            color="secondary"
                            showFirstButton
                            showLastButton
                        />
                    </Box>
                )}
            </Box>

            <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center' }}>
                        <VideoLibrary sx={{ mr: 1, color: 'primary.main' }} />
                        {t('videos')} ({filteredVideos.length})
                    </Typography>
                    <TextField
                        placeholder="Search videos..."
                        size="small"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <Search />
                                </InputAdornment>
                            ),
                        }}
                        sx={{ width: 300 }}
                    />
                </Box>

                {filteredVideos.length > 0 ? (
                    <TableContainer component={Paper} variant="outlined">
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>{t('thumbnail')}</TableCell>
                                    <TableCell>{t('title')}</TableCell>
                                    <TableCell>{t('author')}</TableCell>
                                    <TableCell align="right">{t('actions')}</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {displayedVideos.map(video => (
                                    <TableRow key={video.id} hover>
                                        <TableCell sx={{ width: 140 }}>
                                            <Box sx={{ position: 'relative', width: 120, height: 68 }}>
                                                <Box
                                                    component="img"
                                                    src={getThumbnailSrc(video)}
                                                    alt={video.title}
                                                    sx={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 1 }}
                                                />
                                                <Tooltip title={t('refreshThumbnail') || "Refresh Thumbnail"}>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => handleRefreshThumbnail(video.id)}
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
                                            </Box>
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
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => handleEditClick(video)}
                                                        sx={{ mr: 1, mt: -0.5, opacity: 0.6, '&:hover': { opacity: 1 } }}
                                                    >
                                                        <Edit fontSize="small" />
                                                    </IconButton>
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
                                        <TableCell>{video.author}</TableCell>
                                        <TableCell align="right">
                                            <Tooltip title={t('deleteVideo')}>
                                                <IconButton
                                                    color="error"
                                                    onClick={() => handleDelete(video.id)}
                                                    disabled={deletingId === video.id}
                                                >
                                                    {deletingId === video.id ? <CircularProgress size={24} /> : <Delete />}
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                ) : (
                    <Alert severity="info" variant="outlined">{t('noVideosFoundMatching')}</Alert>
                )}
            </Box>

            {totalVideoPages > 1 && (
                <Box sx={{ mt: 2, mb: 4, display: 'flex', justifyContent: 'center' }}>
                    <Pagination
                        count={totalVideoPages}
                        page={videoPage}
                        onChange={handleVideoPageChange}
                        color="primary"
                        showFirstButton
                        showLastButton
                    />
                </Box>
            )}
        </Container>
    );
};

export default ManagePage;
