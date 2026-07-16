import { CreateNewFolder, Delete, LocalOffer, ViewSidebar } from '@mui/icons-material';
import { Avatar, Box, Button, IconButton, Tooltip, Typography } from '@mui/material';

import FavoriteToggle from '../../components/FavoriteToggle';
import SortControl from '../../components/SortControl';
import { authorAvatarFallbackSx } from '../../utils/authorAvatarStyles';

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
    isFavorite: boolean;
    onToggleFavorite: () => void;
    favoriteLabel: string;
    unfavoriteLabel: string;
    favoriteDisabled: boolean;
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
    onOpenDeleteModal,
    isFavorite,
    onToggleFavorite,
    favoriteLabel,
    unfavoriteLabel,
    favoriteDisabled,
}) => {
    const initial = authorDisplayName ? authorDisplayName.charAt(0).toUpperCase() : 'A';
    const displayName = authorDisplayName || unknownAuthorLabel;

    return (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', md: 'center' }, flex: '1 1 auto', minWidth: 0 }}>
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
                    sx={[authorAvatarFallbackSx, {
                        display: { xs: 'none', md: 'flex' },
                        width: 56,
                        height: 56,
                        mr: 2,
                        fontSize: '1.5rem',
                        flexShrink: 0,
                    }]}
                >
                    {initial}
                </Avatar>

                <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: { xs: 0, md: 2 } }}>
                        <Typography
                            variant="h4"
                            component="h1"
                            fontWeight="bold"
                            sx={{
                                fontSize: { xs: '1.5rem', md: '2.125rem' },
                                lineHeight: { xs: 1.25, md: 1.235 },
                                overflowWrap: 'anywhere',
                                minWidth: 0,
                            }}
                        >
                            <Avatar
                                component="span"
                                src={avatarUrl || undefined}
                                aria-hidden
                                sx={[authorAvatarFallbackSx, {
                                    display: { xs: 'inline-flex', md: 'none' },
                                    width: 40,
                                    height: 40,
                                    mr: 1,
                                    verticalAlign: 'middle',
                                    fontSize: '1.1rem',
                                }]}
                            >
                                {initial}
                            </Avatar>
                            {displayName}
                        </Typography>
                    </Box>

                    <Typography variant="subtitle1" color="text.secondary">
                        {videoCountLabel}
                    </Typography>
                </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
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
                    <FavoriteToggle
                        active={isFavorite}
                        onToggle={onToggleFavorite}
                        label={favoriteLabel}
                        activeLabel={unfavoriteLabel}
                        disabled={favoriteDisabled}
                    />
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
        </Box>
    );
};

export default AuthorVideosHeader;
