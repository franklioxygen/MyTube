import { Box, CircularProgress, Container } from '@mui/material';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import ConfirmationModal from '../../components/ConfirmationModal';
import TagsModal from '../../components/TagsModal';
import { TagsSidebar } from '../../components/TagsSidebar';
import { useCollection } from '../../contexts/CollectionContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSnackbar } from '../../contexts/SnackbarContext';
import { useVideo } from '../../contexts/VideoContext';
import { useCloudStorageUrl } from '../../hooks/useCloudStorageUrl';
import { useSettings } from '../../hooks/useSettings';
import { useVideoSort } from '../../hooks/useVideoSort';
import AuthorVideosContent from './AuthorVideosContent';
import AuthorVideosHeader from './AuthorVideosHeader';
import { useAuthorTagFilter } from './useAuthorTagFilter';
import { useAuthorVideoActions } from './useAuthorVideoActions';
import { getAuthorVideos, getVideoCountLabel } from './utils';

const AuthorVideosPage: React.FC = () => {
    const { t } = useLanguage();
    const { authorName } = useParams<{ authorName: string }>();
    const { videos, loading, deleteVideo, availableTags: globalAvailableTags, updateVideo } = useVideo();
    const { collections, createCollection, addToCollection } = useCollection();
    const { showSnackbar } = useSnackbar();
    const navigate = useNavigate();
    const { data: settings } = useSettings();

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const authorVideos = useMemo(
        () => getAuthorVideos(videos, authorName),
        [videos, authorName]
    );
    const authorDisplayName = authorVideos[0]?.author ?? authorName ?? '';
    const showTagsOnThumbnail = settings?.showTagsOnThumbnail ?? true;

    const {
        availableTags,
        selectedTags,
        commonTags,
        videosFilteredByTags,
        handleTagToggle
    } = useAuthorTagFilter(authorVideos);

    const {
        sortedVideos,
        sortOption,
        sortAnchorEl,
        handleSortClick,
        handleSortClose
    } = useVideoSort({
        videos: videosFilteredByTags,
        defaultSort: 'dateDesc'
    });

    const authorAvatarPath = useMemo(
        () => authorVideos.find((video) => video.authorAvatarPath)?.authorAvatarPath,
        [authorVideos]
    );
    const avatarUrl = useCloudStorageUrl(authorAvatarPath, 'thumbnail');

    const actions = useAuthorVideoActions({
        authorDisplayName,
        authorVideos,
        commonTags,
        collections,
        deleteVideo,
        updateVideo,
        createCollection,
        addToCollection,
        showSnackbar,
        t,
        navigateHome: () => navigate('/')
    });

    const videoCountLabel = useMemo(
        () => getVideoCountLabel(authorVideos.length, sortedVideos.length, selectedTags.length, t('videos')),
        [authorVideos.length, selectedTags.length, sortedVideos.length, t]
    );

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box sx={{ display: 'flex', alignItems: 'stretch' }}>
                <TagsSidebar
                    isSidebarOpen={isSidebarOpen}
                    availableTags={availableTags}
                    selectedTags={selectedTags}
                    onTagToggle={handleTagToggle}
                />

                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <AuthorVideosHeader
                        authorDisplayName={authorDisplayName}
                        unknownAuthorLabel={t('unknownAuthor')}
                        avatarUrl={avatarUrl}
                        videoCountLabel={videoCountLabel}
                        hasVideos={authorVideos.length > 0}
                        isBusy={actions.isCreatingCollection || actions.isDeleting}
                        addTagsLabel={t('addTags')}
                        createCollectionTooltip={t('createCollectionFromAuthorTooltip')}
                        deleteAuthorLabel={t('deleteAuthor')}
                        sortOption={sortOption}
                        sortAnchorEl={sortAnchorEl}
                        onSortClick={handleSortClick}
                        onSortClose={handleSortClose}
                        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
                        onOpenTagsModal={actions.openTagsModal}
                        onOpenCreateCollectionModal={actions.openCreateCollectionModal}
                        onOpenDeleteModal={actions.openDeleteModal}
                    />

                    <AuthorVideosContent
                        authorVideosLength={authorVideos.length}
                        sortedVideos={sortedVideos}
                        noVideosMessage={t('noVideosForAuthor')}
                        noFilteredVideosMessage={t('noVideosFoundMatching')}
                        showTagsOnThumbnail={showTagsOnThumbnail}
                        onDeleteVideo={deleteVideo}
                    />
                </Box>
            </Box>

            <ConfirmationModal
                isOpen={actions.isDeleteModalOpen}
                onClose={actions.closeDeleteModal}
                onConfirm={actions.handleDeleteAuthor}
                title={t('deleteAuthor')}
                message={t('deleteAuthorConfirmation', { author: authorDisplayName || '' })}
                confirmText={actions.isDeleting ? t('deleting') : t('delete')}
                cancelText={t('cancel')}
                isDanger={true}
            />

            <ConfirmationModal
                isOpen={actions.isCreateCollectionModalOpen}
                onClose={actions.closeCreateCollectionModal}
                onConfirm={actions.handleCreateCollectionFromAuthor}
                title={actions.createCollectionModalTitle}
                message={actions.createCollectionMessage}
                confirmText={actions.isCreatingCollection ? t('creatingCollection') : t('create')}
                cancelText={t('cancel')}
                isDanger={false}
            />

            <TagsModal
                open={actions.isTagsModalOpen}
                onClose={actions.closeTagsModal}
                videoTags={commonTags}
                availableTags={globalAvailableTags ?? []}
                onSave={actions.handleSaveAuthorTags}
            />
        </Container>
    );
};

export default AuthorVideosPage;
