import { useState } from 'react';
import { Link } from 'react-router-dom';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

const ManagePage = ({ videos, onDeleteVideo }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [deletingId, setDeletingId] = useState(null);

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

    const getThumbnailSrc = (video) => {
        if (video.thumbnailPath) {
            return `${BACKEND_URL}${video.thumbnailPath}`;
        }
        return video.thumbnailUrl || 'https://via.placeholder.com/120x90?text=No+Thumbnail';
    };

    return (
        <div className="manage-page">
            <div className="manage-header">
                <h1>Manage Videos</h1>
                <Link to="/" className="back-link">← Back to Home</Link>
            </div>

            <div className="manage-controls">
                <input
                    type="text"
                    placeholder="Search videos..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="manage-search"
                />
                <div className="video-count">
                    {filteredVideos.length} videos found
                </div>
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
    );
};

export default ManagePage;
