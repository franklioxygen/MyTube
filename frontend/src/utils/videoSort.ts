import { Video } from "../types";

export type SortOption =
  | "dateDesc"
  | "dateAsc"
  | "viewsDesc"
  | "viewsAsc"
  | "nameAsc"
  | "videoDateDesc"
  | "videoDateAsc"
  | "random";

export const VALID_SORT_OPTIONS: SortOption[] = [
  "dateDesc",
  "dateAsc",
  "viewsDesc",
  "viewsAsc",
  "nameAsc",
  "videoDateDesc",
  "videoDateAsc",
  "random",
];

export const validateSortOption = (
  sort: string | null | undefined,
  fallback: SortOption = "dateDesc"
): SortOption => {
  if (!sort || !VALID_SORT_OPTIONS.includes(sort as SortOption)) {
    return fallback;
  }
  return sort as SortOption;
};

export const getRandomSeed = (): number => {
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0] % 1000000;
  }
  return Math.floor(Math.random() * 1000000);
};

const getSeededScore = (id: string, shuffleSeed: number): number => {
  let hash = 0x811c9dc5;
  const str = `${id}${shuffleSeed}`;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const sortVideos = (
  videos: Video[] | undefined,
  sortOption: SortOption,
  shuffleSeed: number = 0
): Video[] => {
  if (!videos) return [];

  const result = [...videos];
  switch (sortOption) {
    case "dateDesc":
      return result.sort(
        (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
      );
    case "dateAsc":
      return result.sort(
        (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
      );
    case "viewsDesc":
      return result.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
    case "viewsAsc":
      return result.sort((a, b) => (a.viewCount || 0) - (b.viewCount || 0));
    case "nameAsc":
      return result.sort((a, b) => a.title.localeCompare(b.title));
    case "videoDateDesc":
      return result.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.localeCompare(a.date);
      });
    case "videoDateAsc":
      return result.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      });
    case "random":
      return result
        .map((video) => ({ video, score: getSeededScore(video.id, shuffleSeed) }))
        .sort((a, b) => a.score - b.score)
        .map((item) => item.video);
    default:
      return result;
  }
};
