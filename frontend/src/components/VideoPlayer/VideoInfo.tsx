import { Alert, Box, Divider, Stack } from '@mui/material';
import React from 'react';
import { useVideoResolution } from '../../hooks/useVideoResolution';
import { Collection, Video } from '../../types';
import EditableTitle from './VideoInfo/EditableTitle';
import VideoActionButtons from './VideoInfo/VideoActionButtons';
import VideoAuthorInfo from './VideoInfo/VideoAuthorInfo';
import VideoDescription from './VideoInfo/VideoDescription';
import VideoMetadata from './VideoInfo/VideoMetadata';
import VideoRating from './VideoInfo/VideoRating';
import VideoTags from './VideoInfo/VideoTags';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

interface VideoInfoProps {
    video: Video;
    onTitleSave: (newTitle: string) => Promise<void>;
    onRatingChange: (newRating: number) => Promise<void>;
    onAuthorClick: () => void;
    onAddToCollection: () => void;
    onDelete: () => void;
    isDeleting: boolean;
    deleteError: string | null;
    videoCollections: Collection[];
    onCollectionClick: (id: string) => void;
    availableTags: string[];
    onTagsUpdate: (tags: string[]) => Promise<void>;
}

const VideoInfo: React.FC<VideoInfoProps> = ({
    video,
    onTitleSave,
    onRatingChange,
    onAuthorClick,
    onAddToCollection,
    onDelete,
    isDeleting,
    deleteError,
    videoCollections,
    onCollectionClick,
    availableTags,
    onTagsUpdate
}) => {
    const { videoRef, videoResolution } = useVideoResolution(video);

    return (
        <Box sx={{ mt: 2 }}>
            {/* Hidden video element to get resolution */}
            {(video.videoPath || video.sourceUrl) && (
                <video
                    ref={videoRef}
                    src={video.videoPath ? `${BACKEND_URL}${video.videoPath}` : video.sourceUrl}
                    style={{ 
                        position: 'absolute',
                        width: '1px',
                        height: '1px',
                        opacity: 0,
                        pointerEvents: 'none',
                        zIndex: -1
                    }}
                    preload="metadata"
                    muted
                    crossOrigin="anonymous"
                />
            )}

            <EditableTitle title={video.title} onSave={onTitleSave} />

            <VideoRating
                rating={video.rating}
                viewCount={video.viewCount}
                onRatingChange={onRatingChange}
            />

            <VideoTags
                tags={video.tags}
                availableTags={availableTags}
                onTagsUpdate={onTagsUpdate}
            />

            <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                spacing={2}
                sx={{ mb: 2 }}
            >
                <VideoAuthorInfo
                    author={video.author}
                    date={video.date}
                    onAuthorClick={onAuthorClick}
                />

                <VideoActionButtons
                    video={video}
                    onAddToCollection={onAddToCollection}
                    onDelete={onDelete}
                    isDeleting={isDeleting}
                />
            </Stack>

            {deleteError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {deleteError}
                </Alert>
            )}

            <VideoDescription description={video.description} />

            <Divider sx={{ my: 2 }} />

            <VideoMetadata
                video={video}
                videoCollections={videoCollections}
                onCollectionClick={onCollectionClick}
                videoResolution={videoResolution}
            />
        </Box>
    );
};

export default VideoInfo;
