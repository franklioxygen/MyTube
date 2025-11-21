
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Delete Collection</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <p style={{ marginBottom: '12px', fontSize: '0.95rem' }}>
            Are you sure you want to delete the collection <strong>"{collectionName}"</strong>?
          </p>
          <p style={{ marginBottom: '20px', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
            This collection contains <strong>{videoCount}</strong> video{videoCount !== 1 ? 's' : ''}.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              className="btn secondary-btn"
              onClick={onDeleteCollectionOnly}
              style={{ width: '100%' }}
            >
              Delete Collection Only
            </button>
            {videoCount > 0 && (
              <button
                className="btn primary-btn"
                onClick={onDeleteCollectionAndVideos}
                style={{
                  width: '100%',
                  background: 'linear-gradient(135deg, #ff3e3e 0%, #ff6b6b 100%)'
                }}
              >
                ⚠️ Delete Collection and All Videos
              </button>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="btn secondary-btn"
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