import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface VideoWithDetails {
    id: string;
    title: string;
    addedAt: string;
    viewCount?: number;
    [key: string]: any;
}

interface UseVideoSortProps<T> {
    videos: T[];
    onSortChange?: (option: string) => void;
}

export const useVideoSort = <T extends VideoWithDetails>({ videos, onSortChange }: UseVideoSortProps<T>) => {
    const [searchParams, setSearchParams] = useSearchParams();

    // Initialize sort option from URL or default
    const sortOptionP = searchParams.get('sort') || 'dateDesc';
    const seedP = parseInt(searchParams.get('seed') || '0', 10);

    const [sortOption, setSortOption] = useState<string>(sortOptionP);
    const [shuffleSeed, setShuffleSeed] = useState<number>(seedP);
    const [sortAnchorEl, setSortAnchorEl] = useState<null | HTMLElement>(null);

    // Sync state with URL params
    useEffect(() => {
        const currentSort = searchParams.get('sort') || 'dateDesc';
        const currentSeed = parseInt(searchParams.get('seed') || '0', 10);
        setSortOption(currentSort);
        setShuffleSeed(currentSeed);
    }, [searchParams]);

    const handleSortClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        setSortAnchorEl(event.currentTarget);
    };

    const handleSortClose = (option?: string) => {
        if (option) {
            if (onSortChange) {
                onSortChange(option);
            }
            
            setSearchParams((prev: URLSearchParams) => {
                const newParams = new URLSearchParams(prev);

                if (option === 'random') {
                    newParams.set('sort', 'random');
                    // Always generate a new seed when clicking 'random'
                    const newSeed = Math.floor(Math.random() * 1000000);
                    newParams.set('seed', newSeed.toString());
                } else {
                    newParams.set('sort', option);
                    newParams.delete('seed');
                }
                return newParams;
            });
        }
        setSortAnchorEl(null);
    };

    const sortedVideos = useMemo(() => {
        if (!videos) return [];
        const result = [...videos];
        switch (sortOption) {
            case 'dateDesc':
                return result.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
            case 'dateAsc':
                return result.sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime());
            case 'viewsDesc':
                return result.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
            case 'viewsAsc':
                return result.sort((a, b) => (a.viewCount || 0) - (b.viewCount || 0));
            case 'nameAsc':
                return result.sort((a, b) => a.title.localeCompare(b.title));
            case 'random':
                // Use a seeded predictable random sort
                return result.map(v => {
                    // Simple hash function for stability with seed
                    let h = 0x811c9dc5;
                    const s = v.id + shuffleSeed;
                    // Hash string id + seed
                    const str = s.toString();
                    for (let i = 0; i < str.length; i++) {
                        h ^= str.charCodeAt(i);
                        h = Math.imul(h, 0x01000193);
                    }
                    return { v, score: h >>> 0 };
                })
                    .sort((a, b) => a.score - b.score)
                    .map(item => item.v);
            default:
                return result;
        }
    }, [videos, sortOption, shuffleSeed]);

    return {
        sortedVideos,
        sortOption,
        sortAnchorEl,
        handleSortClick,
        handleSortClose
    };
};
