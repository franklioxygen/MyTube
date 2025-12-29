import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Collection, Video } from '../../types';
import { useVideoFiltering } from '../useVideoFiltering';

describe('useVideoFiltering', () => {
  const mockVideos: Video[] = [
    { id: 'v1', title: 'Video 1', tags: ['tag1'], lastPlayedAt: 100 } as Video,
    { id: 'v2', title: 'Video 2', tags: ['tag2'], lastPlayedAt: 200 } as Video,
    { id: 'v3', title: 'Video 3', tags: ['tag1', 'tag2'], lastPlayedAt: undefined } as Video,
  ];

  const mockCollections: Collection[] = [
    { id: 'c1', name: 'Collection 1', videos: ['v1', 'v3'] } as Collection,
    { id: 'c2', name: 'Collection 2', videos: ['v2'] } as Collection,
  ];

  it('should return all videos when viewMode is "all-videos"', () => {
    const { result } = renderHook(() =>
      useVideoFiltering({
        videos: mockVideos,
        viewMode: 'all-videos',
        selectedTags: [],
        collections: mockCollections,
      })
    );

    expect(result.current).toHaveLength(3);
    expect(result.current).toEqual(mockVideos);
  });

  it('should filter by tags in "all-videos" mode', () => {
    const { result } = renderHook(() =>
      useVideoFiltering({
        videos: mockVideos,
        viewMode: 'all-videos',
        selectedTags: ['tag1'],
        collections: mockCollections,
      })
    );

    expect(result.current).toHaveLength(2);
    expect(result.current.map(v => v.id)).toContain('v1');
    expect(result.current.map(v => v.id)).toContain('v3');
  });

  it('should return only videos with lastPlayedAt in "history" mode and sort by date desc', () => {
    const { result } = renderHook(() =>
      useVideoFiltering({
        videos: mockVideos,
        viewMode: 'history',
        selectedTags: [],
        collections: mockCollections,
      })
    );

    expect(result.current).toHaveLength(2);
    // v2 (200) > v1 (100)
    expect(result.current[0].id).toBe('v2');
    expect(result.current[1].id).toBe('v1');
  });

  it('should filter by tags in "history" mode', () => {
    const { result } = renderHook(() =>
      useVideoFiltering({
        videos: mockVideos,
        viewMode: 'history',
        selectedTags: ['tag1'],
        collections: mockCollections,
      })
    );

    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe('v1');
  });

  it('should return first video of each collection in "collections" mode', () => {
    const { result } = renderHook(() =>
      useVideoFiltering({
        videos: mockVideos,
        viewMode: 'collections',
        selectedTags: [],
        collections: mockCollections,
      })
    );

    // c1 starts with v1, c2 starts with v2
    // v3 is in c1 but not first, so should not show
    const ids = result.current.map(v => v.id);
    expect(ids).toContain('v1');
    expect(ids).toContain('v2');
    expect(ids).not.toContain('v3');
    expect(result.current).toHaveLength(2);
  });

  it('should return empty array if videos is undefined', () => {
    const { result } = renderHook(() =>
      useVideoFiltering({
        videos: undefined as any,
        viewMode: 'all-videos',
        selectedTags: [],
        collections: mockCollections,
      })
    );

    expect(result.current).toEqual([]);
  });

    it('should filter by tags in "collections" mode', () => {
     // v1 (tag1) is first in c1. v2 (tag2) is first in c2.
     // If we filter by tag1, only v1 should show.
    const { result } = renderHook(() =>
      useVideoFiltering({
        videos: mockVideos,
        viewMode: 'collections',
        selectedTags: ['tag1'],
        collections: mockCollections,
      })
    );

    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe('v1');
  });
});
