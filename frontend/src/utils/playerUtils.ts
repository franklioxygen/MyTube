export interface PlayerOption {
  id: string;
  name: string;
}

// Platform detection functions
// Using navigator.userAgent instead of deprecated navigator.platform
// Note: isMac() excludes iOS devices to avoid overlap with isIOS()
export const isMac = () => {
  const userAgent = navigator.userAgent;
  // Exclude iOS devices (iPod, iPhone, iPad) from Mac detection
  if (/iPod|iPhone|iPad/.test(userAgent)) {
    return false;
  }
  // Check for Mac (Macintosh, MacIntel, MacPPC, Mac68K)
  return /Macintosh|MacIntel|MacPPC|Mac68K/.test(userAgent);
};

export const isWindows = () => {
  const userAgent = navigator.userAgent;
  return /Win32|Win64|Windows|WinCE/.test(userAgent);
};

export const isIOS = () => {
  const userAgent = navigator.userAgent;
  // Check for iOS devices (iPod, iPhone, iPad)
  // Exclude IE/Edge legacy (MSStream check)
  const isNotLegacyIE = !(window as unknown as { MSStream?: unknown }).MSStream;
  if (/iPod|iPhone|iPad/.test(userAgent) && isNotLegacyIE) {
    return true;
  }
  // Check for iPadOS (iPad running iPadOS may report as Mac with touch support)
  // This is a fallback for cases where userAgent doesn't explicitly mention iPad
  return (
    /Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1 && isNotLegacyIE
  );
};

export const isAndroid = () => /Android/.test(navigator.userAgent);

export const isLinux = () => {
  const userAgent = navigator.userAgent;
  return /Linux/.test(userAgent) && !isAndroid() && !/Android/.test(userAgent);
};

// Player definitions
const PLAYERS = {
  VLC: { id: "vlc", name: "VLC" },
  IINA: { id: "iina", name: "IINA" },
  INFUSE: { id: "infuse", name: "Infuse" },
  MPV: { id: "mpv", name: "mpv" },
  POTPLAYER: { id: "potplayer", name: "PotPlayer" },
  MXPLAYER: { id: "mxplayer", name: "MX Player" },
  KMPLAYER: { id: "kmplayer", name: "KMPlayer" },
  GOMPLAYER: { id: "gomplayer", name: "GOM Player" },
  NPLAYER: { id: "nplayer", name: "nPlayer" },
} as const;

/**
 * Get available players based on the current platform
 * @returns Array of available player options
 */
export const getAvailablePlayers = (): PlayerOption[] => {
  const players: PlayerOption[] = [];
  const isDesktop = isMac() || isWindows() || isLinux();
  const isMobile = isIOS() || isAndroid();

  // Desktop players
  if (isDesktop) {
    players.push(PLAYERS.VLC);
    players.push(PLAYERS.MPV);

    // Mac-specific players
    if (isMac()) {
      players.push(PLAYERS.IINA);
      players.push(PLAYERS.INFUSE);
    }

    // Windows-specific players
    if (isWindows()) {
      players.push(PLAYERS.POTPLAYER);
      players.push(PLAYERS.KMPLAYER);
      players.push(PLAYERS.GOMPLAYER);
    }
  }

  // Mobile players
  if (isMobile) {
    players.push(PLAYERS.VLC);

    // iOS-specific players
    if (isIOS()) {
      players.push(PLAYERS.INFUSE);
      players.push(PLAYERS.NPLAYER);
    }

    // Android-specific players
    if (isAndroid()) {
      players.push(PLAYERS.MXPLAYER);
      players.push(PLAYERS.KMPLAYER);
    }
  }

  // Fallback: if no platform detected, at least offer VLC
  if (players.length === 0) {
    players.push(PLAYERS.VLC);
  }

  // Remove duplicates by converting to Map and back to array
  const playerMap = new Map<string, PlayerOption>();
  for (const player of players) {
    if (!playerMap.has(player.id)) {
      playerMap.set(player.id, player);
    }
  }

  return Array.from(playerMap.values());
};

/**
 * Generate a player URL scheme for the given player ID and video URL
 * @param playerId - The ID of the player (e.g., 'vlc', 'iina', 'mpv')
 * @param videoUrl - The URL of the video to play
 * @returns The player URL scheme, or empty string if playerId is invalid
 */
export const getPlayerUrl = (playerId: string, videoUrl: string): string => {
  // Validate inputs
  if (!playerId || !videoUrl) {
    return "";
  }

  // Ensure videoUrl is a valid string
  const encodedUrl = encodeURIComponent(videoUrl);

  switch (playerId) {
    case "vlc":
      return `vlc://${videoUrl}`;
    case "iina":
      return `iina://weblink?url=${encodedUrl}`;
    case "mpv":
      return `mpv://${videoUrl}`;
    case "potplayer":
      return `potplayer://${videoUrl}`;
    case "infuse":
      return `infuse://x-callback-url/play?url=${encodedUrl}`;
    case "mxplayer":
      // MX Player Android intent URL
      return `intent:${videoUrl}#Intent;package=com.mxtech.videoplayer.ad;action=android.intent.action.VIEW;type=video/*;end`;
    case "kmplayer":
      // KMPlayer URL scheme (may vary by platform)
      return `kmplayer://${videoUrl}`;
    case "gomplayer":
      // GOM Player URL scheme
      return `gomplayer://${videoUrl}`;
    case "nplayer":
      // nPlayer iOS URL scheme
      return `nplayer://${encodedUrl}`;
    default:
      return "";
  }
};
