import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import logo from '../assets/logo.svg';

interface DownloadInfo {
    id: string;
    title: string;
    timestamp?: number;
}

interface HeaderProps {
    onSubmit: (url: string) => Promise<any>;
    onSearch: (term: string) => Promise<any>;
    activeDownloads?: DownloadInfo[];
    isSearchMode?: boolean;
    searchTerm?: string;
    onResetSearch?: () => void;
}

const Header: React.FC<HeaderProps> = ({
    onSubmit,
    onSearch,
    activeDownloads = [],
    isSearchMode = false,
    searchTerm = '',
    onResetSearch
}) => {
    const [videoUrl, setVideoUrl] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [showDownloads, setShowDownloads] = useState<boolean>(false);
    const navigate = useNavigate();

    const isDownloading = activeDownloads.length > 0;

    // Log props for debugging
    useEffect(() => {
        console.log('Header props:', { activeDownloads });
    }, [activeDownloads]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();

        if (!videoUrl.trim()) {
            setError('Please enter a video URL or search term');
            return;
        }

        // Simple validation for YouTube or Bilibili URL
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
        const bilibiliRegex = /^(https?:\/\/)?(www\.)?(bilibili\.com|b23\.tv)\/.+$/;

        // Check if input is a URL
        const isUrl = youtubeRegex.test(videoUrl) || bilibiliRegex.test(videoUrl);

        setError('');
        setIsSubmitting(true);

        try {
            if (isUrl) {
                // Handle as URL for download
                const result = await onSubmit(videoUrl);

                if (result.success) {
                    setVideoUrl('');
                } else if (result.isSearchTerm) {
                    // If backend determined it's a search term despite our check
                    const searchResult = await onSearch(videoUrl);
                    if (searchResult.success) {
                        setVideoUrl('');
                        navigate('/'); // Stay on homepage to show search results
                    } else {
                        setError(searchResult.error);
                    }
                } else {
                    setError(result.error);
                }
            } else {
                // Handle as search term
                const result = await onSearch(videoUrl);

                if (result.success) {
                    setVideoUrl('');
                    // Stay on homepage to show search results
                    navigate('/');
                } else {
                    setError(result.error);
                }
            }
        } catch (err) {
            setError('An unexpected error occurred. Please try again.');
            console.error(err);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <header className="header">
            <div className="header-content">
                <Link to="/" className="logo">
                    <img src={logo} alt="MyTube Logo" className="logo-icon" />
                    <span style={{ color: '#f0f0f0' }}>MyTube</span>
                </Link>

                <form className="url-form" onSubmit={handleSubmit}>
                    <div className="form-group">
                        <input
                            type="text"
                            className="url-input"
                            placeholder="Enter YouTube/Bilibili URL or search term"
                            value={videoUrl}
                            onChange={(e) => setVideoUrl(e.target.value)}
                            disabled={isSubmitting}
                            aria-label="Video URL or search term"
                        />
                        {isSearchMode && searchTerm && (
                            <button
                                type="button"
                                className="clear-search-btn"
                                onClick={onResetSearch}
                                title="Clear search"
                                style={{
                                    position: 'absolute',
                                    right: '100px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    color: '#aaa',
                                    fontSize: '1.2rem',
                                    cursor: 'pointer'
                                }}
                            >
                                ×
                            </button>
                        )}
                        <button
                            type="submit"
                            className="submit-btn"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? 'Processing...' : 'Submit'}
                        </button>
                    </div>
                    {error && (
                        <div className="form-error">
                            {error}
                        </div>
                    )}

                    {/* Active Downloads Indicator */}
                    {isDownloading && (
                        <div className="downloads-indicator-container">
                            <div
                                className="downloads-summary"
                                onClick={() => setShowDownloads(!showDownloads)}
                            >
                                <span className="download-icon">⬇️</span>
                                <span className="download-count">
                                    {activeDownloads.length} Downloading
                                </span>
                                <span className="download-arrow">{showDownloads ? '▲' : '▼'}</span>
                            </div>

                            {showDownloads && (
                                <div className="downloads-dropdown">
                                    {activeDownloads.map((download) => (
                                        <div key={download.id} className="download-item">
                                            <div className="download-spinner"></div>
                                            <div className="download-title" title={download.title}>
                                                {download.title}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </form>
            </div>
        </header>
    );
};

export default Header;
