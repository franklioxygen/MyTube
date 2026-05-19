import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Video } from "../types";
import {
  getRandomSeed,
  sortVideos,
  SortOption,
  validateSortOption,
} from "../utils/videoSort";

interface UseVideoSortProps {
  videos: Video[] | undefined;
  defaultSort?: string;
  onSortChange?: (option: string) => void;
  preserveOrder?: boolean;
  storageKey?: string;
}

export const useVideoSort = ({
  videos,
  defaultSort = "dateDesc",
  onSortChange,
  preserveOrder = false,
  storageKey,
}: UseVideoSortProps) => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Validate defaultSort
  const validatedDefaultSort = validateSortOption(defaultSort, "dateDesc");

  const getStoredSort = useCallback((): SortOption | null => {
    if (!storageKey || typeof window === "undefined") return null;

    try {
      const storedSort = window.localStorage.getItem(storageKey);
      if (!storedSort) return null;
      return validateSortOption(storedSort, validatedDefaultSort);
    } catch {
      return null;
    }
  }, [storageKey, validatedDefaultSort]);

  // Initialize sort from URL or default
  const paramSort = searchParams.get("sort");
  const initialSort = validateSortOption(
    paramSort,
    getStoredSort() ?? validatedDefaultSort
  );

  const [sortOption, setSortOption] = useState<SortOption>(initialSort);
  const [shuffleSeed, setShuffleSeed] = useState<number>(() => {
    const paramSeed = parseInt(searchParams.get("seed") || "0", 10);
    if (paramSeed > 0) return paramSeed;
    return initialSort === "random" ? getRandomSeed() : 0;
  });
  const [sortAnchorEl, setSortAnchorEl] = useState<null | HTMLElement>(null);

  // Sync state with URL or validatedDefaultSort
  useEffect(() => {
    const currentParam = searchParams.get("sort");
    const nextSort = currentParam
      ? validateSortOption(currentParam, validatedDefaultSort)
      : getStoredSort() ?? validatedDefaultSort;

    setSortOption(nextSort);

    const currentSeed = parseInt(searchParams.get("seed") || "0", 10);
    if (nextSort === "random") {
      setShuffleSeed(currentSeed > 0 ? currentSeed : getRandomSeed());
    } else {
      setShuffleSeed(0);
    }
  }, [searchParams, validatedDefaultSort, getStoredSort]);

  const handleSortClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setSortAnchorEl(event.currentTarget);
  };

  const handleSortClose = (option?: string) => {
    if (option) {
      // Validate the sort option
      const validatedOption = validateSortOption(option, validatedDefaultSort);

      if (storageKey && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(storageKey, validatedOption);
        } catch {
          // Ignore storage failures; URL state still reflects the selected sort.
        }
      }

      // Notify parent if callback provided (e.g. to reset page)
      if (onSortChange) {
        onSortChange(validatedOption);
      }

      // Update URL params
      setSearchParams((prev: URLSearchParams) => {
        const newParams = new URLSearchParams(prev);
        if (validatedOption === "random") {
          newParams.set("sort", "random");
          newParams.set("seed", getRandomSeed().toString());
        } else {
          newParams.set("sort", validatedOption);
          newParams.delete("seed");
        }
        return newParams;
      });
    }
    setSortAnchorEl(null);
  };

  const sortedVideos = useMemo(() => {
    if (preserveOrder) {
      return videos ? [...videos] : [];
    }

    return sortVideos(videos, sortOption, shuffleSeed);
  }, [videos, sortOption, shuffleSeed, preserveOrder]);

  return {
    sortedVideos,
    sortOption,
    sortAnchorEl,
    handleSortClick,
    handleSortClose,
  };
};
