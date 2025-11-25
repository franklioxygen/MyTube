import {
    ArrowBack,
    Delete,
    Folder,
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
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [collectionToDelete, setCollectionToDelete] = useState<Collection | null>(null);
    const [isDeletingCollection, setIsDeletingCollection] = useState<boolean>(false);
    const [videoToDelete, setVideoToDelete] = useState<string | null>(null);
    const [showVideoDeleteModal, setShowVideoDeleteModal] = useState<boolean>(false);

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
                                            <Box
                                                component="img"
                                                src={getThumbnailSrc(video)}
                                                alt={video.title}
                                                sx={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 1 }}
                                            />
                                        </TableCell>
                                        <TableCell sx={{ fontWeight: 500 }}>
                                            {video.title}
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
