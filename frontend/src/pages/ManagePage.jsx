import { useState } from 'react';
import { Link } from 'react-router-dom';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

const ManagePage = ({ videos, onDeleteVideo, collections = [], onDeleteCollection }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [deletingId, setDeletingId] = useState(null);
    const [collectionToDelete, setCollectionToDelete] = useState(null);
    const [isDeletingCollection, setIsDeletingCollection] = useState(false);

    const filteredVideos = videos.filter(video =>
        video.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        video.author.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleDelete = async (id) => {
        if (window.confirm('Are you sure you want to delete this video?')) {
            setDeletingId(id);
            await onDeleteVideo(id);
            setDeletingId(null);
        }
    };

    const confirmDeleteCollection = (collection) => {
        setCollectionToDelete(collection);
    };

    const handleCollectionDelete = async (deleteVideos) => {
        if (!collectionToDelete) return;

        setIsDeletingCollection(true);
        await onDeleteCollection(collectionToDelete.id, deleteVideos);
        setIsDeletingCollection(false);
        setCollectionToDelete(null);
    };

    const getThumbnailSrc = (video) => {
        if (video.thumbnailPath) {
            return `${BACKEND_URL}${video.thumbnailPath}`;
        }
        return video.thumbnailUrl || 'https://via.placeholder.com/120x90?text=No+Thumbnail';
    };

    return (
        <div className="manage-page">
            <div className="manage-header">
                <h1>Manage Content</h1>
                <Link to="/" className="back-link">← Back to Home</Link>
            </div>

            {/* Delete Collection Modal */}
            {collectionToDelete && (
                <div className="modal-overlay" onClick={() => !isDeletingCollection && setCollectionToDelete(null)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h2>Delete Collection</h2>
                        <p style={{ marginBottom: '0.5rem' }}>
                            You are about to delete the collection <strong>"{collectionToDelete.name}"</strong>.
                        </p>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                            This collection contains {collectionToDelete.videos.length} video{collectionToDelete.videos.length !== 1 ? 's' : ''}.
                        </p>
                        <div className="modal-actions" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <button
                                className="modal-btn secondary-btn"
                                onClick={() => handleCollectionDelete(false)}
                                disabled={isDeletingCollection}
                            >
                                {isDeletingCollection ? 'Deleting...' : 'Delete Collection Only'}
                            </button>
                            <button
                                className="modal-btn danger-btn"
                                onClick={() => handleCollectionDelete(true)}
                                disabled={isDeletingCollection}
                            >
                                {isDeletingCollection ? 'Deleting...' : 'Delete Collection & Videos'}
                            </button>
                            <button
                                className="modal-btn cancel-btn"
                                onClick={() => setCollectionToDelete(null)}
                                disabled={isDeletingCollection}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="manage-section">
                <h2>Collections ({collections.length})</h2>
                <div className="manage-list">
                    {collections.length > 0 ? (
                        <table className="manage-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Videos</th>
                                    <th>Created</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {collections.map(collection => (
                                    <tr key={collection.id}>
                                        <td className="col-title">{collection.name}</td>
                                        <td>{collection.videos.length} videos</td>
                                        <td>{new Date(collection.createdAt).toLocaleDateString()}</td>
                                        <td className="col-actions">
                                            <button
                                                className="delete-btn-small"
                                                onClick={() => confirmDeleteCollection(collection)}
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className="no-videos-found">
                            No collections found.
                        </div>
                    )}
                </div>
            </div>

            <div className="manage-section">
                <h2>Videos ({filteredVideos.length})</h2>
                <div className="manage-controls">
                    <input
                        type="text"
                        placeholder="Search videos..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="manage-search"
                    />
                </div>

                <div className="manage-list">
                    {filteredVideos.length > 0 ? (
                        <table className="manage-table">
                            <thead>
                                <tr>
                                    <th>Thumbnail</th>
                                    <th>Title</th>
                                    <th>Author</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredVideos.map(video => (
                                    <tr key={video.id}>
                                        <td className="col-thumbnail">
                                            <img
                                                src={getThumbnailSrc(video)}
                                                alt={video.title}
                                                className="manage-thumbnail"
                                            />
                                        </td>
                                        <td className="col-title">{video.title}</td>
                                        <td className="col-author">{video.author}</td>
                                        <td className="col-actions">
                                            <button
                                                className="delete-btn-small"
                                                onClick={() => handleDelete(video.id)}
                                                disabled={deletingId === video.id}
                                            >
                                                {deletingId === video.id ? 'Deleting...' : 'Delete'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className="no-videos-found">
                            No videos found matching your search.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ManagePage;
