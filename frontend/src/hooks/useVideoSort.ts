import { useEffect, useMemo, useState } from "react";
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
}

export const useVideoSort = ({
  videos,
  defaultSort = "dateDesc",
  onSortChange,
  preserveOrder = false,
}: UseVideoSortProps) => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Validate defaultSort
  const validatedDefaultSort = validateSortOption(defaultSort, "dateDesc");

  // Initialize sort from URL or default
  const paramSort = searchParams.get("sort");
  const initialSort = validateSortOption(paramSort, validatedDefaultSort);

  const [sortOption, setSortOption] = useState<SortOption>(initialSort);
  const [shuffleSeed, setShuffleSeed] = useState<number>(() => getRandomSeed());
  const [sortAnchorEl, setSortAnchorEl] = useState<null | HTMLElement>(null);

  // Sync state with URL or validatedDefaultSort
  useEffect(() => {
    const currentParam = searchParams.get("sort");
    if (currentParam) {
      setSortOption(validateSortOption(currentParam, validatedDefaultSort));
    } else {
      setSortOption(validatedDefaultSort);
    }

    const currentSeed = parseInt(searchParams.get("seed") || "0", 10);
    setShuffleSeed(currentSeed);
  }, [searchParams, validatedDefaultSort]);

  const handleSortClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setSortAnchorEl(event.currentTarget);
  };

  const handleSortClose = (option?: string) => {
    if (option) {
      // Validate the sort option
      const validatedOption = validateSortOption(option, validatedDefaultSort);

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
