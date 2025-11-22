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
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [collectionToDelete, setCollectionToDelete] = useState<Collection | null>(null);
    const [isDeletingCollection, setIsDeletingCollection] = useState<boolean>(false);
    const [videoToDelete, setVideoToDelete] = useState<string | null>(null);
    const [showVideoDeleteModal, setShowVideoDeleteModal] = useState<boolean>(false);

    const filteredVideos = videos.filter(video =>
        video.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        video.author.toLowerCase().includes(searchTerm.toLowerCase())
    );

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
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    Manage Content
                </Typography>
                <Button
                    component={Link}
                    to="/"
                    variant="outlined"
                    startIcon={<ArrowBack />}
                >
                    Back to Home
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
                title="Delete Video"
                message="Are you sure you want to delete this video?"
                confirmText="Delete"
                isDanger={true}
            />

            <Box sx={{ mb: 6 }}>
                <Typography variant="h5" sx={{ mb: 2, display: 'flex', alignItems: 'center' }}>
                    <Folder sx={{ mr: 1, color: 'secondary.main' }} />
                    Collections ({collections.length})
                </Typography>

                {collections.length > 0 ? (
                    <TableContainer component={Paper} variant="outlined">
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Name</TableCell>
                                    <TableCell>Videos</TableCell>
                                    <TableCell>Created</TableCell>
                                    <TableCell align="right">Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {collections.map(collection => (
                                    <TableRow key={collection.id} hover>
                                        <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>
                                            {collection.name}
                                        </TableCell>
                                        <TableCell>{collection.videos.length} videos</TableCell>
                                        <TableCell>{new Date(collection.createdAt).toLocaleDateString()}</TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="Delete Collection">
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
                    <Alert severity="info" variant="outlined">No collections found.</Alert>
                )}
            </Box>

            <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center' }}>
                        <VideoLibrary sx={{ mr: 1, color: 'primary.main' }} />
                        Videos ({filteredVideos.length})
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
                                    <TableCell>Thumbnail</TableCell>
                                    <TableCell>Title</TableCell>
                                    <TableCell>Author</TableCell>
                                    <TableCell align="right">Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {filteredVideos.map(video => (
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
                                            <Tooltip title="Delete Video">
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
                    <Alert severity="info" variant="outlined">No videos found matching your search.</Alert>
                )}
            </Box>
        </Container>
    );
};

export default ManagePage;
