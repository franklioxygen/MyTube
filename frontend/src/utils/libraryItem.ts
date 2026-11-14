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
