import { FilenameTemplateContext } from "./types";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Computes alias variable values from the normalized context.
 * Returns a map of alias variable name -> rendered string.
 * All aliases are injected into the renderer before segment sanitization.
 */
export function computeAliases(
  ctx: FilenameTemplateContext
): Record<string, string> {
  const year = ctx.uploadYear || "0000";
  const month = ctx.uploadMonth || "00";
  const day = ctx.uploadDay || "00";
  const idx = ctx.mediaPlaylistIndexWithinDate ?? ctx.mediaPlaylistIndex;
  const idxStr = idx !== undefined ? pad2(idx) : "00";

  const seasonFromDate = year; // e.g. "2026"
  const seasonEpisodeFromDate = `s${year}e${month}${day}`; // e.g. "s2026e0430"
  const seasonEpisodeIndexFromDate = `s${year}e${month}${day}${idxStr}`; // e.g. "s2026e043001"

  const seasonByYearEpByDate = `Season ${year}/s${year}e${month}${day}`;
  const seasonByYearEpByDateAndIndex = `Season ${year}/s${year}e${month}${day}${idxStr}`;

  const playlistIndex = ctx.mediaPlaylistIndex ?? 0;
  const staticSeasonEpByIndex = `Season 1/s01e${pad2(playlistIndex)}`;
  const staticSeasonEpByDate = `Season 1/s01e${year}${month}${day}`;

  return {
    season_from_date: seasonFromDate,
    season_episode_from_date: seasonEpisodeFromDate,
    season_episode_index_from_date: seasonEpisodeIndexFromDate,
    season_by_year__episode_by_date: seasonByYearEpByDate,
    season_by_year__episode_by_date_and_index: seasonByYearEpByDateAndIndex,
    static_season__episode_by_index: staticSeasonEpByIndex,
    static_season__episode_by_date: staticSeasonEpByDate,
  };
}
