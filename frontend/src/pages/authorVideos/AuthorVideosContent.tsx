import { Alert, Grid } from '@mui/material';

import VideoCard from '../../components/VideoCard';
import { Video } from '../../types';

interface AuthorVideosContentProps {
    authorVideosLength: number;
    sortedVideos: Video[];
    noVideosMessage: string;
    noFilteredVideosMessage: string;
    showTagsOnThumbnail: boolean;
    onDeleteVideo: (id: string, options?: { showSnackbar?: boolean }) => Promise<{ success: boolean; error?: string }>;
}

const AuthorVideosContent: React.FC<AuthorVideosContentProps> = ({
    authorVideosLength,
    sortedVideos,
    noVideosMessage,
    noFilteredVideosMessage,
    showTagsOnThumbnail,
    onDeleteVideo
}) => {
    if (authorVideosLength === 0) {
        return <Alert severity="info" variant="outlined">{noVideosMessage}</Alert>;
    }

    if (sortedVideos.length === 0) {
        return (
            <Alert severity="info" variant="outlined">
                {noFilteredVideosMessage}
            </Alert>
        );
    }

    return (
        <Grid container spacing={3}>
            {sortedVideos.map((video) => (
                <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={video.id}>
                    <VideoCard
                        video={video}
                        onDeleteVideo={onDeleteVideo}
                        showDeleteButton={true}
                        showTagsOnThumbnail={showTagsOnThumbnail}
                    />
                </Grid>
            ))}
        </Grid>
    );
};

export default AuthorVideosContent;
