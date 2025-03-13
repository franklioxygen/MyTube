import React from 'react';

const DeleteCollectionModal = ({ 
  isOpen, 
  onClose, 
  onDeleteCollectionOnly, 
  onDeleteCollectionAndVideos, 
  collectionName, 
  videoCount 
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Delete Collection</h2>
        <p>
          Are you sure you want to delete the collection "{collectionName}"?
        </p>
        <p>
          This collection contains {videoCount} video{videoCount !== 1 ? 's' : ''}.
        </p>
        <div className="modal-buttons">
          <button 
            className="modal-button delete-collection-only" 
            onClick={onDeleteCollectionOnly}
          >
            Delete Collection Only
          </button>
          {videoCount > 0 && (
            <button 
              className="modal-button delete-all danger" 
              onClick={onDeleteCollectionAndVideos}
            >
              Delete Collection and All Videos
            </button>
          )}
          <button 
            className="modal-button cancel" 
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteCollectionModal; 