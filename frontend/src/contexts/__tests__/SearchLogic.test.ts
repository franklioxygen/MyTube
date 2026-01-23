
import { describe, expect, it } from 'vitest';

// Mimic the search function from VideoContext logic for testing
const searchLocalVideos = (query: string, videos: any[]) => {
    if (!query || !videos.length) return [];
    
    // Normalize query: lowercase, trim, split by whitespace
    const terms = query.toLowerCase().trim().split(/\s+/).filter(t => t.length > 0);
    
    if (terms.length === 0) return videos;

    return videos.filter(video => {
        const searchableText = [
            video.title,
            video.author,
            video.description || '',
            ...(video.tags || [])
        ].join(' ').toLowerCase();

        // Check if ALL terms are present (AND logic)
        return terms.every(term => searchableText.includes(term));
    });
};

const mockVideos = [
    {
        id: '1',
        title: 'Funny Cat Video',
        author: 'CatLover',
        description: 'A very funny cat jumping',
        tags: ['cat', 'animals', 'funny']
    },
    {
        id: '2',
        title: 'Dog Training',
        author: 'DogWhisperer',
        description: 'How to sit',
        tags: ['dog', 'training']
    },
    {
        id: '3',
        title: 'Gaming compilation',
        author: 'GamerOne',
        description: 'Best moments',
        tags: ['game', 'fun']
    }
];

describe('Search Optimization Logic', () => {
    it('should find video by single term in title', () => {
        const results = searchLocalVideos('cat', mockVideos);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('1');
    });

    it('should find video by author', () => {
        const results = searchLocalVideos('whisperer', mockVideos);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('2');
    });

    it('should find video by tag', () => {
        const results = searchLocalVideos('animals', mockVideos);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('1');
    });

    it('should support AND logic (multi-term)', () => {
        const results = searchLocalVideos('funny cat', mockVideos);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('1');
    });

    it('should return empty if one term matches but other does not', () => {
        const results = searchLocalVideos('training cat', mockVideos);
        expect(results).toHaveLength(0);
    });

    it('should find partial matches', () => {
        const results = searchLocalVideos('gamin', mockVideos);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('3');
    });

    it('should be case insensitive', () => {
        const results = searchLocalVideos('GAMER', mockVideos);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('3');
    });

    it('should handle extra whitespace', () => {
        const results = searchLocalVideos('  dog   training  ', mockVideos);
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('2');
    });
});
