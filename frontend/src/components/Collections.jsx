import { useState } from 'react';
import { Link } from 'react-router-dom';

const Collections = ({ collections }) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
  };

  if (!collections || collections.length === 0) {
    return null;
  }

  return (
    <div className="collections-container">
      {/* Mobile dropdown toggle */}
      <div className="collections-dropdown-toggle" onClick={toggleDropdown}>
        <h3>Collections</h3>
        <span className={`dropdown-arrow ${isOpen ? 'open' : ''}`}>▼</span>
      </div>

      {/* Collections list - visible on desktop or when dropdown is open on mobile */}
      <div className={`collections-list ${isOpen ? 'open' : ''}`}>
        <h3 className="collections-title">Collections</h3>
        <ul>
          {collections.map(collection => (
            <li key={collection.id} className="collection-item">
              <Link 
                to={`/collection/${collection.id}`}
                className="collection-link"
                onClick={() => setIsOpen(false)} // Close dropdown when a collection is selected
              >
                {collection.name} ({collection.videos.length})
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default Collections; 