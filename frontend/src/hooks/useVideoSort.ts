import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Video } from "../types";

interface UseVideoSortProps {
  videos: Video[] | undefined;
  defaultSort?: string;
  onSortChange?: (option: string) => void;
}

// Valid sort options
const VALID_SORT_OPTIONS = [
  "dateDesc",
  "dateAsc",
  "viewsDesc",
  "viewsAsc",
  "nameAsc",
  "videoDateDesc",
  "videoDateAsc",
  "random",
];

// Validate and normalize sort option
const validateSortOption = (
  sort: string | null,
  fallback: string = "dateDesc"
): string => {
  if (!sort || !VALID_SORT_OPTIONS.includes(sort)) {
    return fallback;
  }
  return sort;
};

export const useVideoSort = ({
  videos,
  defaultSort = "dateDesc",
  onSortChange,
}: UseVideoSortProps) => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Validate defaultSort
  const validatedDefaultSort = validateSortOption(defaultSort, "dateDesc");

  // Initialize sort from URL or default
  const paramSort = searchParams.get("sort");
  const initialSort = validateSortOption(paramSort, validatedDefaultSort);

  const [sortOption, setSortOption] = useState<string>(initialSort);
  const [shuffleSeed, setShuffleSeed] = useState<number>(() => {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0] % 1000000;
  });
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
          // Use crypto for secure random seed generation
          const array = new Uint32Array(1);
          window.crypto.getRandomValues(array);
          const newSeed = array[0] % 1000000;
          newParams.set("seed", newSeed.toString());
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
    if (!videos) return [];
    const result = [...videos];
    switch (sortOption) {
      case "dateDesc":
        return result.sort(
          (a, b) =>
            new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
        );
      case "dateAsc":
        return result.sort(
          (a, b) =>
            new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
        );
      case "viewsDesc":
        return result.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
      case "viewsAsc":
        return result.sort((a, b) => (a.viewCount || 0) - (b.viewCount || 0));
      case "nameAsc":
        return result.sort((a, b) => a.title.localeCompare(b.title));
      case "videoDateDesc":
        // Sort by video creation date descending, empty dates go to end
        return result.sort((a, b) => {
          if (!a.date && !b.date) return 0;
          if (!a.date) return 1; // a goes to end
          if (!b.date) return -1; // b goes to end
          // Compare YYYYMMDD format strings (lexicographic comparison works for this format)
          return b.date.localeCompare(a.date);
        });
      case "videoDateAsc":
        // Sort by video creation date ascending, empty dates go to end
        return result.sort((a, b) => {
          if (!a.date && !b.date) return 0;
          if (!a.date) return 1; // a goes to end
          if (!b.date) return -1; // b goes to end
          // Compare YYYYMMDD format strings (lexicographic comparison works for this format)
          return a.date.localeCompare(b.date);
        });
      case "random":
        // Use a seeded predictable random sort
        return result
          .map((v) => {
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
          .map((item) => item.v);
      default:
        return result;
    }
  }, [videos, sortOption, shuffleSeed]);

  return {
    sortedVideos,
    sortOption,
    sortAnchorEl,
    handleSortClick,
    handleSortClose,
  };
};
