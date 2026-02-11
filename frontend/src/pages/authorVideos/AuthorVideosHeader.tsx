import { CreateNewFolder, Delete, LocalOffer, ViewSidebar } from '@mui/icons-material';
import { Avatar, Box, Button, IconButton, Tooltip, Typography } from '@mui/material';

import SortControl from '../../components/SortControl';

interface AuthorVideosHeaderProps {
    authorDisplayName: string;
    unknownAuthorLabel: string;
    avatarUrl: string | null;
    videoCountLabel: string;
    hasVideos: boolean;
    isBusy: boolean;
    addTagsLabel: string;
    createCollectionTooltip: string;
    deleteAuthorLabel: string;
    sortOption: string;
    sortAnchorEl: null | HTMLElement;
    onSortClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    onSortClose: (option?: string) => void;
    onToggleSidebar: () => void;
    onOpenTagsModal: () => void;
    onOpenCreateCollectionModal: () => void;
    onOpenDeleteModal: () => void;
}

const AuthorVideosHeader: React.FC<AuthorVideosHeaderProps> = ({
    authorDisplayName,
    unknownAuthorLabel,
    avatarUrl,
    videoCountLabel,
    hasVideos,
    isBusy,
    addTagsLabel,
    createCollectionTooltip,
    deleteAuthorLabel,
    sortOption,
    sortAnchorEl,
    onSortClick,
    onSortClose,
    onToggleSidebar,
    onOpenTagsModal,
    onOpenCreateCollectionModal,
    onOpenDeleteModal
}) => {
    const initial = authorDisplayName ? authorDisplayName.charAt(0).toUpperCase() : 'A';
    const displayName = authorDisplayName || unknownAuthorLabel;

    return (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Button
                    onClick={onToggleSidebar}
                    variant="outlined"
                    size="small"
                    sx={{
                        minWidth: 'auto',
                        p: 1,
                        display: { xs: 'none', md: 'inline-flex' },
                        color: 'text.secondary',
                        borderColor: 'text.secondary',
                        mr: 2,
                        height: 38
                    }}
                >
                    <ViewSidebar sx={{ transform: 'rotate(180deg)' }} />
                </Button>

                <Avatar
                    src={avatarUrl || undefined}
                    sx={{ width: 56, height: 56, bgcolor: 'primary.main', mr: 2, fontSize: '1.5rem' }}
                >
                    {initial}
                </Avatar>

                <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Typography variant="h4" component="h1" fontWeight="bold">
                            {displayName}
                        </Typography>
                        <Tooltip title={addTagsLabel}>
                            <IconButton
                                color="primary"
                                onClick={onOpenTagsModal}
                                disabled={isBusy}
                                aria-label="add tags to author"
                            >
                                <LocalOffer />
                            </IconButton>
                        </Tooltip>
                        {hasVideos && (
                            <>
                                <Tooltip title={createCollectionTooltip}>
                                    <IconButton
                                        color="primary"
                                        onClick={onOpenCreateCollectionModal}
                                        disabled={isBusy}
                                        aria-label="create collection from author"
                                    >
                                        <CreateNewFolder />
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title={deleteAuthorLabel}>
                                    <IconButton
                                        color="error"
                                        onClick={onOpenDeleteModal}
                                        disabled={isBusy}
                                        aria-label="delete author"
                                    >
                                        <Delete />
                                    </IconButton>
                                </Tooltip>
                            </>
                        )}
                    </Box>

                    <Typography variant="subtitle1" color="text.secondary">
                        {videoCountLabel}
                    </Typography>
                </Box>
            </Box>

            {hasVideos && (
                <SortControl
                    sortOption={sortOption}
                    sortAnchorEl={sortAnchorEl}
                    onSortClick={onSortClick}
                    onSortClose={onSortClose}
                    sx={{ height: 38 }}
                />
            )}
        </Box>
    );
};

export default AuthorVideosHeader;
