export interface Subscription {
  id: string;
  author: string;
  authorUrl: string;
  interval: number;
  lastVideoLink?: string;
  lastCheck?: number;
  downloadCount: number;
  createdAt: number;

  platform: string;
  paused?: number;

  // Playlist subscription fields
  playlistId?: string;
  playlistTitle?: string;
  channelName?: string;
  subscriptionType?: string; // 'author' or 'playlist'
  collectionId?: string;

  // Shorts support
  downloadShorts?: number; // 0 or 1
  lastShortVideoLink?: string;

  // Twitch support
  twitchBroadcasterId?: string;
  twitchBroadcasterLogin?: string;
  lastTwitchVideoId?: string;

  // Retention
  retentionDays?: number | null;

  // Statistics-related durable state
  consecutiveFailureCount?: number;
  lastCheckStatus?: string | null;
  lastFailureReason?: string | null;

  // Per-subscription yt-dlp config override (issue #345).
  // Free-text yt-dlp config snippet; empty/undefined = use the global config.
  ytdlpConfig?: string | null;

  /** Per-subscription filename-template override. null/undefined means inherit global filename naming settings. */
  filenameTemplate?: string | null;
}
