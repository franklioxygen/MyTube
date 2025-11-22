interface DeleteCollectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onDeleteCollectionOnly: () => void;
    onDeleteCollectionAndVideos: () => void;
    collectionName: string;
    videoCount: number;
}

const DeleteCollectionModal: React.FC<DeleteCollectionModalProps> = ({
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
            <div className="modal-content" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
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

                    <div className="modal-actions" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <button
                            className="btn secondary-btn glass-panel"
                            onClick={onDeleteCollectionOnly}
                            style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                color: 'var(--text-color)',
                                cursor: 'pointer',
                            }}
                        >

                            Delete Collection Only
                        </button>
                        {videoCount > 0 && (
                            <button
                                className="btn danger-btn"
                                onClick={onDeleteCollectionAndVideos}
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: 'linear-gradient(90deg, #ff4b4b 0%, #ff0000 100%)',
                                    color: 'white',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 12px rgba(255, 0, 0, 0.3)',
                                    transition: 'all 0.2s ease',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px'
                                }}
                                onMouseOver={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 6px 16px rgba(255, 0, 0, 0.4)';
                                }}
                                onMouseOut={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(255, 0, 0, 0.3)';
                                }}
                            >
                                <span style={{ fontSize: '1.2em' }}>⚠️</span>
                                <span>Delete Collection & All {videoCount} Videos</span>
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
