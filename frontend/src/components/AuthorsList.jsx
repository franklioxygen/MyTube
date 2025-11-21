import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const AuthorsList = ({ videos }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [authors, setAuthors] = useState([]);

  useEffect(() => {
    // Extract unique authors from videos
    if (videos && videos.length > 0) {
      const uniqueAuthors = [...new Set(videos.map(video => video.author))]
        .filter(author => author) // Filter out null/undefined authors
        .sort((a, b) => a.localeCompare(b)); // Sort alphabetically

      setAuthors(uniqueAuthors);
    } else {
      setAuthors([]);
    }
  }, [videos]);

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  if (!authors.length) {
    return null;
  }

  return (
    <div className="authors-container">
      {/* Mobile dropdown toggle */}
      <div className="authors-dropdown-toggle" onClick={toggleDropdown}>
        <h3>Authors</h3>
        <span className={`dropdown-arrow ${isOpen ? 'open' : ''}`}>▼</span>
      </div>

      {/* Authors list - visible on desktop or when dropdown is open on mobile */}
      <div className={`authors-list ${isOpen ? 'open' : ''}`}>
        <h3 className="authors-title">Authors</h3>
        <ul>
          {authors.map(author => (
            <li key={author} className="author-item">
              <Link
                to={`/author/${encodeURIComponent(author)}`}
                className="author-link"
                onClick={() => setIsOpen(false)} // Close dropdown when an author is selected
              >
                {author}
              </Link>
            </li>
          ))}
        </ul>
        <div className="manage-videos-link-container" style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
          <Link
            to="/manage"
            className="author-link manage-link"
            onClick={() => setIsOpen(false)}
            style={{ fontWeight: 'bold', color: 'var(--primary-color)' }}
          >
            Manage Videos
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AuthorsList; 