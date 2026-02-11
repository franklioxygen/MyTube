import { useCallback, useEffect, useMemo, useState } from 'react';

import { usePageTagFilter } from '../../contexts/PageTagFilterContext';
import { Video } from '../../types';
import {
    filterAuthorVideosByTags,
    getAvailableAuthorTags,
    getCommonAuthorTags
} from './utils';

interface UseAuthorTagFilterResult {
    availableTags: string[];
    selectedTags: string[];
    commonTags: string[];
    videosFilteredByTags: Video[];
    handleTagToggle: (tag: string) => void;
}

export const useAuthorTagFilter = (authorVideos: Video[]): UseAuthorTagFilterResult => {
    const { setPageTagFilter } = usePageTagFilter();
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [filterVersion, setFilterVersion] = useState(0);

    const availableTags = useMemo(
        () => getAvailableAuthorTags(authorVideos),
        [authorVideos]
    );
    const commonTags = useMemo(
        () => getCommonAuthorTags(authorVideos),
        [authorVideos]
    );
    const videosFilteredByTags = useMemo(
        () => filterAuthorVideosByTags(authorVideos, selectedTags),
        [authorVideos, selectedTags]
    );

    const handleTagToggle = useCallback((tag: string) => {
        setSelectedTags((prevTags) =>
            prevTags.includes(tag)
                ? prevTags.filter((currentTag) => currentTag !== tag)
                : [...prevTags, tag]
        );
        setFilterVersion((value) => value + 1);
    }, []);

    const pageTagFilter = useMemo(
        () => ({
            availableTags,
            selectedTags,
            onTagToggle: handleTagToggle,
            _version: filterVersion
        }),
        [availableTags, selectedTags, handleTagToggle, filterVersion]
    );

    useEffect(() => {
        setPageTagFilter(pageTagFilter);
        return () => {
            setPageTagFilter(null);
        };
    }, [pageTagFilter, setPageTagFilter]);

    return {
        availableTags,
        selectedTags,
        commonTags,
        videosFilteredByTags,
        handleTagToggle
    };
};
