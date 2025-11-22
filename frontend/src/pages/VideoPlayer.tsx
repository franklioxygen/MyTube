import axios from 'axios';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Collection, Video } from '../types';

const API_URL = import.meta.env.VITE_API_URL;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

interface VideoPlayerProps {
    videos: Video[];
    onDeleteVideo: (id: string) => Promise<{ success: boolean; error?: string }>;
    collections: Collection[];
    onAddToCollection: (collectionId: string, videoId: string) => Promise<void>;
    onCreateCollection: (name: string, videoId: string) => Promise<void>;
    onRemoveFromCollection: (videoId: string) => Promise<any>;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
    videos,
    onDeleteVideo,
    collections,
    onAddToCollection,
    onCreateCollection,
    onRemoveFromCollection
}) => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [video, setVideo] = useState<Video | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState<boolean>(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [showCollectionModal, setShowCollectionModal] = useState<boolean>(false);
    const [newCollectionName, setNewCollectionName] = useState<string>('');
    const [selectedCollection, setSelectedCollection] = useState<string>('');
    const [videoCollections, setVideoCollections] = useState<Collection[]>([]);

    useEffect(() => {
        // Don't try to fetch the video if it's being deleted
        if (isDeleting) {
            return;
        }

        const fetchVideo = async () => {
            if (!id) return;

            // First check if the video is in the videos prop
            const foundVideo = videos.find(v => v.id === id);

            if (foundVideo) {
                setVideo(foundVideo);
                setLoading(false);
                return;
            }

            // If not found in props, try to fetch from API
            try {
                const response = await axios.get(`${API_URL}/videos/${id}`);
                setVideo(response.data);
                setError(null);
            } catch (err) {
                console.error('Error fetching video:', err);
                setError('Video not found or could not be loaded.');

                // Redirect to home after 3 seconds if video not found
                setTimeout(() => {
                    navigate('/');
                }, 3000);
            } finally {
                setLoading(false);
            }
        };

        fetchVideo();
    }, [id, videos, navigate, isDeleting]);

    // Find collections that contain this video
    useEffect(() => {
        if (collections && collections.length > 0 && id) {
            const belongsToCollections = collections.filter(collection =>
                collection.videos.includes(id)
            );
            setVideoCollections(belongsToCollections);
        } else {
            setVideoCollections([]);
        }
    }, [collections, id]);

    // Format the date (assuming format YYYYMMDD from youtube-dl)
    const formatDate = (dateString?: string) => {
        if (!dateString || dateString.length !== 8) {
            return 'Unknown date';
        }

        const year = dateString.substring(0, 4);
        const month = dateString.substring(4, 6);
        const day = dateString.substring(6, 8);

        return `${year}-${month}-${day}`;
    };

    // Handle navigation to author videos page
    const handleAuthorClick = () => {
        if (video) {
            navigate(`/author/${encodeURIComponent(video.author)}`);
        }
    };

    const handleCollectionClick = (collectionId: string) => {
        navigate(`/collection/${collectionId}`);
    };

    const handleDelete = async () => {
        if (!id) return;

        if (!window.confirm('Are you sure you want to delete this video?')) {
            return;
        }

        setIsDeleting(true);
        setDeleteError(null);

        try {
            const result = await onDeleteVideo(id);

            if (result.success) {
                // Navigate to home immediately after successful deletion
                navigate('/', { replace: true });
            } else {
                setDeleteError(result.error || 'Failed to delete video');
                setIsDeleting(false);
            }
        } catch (err) {
            setDeleteError('An unexpected error occurred while deleting the video.');
            console.error(err);
            setIsDeleting(false);
        }
    };

    const handleAddToCollection = () => {
        setShowCollectionModal(true);
    };

    const handleCloseModal = () => {
        setShowCollectionModal(false);
        setNewCollectionName('');
        setSelectedCollection('');
    };

    const handleCreateCollection = async () => {
        if (!newCollectionName.trim() || !id) {
            return;
        }

        try {
            await onCreateCollection(newCollectionName, id);
            handleCloseModal();
        } catch (error) {
            console.error('Error creating collection:', error);
        }
    };

    const handleAddToExistingCollection = async () => {
        if (!selectedCollection || !id) {
            return;
        }

        try {
            await onAddToCollection(selectedCollection, id);
            handleCloseModal();
        } catch (error) {
            console.error('Error adding to collection:', error);
        }
    };

    const handleRemoveFromCollection = async () => {
        if (!id) return;

        if (!window.confirm('Are you sure you want to remove this video from the collection?')) {
            return;
        }

        try {
            await onRemoveFromCollection(id);
            handleCloseModal();
        } catch (error) {
            console.error('Error removing from collection:', error);
        }
    };

    if (loading) {
        return <div className="loading">Loading video...</div>;
    }

    if (error || !video) {
        return <div className="error">{error || 'Video not found'}</div>;
    }

    // Get related videos (exclude current video)
    const relatedVideos = videos.filter(v => v.id !== id).slice(0, 10);

    return (
        <div className="video-player-page">
            {/* Main Content Column */}
            <div className="video-main-content">
                <div className="video-wrapper">
                    <video
                        className="video-player"
                        controls
                        autoPlay
                        src={`${BACKEND_URL}${video.videoPath || video.sourceUrl}`}
                    >
                        Your browser does not support the video tag.
                    </video>
                </div>

                <div className="video-info-section">
                    <h1 className="video-title-h1">{video.title}</h1>

                    <div className="video-actions-row">
                        <div className="video-primary-actions">
                            <div className="channel-row" style={{ marginBottom: 0 }}>
                                <div className="channel-avatar">
                                    {video.author ? video.author.charAt(0).toUpperCase() : 'A'}
                                </div>
                                <div className="channel-info">
                                    <div
                                        className="channel-name clickable"
                                        onClick={handleAuthorClick}
                                    >
                                        {video.author}
                                    </div>
                                    <div className="video-stats">
                                        {/* Placeholder for subscribers if we had that data */}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="video-primary-actions">
                            <button
                                className="action-btn btn-secondary"
                                onClick={handleAddToCollection}
                            >
                                <span>+ Add to Collection</span>
                            </button>
                            <button
                                className="action-btn btn-danger"
                                onClick={handleDelete}
                                disabled={isDeleting}
                            >
                                {isDeleting ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>

                    {deleteError && (
                        <div className="error-message" style={{ color: '#ff4d4d', marginTop: '10px' }}>
                            {deleteError}
                        </div>
                    )}
                </div>

                <div className="channel-desc-container">
                    <div className="video-stats" style={{ marginBottom: '8px', color: '#fff', fontWeight: 'bold' }}>
                        {/* Views would go here */}
                        {formatDate(video.date)}
                    </div>

                    <div className="description-text">
                        {/* We don't have a real description, so we'll show some metadata */}
                        <p>Source: {video.source === 'bilibili' ? 'Bilibili' : 'YouTube'}</p>
                        {video.sourceUrl && (
                            <p>
                                Original Link: <a href={video.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#3ea6ff' }}>{video.sourceUrl}</a>
                            </p>
                        )}
                    </div>

                    {videoCollections.length > 0 && (
                        <div className="collection-tags">
                            {videoCollections.map(c => (
                                <span
                                    key={c.id}
                                    className="collection-pill"
                                    onClick={() => handleCollectionClick(c.id)}
                                >
                                    {c.name}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>


            {/* Sidebar Column - Up Next */}
            <div className="video-sidebar">
                <h3 className="sidebar-title">Up Next</h3>
                <div className="related-videos-list">
                    {relatedVideos.map(relatedVideo => (
                        <div
                            key={relatedVideo.id}
                            className="related-video-card"
                            onClick={() => navigate(`/video/${relatedVideo.id}`)}
                        >
                            <div className="related-video-thumbnail">
                                <img
                                    src={`${BACKEND_URL}${relatedVideo.thumbnailPath}`}
                                    alt={relatedVideo.title}
                                    onError={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        target.onerror = null;
                                        target.src = 'https://via.placeholder.com/168x94?text=No+Thumbnail';
                                    }}
                                />
                                <span className="duration-badge">{relatedVideo.duration || '00:00'}</span>
                            </div>
                            <div className="related-video-info">
                                <div className="related-video-title">{relatedVideo.title}</div>
                                <div className="related-video-author">{relatedVideo.author}</div>
                                <div className="related-video-meta">
                                    {formatDate(relatedVideo.date)}
                                </div>
                            </div>
                        </div>
                    ))}
                    {relatedVideos.length === 0 && (
                        <div className="no-videos">No other videos available</div>
                    )}
                </div>
            </div>

            {/* Collection Modal */}
            {
                showCollectionModal && (
                    <div className="modal-overlay" onClick={handleCloseModal}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h2>Add to Collection</h2>
                                <button className="close-btn" onClick={handleCloseModal}>×</button>
                            </div>

                            <div className="modal-body">
                                {videoCollections.length > 0 && (
                                    <div className="current-collection" style={{
                                        marginBottom: '1.5rem',
                                        padding: '1rem',
                                        background: 'linear-gradient(135deg, rgba(62, 166, 255, 0.1) 0%, rgba(62, 166, 255, 0.05) 100%)',
                                        borderRadius: '8px',
                                        border: '1px solid rgba(62, 166, 255, 0.3)'
                                    }}>
                                        <p style={{ margin: '0 0 0.5rem 0', color: 'var(--text-color)', fontWeight: '500' }}>
                                            📁 Currently in: <strong>{videoCollections[0].name}</strong>
                                        </p>
                                        <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                            Adding to a different collection will remove it from the current one.
                                        </p>
                                        <button
                                            className="modal-btn danger-btn"
                                            style={{ width: '100%' }}
                                            onClick={handleRemoveFromCollection}
                                        >
                                            Remove from Collection
                                        </button>
                                    </div>
                                )}

                                {collections && collections.length > 0 && (
                                    <div className="existing-collections" style={{ marginBottom: '1.5rem' }}>
                                        <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', fontWeight: '600', color: 'var(--text-color)' }}>
                                            Add to existing collection:
                                        </h3>
                                        <div style={{ position: 'relative' }}>
                                            <select
                                                value={selectedCollection}
                                                onChange={(e) => setSelectedCollection(e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    padding: '12px 16px',
                                                    paddingRight: '40px',
                                                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                                    borderRadius: '8px',
                                                    color: 'var(--text-color)',
                                                    fontSize: '1rem',
                                                    marginBottom: '0.8rem',
                                                    cursor: 'pointer',
                                                    appearance: 'none',
                                                    backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                                                    backgroundRepeat: 'no-repeat',
                                                    backgroundPosition: 'right 12px center',
                                                    backgroundSize: '16px',
                                                    transition: 'all 0.2s ease'
                                                }}
                                                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'}
                                                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'}
                                            >
                                                <option value="" style={{ color: 'black' }}>Select a collection</option>
                                                {collections.map(collection => (
                                                    <option
                                                        key={collection.id}
                                                        value={collection.id}
                                                        disabled={videoCollections.length > 0 && videoCollections[0].id === collection.id}
                                                        style={{ color: 'black' }}
                                                    >
                                                        {collection.name} {videoCollections.length > 0 && videoCollections[0].id === collection.id ? '(Current)' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <button
                                            className="modal-btn primary-btn"
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                borderRadius: '8px',
                                                background: 'linear-gradient(135deg, #00C6FF 0%, #0072FF 100%)',
                                                border: 'none',
                                                color: 'white',
                                                fontWeight: '600',
                                                cursor: selectedCollection ? 'pointer' : 'not-allowed',
                                                opacity: selectedCollection ? 1 : 0.6,
                                                transition: 'all 0.2s ease'
                                            }}
                                            onClick={handleAddToExistingCollection}
                                            disabled={!selectedCollection}
                                        >
                                            Add to Collection
                                        </button>
                                    </div>
                                )}

                                <div className="new-collection">
                                    <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', fontWeight: '600', color: 'var(--text-color)' }}>
                                        Create new collection:
                                    </h3>
                                    <input
                                        type="text"
                                        className="collection-input"
                                        placeholder="Collection name"
                                        value={newCollectionName}
                                        onChange={(e) => setNewCollectionName(e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && newCollectionName.trim() && handleCreateCollection()}
                                        style={{
                                            width: '100%',
                                            padding: '12px 16px',
                                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                            border: '1px solid rgba(255, 255, 255, 0.1)',
                                            borderRadius: '8px',
                                            color: 'var(--text-color)',
                                            fontSize: '1rem',
                                            marginBottom: '0.8rem',
                                            transition: 'all 0.2s ease'
                                        }}
                                        onFocus={(e) => e.currentTarget.style.borderColor = 'rgba(62, 166, 255, 0.5)'}
                                        onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                                    />
                                    <button
                                        className="modal-btn primary-btn"
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            background: 'linear-gradient(135deg, #00C6FF 0%, #0072FF 100%)',
                                            border: 'none',
                                            color: 'white',
                                            fontWeight: '600',
                                            cursor: newCollectionName.trim() ? 'pointer' : 'not-allowed',
                                            opacity: newCollectionName.trim() ? 1 : 0.6,
                                            transition: 'all 0.2s ease'
                                        }}
                                        onClick={handleCreateCollection}
                                        disabled={!newCollectionName.trim()}
                                    >
                                        Create Collection
                                    </button>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button className="btn secondary-btn" onClick={handleCloseModal}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default VideoPlayer;
