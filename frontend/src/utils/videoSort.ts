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
  if (
    typeof window !== "undefined" &&
    typeof window.crypto.getRandomValues === "function"
  ) {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0] % 1000000;
  }
  return Date.now() % 1000000;
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

type VideoComparator = (a: Video, b: Video) => number;

const compareAddedAtDesc: VideoComparator = (a, b) =>
  new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();

const compareAddedAtAsc: VideoComparator = (a, b) =>
  new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();

const compareViewsDesc: VideoComparator = (a, b) =>
  (b.viewCount || 0) - (a.viewCount || 0);

const compareViewsAsc: VideoComparator = (a, b) =>
  (a.viewCount || 0) - (b.viewCount || 0);

const compareNameAsc: VideoComparator = (a, b) => a.title.localeCompare(b.title);

const compareVideoDate = (a: Video, b: Video, ascending: boolean): number => {
  if (!a.date && !b.date) return 0;
  if (!a.date) return 1;
  if (!b.date) return -1;
  return ascending ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
};

const compareVideoDateDesc: VideoComparator = (a, b) =>
  compareVideoDate(a, b, false);

const compareVideoDateAsc: VideoComparator = (a, b) =>
  compareVideoDate(a, b, true);

const sortRandomVideos = (videos: Video[], shuffleSeed: number): Video[] =>
  videos
    .map((video) => ({ video, score: getSeededScore(video.id, shuffleSeed) }))
    .sort((a, b) => a.score - b.score)
    .map((item) => item.video);

export const sortVideos = (
  videos: Video[] | undefined,
  sortOption: SortOption,
  shuffleSeed: number = 0
): Video[] => {
  if (!videos) return [];

  if (sortOption === "random") {
    return sortRandomVideos([...videos], shuffleSeed);
  }

  switch (sortOption) {
    case "dateDesc":
      return [...videos].sort(compareAddedAtDesc);
    case "dateAsc":
      return [...videos].sort(compareAddedAtAsc);
    case "viewsDesc":
      return [...videos].sort(compareViewsDesc);
    case "viewsAsc":
      return [...videos].sort(compareViewsAsc);
    case "nameAsc":
      return [...videos].sort(compareNameAsc);
    case "videoDateDesc":
      return [...videos].sort(compareVideoDateDesc);
    case "videoDateAsc":
      return [...videos].sort(compareVideoDateAsc);
    case "random":
    default:
      return [...videos];
  }
};
