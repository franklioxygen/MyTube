import type { LibraryCapabilities, Video } from '../types';

type LibraryItem = Pick<Video, 'origin' | 'capabilities'> | null | undefined;

/** An item synced from another instance, played through this one's gateway. */
export const isRemoteVideo = (video: LibraryItem): boolean => video?.origin?.kind === 'remote';

/**
 * Whether this instance can do `capability` with the item. Native videos keep
 * every existing behaviour (callers still apply role checks); a remote item
 * can only do what the server says, so an unsupported action is never sent to
 * a native handler.
 */
export const videoCan = (video: LibraryItem, capability: keyof LibraryCapabilities): boolean =>
    !isRemoteVideo(video) || video?.capabilities?.[capability] === true;

/** The instance a remote item comes from, or null for a native video. */
export const remoteInstanceName = (video: LibraryItem): string | null =>
    video?.origin?.kind === 'remote' ? video.origin.instanceName : null;

/** How often the library list revalidates while other instances feed it. */
export const LIBRARY_POLL_MS = 30_000;

/**
 * Poll while the list holds remote items, or while the server says the owner
 * has connected peers whose first sync may not have landed yet.
 */
export const libraryPollInterval = (
    videos: readonly Pick<Video, 'origin' | 'capabilities'>[] | undefined,
    hasPeers: boolean,
): number | false => (hasPeers || (videos ?? []).some(isRemoteVideo) ? LIBRARY_POLL_MS : false);
