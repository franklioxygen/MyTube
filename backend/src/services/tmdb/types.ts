export interface TMDBMovieResult {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  vote_average?: number;
  genres?: Array<{ id: number; name: string }>;
}

export interface TMDBTVResult {
  id: number;
  name: string;
  original_name?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  vote_average?: number;
  genres?: Array<{ id: number; name: string }>;
  created_by?: Array<{ id: number; name: string }>;
}

export interface TMDBSearchResult {
  media_type: "movie" | "tv" | "person";
  id: number;
  title?: string; // For movies
  original_title?: string; // For movies
  name?: string; // For TV shows
  original_name?: string; // For TV shows
  release_date?: string; // For movies
  first_air_date?: string; // For TV shows
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  vote_average?: number;
  popularity?: number;
}

export type MultiStrategySearchResult = {
  result: TMDBMovieResult | TMDBTVResult | null;
  mediaType: "movie" | "tv" | null;
  strategy: string;
  director?: string;
};

export type TMDBCrewMember = {
  job?: string;
  name?: string;
};

export type TMDBCredentialAuthType = "apiKey" | "readAccessToken";

export type TMDBCredentialMessageKey =
  | "tmdbCredentialValidApiKey"
  | "tmdbCredentialValidReadAccessToken"
  | "tmdbCredentialInvalid"
  | "tmdbCredentialRequestFailed";

export type TMDBCredentialTestResult =
  | {
      success: true;
      authType: TMDBCredentialAuthType;
      messageKey:
        | "tmdbCredentialValidApiKey"
        | "tmdbCredentialValidReadAccessToken";
    }
  | {
      success: false;
      authType: TMDBCredentialAuthType;
      code: "auth-failed" | "request-failed";
      messageKey: "tmdbCredentialInvalid" | "tmdbCredentialRequestFailed";
      error: string;
    };
