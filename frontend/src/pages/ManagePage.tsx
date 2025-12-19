import {
    FindInPage
} from '@mui/icons-material';
import {
    Box,
    Button,
    Container,
    Typography
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { useState } from 'react';
import ConfirmationModal from '../components/ConfirmationModal';
import DeleteCollectionModal from '../components/DeleteCollectionModal';
import CollectionsTable from '../components/ManagePage/CollectionsTable';
import VideosTable from '../components/ManagePage/VideosTable';

import { useCollection } from '../contexts/CollectionContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useVisitorMode } from '../contexts/VisitorModeContext';
import { useVideo } from '../contexts/VideoContext';
import { Collection, Video } from '../types';
import { formatSize } from '../utils/formatUtils';

const API_URL = import.meta.env.VITE_API_URL;

const ManagePage: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState<string>('');
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const { visitorMode } = useVisitorMode();
    const { videos, deleteVideo, refreshThumbnail, updateVideo } = useVideo();
    const { collections, deleteCollection } = useCollection();
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [refreshingId, setRefreshingId] = useState<string | null>(null);
    const [collectionToDelete, setCollectionToDelete] = useState<Collection | null>(null);
    const [isDeletingCollection, setIsDeletingCollection] = useState<boolean>(false);
    const [videoToDelete, setVideoToDelete] = useState<string | null>(null);
    const [showVideoDeleteModal, setShowVideoDeleteModal] = useState<boolean>(false);
    const [showScanConfirmModal, setShowScanConfirmModal] = useState(false);

    // Pagination state
    const [collectionPage, setCollectionPage] = useState(1);
    const [videoPage, setVideoPage] = useState(1);
    const ITEMS_PER_PAGE = 10;

    // Sorting state
    const [orderBy, setOrderBy] = useState<keyof Video | 'fileSize'>('addedAt');
    const [order, setOrder] = useState<'asc' | 'desc'>('desc');

    const handleRequestSort = (property: keyof Video | 'fileSize') => {
        const isAsc = orderBy === property && order === 'asc';
        setOrder(isAsc ? 'desc' : 'asc');
        setOrderBy(property);
    };

    // Scan files mutation
    const scanMutation = useMutation({
        mutationFn: async () => {
            const res = await axios.post(`${API_URL}/scan-files`);
            return res.data;
        },
        onSuccess: (data) => {
            const addedMsg = t('scanFilesSuccess').replace('{count}', data.addedCount.toString()) || `Scan complete. ${data.addedCount} files added.`;
            const deletedMsg = data.deletedCount > 0 ? (t('scanFilesDeleted').replace('{count}', data.deletedCount.toString()) || ` ${data.deletedCount} missing files removed.`) : '';
            showSnackbar(addedMsg + deletedMsg);
        },
        onError: (error: any) => {
            showSnackbar(`${t('scanFilesFailed') || 'Scan failed'}: ${error.response?.data?.details || error.message}`);
        }
    });

    const filteredVideos = videos.filter(video =>
        video.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        video.author.toLowerCase().includes(searchTerm.toLowerCase())
    ).sort((a, b) => {
        let aValue: any = a[orderBy as keyof Video];
        let bValue: any = b[orderBy as keyof Video];

        if (orderBy === 'fileSize') {
            aValue = a.fileSize ? parseInt(a.fileSize, 10) : 0;
            bValue = b.fileSize ? parseInt(b.fileSize, 10) : 0;
        }

        if (bValue < aValue) {
            return order === 'asc' ? 1 : -1;
        }
        if (bValue > aValue) {
            return order === 'asc' ? -1 : 1;
        }
        return 0;
    });

    const totalSize = filteredVideos.reduce((acc, video) => {
        const size = video.fileSize ? parseInt(video.fileSize, 10) : 0;
        return acc + (isNaN(size) ? 0 : size);
    }, 0);

    const getCollectionSize = (collectionVideoIds: string[]) => {
        const totalBytes = collectionVideoIds.reduce((acc, videoId) => {
            const video = videos.find(v => v.id === videoId);
            if (video && video.fileSize) {
                const size = parseInt(video.fileSize, 10);
                return acc + (isNaN(size) ? 0 : size);
            }
            return acc;
        }, 0);
        return formatSize(totalBytes);
    };

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
        await deleteVideo(videoToDelete);
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
        await deleteCollection(collectionToDelete.id, false);
        setIsDeletingCollection(false);
        setCollectionToDelete(null);
    };

    const handleCollectionDeleteAll = async () => {
        if (!collectionToDelete) return;
        setIsDeletingCollection(true);
        await deleteCollection(collectionToDelete.id, true);
        setIsDeletingCollection(false);
        setCollectionToDelete(null);
    };

    const handleRefreshThumbnail = async (id: string) => {
        setRefreshingId(id);
        await refreshThumbnail(id);
        setRefreshingId(null);
    };

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    {t('manageContent')}
                </Typography>
                {!visitorMode && (
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Button
                            variant="outlined"
                            startIcon={<FindInPage />}
                            onClick={() => setShowScanConfirmModal(true)}
                            disabled={scanMutation.isPending}
                        >
                            {scanMutation.isPending ? (t('scanning') || 'Scanning...') : (t('scanFiles') || 'Scan Files')}
                        </Button>
                    </Box>
                )}
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

            <ConfirmationModal
                isOpen={showScanConfirmModal}
                onClose={() => setShowScanConfirmModal(false)}
                onConfirm={() => {
                    setShowScanConfirmModal(false);
                    scanMutation.mutate();
                }}
                title={t('scanFiles') || 'Scan Files'}
                message={t('scanFilesConfirmMessage') || 'The system will scan the root folder of the video path. New files will be added, and missing video files will be removed from the system.'}
                confirmText={t('continue') || 'Continue'}
                cancelText={t('cancel') || 'Cancel'}
            />

            <CollectionsTable
                displayedCollections={displayedCollections}
                totalCollectionsCount={collections.length}
                onDelete={confirmDeleteCollection}
                page={collectionPage}
                totalPages={totalCollectionPages}
                onPageChange={handleCollectionPageChange}
                getCollectionSize={getCollectionSize}
            />

            <VideosTable
                displayedVideos={displayedVideos}
                totalVideosCount={filteredVideos.length}
                totalSize={totalSize}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                orderBy={orderBy}
                order={order}
                onSort={handleRequestSort}
                page={videoPage}
                totalPages={totalVideoPages}
                onPageChange={handleVideoPageChange}
                onDeleteClick={handleDelete}
                deletingId={deletingId}
                onRefreshThumbnail={handleRefreshThumbnail}
                refreshingId={refreshingId}
                onUpdateVideo={updateVideo}
            />
        </Container>
    );
};

export default ManagePage;
