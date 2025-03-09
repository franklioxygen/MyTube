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
  const [isDeleted, setIsDeleted] = useState(false);
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [selectedCollection, setSelectedCollection] = useState('');
  const [videoCollections, setVideoCollections] = useState([]);

  useEffect(() => {
    // Don't try to fetch the video if it's being deleted or has been deleted
    if (isDeleting || isDeleted) {
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
  }, [id, videos, navigate, isDeleting, isDeleted]);

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
        setIsDeleted(true);
        // Navigate immediately to prevent further API calls
        navigate('/', { replace: true });
      } else {
        setDeleteError(result.error);
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

  if (isDeleted) {
    return <div className="loading">Video deleted successfully. Redirecting...</div>;
  }

  if (loading) {
    return <div className="loading">Loading video...</div>;
  }

  if (error || !video) {
    return <div className="error">{error || 'Video not found'}</div>;
  }

  // Get source badge
  const getSourceBadge = () => {
    if (video.source === 'bilibili') {
      return <span className="source-badge bilibili">Bilibili</span>;
    }
    return <span className="source-badge youtube">YouTube</span>;
  };

  return (
    <div className="video-player-container">
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
      
      <div className="video-details">
        <div className="video-details-header">
          <div className="title-container">
            <h1>{video.title}</h1>
            {getSourceBadge()}
          </div>
          <div className="video-actions">
            <button 
              className="collection-btn" 
              onClick={handleAddToCollection}
            >
              Add to Collection
            </button>
            <button 
              className="delete-btn" 
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete Video'}
            </button>
          </div>
        </div>
        
        {deleteError && (
          <div className="error" style={{ marginTop: '0.5rem' }}>
            {deleteError}
          </div>
        )}
        
        <div className="video-details-meta">
          <div>
            <strong>Author:</strong>{' '}
            <span 
              className="author-link"
              onClick={handleAuthorClick}
              role="button"
              tabIndex="0"
              aria-label={`View all videos by ${video.author}`}
            >
              {video.author}
            </span>
          </div>          
          <div>
            <strong>Upload Date:</strong> {formatDate(video.date)}
          </div>
          <div>
            <strong>Added:</strong> {new Date(video.addedAt).toLocaleString()}
          </div>
          {video.sourceUrl && (
            <div>
              <strong>Source:</strong>{' '}
              <a 
                href={video.sourceUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="source-link"
              >
                Original Video
              </a>
            </div>
          )}
          {videoCollections.length > 0 && (
            <div className="video-collections">
              <div className="video-collections-title">Collection:</div>
              <div className="video-collections-list">
                <span 
                  key={videoCollections[0].id} 
                  className="video-collection-tag"
                  onClick={() => handleCollectionClick(videoCollections[0].id)}
                >
                  {videoCollections[0].name}
                </span>
              </div>
            </div>
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