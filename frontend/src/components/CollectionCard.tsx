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
import { Collection, Video } from '../types';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

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

    const getThumbnailSrc = (video: Video) => {
        return video.thumbnailPath
            ? `${BACKEND_URL}${video.thumbnailPath}`
            : video.thumbnailUrl;
    };

    return (
        <Card
            sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                transition: 'transform 0.2s, box-shadow 0.2s',
                '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: theme.shadows[8],
                },
                border: `1px solid ${theme.palette.secondary.main}`
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
                                <Box
                                    key={video.id}
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
                                        image={getThumbnailSrc(video) || 'https://via.placeholder.com/240x180?text=No+Thumbnail'}
                                        alt={video.title}
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
                            ))
                        ) : (
                            <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Folder sx={{ fontSize: 60, color: 'text.disabled' }} />
                            </Box>
                        )}
                    </Box>

                    <Chip
                        icon={<Folder />}
                        label={`${collection.videos.length} videos`}
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

export default CollectionCard;
