type PlaylistSourceLike = {
  author?: string | null;
  playlistTitle?: string | null;
  subscriptionType?: string | null;
  playlistId?: string | null;
};

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function stripChannelSuffixFromPlaylistName(
  playlistName: string | null | undefined,
  channelName: string | null | undefined
): string {
  const cleanPlaylistName = clean(playlistName);
  const cleanChannelName = clean(channelName);
  if (!cleanPlaylistName || !cleanChannelName) {
    return cleanPlaylistName;
  }

  const suffix = ` - ${cleanChannelName}`;
  return cleanPlaylistName.endsWith(suffix)
    ? cleanPlaylistName.slice(0, -suffix.length).trim()
    : cleanPlaylistName;
}

export function isPlaylistSource(input: PlaylistSourceLike): boolean {
  return input.subscriptionType === "playlist" || Boolean(input.playlistId);
}

export function inferPlaylistChannelNameFromDisplayName(
  displayName: string | null | undefined,
  playlistTitle: string | null | undefined
): string {
  const cleanDisplayName = clean(displayName);
  const cleanPlaylistTitle = clean(playlistTitle);
  if (!cleanDisplayName || !cleanPlaylistTitle) {
    return "";
  }

  const prefix = `${cleanPlaylistTitle} - `;
  return cleanDisplayName.startsWith(prefix)
    ? cleanDisplayName.slice(prefix.length).trim()
    : "";
}

export function resolvePlaylistSourceCustomName(
  input: PlaylistSourceLike
): string {
  return (
    inferPlaylistChannelNameFromDisplayName(input.author, input.playlistTitle) ||
    clean(input.author)
  );
}

