import axios from 'axios';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

const VideoPlayer = ({ videos, onDeleteVideo, collections, onAddToCollection, onCreateCollection, onRemoveFromCollection }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [selectedCollection, setSelectedCollection] = useState('');
  const [videoCollections, setVideoCollections] = useState([]);

  useEffect(() => {
    // Don't try to fetch the video if it's being deleted
    if (isDeleting) {
      return;
    }

    const fetchVideo = async () => {
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
  const formatDate = (dateString) => {
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
    navigate(`/author/${encodeURIComponent(video.author)}`);
  };

  const handleCollectionClick = (collectionId) => {
    navigate(`/collection/${collectionId}`);
  };

  const handleDelete = async () => {
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
    if (!newCollectionName.trim()) {
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
    if (!selectedCollection) {
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
            src={`${BACKEND_URL}${video.videoPath || video.url}`}
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
                    e.target.onerror = null;
                    e.target.src = 'https://via.placeholder.com/168x94?text=No+Thumbnail';
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
      {showCollectionModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Add to Collection</h2>

            {videoCollections.length > 0 && (
              <div className="current-collection">
                <p className="collection-note">
                  This video is currently in the collection: <strong>{videoCollections[0].name}</strong>
                </p>
                <p className="collection-warning">
                  Adding to a different collection will remove it from the current one.
                </p>
                <button
                  className="remove-from-collection"
                  onClick={handleRemoveFromCollection}
                >
                  Remove from Collection
                </button>
              </div>
            )}

            {collections && collections.length > 0 && (
              <div className="existing-collections">
                <h3>Add to existing collection:</h3>
                <select
                  value={selectedCollection}
                  onChange={(e) => setSelectedCollection(e.target.value)}
                >
                  <option value="">Select a collection</option>
                  {collections.map(collection => (
                    <option
                      key={collection.id}
                      value={collection.id}
                      disabled={videoCollections.length > 0 && videoCollections[0].id === collection.id}
                    >
                      {collection.name} {videoCollections.length > 0 && videoCollections[0].id === collection.id ? '(Current)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAddToExistingCollection}
                  disabled={!selectedCollection}
                >
                  Add to Collection
                </button>
              </div>
            )}

            <div className="new-collection">
              <h3>Create new collection:</h3>
              <input
                type="text"
                placeholder="Collection name"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
              />
              <button
                onClick={handleCreateCollection}
                disabled={!newCollectionName.trim()}
              >
                Create Collection
              </button>
            </div>

            <button className="close-modal" onClick={handleCloseModal}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer; 