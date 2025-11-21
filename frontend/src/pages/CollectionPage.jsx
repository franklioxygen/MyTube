import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DeleteCollectionModal from '../components/DeleteCollectionModal';
import VideoCard from '../components/VideoCard';

const CollectionPage = ({ collections, videos, onDeleteVideo, onDeleteCollection }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [collection, setCollection] = useState(null);
  const [collectionVideos, setCollectionVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    if (collections && collections.length > 0) {
      const foundCollection = collections.find(c => c.id === id);

      if (foundCollection) {
        setCollection(foundCollection);

        // Find all videos that are in this collection
        const videosInCollection = videos.filter(video =>
          foundCollection.videos.includes(video.id)
        );

        setCollectionVideos(videosInCollection);
      } else {
        // Collection not found, redirect to home
        navigate('/');
      }
    }

    setLoading(false);
  }, [id, collections, videos, navigate]);

  const handleBack = () => {
    navigate(-1);
  };

  const handleShowDeleteModal = () => {
    setShowDeleteModal(true);
  };

  const handleCloseDeleteModal = () => {
    setShowDeleteModal(false);
  };

  const handleDeleteCollectionOnly = async () => {
    const success = await onDeleteCollection(id, false);
    if (success) {
      navigate('/');
    }
    setShowDeleteModal(false);
  };

  const handleDeleteCollectionAndVideos = async () => {
    const success = await onDeleteCollection(id, true);
    if (success) {
      navigate('/');
    }
    setShowDeleteModal(false);
  };

  if (loading) {
    return <div className="loading">Loading collection...</div>;
  }

  if (!collection) {
    return <div className="error">Collection not found</div>;
  }

  return (
    <div className="collection-page">
      <div className="collection-header">
        <button className="back-button" onClick={handleBack}>
          &larr; Back
        </button>
        <div className="collection-info">
          <h2 className="collection-title">Collection: {collection.name}</h2>
          <span className="video-count">{collectionVideos.length} video{collectionVideos.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {collectionVideos.length === 0 ? (
        <div className="no-videos">
          <p>No videos in this collection.</p>
        </div>
      ) : (
        <div className="videos-grid">
          {collectionVideos.map(video => (
            <VideoCard
              key={video.id}
              video={video}
              onDeleteVideo={onDeleteVideo}
              showDeleteButton={true}
            />
          ))}
        </div>
      )}

      <DeleteCollectionModal
        isOpen={showDeleteModal}
        onClose={handleCloseDeleteModal}
        onDeleteCollectionOnly={handleDeleteCollectionOnly}
        onDeleteCollectionAndVideos={handleDeleteCollectionAndVideos}
        collectionName={collection?.name || ''}
        videoCount={collectionVideos.length}
      />
    </div>
  );
};

export default CollectionPage; 