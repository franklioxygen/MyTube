import { Folder } from '@mui/icons-material';
import {
    Box,
    Card,
    CardActionArea,
    CardContent,
    CardMedia,
    Chip,
    Typography,
    useTheme
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useCloudStorageUrl } from '../hooks/useCloudStorageUrl';
import { Collection, Video } from '../types';

interface CollectionCardProps {
    collection: Collection;
    videos: Video[];
}

const CollectionCard: React.FC<CollectionCardProps> = ({ collection, videos }) => {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const theme = useTheme();

    // Get the first 4 videos in the collection
    const collectionVideos = collection.videos
        .map(id => videos.find(v => v.id === id))
        .filter((v): v is Video => v !== undefined)
        .slice(0, 4);

    const handleClick = () => {
        navigate(`/collection/${collection.id}`);
    };

    return (
        <Card
            sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                transition: 'transform 0.2s, box-shadow 0.2s, background-color 0.3s, color 0.3s',
                '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: theme.shadows[8],
                }
            }}
        >
            <CardActionArea onClick={handleClick} sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
                <Box sx={{ position: 'relative', paddingTop: '56.25%' /* 16:9 aspect ratio */, bgcolor: 'action.hover' }}>
                    {/* 2x2 Grid for Thumbnails */}
                    <Box
                        sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            flexWrap: 'wrap'
                        }}
                    >
                        {collectionVideos.length > 0 ? (
                            collectionVideos.map((video, index) => (
                                <CollectionThumbnail key={video.id} video={video} index={index} />
                            ))
                        ) : (
                            <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Folder sx={{ fontSize: 60, color: 'text.disabled' }} />
                            </Box>
                        )}
                    </Box>

                    <Chip
                        icon={<Folder />}
                        label={collection.videos.length}
                        color="secondary"
                        size="small"
                        sx={{ position: 'absolute', bottom: 8, right: 8 }}
                    />
                </Box>

                <CardContent sx={{ flexGrow: 1, p: 2 }}>
                    <Typography gutterBottom variant="subtitle1" component="div" sx={{ fontWeight: 600, lineHeight: 1.2, mb: 1 }}>
                        {collection.name} {t('collection')}
                    </Typography>

                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 'auto' }}>
                        <Typography variant="caption" color="text.secondary">
                            {new Date(collection.createdAt).toLocaleDateString()}
                        </Typography>
                    </Box>
                </CardContent>
            </CardActionArea>
        </Card>
    );
};

// Component for individual thumbnail with cloud storage support
const CollectionThumbnail: React.FC<{ video: Video; index: number }> = ({ video, index }) => {
    // Only load thumbnail from cloud if the video itself is in cloud storage
    const isVideoInCloud = video.videoPath?.startsWith('cloud:') ?? false;
    const thumbnailPathForCloud = isVideoInCloud ? video.thumbnailPath : null;
    const thumbnailUrl = useCloudStorageUrl(thumbnailPathForCloud, 'thumbnail');
    const localThumbnailUrl = !isVideoInCloud && video.thumbnailPath
        ? `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5551'}${video.thumbnailPath}`
        : undefined;
    const src = thumbnailUrl || localThumbnailUrl || video.thumbnailUrl || 'https://via.placeholder.com/240x180?text=No+Thumbnail';

    return (
        <Box
            sx={{
                width: '50%',
                height: '50%',
                position: 'relative',
                borderRight: index % 2 === 0 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                borderBottom: index < 2 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                overflow: 'hidden'
            }}
        >
            <CardMedia
                component="img"
                image={src}
                alt={video.title}
                loading="lazy"
                sx={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                }}
                onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.onerror = null;
                    target.src = 'https://via.placeholder.com/240x180?text=No+Thumbnail';
                }}
            />
        </Box>
    );
};



export default CollectionCard;
