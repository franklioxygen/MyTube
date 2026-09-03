import {
    FindInPage
} from '@mui/icons-material';
import {
    Box,
    Button,
    Container,
    Tab,
    Tabs,
    Typography
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import ConfirmationModal from '../components/ConfirmationModal';
import DeleteCollectionModal from '../components/DeleteCollectionModal';
import CollectionsTable from '../components/ManagePage/CollectionsTable';
import VideosTable from '../components/ManagePage/VideosTable';
import { api, getApiErrorMessage } from '../utils/apiClient';

import { useAuth } from '../contexts/AuthContext';
import { useCollection } from '../contexts/CollectionContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { useVideo } from '../contexts/VideoContext';
import { Collection, Video } from '../types';
import { formatSize } from '../utils/formatUtils';
import { runMutationAsync } from '../utils/mutationUtils';
import { useScanStatus } from '../hooks/useScanStatus';

const ManagePage: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [tabValue, setTabValue] = useState(0);
    const { t } = useLanguage();
    const { showSnackbar } = useSnackbar();
    const { userRole } = useAuth();
    const isVisitor = userRole === 'visitor';
    const { videos, deleteVideo, refreshThumbnail, redownloadThumbnail, uploadThumbnail, updateVideo, fetchVideos } = useVideo();
    const { collections, deleteCollection, cleanupEmptyCollections, updateCollection } = useCollection();
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [refreshingId, setRefreshingId] = useState<string | null>(null);
    const [redownloadingThumbnailIds, setRedownloadingThumbnailIds] = useState<Record<string, boolean>>({});
    const [thumbnailCacheBustById, setThumbnailCacheBustById] = useState<Record<string, number | undefined>>({});
    const [collectionToDelete, setCollectionToDelete] = useState<Collection | null>(null);
    const [isDeletingCollection, setIsDeletingCollection] = useState<boolean>(false);
    const [videoToDelete, setVideoToDelete] = useState<string | null>(null);
    const [showVideoDeleteModal, setShowVideoDeleteModal] = useState<boolean>(false);
    const [showScanConfirmModal, setShowScanConfirmModal] = useState(false);
    const [showCleanupCollectionsModal, setShowCleanupCollectionsModal] = useState(false);
    const [isCleaningUpCollections, setIsCleaningUpCollections] = useState<boolean>(false);

    // Pagination state
    const [collectionPage, setCollectionPage] = useState(1);
    const [videoPage, setVideoPage] = useState(1);
    const ITEMS_PER_PAGE = 10;

    // Sorting state for videos
    const [orderBy, setOrderBy] = useState<keyof Video | 'fileSize'>('addedAt');
    const [order, setOrder] = useState<'asc' | 'desc'>('desc');

    const handleRequestSort = (property: keyof Video | 'fileSize') => {
        const isAsc = orderBy === property && order === 'asc';
        setOrder(isAsc ? 'desc' : 'asc');
        setOrderBy(property);
    };

    // Sorting state for collections
    type CollectionSortBy = 'name' | 'videoCount' | 'size' | 'createdAt';
    const [collectionOrderBy, setCollectionOrderBy] = useState<CollectionSortBy>('createdAt');
    const [collectionOrder, setCollectionOrder] = useState<'asc' | 'desc'>('desc');

    const handleCollectionRequestSort = (property: CollectionSortBy) => {
        const isAsc = collectionOrderBy === property && collectionOrder === 'asc';
        setCollectionOrder(isAsc ? 'desc' : 'asc');
        setCollectionOrderBy(property);
    };

    // Server-side scan state: a scan keeps running when this page unmounts, so
    // the button state has to come from the server rather than the mutation.
    const { data: scanStatus } = useScanStatus(!isVisitor);
    const isFileScanRunning = scanStatus?.scanType === 'files';
    const isOtherScanRunning = !!scanStatus?.scanning && !isFileScanRunning;

    // Scan files mutation
    const scanMutation = useMutation({
        mutationFn: async () => {
            const res = await api.post('/scan-files', undefined, { timeout: 0 });
            return res.data;
        },
        onSuccess: (data) => {
            const addedMsg = t('scanFilesSuccess').replace('{count}', data.addedCount.toString()) || `Scan complete. ${data.addedCount} files added.`;
            const deletedMsg = data.deletedCount > 0 ? (t('scanFilesDeleted').replace('{count}', data.deletedCount.toString()) || ` ${data.deletedCount} missing files removed.`) : '';
            showSnackbar(addedMsg + deletedMsg);
        },
        onError: async (error: any) => {
            const detail = await getApiErrorMessage(error, t) || error.message;
            showSnackbar(`${t('scanFilesFailed') || 'Scan failed'}: ${detail}`);
        }
    });

    const refreshFileSizesMutation = useMutation({
        mutationFn: async () => {
            const res = await api.post('/videos/refresh-file-sizes');
            return res.data;
        },
        onSuccess: async (data) => {
            await fetchVideos();

            const updatedCount = data?.updatedCount ?? 0;
            const skippedCount = data?.skippedCount ?? 0;
            const failedCount = data?.failedCount ?? 0;

            const successMsg = t('refreshFileSizesSuccess').replace('{count}', updatedCount.toString());
            let message = successMsg;

            if (failedCount > 0) {
                message += t('refreshFileSizesFailed').replace('{count}', failedCount.toString());
            } else if (skippedCount > 0) {
                message += t('refreshFileSizesSkipped').replace('{count}', skippedCount.toString());
            }

            showSnackbar(message);
        },
        onError: (error: any) => {
            const errorDetails = error.response?.data?.details || error.message;
            showSnackbar(t('refreshFileSizesError').replace('{error}', errorDetails));
        }
    });

    // Precompute a videoId -> size-in-bytes map once so per-collection size
    // lookups are O(members) instead of O(videos × members). Rebuilt only when
    // the videos list changes.
    const videoSizeById = useMemo(() => {
        const map = new Map<string, number>();
        for (const video of videos) {
            const size = video.fileSize ? parseInt(video.fileSize, 10) : 0;
            map.set(video.id, isNaN(size) ? 0 : size);
        }
        return map;
    }, [videos]);

    const filteredVideos = useMemo(() => videos.filter(video =>
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
    }), [videos, searchTerm, orderBy, order]);

    const totalSize = useMemo(() => filteredVideos.reduce((acc, video) => {
        const size = video.fileSize ? parseInt(video.fileSize, 10) : 0;
        return acc + (isNaN(size) ? 0 : size);
    }, 0), [filteredVideos]);

    // Helper to sum the size (in bytes) of a collection's video ids using the
    // precomputed map, so this is O(members) rather than O(videos × members).
    const getCollectionSizeBytes = useMemo(() => {
        return (collectionVideoIds: string[]) => {
            let total = 0;
            for (const videoId of collectionVideoIds) {
                total += videoSizeById.get(videoId) ?? 0;
            }
            return total;
        };
    }, [videoSizeById]);

    const getCollectionSize = useMemo(() => {
        return (collectionVideoIds: string[]) => formatSize(getCollectionSizeBytes(collectionVideoIds));
    }, [getCollectionSizeBytes]);

    // Sort collections
    const sortedCollections = useMemo(() => [...collections].sort((a, b) => {
        let aValue: any;
        let bValue: any;

        if (collectionOrderBy === 'name') {
            aValue = a.name.toLowerCase();
            bValue = b.name.toLowerCase();
        } else if (collectionOrderBy === 'videoCount') {
            aValue = a.videos.length;
            bValue = b.videos.length;
        } else if (collectionOrderBy === 'size') {
            aValue = getCollectionSizeBytes(a.videos);
            bValue = getCollectionSizeBytes(b.videos);
        } else if (collectionOrderBy === 'createdAt') {
            aValue = new Date(a.createdAt).getTime();
            bValue = new Date(b.createdAt).getTime();
        } else {
            return 0;
        }

        if (bValue < aValue) {
            return collectionOrder === 'asc' ? 1 : -1;
        }
        if (bValue > aValue) {
            return collectionOrder === 'asc' ? -1 : 1;
        }
        return 0;
    }), [collections, collectionOrderBy, collectionOrder, getCollectionSizeBytes]);

    // Pagination logic
    const totalCollectionPages = Math.ceil(sortedCollections.length / ITEMS_PER_PAGE);
    // Deleting collections - one row, or every empty one at once - can leave the
    // held page past the end of the list, which renders as an empty table with
    // the pager gone and no way back short of a reload. Read the page through
    // the range the list actually has rather than trusting what was stored.
    const currentCollectionPage = Math.min(
        collectionPage,
        Math.max(1, totalCollectionPages)
    );
    const displayedCollections = sortedCollections.slice(
        (currentCollectionPage - 1) * ITEMS_PER_PAGE,
        currentCollectionPage * ITEMS_PER_PAGE
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

    const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
    };

    const confirmDeleteVideo = async () => {
        if (!videoToDelete) return;

        setDeletingId(videoToDelete);
        try {
            await deleteVideo(videoToDelete);
            setVideoToDelete(null);
            setShowVideoDeleteModal(false);
        } finally {
            setDeletingId(null);
        }
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
        try {
            await deleteCollection(collectionToDelete.id, false);
            setCollectionToDelete(null);
        } finally {
            setIsDeletingCollection(false);
        }
    };

    const handleCollectionDeleteAll = async () => {
        if (!collectionToDelete) return;
        setIsDeletingCollection(true);
        try {
            await deleteCollection(collectionToDelete.id, true);
            setCollectionToDelete(null);
        } finally {
            setIsDeletingCollection(false);
        }
    };

    // Counted from the collections already loaded for the table, so the modal can
    // say how many are going before the request is made. The server decides what
    // is actually empty when it runs.
    const emptyCollectionsCount = useMemo(
        () => collections.filter(collection => collection.videos.length === 0).length,
        [collections]
    );

    const handleCleanupEmptyCollections = async () => {
        setIsCleaningUpCollections(true);
        try {
            const result = await cleanupEmptyCollections();
            // Thrown so the modal stays open for a retry; the error itself is
            // already on screen as a snackbar.
            if (!result.success) throw new Error(result.error);
        } finally {
            setIsCleaningUpCollections(false);
        }
    };

    const handleRefreshThumbnail = async (id: string) => {
        setRefreshingId(id);
        try {
            const result = await refreshThumbnail(id);
            if (result.success) {
                setThumbnailCacheBustById(prev => ({ ...prev, [id]: Date.now() }));
            }
            await fetchVideos();
        } finally {
            setRefreshingId(null);
        }
    };

    const handleRedownloadThumbnail = async (id: string) => {
        setRedownloadingThumbnailIds(prev => ({ ...prev, [id]: true }));
        try {
            const result = await redownloadThumbnail(id);
            if (result.success) {
                setThumbnailCacheBustById(prev => ({ ...prev, [id]: Date.now() }));
            }
            await fetchVideos();
        } finally {
            setRedownloadingThumbnailIds(prev => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
        }
    };

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Typography variant="h4" component="h1" fontWeight="bold">
                    {t('manageContent')}
                </Typography>
                {!isVisitor && (
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Button
                            variant="outlined"
                            startIcon={<FindInPage />}
                            onClick={() => setShowScanConfirmModal(true)}
                            loading={scanMutation.isPending || isFileScanRunning}
                            disabled={isOtherScanRunning}
                            loadingPosition="start"
                        >
                            {t('scanFiles') || 'Scan Files'}
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
                isOpen={showCleanupCollectionsModal}
                onClose={() => setShowCleanupCollectionsModal(false)}
                onConfirm={handleCleanupEmptyCollections}
                title={t('cleanupEmptyCollectionsTitle')}
                message={t('cleanupEmptyCollectionsMessage').replace(
                    '{count}',
                    emptyCollectionsCount.toString()
                )}
                confirmText={t('continue')}
                cancelText={t('cancel')}
                isDanger={true}
            />

            <ConfirmationModal
                isOpen={showScanConfirmModal}
                onClose={() => setShowScanConfirmModal(false)}
                onConfirm={async () => {
                    await runMutationAsync(scanMutation, undefined);
                }}
                title={t('scanFiles') || 'Scan Files'}
                message={t('scanFilesConfirmMessage') || 'The system will scan the root folder of the video path. New files will be added, and missing video files will be removed from the system.'}
                confirmText={t('continue') || 'Continue'}
                cancelText={t('cancel') || 'Cancel'}
            />

            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
                <Tabs
                    value={tabValue}
                    onChange={handleTabChange}
                    aria-label="manage content tabs"
                    variant="scrollable"
                    scrollButtons="auto"
                    allowScrollButtonsMobile
                >
                    <Tab
                        label={`${t('collections')} (${collections.length})`}
                        id="manage-tab-0"
                        aria-controls="manage-tabpanel-0"
                    />
                    <Tab
                        label={`${t('videos')} (${filteredVideos.length})`}
                        id="manage-tab-1"
                        aria-controls="manage-tabpanel-1"
                    />
                </Tabs>
            </Box>

            <div
                role="tabpanel"
                hidden={tabValue !== 0}
                id="manage-tabpanel-0"
                aria-labelledby="manage-tab-0"
            >
                {tabValue === 0 && (
                    <CollectionsTable
                        displayedCollections={displayedCollections}
                        totalCollectionsCount={collections.length}
                        onDelete={confirmDeleteCollection}
                        onUpdate={async (id, name) => {
                            const result = await updateCollection(id, name);
                            if (!result.success) throw new Error(result.error);
                        }}
                        page={currentCollectionPage}
                        totalPages={totalCollectionPages}
                        onPageChange={handleCollectionPageChange}
                        getCollectionSize={getCollectionSize}
                        orderBy={collectionOrderBy}
                        order={collectionOrder}
                        onSort={handleCollectionRequestSort}
                        emptyCollectionsCount={emptyCollectionsCount}
                        onCleanupEmpty={() => setShowCleanupCollectionsModal(true)}
                        isCleaningUpEmpty={isCleaningUpCollections}
                    />
                )}
            </div>

            <div
                role="tabpanel"
                hidden={tabValue !== 1}
                id="manage-tabpanel-1"
                aria-labelledby="manage-tab-1"
            >
                {tabValue === 1 && (
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
                        onRedownloadThumbnail={handleRedownloadThumbnail}
                        onUploadThumbnail={uploadThumbnail}
                        refreshingId={refreshingId}
                        redownloadingThumbnailIds={redownloadingThumbnailIds}
                        thumbnailCacheBustById={thumbnailCacheBustById}
                        onRefreshFileSizes={() => refreshFileSizesMutation.mutate()}
                        isRefreshingFileSizes={refreshFileSizesMutation.isPending}
                        onUpdateVideo={updateVideo}
                    />
                )}
            </div>
        </Container>
    );
};

export default ManagePage;
